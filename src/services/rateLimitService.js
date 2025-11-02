const logger = require('./logger')

/**
 * Intelligent Rate Limiting Service
 * Manages rate limits across multiple external APIs with queue management,
 * adaptive throttling, and priority-based request handling
 */
class RateLimitService {
  constructor (config = {}) {
    this.globalConfig = {
      defaultWindowMs: config.defaultWindowMs || 60000, // 1 minute
      defaultMaxRequests: config.defaultMaxRequests || 100,
      queueTimeout: config.queueTimeout || 30000, // 30 seconds
      adaptiveThrottling: config.adaptiveThrottling !== false,
      priorityLevels: config.priorityLevels || ['low', 'normal', 'high', 'critical']
    }

    // Service-specific rate limiters
    this.services = new Map()

    // Global request queue with priority support
    this.requestQueue = {
      critical: [],
      high: [],
      normal: [],
      low: []
    }

    // Queue processing state
    this.queueProcessor = {
      isRunning: false,
      processInterval: null,
      processDelay: 100 // Base delay between queue processing
    }

    // Adaptive throttling state
    this.adaptiveState = {
      errorRates: new Map(),
      responseTimers: new Map(),
      throttleFactors: new Map()
    }

    // Global statistics
    this.globalStats = {
      totalRequests: 0,
      totalQueued: 0,
      totalTimedOut: 0,
      totalErrors: 0,
      averageWaitTime: 0,
      peakQueueSize: 0
    }

    this.startQueueProcessor()
    this.startAdaptiveThrottling()

    logger.info('Rate Limiting Service initialized', {
      defaultWindowMs: this.globalConfig.defaultWindowMs,
      defaultMaxRequests: this.globalConfig.defaultMaxRequests,
      adaptiveThrottling: this.globalConfig.adaptiveThrottling
    })
  }

  /**
   * Register a new service with specific rate limiting configuration
   */
  registerService (serviceName, config) {
    const serviceConfig = {
      maxRequests: config.maxRequests || this.globalConfig.defaultMaxRequests,
      windowMs: config.windowMs || this.globalConfig.defaultWindowMs,
      burstAllowance: config.burstAllowance || Math.floor(config.maxRequests * 0.2),
      backoffMultiplier: config.backoffMultiplier || 1.5,
      maxBackoffDelay: config.maxBackoffDelay || 60000,
      priority: config.priority || 'normal'
    }

    this.services.set(serviceName, {
      config: serviceConfig,
      requestHistory: [],
      burstTokens: serviceConfig.burstAllowance,
      lastBurstRefill: Date.now(),
      currentBackoffDelay: 0,
      stats: {
        totalRequests: 0,
        throttledRequests: 0,
        averageWaitTime: 0,
        errorRate: 0,
        lastRequestTime: null
      }
    })

    // Initialize adaptive throttling state
    this.adaptiveState.errorRates.set(serviceName, { errors: 0, total: 0 })
    this.adaptiveState.responseTimers.set(serviceName, [])
    this.adaptiveState.throttleFactors.set(serviceName, 1.0)

    logger.info('Registered rate limiting service', { serviceName, config: serviceConfig })
  }

  /**
   * Make a rate-limited request
   */
  async makeRequest (serviceName, requestFn, options = {}) {
    const service = this.services.get(serviceName)
    if (!service) {
      throw new Error(`Service '${serviceName}' not registered with rate limiter`)
    }

    const priority = options.priority || service.config.priority
    const timeout = options.timeout || this.globalConfig.queueTimeout

    // Create request promise with timeout
    return new Promise((resolve, reject) => {
      const requestItem = {
        serviceName,
        requestFn,
        options,
        priority,
        resolve,
        reject,
        createdAt: Date.now(),
        timeout: setTimeout(() => {
          this.removeFromQueue(requestItem)
          this.globalStats.totalTimedOut++
          reject(new Error(`Request timed out after ${timeout}ms`))
        }, timeout)
      }

      // Add to appropriate priority queue
      this.requestQueue[priority].push(requestItem)
      this.globalStats.totalQueued++

      // Update peak queue size
      const currentQueueSize = this.getTotalQueueSize()
      if (currentQueueSize > this.globalStats.peakQueueSize) {
        this.globalStats.peakQueueSize = currentQueueSize
      }

      logger.debug('Request queued', {
        serviceName,
        priority,
        queueSize: currentQueueSize,
        position: this.requestQueue[priority].length
      })
    })
  }

  /**
   * Check if request can be made immediately
   */
  canMakeRequest (serviceName) {
    const service = this.services.get(serviceName)
    if (!service) {
      return false
    }

    const now = Date.now()
    const adaptiveThrottleFactor = this.adaptiveState.throttleFactors.get(serviceName) || 1.0
    const effectiveMaxRequests = Math.floor(service.config.maxRequests / adaptiveThrottleFactor)
    const effectiveWindowMs = service.config.windowMs * adaptiveThrottleFactor

    // Clean old requests from history
    service.requestHistory = service.requestHistory.filter(
      timestamp => now - timestamp < effectiveWindowMs
    )

    // Check burst tokens first
    this.refillBurstTokens(service, now)
    if (service.burstTokens > 0) {
      return true
    }

    // Check regular rate limit
    return service.requestHistory.length < effectiveMaxRequests
  }

