/**
 * Error Tracking Service
 * Comprehensive error monitoring, logging, and alerting
 */

const EventEmitter = require('events')
const fs = require('fs').promises
const path = require('path')
const crypto = require('crypto')

class ErrorTrackingService extends EventEmitter {
  constructor () {
    super()
    this.errors = new Map()
    this.errorHistory = []
    this.errorPatterns = new Map()
    this.alertThresholds = {
      errorRate: 5, // errors per minute
      criticalErrors: 3, // critical errors per hour
      duplicateErrorCount: 10 // same error repeated
    }
    this.maxHistoryEntries = 1000
    this.logDirectory = path.join(process.cwd(), 'logs')
    this.initialized = false
    this.errorCategories = {
      DATABASE_ERROR: { severity: 'high', category: 'database' },
      API_ERROR: { severity: 'medium', category: 'external' },
      VALIDATION_ERROR: { severity: 'low', category: 'validation' },
      AUTHENTICATION_ERROR: { severity: 'medium', category: 'security' },
      RATE_LIMIT_ERROR: { severity: 'low', category: 'rate_limiting' },
      INTERNAL_SERVER_ERROR: { severity: 'high', category: 'internal' },
      TIMEOUT_ERROR: { severity: 'medium', category: 'timeout' },
      NETWORK_ERROR: { severity: 'medium', category: 'network' }
    }
  }

  /**
     * Initialize error tracking service
     */
  async initialize () {
    if (this.initialized) return

    try {
      // Create logs directory if it doesn't exist
      await fs.mkdir(this.logDirectory, { recursive: true })

      // Setup process error handlers
      this.setupProcessErrorHandlers()

      this.initialized = true
      console.log('Error tracking service initialized')
    } catch (error) {
      console.error('Failed to initialize error tracking service:', error)
    }
  }

