const logger = require('./logger')

/**
 * Enhanced Error Handling Service
 * Provides comprehensive error handling with circuit breaker pattern,
 * exponential backoff, retry mechanisms, and failure analytics
 */
class ErrorHandlingService {
  constructor (config = {}) {
    this.globalConfig = {
      defaultMaxRetries: config.defaultMaxRetries || 3,
      defaultRetryDelay: config.defaultRetryDelay || 1000,
      defaultCircuitBreakerThreshold: config.defaultCircuitBreakerThreshold || 5,
      defaultCircuitBreakerTimeout: config.defaultCircuitBreakerTimeout || 60000,
      exponentialBackoffMultiplier: config.exponentialBackoffMultiplier || 2,
      maxBackoffDelay: config.maxBackoffDelay || 60000,
      jitterEnabled: config.jitterEnabled !== false,
      healthCheckInterval: config.healthCheckInterval || 30000
    }

    // Service-specific configurations
    this.services = new Map()

    // Global error analytics
    this.analytics = {
      totalErrors: 0,
      errorsByType: new Map(),
      errorsByService: new Map(),
      circuitBreakerTrips: 0,
      successfulRetries: 0,
      failedRetries: 0,
      averageRecoveryTime: 0
    }

    // Error classification patterns
    this.errorPatterns = {
      network: [
        'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND',
        'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE'
      ],
      rateLimit: [
        'rate limit', 'too many requests', '429'
      ],
      authentication: [
        'unauthorized', 'forbidden', '401', '403', 'invalid api key'
      ],
      serverError: [
        '500', '502', '503', '504', 'internal server error',
        'bad gateway', 'service unavailable', 'gateway timeout'
      ],
      clientError: [
        '400', '404', '409', '422', 'bad request', 'not found',
        'conflict', 'unprocessable entity'
      ]
    }

    // Start health monitoring
    this.startHealthMonitoring()

    logger.info('Error Handling Service initialized', {
      defaultMaxRetries: this.globalConfig.defaultMaxRetries,
      circuitBreakerEnabled: true,
      exponentialBackoff: true
    })
  }

  /**
   * Register a service with specific error handling configuration
   */
  registerService (serviceName, config = {}) {
    const serviceConfig = {
      maxRetries: config.maxRetries || this.globalConfig.defaultMaxRetries,
      retryDelay: config.retryDelay || this.globalConfig.defaultRetryDelay,
      circuitBreaker: {
        threshold: config.circuitBreakerThreshold || this.globalConfig.defaultCircuitBreakerThreshold,
        timeout: config.circuitBreakerTimeout || this.globalConfig.defaultCircuitBreakerTimeout,
        isOpen: false,
        failureCount: 0,
        lastFailureTime: null,
        halfOpenRetryCount: 0,
        maxHalfOpenRetries: config.maxHalfOpenRetries || 3
      },
      retryableErrors: config.retryableErrors || ['network', 'rateLimit', 'serverError'],
      nonRetryableErrors: config.nonRetryableErrors || ['authentication', 'clientError'],
      customErrorHandler: config.customErrorHandler || null,
      healthCheck: config.healthCheck || null
    }

    this.services.set(serviceName, {
      config: serviceConfig,
      stats: {
        totalRequests: 0,
        totalErrors: 0,
        retriedRequests: 0,
        circuitBreakerTrips: 0,
        lastError: null,
        lastSuccessTime: Date.now(),
        averageErrorRate: 0,
        averageRecoveryTime: 0
      }
    })

    // Initialize analytics for this service
    this.analytics.errorsByService.set(serviceName, {
      total: 0,
      byType: new Map(),
      circuitBreakerTrips: 0,
      successfulRetries: 0,
      failedRetries: 0
    })

    logger.info('Registered error handling service', { serviceName, config: serviceConfig })
  }