  /**
   * Execute a request if rate limit allows
   */
  async executeRequest (requestItem) {
    const { serviceName, requestFn, options } = requestItem
    const service = this.services.get(serviceName)

    if (!this.canMakeRequest(serviceName)) {
      return false // Cannot execute now, keep in queue
    }

    const startTime = Date.now()

    try {
      // Use burst token if available
      if (service.burstTokens > 0) {
        service.burstTokens--
        logger.debug('Used burst token', { serviceName, tokensLeft: service.burstTokens })
      }

      // Record request in history
      service.requestHistory.push(startTime)
      service.stats.totalRequests++
      service.stats.lastRequestTime = startTime
      this.globalStats.totalRequests++

      // Execute the actual request
      const result = await requestFn()

      // Record successful execution
      const executionTime = Date.now() - startTime
      this.updateAdaptiveThrottling(serviceName, executionTime, false)

      // Update wait time statistics
      const waitTime = startTime - requestItem.createdAt
      this.updateWaitTimeStats(service, waitTime)

      // Clear timeout and resolve
      clearTimeout(requestItem.timeout)
      requestItem.resolve(result)

      logger.debug('Request executed successfully', {
        serviceName,
        executionTime,
        waitTime
      })

      return true
    } catch (error) {
      // Record error for adaptive throttling
      this.updateAdaptiveThrottling(serviceName, Date.now() - startTime, true)
      this.globalStats.totalErrors++

      // Update backoff delay
      service.currentBackoffDelay = Math.min(
        service.currentBackoffDelay * service.config.backoffMultiplier,
        service.config.maxBackoffDelay
      )

      // Clear timeout and reject
      clearTimeout(requestItem.timeout)
      requestItem.reject(error)

      logger.error('Request execution failed', {
        serviceName,
        error: error.message,
        newBackoffDelay: service.currentBackoffDelay
      })

      return true // Remove from queue even on error
    }
  }

  /**
   * Refill burst tokens
   */
  refillBurstTokens (service, now) {
    const timeSinceRefill = now - service.lastBurstRefill
    const tokensToAdd = Math.floor(timeSinceRefill / (service.config.windowMs / service.config.burstAllowance))

    if (tokensToAdd > 0) {
      service.burstTokens = Math.min(
        service.burstTokens + tokensToAdd,
        service.config.burstAllowance
      )
      service.lastBurstRefill = now
    }
  }

  /**
   * Update wait time statistics
   */
  updateWaitTimeStats (service, waitTime) {
    const currentAvg = service.stats.averageWaitTime
    const totalRequests = service.stats.totalRequests

    service.stats.averageWaitTime = (currentAvg * (totalRequests - 1) + waitTime) / totalRequests

    // Update global average
    const globalAvg = this.globalStats.averageWaitTime
    const globalTotal = this.globalStats.totalRequests
    this.globalStats.averageWaitTime = (globalAvg * (globalTotal - 1) + waitTime) / globalTotal
  }

  /**
   * Update adaptive throttling based on response time and errors
   */
  updateAdaptiveThrottling (serviceName, responseTime, isError) {
    if (!this.globalConfig.adaptiveThrottling) {
      return
    }

    // Update error rate
    const errorData = this.adaptiveState.errorRates.get(serviceName)
    errorData.total++
    if (isError) {
      errorData.errors++
    }

    // Update response time history
    const responseTimes = this.adaptiveState.responseTimers.get(serviceName)
    responseTimes.push(responseTime)
    if (responseTimes.length > 100) {
      responseTimes.shift() // Keep only last 100 responses
    }

    // Calculate new throttle factor
    let throttleFactor = 1.0

    // Increase throttling based on error rate
    const errorRate = errorData.errors / errorData.total
    if (errorRate > 0.1) { // 10% error rate
      throttleFactor *= 1 + (errorRate - 0.1) * 2 // Increase throttling
    }

    // Increase throttling based on slow response times
    if (responseTimes.length >= 10) {
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      if (avgResponseTime > 5000) { // 5+ seconds average
        throttleFactor *= 1 + ((avgResponseTime - 5000) / 10000) // Gradual increase
      }
    }

    // Apply throttle factor with smoothing
    const currentFactor = this.adaptiveState.throttleFactors.get(serviceName)
    const smoothedFactor = currentFactor * 0.9 + throttleFactor * 0.1
    this.adaptiveState.throttleFactors.set(serviceName, Math.max(1.0, smoothedFactor))

    logger.debug('Updated adaptive throttling', {
      serviceName,
      errorRate,
      avgResponseTime: responseTimes.length ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : 0,
      throttleFactor: smoothedFactor
    })
  }