  /**
     * Setup process-level error handlers
     */
  setupProcessErrorHandlers () {
    // Uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.trackError(error, {
        type: 'UNCAUGHT_EXCEPTION',
        severity: 'critical',
        source: 'process',
        context: 'global'
      })
    })

    // Unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      this.trackError(reason, {
        type: 'UNHANDLED_REJECTION',
        severity: 'critical',
        source: 'promise',
        context: 'global',
        details: { promise: promise.toString() }
      })
    })

    // Warning events
    process.on('warning', (warning) => {
      this.trackError(warning, {
        type: 'PROCESS_WARNING',
        severity: 'low',
        source: 'process',
        context: 'warning'
      })
    })
  }

  /**
     * Track an error
     */
  async trackError (error, options = {}) {
    const timestamp = Date.now()
    const errorId = this.generateErrorId(error)

    const errorData = {
      id: errorId,
      timestamp,
      message: error.message || 'Unknown error',
      name: error.name || 'Error',
      stack: error.stack,
      type: options.type || this.categorizeError(error),
      severity: options.severity || this.determineSeverity(error),
      source: options.source || 'application',
      context: options.context || {},
      userAgent: options.userAgent,
      ipAddress: options.ipAddress,
      userId: options.userId,
      sessionId: options.sessionId,
      requestId: options.requestId,
      endpoint: options.endpoint,
      method: options.method,
      details: {
        ...options.details,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime()
      }
    }

    // Store in memory
    if (this.errors.has(errorId)) {
      const existing = this.errors.get(errorId)
      existing.count++
      existing.lastOccurrence = timestamp
      existing.occurrences.push(timestamp)
    } else {
      this.errors.set(errorId, {
        ...errorData,
        count: 1,
        firstOccurrence: timestamp,
        lastOccurrence: timestamp,
        occurrences: [timestamp],
        resolved: false,
        tags: []
      })
    }

    // Add to history
    this.errorHistory.push(errorData)
    if (this.errorHistory.length > this.maxHistoryEntries) {
      this.errorHistory = this.errorHistory.slice(-this.maxHistoryEntries)
    }

    // Analyze error patterns
    this.analyzeErrorPatterns(errorData)

    // Log to file
    await this.logErrorToFile(errorData)

    // Check for alerts
    this.checkErrorAlerts(errorData)

    // Emit error event
    this.emit('error', errorData)

    return errorId
  }

  /**
     * Generate unique error ID based on error characteristics
     */
  generateErrorId (error) {
    const signature = [
      error.name || 'Error',
      error.message || 'Unknown',
      (error.stack || '').split('\n')[0] // First line of stack trace
    ].join('|')

    return crypto.createHash('md5').update(signature).digest('hex').substring(0, 8)
  }

  /**
     * Categorize error type
     */
  categorizeError (error) {
    const message = (error.message || '').toLowerCase()
    const name = (error.name || '').toLowerCase()

    if (message.includes('database') || message.includes('mongodb') || message.includes('connection')) {
      return 'DATABASE_ERROR'
    }
    if (message.includes('timeout')) {
      return 'TIMEOUT_ERROR'
    }
    if (message.includes('network') || message.includes('fetch') || message.includes('http')) {
      return 'NETWORK_ERROR'
    }
    if (message.includes('validation') || message.includes('invalid')) {
      return 'VALIDATION_ERROR'
    }
    if (message.includes('auth') || message.includes('permission')) {
      return 'AUTHENTICATION_ERROR'
    }
    if (message.includes('rate limit')) {
      return 'RATE_LIMIT_ERROR'
    }
    if (name.includes('api')) {
      return 'API_ERROR'
    }

    return 'INTERNAL_SERVER_ERROR'
  }

  /**
     * Determine error severity
     */
  determineSeverity (error) {
    const errorType = this.categorizeError(error)
    const category = this.errorCategories[errorType]

    if (category) {
      return category.severity
    }

    // Fallback based on error characteristics
    if (error.name === 'TypeError' || error.name === 'ReferenceError') {
      return 'high'
    }
    if (error.name === 'ValidationError') {
      return 'low'
    }

    return 'medium'
  }

  /**
     * Analyze error patterns and trends
     */
  analyzeErrorPatterns (errorData) {
    const patternKey = `${errorData.type}_${errorData.severity}`
    const now = Date.now()
    const hourKey = Math.floor(now / (60 * 60 * 1000)) // Hour bucket

    if (!this.errorPatterns.has(patternKey)) {
      this.errorPatterns.set(patternKey, {
        type: errorData.type,
        severity: errorData.severity,
        hourlyCount: new Map(),
        totalCount: 0,
        firstSeen: now,
        lastSeen: now,
        affectedEndpoints: new Set(),
        affectedUsers: new Set()
      })
    }

    const pattern = this.errorPatterns.get(patternKey)
    pattern.totalCount++
    pattern.lastSeen = now
    pattern.hourlyCount.set(hourKey, (pattern.hourlyCount.get(hourKey) || 0) + 1)

    if (errorData.endpoint) {
      pattern.affectedEndpoints.add(errorData.endpoint)
    }
    if (errorData.userId) {
      pattern.affectedUsers.add(errorData.userId)
    }

    // Clean old hourly data (keep last 24 hours)
    const cutoffHour = hourKey - 24
    for (const [hour] of pattern.hourlyCount) {
      if (hour < cutoffHour) {
        pattern.hourlyCount.delete(hour)
      }
    }
  }

  /**
     * Check for error-based alerts
     */
  checkErrorAlerts (errorData) {
    const alerts = []
    const now = Date.now()
    const error = this.errors.get(errorData.id)

    // Duplicate error alert
    if (error.count >= this.alertThresholds.duplicateErrorCount) {
      alerts.push({
        type: 'duplicate_error',
        severity: 'warning',
        errorId: errorData.id,
        count: error.count,
        message: `Error repeated ${error.count} times: ${errorData.message}`,
        timestamp: now
      })
    }

    // Critical error alert
    if (errorData.severity === 'critical' || errorData.severity === 'high') {
      alerts.push({
        type: 'critical_error',
        severity: 'critical',
        errorId: errorData.id,
        errorType: errorData.type,
        message: `Critical error: ${errorData.message}`,
        timestamp: now
      })
    }

    // Error rate alert
    const recentErrors = this.errorHistory.filter(e => e.timestamp > now - 60000) // Last minute
    if (recentErrors.length >= this.alertThresholds.errorRate) {
      alerts.push({
        type: 'error_rate',
        severity: 'warning',
        count: recentErrors.length,
        message: `High error rate: ${recentErrors.length} errors in the last minute`,
        timestamp: now
      })
    }

    // Emit alerts
    alerts.forEach(alert => {
      this.emit('alert', alert)
    })
  }

  /**
     * Log error to file
     */
  async logErrorToFile (errorData) {
    try {
      const date = new Date(errorData.timestamp)
      const dateString = date.toISOString().split('T')[0] // YYYY-MM-DD
      const logFile = path.join(this.logDirectory, `errors-${dateString}.log`)

      const logEntry = {
        timestamp: new Date(errorData.timestamp).toISOString(),
        level: 'ERROR',
        severity: errorData.severity,
        type: errorData.type,
        message: errorData.message,
        name: errorData.name,
        stack: errorData.stack,
        context: errorData.context,
        details: errorData.details
      }

      const logLine = JSON.stringify(logEntry) + '\n'
      await fs.appendFile(logFile, logLine, 'utf8')
    } catch (error) {
      console.error('Failed to log error to file:', error)
    }
  }

  /**
     * Get error statistics
     */
  getErrorStatistics (timeRange = '24h') {
    const now = Date.now()
    const timeRanges = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000
    }

    const rangeMs = timeRanges[timeRange] || timeRanges['24h']
    const cutoff = now - rangeMs

    const recentErrors = this.errorHistory.filter(e => e.timestamp >= cutoff)
    const errorsByType = new Map()
    const errorsBySeverity = new Map()
    const errorsByHour = new Map()

    recentErrors.forEach(error => {
      // By type
      errorsByType.set(error.type, (errorsByType.get(error.type) || 0) + 1)

      // By severity
      errorsBySeverity.set(error.severity, (errorsBySeverity.get(error.severity) || 0) + 1)

      // By hour
      const hour = Math.floor(error.timestamp / (60 * 60 * 1000))
      errorsByHour.set(hour, (errorsByHour.get(hour) || 0) + 1)
    })

    // Calculate error rate
    const errorRate = recentErrors.length / (rangeMs / 60000) // errors per minute

    // Top errors
    const topErrors = Array.from(this.errors.values())
      .filter(error => error.lastOccurrence >= cutoff)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(error => ({
        id: error.id,
        message: error.message,
        type: error.type,
        severity: error.severity,
        count: error.count,
        lastOccurrence: new Date(error.lastOccurrence).toISOString()
      }))

    return {
      timeRange,
      generatedAt: new Date().toISOString(),
      summary: {
        totalErrors: recentErrors.length,
        uniqueErrors: new Set(recentErrors.map(e => e.id)).size,
        errorRate: Math.round(errorRate * 100) / 100,
        criticalErrors: recentErrors.filter(e => e.severity === 'critical').length,
        resolvedErrors: Array.from(this.errors.values()).filter(e => e.resolved).length
      },
      breakdown: {
        byType: Object.fromEntries(errorsByType),
        bySeverity: Object.fromEntries(errorsBySeverity),
        byHour: Array.from(errorsByHour.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([hour, count]) => ({
            hour: new Date(hour * 60 * 60 * 1000).toISOString(),
            count
          }))
      },
      topErrors,
      patterns: this.getErrorPatterns(cutoff)
    }
  }

  /**
     * Get error patterns analysis
     */
  getErrorPatterns (cutoff) {
    const patterns = []

    for (const [key, pattern] of this.errorPatterns) {
      if (pattern.lastSeen < cutoff) continue

      const recentCount = Array.from(pattern.hourlyCount.values()).reduce((sum, count) => sum + count, 0)

      patterns.push({
        type: pattern.type,
        severity: pattern.severity,
        totalCount: pattern.totalCount,
        recentCount,
        firstSeen: new Date(pattern.firstSeen).toISOString(),
        lastSeen: new Date(pattern.lastSeen).toISOString(),
        affectedEndpoints: Array.from(pattern.affectedEndpoints),
        affectedUsers: pattern.affectedUsers.size,
        trend: this.calculateErrorTrend(pattern)
      })
    }

    return patterns.sort((a, b) => b.recentCount - a.recentCount)
  }

  /**
     * Calculate error trend
     */
  calculateErrorTrend (pattern) {
    const recentHours = Array.from(pattern.hourlyCount.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(-6) // Last 6 hours
      .map(([, count]) => count)

    if (recentHours.length < 2) return 'stable'

    const firstHalf = recentHours.slice(0, Math.floor(recentHours.length / 2))
    const secondHalf = recentHours.slice(Math.floor(recentHours.length / 2))

    const firstAvg = firstHalf.reduce((sum, count) => sum + count, 0) / firstHalf.length
    const secondAvg = secondHalf.reduce((sum, count) => sum + count, 0) / secondHalf.length

    const change = (secondAvg - firstAvg) / (firstAvg || 1)

    if (change > 0.2) return 'increasing'
    if (change < -0.2) return 'decreasing'
    return 'stable'
  }

  /**
     * Get specific error details
     */
  getErrorDetails (errorId) {
    const error = this.errors.get(errorId)
    if (!error) return null

    return {
      ...error,
      firstOccurrence: new Date(error.firstOccurrence).toISOString(),
      lastOccurrence: new Date(error.lastOccurrence).toISOString(),
      occurrences: error.occurrences.map(timestamp => new Date(timestamp).toISOString()),
      category: this.errorCategories[error.type] || { severity: error.severity, category: 'unknown' }
    }
  }

  /**
     * Mark error as resolved
     */
  resolveError (errorId, resolution = '') {
    const error = this.errors.get(errorId)
    if (error) {
      error.resolved = true
      error.resolvedAt = Date.now()
      error.resolution = resolution

      this.emit('errorResolved', { errorId, resolution })
      return true
    }
    return false
  }

  /**
     * Add tags to error
     */
  tagError (errorId, tags) {
    const error = this.errors.get(errorId)
    if (error) {
      error.tags = [...new Set([...error.tags, ...tags])]
      return true
    }
    return false
  }

  /**
     * Search errors
     */
  searchErrors (query = {}) {
    const results = []

    for (const [id, error] of this.errors) {
      let matches = true

      // Filter by type
      if (query.type && error.type !== query.type) {
        matches = false
      }

      // Filter by severity
      if (query.severity && error.severity !== query.severity) {
        matches = false
      }

      // Filter by resolved status
      if (query.resolved !== undefined && error.resolved !== query.resolved) {
        matches = false
      }

      // Filter by message content
      if (query.message && !error.message.toLowerCase().includes(query.message.toLowerCase())) {
        matches = false
      }

      // Filter by time range
      if (query.since && error.lastOccurrence < query.since) {
        matches = false
      }
      if (query.until && error.firstOccurrence > query.until) {
        matches = false
      }

      if (matches) {
        results.push({
          id,
          ...error,
          firstOccurrence: new Date(error.firstOccurrence).toISOString(),
          lastOccurrence: new Date(error.lastOccurrence).toISOString()
        })
      }
    }

    return results.sort((a, b) => b.lastOccurrence - a.lastOccurrence)
  }

  /**
     * Export error data
     */
  exportErrors (format = 'json', timeRange = '24h') {
    const stats = this.getErrorStatistics(timeRange)

    if (format === 'csv') {
      return this.toCsvFormat(stats)
    }

    return stats
  }

  /**
     * Convert to CSV format
     */
  toCsvFormat (data) {
    const rows = ['timestamp,type,severity,message,count']

    data.topErrors.forEach(error => {
      const row = [
        error.lastOccurrence,
        error.type,
        error.severity,
                `"${error.message.replace(/"/g, '""')}"`,
                error.count
      ].join(',')
      rows.push(row)
    })

    return rows.join('\n')
  }

  /**
     * Clear old error data
     */
  clearOldErrors (maxAge = 7 * 24 * 60 * 60 * 1000) { // 7 days
    const cutoff = Date.now() - maxAge
    let cleared = 0

    for (const [id, error] of this.errors) {
      if (error.lastOccurrence < cutoff) {
        this.errors.delete(id)
        cleared++
      }
    }

    this.errorHistory = this.errorHistory.filter(error => error.timestamp >= cutoff)

    console.log(`Cleared ${cleared} old errors`)
    return cleared
  }

  /**
     * Get health status based on errors
     */
  getHealthStatus () {
    const now = Date.now()
    const lastHour = now - (60 * 60 * 1000)
    const recentErrors = this.errorHistory.filter(e => e.timestamp >= lastHour)

    const criticalErrors = recentErrors.filter(e => e.severity === 'critical').length
    const highErrors = recentErrors.filter(e => e.severity === 'high').length
    const totalErrors = recentErrors.length

    if (criticalErrors > 0) return 'critical'
    if (highErrors > 3 || totalErrors > 20) return 'degraded'
    if (totalErrors > 10) return 'warning'
    return 'healthy'
  }

  /**
     * Cleanup resources
     */
  cleanup () {
    this.removeAllListeners()
    this.errors.clear()
    this.errorHistory = []
    this.errorPatterns.clear()
    console.log('Error tracking service cleaned up')
  }
}

module.exports = ErrorTrackingService
