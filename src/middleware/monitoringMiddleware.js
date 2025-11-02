/**
 * Monitoring Middleware
 * Express middleware for automatic error tracking, performance monitoring, and request logging
 */

const ErrorTrackingService = require('../services/errorTrackingService')
const PerformanceMetricsService = require('../services/performanceMetricsService')

class MonitoringMiddleware {
  constructor () {
    this.errorTracking = new ErrorTrackingService()
    this.performanceMetrics = new PerformanceMetricsService()
    this.initialized = false
  }

  /**
     * Initialize monitoring middleware
     */
  async initialize () {
    if (this.initialized) return

    await this.errorTracking.initialize()
    this.performanceMetrics.startCollection()
    this.initialized = true
  }

  /**
     * Request timing middleware
     */
  requestTiming () {
    return (req, res, next) => {
      req.startTime = Date.now()

      // Add request ID for tracking
      req.requestId = this.generateRequestId()

      // Track request start
      res.on('finish', () => {
        const responseTime = Date.now() - req.startTime
        const size = parseInt(res.get('Content-Length') || '0')

        this.performanceMetrics.recordRequest(
          req.route?.path || req.path,
          req.method,
          res.statusCode,
          responseTime,
          size
        )
      })

      next()
    }
  }

  /**
     * Error tracking middleware
     */
  errorTracking () {
    return async (error, req, res, next) => {
      // Track the error
      const errorId = await this.errorTracking.trackError(error, {
        type: this.categorizeRequestError(error, req),
        severity: this.determineSeverity(error, res.statusCode),
        endpoint: req.path,
        method: req.method,
        userAgent: req.get('User-Agent'),
        ipAddress: req.ip || req.connection.remoteAddress,
        requestId: req.requestId,
        context: {
          query: req.query,
          params: req.params,
          headers: this.sanitizeHeaders(req.headers),
          body: this.sanitizeBody(req.body)
        }
      })

      // Add error ID to response headers
      res.set('X-Error-ID', errorId)

      // Continue with default error handling
      next(error)
    }
  }

  /**
     * Request logging middleware
     */
  requestLogging () {
    return (req, res, next) => {
      const startTime = Date.now()

      // Log request start
      // eslint-disable-next-line no-console
      console.log(`${new Date().toISOString()} [${req.requestId}] ${req.method} ${req.path} - ${req.ip}`)

      res.on('finish', () => {
        const responseTime = Date.now() - startTime
        const logLevel = res.statusCode >= 400 ? 'ERROR' : 'INFO'

        // eslint-disable-next-line no-console
        console.log(
                    `${new Date().toISOString()} [${req.requestId}] ${logLevel}: ` +
                    `${req.method} ${req.path} - ${res.statusCode} - ${responseTime}ms - ${req.ip}`
        )
      })

      next()
    }
  }

  /**
     * Rate limiting monitoring middleware
     */
  rateLimitMonitoring () {
    return (req, res, next) => {
      // Check if rate limited
      if (res.statusCode === 429) {
        this.errorTracking.trackError(new Error('Rate limit exceeded'), {
          type: 'RATE_LIMIT_ERROR',
          severity: 'low',
          endpoint: req.path,
          method: req.method,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          requestId: req.requestId
        })
      }

      next()
    }
  }

  /**
     * Security monitoring middleware
     */
  securityMonitoring () {
    return (req, res, next) => {
      // Monitor for suspicious patterns
      const suspiciousPatterns = [
        /(<script.*?>)/i,
        /(union.*select)/i,
        /(drop.*table)/i,
        /(exec.*xp_)/i,
        /(\.\.)/,
        /(\/etc\/passwd)/i
      ]

      const checkValue = (value) => {
        if (typeof value === 'string') {
          return suspiciousPatterns.some(pattern => pattern.test(value))
        }
        return false
      }

      let suspicious = false
      const suspiciousData = []

      // Check query parameters
      for (const [key, value] of Object.entries(req.query || {})) {
        if (checkValue(value)) {
          suspicious = true
          suspiciousData.push({ type: 'query', key, value })
        }
      }

      // Check request body
      if (req.body && typeof req.body === 'object') {
        for (const [key, value] of Object.entries(req.body)) {
          if (checkValue(value)) {
            suspicious = true
            suspiciousData.push({ type: 'body', key, value })
          }
        }
      }

      // Check headers for suspicious values
      const suspiciousHeaders = req.get('User-Agent')
      if (suspiciousHeaders && checkValue(suspiciousHeaders)) {
        suspicious = true
        suspiciousData.push({ type: 'header', key: 'User-Agent', value: suspiciousHeaders })
      }

      if (suspicious) {
        this.errorTracking.trackError(new Error('Suspicious request detected'), {
          type: 'SECURITY_ALERT',
          severity: 'medium',
          endpoint: req.path,
          method: req.method,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          requestId: req.requestId,
          details: {
            suspiciousData,
            fullUrl: req.originalUrl
          }
        })
      }

      next()
    }
  }