  /**
   * Process request queue with priority handling
   */
  async processQueue () {
    if (this.queueProcessor.isRunning) {
      return
    }

    this.queueProcessor.isRunning = true

    try {
      // Process requests by priority order
      for (const priority of this.globalConfig.priorityLevels.reverse()) {
        const queue = this.requestQueue[priority]

        while (queue.length > 0) {
          const requestItem = queue.shift()

          // Check if request has timed out
          if (Date.now() - requestItem.createdAt > this.globalConfig.queueTimeout) {
            clearTimeout(requestItem.timeout)
            requestItem.reject(new Error('Request timed out in queue'))
            this.globalStats.totalTimedOut++
            continue
          }

          // Try to execute request
          const executed = await this.executeRequest(requestItem)
          if (!executed) {
            // Put back at front of queue if couldn't execute
            queue.unshift(requestItem)
            break // Try again later
          }

          // Add delay to prevent overwhelming
          await this.sleep(this.queueProcessor.processDelay)
        }
      }
    } catch (error) {
      logger.error('Error processing request queue', { error: error.message })
    } finally {
      this.queueProcessor.isRunning = false
    }
  }

  /**
   * Remove request from queue
   */
  removeFromQueue (requestItem) {
    const priority = requestItem.priority
    const queue = this.requestQueue[priority]
    const index = queue.indexOf(requestItem)
    if (index !== -1) {
      queue.splice(index, 1)
    }
  }

  /**
   * Get total queue size across all priorities
   */
  getTotalQueueSize () {
    return Object.values(this.requestQueue).reduce((total, queue) => total + queue.length, 0)
  }

  /**
   * Start queue processor
   */
  startQueueProcessor () {
    this.queueProcessor.processInterval = setInterval(() => {
      if (this.getTotalQueueSize() > 0) {
        this.processQueue()
      }
    }, this.queueProcessor.processDelay)

    logger.info('Queue processor started')
  }

  /**
   * Start adaptive throttling cleanup
   */
  startAdaptiveThrottling () {
    // Reset error rates periodically
    setInterval(() => {
      for (const [serviceName, errorData] of this.adaptiveState.errorRates) {
        // Decay error rate gradually
        errorData.errors = Math.floor(errorData.errors * 0.95)
        errorData.total = Math.floor(errorData.total * 0.95)

        // Reset throttle factor gradually
        const currentFactor = this.adaptiveState.throttleFactors.get(serviceName)
        const newFactor = currentFactor * 0.99 // Gradual recovery
        this.adaptiveState.throttleFactors.set(serviceName, Math.max(1.0, newFactor))
      }
    }, 30000) // Every 30 seconds
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

    const adaptiveState = {
      throttleFactor: this.adaptiveState.throttleFactors.get(serviceName),
      errorRate: this.adaptiveState.errorRates.get(serviceName),
      avgResponseTime: this.adaptiveState.responseTimers.get(serviceName).length
        ? this.adaptiveState.responseTimers.get(serviceName).reduce((a, b) => a + b, 0) / this.adaptiveState.responseTimers.get(serviceName).length
        : 0
    }

    return {
      serviceName,
      config: service.config,
      stats: service.stats,
      adaptiveState,
      currentState: {
        requestsInWindow: service.requestHistory.length,
        burstTokens: service.burstTokens,
        backoffDelay: service.currentBackoffDelay,
        canMakeRequest: this.canMakeRequest(serviceName)
      }
    }
  }

  /**
   * Get global statistics
   */
  getGlobalStats () {
    return {
      ...this.globalStats,
      services: this.services.size,
      currentQueueSize: this.getTotalQueueSize(),
      queueByPriority: Object.fromEntries(
        Object.entries(this.requestQueue).map(([priority, queue]) => [priority, queue.length])
      ),
      adaptiveThrottling: this.globalConfig.adaptiveThrottling,
      processorRunning: this.queueProcessor.isRunning
    }
  }

  /**
   * Get health status
   */
  getHealthStatus () {
    const totalQueueSize = this.getTotalQueueSize()
    const errorRate = this.globalStats.totalRequests > 0
      ? this.globalStats.totalErrors / this.globalStats.totalRequests
      : 0

    let status = 'healthy'
    if (totalQueueSize > 100 || errorRate > 0.1) {
      status = 'degraded'
    }
    if (totalQueueSize > 500 || errorRate > 0.3) {
      status = 'unhealthy'
    }

    return {
      service: 'Rate Limiting Service',
      status,
      totalQueueSize,
      errorRate,
      averageWaitTime: this.globalStats.averageWaitTime,
      registeredServices: this.services.size,
      adaptiveThrottling: this.globalConfig.adaptiveThrottling
    }
  }

  /**
   * Cleanup and shutdown
   */
  shutdown () {
    if (this.queueProcessor.processInterval) {
      clearInterval(this.queueProcessor.processInterval)
      this.queueProcessor.processInterval = null
    }

    // Reject all pending requests
    for (const priority in this.requestQueue) {
      const queue = this.requestQueue[priority]
      while (queue.length > 0) {
        const requestItem = queue.shift()
        clearTimeout(requestItem.timeout)
        requestItem.reject(new Error('Rate limiting service is shutting down'))
      }
    }

    logger.info('Rate Limiting Service shut down')
  }
}

module.exports = RateLimitService