  /**
   * Execute a function with comprehensive error handling
   */
  async executeWithErrorHandling (serviceName, fn, options = {}) {
    const service = this.services.get(serviceName)
    if (!service) {
      throw new Error(`Service '${serviceName}' not registered with error handler`)
    }

    const startTime = Date.now()
    service.stats.totalRequests++

    // Check circuit breaker
    if (service.config.circuitBreaker.isOpen) {
      const canRetry = this.checkCircuitBreakerTimeout(service)
      if (!canRetry) {
        const error = new Error(`Circuit breaker is open for service '${serviceName}'`)
        error.type = 'CIRCUIT_BREAKER_OPEN'
        throw error
      }
    }

    const maxRetries = options.maxRetries || service.config.maxRetries
    let lastError = null

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const result = await fn()

        // Success - update circuit breaker and stats
        this.recordSuccess(service, serviceName, startTime)

        if (attempt > 1) {
          // This was a successful retry
          this.analytics.successfulRetries++
          this.analytics.errorsByService.get(serviceName).successfulRetries++

          logger.info('Request succeeded after retry', {
            serviceName,
            attempt,
            totalTime: Date.now() - startTime
          })
        }

        return result
      } catch (error) {
        lastError = error
        const isLastAttempt = attempt === maxRetries + 1

        // Classify and analyze error
        const errorType = this.classifyError(error)
        this.recordError(service, serviceName, error, errorType)

        // Check if error should be retried
        const shouldRetry = !isLastAttempt && this.shouldRetryError(service, error, errorType, attempt)

        if (!shouldRetry) {
          // Final failure
          if (attempt > 1) {
            this.analytics.failedRetries++
            this.analytics.errorsByService.get(serviceName).failedRetries++
          }

          logger.error('Request failed permanently', {
            serviceName,
            attempts: attempt,
            errorType,
            error: error.message
          })

          throw this.enhanceError(error, {
            serviceName,
            attempts: attempt,
            errorType,
            circuitBreakerOpen: service.config.circuitBreaker.isOpen
          })
        }

        // Calculate retry delay
        const delay = this.calculateRetryDelay(service, attempt, errorType)

        logger.warn('Request failed, retrying', {
          serviceName,
          attempt,
          maxRetries: maxRetries + 1,
          delay,
          errorType,
          error: error.message
        })

        // Wait before retry
        await this.sleep(delay)
      }
    }

    // This should never be reached, but just in case
    throw lastError
  }

  /**
   * Classify error type based on patterns
   */
  classifyError (error) {
    const errorMessage = error.message.toLowerCase()
    const errorCode = error.code?.toUpperCase()
    const statusCode = error.response?.status?.toString()

    for (const [type, patterns] of Object.entries(this.errorPatterns)) {
      for (const pattern of patterns) {
        if (errorMessage.includes(pattern.toLowerCase()) ||
            errorCode === pattern ||
            statusCode === pattern) {
          return type
        }
      }
    }

    return 'unknown'
  }

  /**
   * Determine if error should be retried
   */
  shouldRetryError (service, error, errorType, attempt) {
    // Check if error type is retryable
    if (service.config.nonRetryableErrors.includes(errorType)) {
      return false
    }

    if (!service.config.retryableErrors.includes(errorType) && errorType !== 'unknown') {
      return false
    }

    // Use custom error handler if provided
    if (service.config.customErrorHandler) {
      return service.config.customErrorHandler(error, errorType, attempt)
    }

    // Default retry logic for unknown errors - be conservative
    if (errorType === 'unknown') {
      return attempt <= 2 // Only retry unknown errors once
    }

    return true
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   */
  calculateRetryDelay (service, attempt, errorType) {
    let baseDelay = service.config.retryDelay

    // Adjust base delay based on error type
    switch (errorType) {
      case 'rateLimit':
        baseDelay *= 3 // Longer delay for rate limits
        break
      case 'serverError':
        baseDelay *= 2 // Medium delay for server errors
        break
      case 'network':
        baseDelay *= 1.5 // Shorter delay for network errors
        break
    }

    // Apply exponential backoff
    const exponentialDelay = baseDelay * Math.pow(this.globalConfig.exponentialBackoffMultiplier, attempt - 1)

    // Add jitter to prevent thundering herd
    let jitter = 0
    if (this.globalConfig.jitterEnabled) {
      jitter = Math.random() * 1000
    }

    // Cap at maximum delay
    const finalDelay = Math.min(exponentialDelay + jitter, this.globalConfig.maxBackoffDelay)

    return Math.floor(finalDelay)
  }

  /**
   * Record successful request
   */
  recordSuccess (service, serviceName, startTime) {
    const responseTime = Date.now() - startTime

    // Reset circuit breaker on success
    if (service.config.circuitBreaker.isOpen) {
      service.config.circuitBreaker.isOpen = false
      service.config.circuitBreaker.failureCount = 0
      service.config.circuitBreaker.halfOpenRetryCount = 0

      // Calculate recovery time
      const recoveryTime = Date.now() - service.config.circuitBreaker.lastFailureTime
      this.updateAverageRecoveryTime(service, recoveryTime)

      logger.info('Circuit breaker closed after success', {
        serviceName,
        recoveryTime
      })
    }

    service.stats.lastSuccessTime = Date.now()

    // Update error rate (moving average)
    const totalRequests = service.stats.totalRequests
    const totalErrors = service.stats.totalErrors
    service.stats.averageErrorRate = totalErrors / totalRequests
  }

  /**
   * Record error and update circuit breaker
   */
  recordError (service, serviceName, error, errorType) {
    service.stats.totalErrors++
    service.stats.lastError = {
      message: error.message,
      type: errorType,
      timestamp: new Date().toISOString()
    }

    // Update global analytics
    this.analytics.totalErrors++
    this.analytics.errorsByType.set(errorType, (this.analytics.errorsByType.get(errorType) || 0) + 1)

    const serviceAnalytics = this.analytics.errorsByService.get(serviceName)
    serviceAnalytics.total++
    serviceAnalytics.byType.set(errorType, (serviceAnalytics.byType.get(errorType) || 0) + 1)

    // Update circuit breaker
    this.updateCircuitBreaker(service, serviceName, errorType)

    // Update error rate
    const totalRequests = service.stats.totalRequests
    const totalErrors = service.stats.totalErrors
    service.stats.averageErrorRate = totalErrors / totalRequests
  }

  /**
   * Update circuit breaker state
   */
  updateCircuitBreaker (service, serviceName, errorType) {
    const circuitBreaker = service.config.circuitBreaker

    // Don't trip circuit breaker for client errors
    if (errorType === 'clientError' || errorType === 'authentication') {
      return
    }

    circuitBreaker.failureCount++
    circuitBreaker.lastFailureTime = Date.now()

    // Check if we should open the circuit breaker
    if (!circuitBreaker.isOpen && circuitBreaker.failureCount >= circuitBreaker.threshold) {
      circuitBreaker.isOpen = true
      service.stats.circuitBreakerTrips++
      this.analytics.circuitBreakerTrips++
      this.analytics.errorsByService.get(serviceName).circuitBreakerTrips++

      logger.warn('Circuit breaker opened', {
        serviceName,
        failureCount: circuitBreaker.failureCount,
        threshold: circuitBreaker.threshold
      })
    }
  }

  /**
   * Check if circuit breaker timeout has expired
   */
  checkCircuitBreakerTimeout (service) {
    const circuitBreaker = service.config.circuitBreaker
    const now = Date.now()

    if (now - circuitBreaker.lastFailureTime > circuitBreaker.timeout) {
      // Half-open state - allow limited retries
      if (circuitBreaker.halfOpenRetryCount < circuitBreaker.maxHalfOpenRetries) {
        circuitBreaker.halfOpenRetryCount++
        logger.info('Circuit breaker half-open, allowing retry', {
          retryCount: circuitBreaker.halfOpenRetryCount,
          maxRetries: circuitBreaker.maxHalfOpenRetries
        })
        return true
      }
    }

    return false
  }

  /**
   * Update average recovery time
   */
  updateAverageRecoveryTime (service, recoveryTime) {
    const currentAvg = service.stats.averageRecoveryTime
    const trips = service.stats.circuitBreakerTrips

    if (trips === 1) {
      service.stats.averageRecoveryTime = recoveryTime
    } else {
      service.stats.averageRecoveryTime = (currentAvg * (trips - 1) + recoveryTime) / trips
    }

    // Update global average
    const globalAvg = this.analytics.averageRecoveryTime
    const globalTrips = this.analytics.circuitBreakerTrips

    if (globalTrips === 1) {
      this.analytics.averageRecoveryTime = recoveryTime
    } else {
      this.analytics.averageRecoveryTime = (globalAvg * (globalTrips - 1) + recoveryTime) / globalTrips
    }
  }

  /**
   * Enhance error with additional context
   */
  enhanceError (originalError, context) {
    const enhancedError = new Error(originalError.message)
    enhancedError.name = originalError.name
    enhancedError.originalError = originalError
    enhancedError.context = context
    enhancedError.timestamp = new Date().toISOString()
    enhancedError.stack = originalError.stack

    // Add service-specific error properties
    enhancedError.serviceName = context.serviceName
    enhancedError.errorType = context.errorType
    enhancedError.retryAttempts = context.attempts - 1
    enhancedError.circuitBreakerOpen = context.circuitBreakerOpen

    return enhancedError
  }

  /**
   * Start health monitoring for all services
   */
  startHealthMonitoring () {
    setInterval(async () => {
      for (const [serviceName, service] of this.services) {
        if (service.config.healthCheck) {
          try {
            await service.config.healthCheck()
            logger.debug('Health check passed', { serviceName })
          } catch (error) {
            logger.warn('Health check failed', {
              serviceName,
              error: error.message
            })

            // Record health check failure
            this.recordError(service, serviceName, error, 'healthCheck')
          }
        }
      }
    }, this.globalConfig.healthCheckInterval)
  }

  /**
   * Utility sleep function
   */
  sleep (ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Get service statistics
   */
  getServiceStats (serviceName) {
    const service = this.services.get(serviceName)
    if (!service) {
      return null
    }

    return {
      serviceName,
      config: service.config,
      stats: service.stats,
      circuitBreaker: {
        isOpen: service.config.circuitBreaker.isOpen,
        failureCount: service.config.circuitBreaker.failureCount,
        lastFailureTime: service.config.circuitBreaker.lastFailureTime,
        halfOpenRetryCount: service.config.circuitBreaker.halfOpenRetryCount
      },
      analytics: this.analytics.errorsByService.get(serviceName)
    }
  }

  /**
   * Get global analytics
   */
  getGlobalAnalytics () {
    return {
      ...this.analytics,
      errorsByType: Object.fromEntries(this.analytics.errorsByType),
      errorsByService: Object.fromEntries(
        Array.from(this.analytics.errorsByService.entries()).map(([service, data]) => [
          service,
          {
            ...data,
            byType: Object.fromEntries(data.byType)
          }
        ])
      ),
      totalServices: this.services.size,
      servicesWithOpenCircuitBreakers: Array.from(this.services.entries())
        .filter(([, service]) => service.config.circuitBreaker.isOpen)
        .map(([name]) => name)
    }
  }

  /**
   * Get health status
   */
  getHealthStatus () {
    const openCircuitBreakers = Array.from(this.services.entries())
      .filter(([, service]) => service.config.circuitBreaker.isOpen)

    const totalRequests = Array.from(this.services.values())
      .reduce((sum, service) => sum + service.stats.totalRequests, 0)

    const globalErrorRate = totalRequests > 0 ? this.analytics.totalErrors / totalRequests : 0

    let status = 'healthy'
    if (openCircuitBreakers.length > 0 || globalErrorRate > 0.1) {
      status = 'degraded'
    }
    if (openCircuitBreakers.length > this.services.size / 2 || globalErrorRate > 0.3) {
      status = 'unhealthy'
    }

    return {
      service: 'Error Handling Service',
      status,
      totalServices: this.services.size,
      openCircuitBreakers: openCircuitBreakers.length,
      globalErrorRate,
      totalErrors: this.analytics.totalErrors,
      circuitBreakerTrips: this.analytics.circuitBreakerTrips,
      averageRecoveryTime: this.analytics.averageRecoveryTime
    }
  }

  /**
   * Reset circuit breaker for a service (manual intervention)
   */
  resetCircuitBreaker (serviceName) {
    const service = this.services.get(serviceName)
    if (!service) {
      throw new Error(`Service '${serviceName}' not found`)
    }

    service.config.circuitBreaker.isOpen = false
    service.config.circuitBreaker.failureCount = 0
    service.config.circuitBreaker.halfOpenRetryCount = 0

    logger.info('Circuit breaker manually reset', { serviceName })
  }

  /**
   * Cleanup and shutdown
   */
  shutdown () {
    logger.info('Error Handling Service shut down')
  }
}

module.exports = ErrorHandlingService