  /**
     * API usage monitoring middleware
     */
  apiUsageMonitoring () {
    return (req, res, next) => {
      // Track API key usage if present
      const apiKey = req.get('X-API-Key') || req.query.api_key
      if (apiKey) {
        // Would track API key usage here
        // eslint-disable-next-line no-console
        console.log(`API Key used: ${apiKey.substring(0, 8)}...`)
      }

      // Track endpoint usage patterns
      res.on('finish', () => {
        const usageData = {
          endpoint: req.path,
          method: req.method,
          statusCode: res.statusCode,
          timestamp: Date.now(),
          apiKey: apiKey ? apiKey.substring(0, 8) + '...' : null,
          userAgent: req.get('User-Agent'),
          ipAddress: req.ip
        }

        // Store usage data (would typically go to database)
        // eslint-disable-next-line no-console
        console.log('API Usage:', JSON.stringify(usageData))
      })

      next()
    }
  }

  /**
     * Categorize request errors
     */
  categorizeRequestError (error, _req) {
    const message = error.message.toLowerCase()

    if (message.includes('validation')) return 'VALIDATION_ERROR'
    if (message.includes('authentication') || message.includes('unauthorized')) return 'AUTHENTICATION_ERROR'
    if (message.includes('permission') || message.includes('forbidden')) return 'PERMISSION_ERROR'
    if (message.includes('not found') || message.includes('404')) return 'NOT_FOUND_ERROR'
    if (message.includes('timeout')) return 'TIMEOUT_ERROR'
    if (message.includes('database') || message.includes('connection')) return 'DATABASE_ERROR'
    if (message.includes('rate limit')) return 'RATE_LIMIT_ERROR'

    return 'API_ERROR'
  }

  /**
     * Determine error severity based on error and status code
     */
  determineSeverity (error, statusCode) {
    // Handle potential error object
    if (error) {
      // Error object is available for additional analysis if needed
    }

    if (statusCode >= 500) return 'high'
    if (statusCode === 401 || statusCode === 403) return 'medium'
    if (statusCode === 404) return 'low'
    if (statusCode === 429) return 'low'
    if (statusCode >= 400) return 'medium'

    return 'low'
  }

  /**
     * Sanitize headers for logging
     */
  sanitizeHeaders (headers) {
    const sanitized = { ...headers }

    // Remove sensitive headers
    const sensitiveHeaders = [
      'authorization',
      'cookie',
      'x-api-key',
      'x-auth-token'
    ]

    sensitiveHeaders.forEach(header => {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]'
      }
    })

    return sanitized
  }

  /**
     * Sanitize request body for logging
     */
  sanitizeBody (body) {
    if (!body || typeof body !== 'object') return body

    const sanitized = { ...body }

    // Remove sensitive fields
    const sensitiveFields = [
      'password',
      'token',
      'secret',
      'key',
      'apiKey',
      'authToken'
    ]

    const sanitizeObject = (obj) => {
      if (typeof obj !== 'object' || obj === null) return obj

      const result = {}
      for (const [key, value] of Object.entries(obj)) {
        if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
          result[key] = '[REDACTED]'
        } else if (typeof value === 'object') {
          result[key] = sanitizeObject(value)
        } else {
          result[key] = value
        }
      }
      return result
    }

    return sanitizeObject(sanitized)
  }

  /**
     * Generate unique request ID
     */
  generateRequestId () {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
  }

  /**
     * Get combined middleware stack
     */
  getAllMiddleware () {
    return [
      this.requestTiming(),
      this.requestLogging(),
      this.securityMonitoring(),
      this.apiUsageMonitoring(),
      this.rateLimitMonitoring()
    ]
  }

  /**
     * Get error handling middleware
     */
  getErrorMiddleware () {
    return this.errorTracking()
  }

  /**
     * Cleanup resources
     */
  async cleanup () {
    if (this.errorTracking) {
      this.errorTracking.cleanup()
    }
    if (this.performanceMetrics) {
      this.performanceMetrics.cleanup()
    }
  }
}

module.exports = MonitoringMiddleware
