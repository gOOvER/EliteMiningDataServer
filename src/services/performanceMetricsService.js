/**
 * Performance Metrics Service
 * Comprehensive performance monitoring and metrics collection
 */

const EventEmitter = require('events')
const os = require('os')

class PerformanceMetricsService extends EventEmitter {
  constructor () {
    super()
    this.metrics = new Map()
    this.requestMetrics = new Map()
    this.systemMetrics = []
    this.alertThresholds = {
      responseTime: 1000,
      errorRate: 5,
      memoryUsage: 80,
      cpuUsage: 80,
      diskUsage: 85
    }
    this.maxMetricsHistory = 1000
    this.isCollecting = false
    this.collectionInterval = null
    this.startTime = Date.now()
  }

  /**
     * Start metrics collection
     */
  startCollection () {
    if (this.isCollecting) return

    this.isCollecting = true
    this.collectionInterval = setInterval(() => {
      this.collectSystemMetrics()
    }, 30000) // Collect every 30 seconds

    console.log('Performance metrics collection started')
  }

  /**
     * Stop metrics collection
     */
  stopCollection () {
    if (!this.isCollecting) return

    this.isCollecting = false
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval)
      this.collectionInterval = null
    }

    console.log('Performance metrics collection stopped')
  }

  /**
     * Record API request metrics
     */
  recordRequest (endpoint, method, statusCode, responseTime, size = 0) {
    const timestamp = Date.now()
    const key = `${method} ${endpoint}`

    if (!this.requestMetrics.has(key)) {
      this.requestMetrics.set(key, {
        endpoint,
        method,
        totalRequests: 0,
        totalResponseTime: 0,
        totalSize: 0,
        statusCodes: new Map(),
        responseTimes: [],
        errors: 0,
        lastRequest: timestamp,
        firstRequest: timestamp,
        hourlyStats: new Map(),
        dailyStats: new Map()
      })
    }

    const metric = this.requestMetrics.get(key)
    metric.totalRequests++
    metric.totalResponseTime += responseTime
    metric.totalSize += size
    metric.lastRequest = timestamp

    // Track status codes
    const statusKey = Math.floor(statusCode / 100) * 100
    metric.statusCodes.set(statusKey, (metric.statusCodes.get(statusKey) || 0) + 1)

    // Track errors
    if (statusCode >= 400) {
      metric.errors++
    }

    // Store response times (keep last 100)
    metric.responseTimes.push(responseTime)
    if (metric.responseTimes.length > 100) {
      metric.responseTimes.shift()
    }

    // Hourly stats
    const hour = new Date(timestamp).getHours()
    const hourKey = `${new Date(timestamp).toDateString()}-${hour}`
    if (!metric.hourlyStats.has(hourKey)) {
      metric.hourlyStats.set(hourKey, { requests: 0, totalTime: 0, errors: 0 })
    }
    const hourStat = metric.hourlyStats.get(hourKey)
    hourStat.requests++
    hourStat.totalTime += responseTime
    if (statusCode >= 400) hourStat.errors++

    // Daily stats
    const dayKey = new Date(timestamp).toDateString()
    if (!metric.dailyStats.has(dayKey)) {
      metric.dailyStats.set(dayKey, { requests: 0, totalTime: 0, errors: 0 })
    }
    const dayStat = metric.dailyStats.get(dayKey)
    dayStat.requests++
    dayStat.totalTime += responseTime
    if (statusCode >= 400) dayStat.errors++

    // Check for performance alerts
    this.checkAlerts(key, metric, responseTime, statusCode)

    // Emit real-time metric event
    this.emit('requestMetric', {
      endpoint: key,
      responseTime,
      statusCode,
      timestamp
    })
  }

  /**
     * Collect system performance metrics
     */
  collectSystemMetrics () {
    const timestamp = Date.now()
    const memUsage = process.memoryUsage()
    const cpuUsage = process.cpuUsage()
    const systemMem = {
      total: os.totalmem(),
      free: os.freemem()
    }

    const metric = {
      timestamp,
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        heapUsedPercent: (memUsage.heapUsed / memUsage.heapTotal) * 100,
        rss: memUsage.rss,
        external: memUsage.external,
        systemTotal: systemMem.total,
        systemFree: systemMem.free,
        systemUsedPercent: ((systemMem.total - systemMem.free) / systemMem.total) * 100
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
        loadAverage: os.loadavg(),
        cores: os.cpus().length
      },
      uptime: {
        process: Date.now() - this.startTime,
        system: os.uptime() * 1000
      },
      eventLoop: {
        lag: this.measureEventLoopLag()
      }
    }

    this.systemMetrics.push(metric)

    // Keep only recent metrics
    if (this.systemMetrics.length > this.maxMetricsHistory) {
      this.systemMetrics = this.systemMetrics.slice(-this.maxMetricsHistory)
    }

    // Check system alerts
    this.checkSystemAlerts(metric)

    // Emit system metric event
    this.emit('systemMetric', metric)
  }

  /**
     * Measure event loop lag
     */
  measureEventLoopLag () {
    const start = process.hrtime.bigint()
    setImmediate(() => {
      const lag = Number(process.hrtime.bigint() - start) / 1e6 // Convert to milliseconds
      this.lastEventLoopLag = lag
    })
    return this.lastEventLoopLag || 0
  }

  /**
     * Get comprehensive performance report
     */
  getPerformanceReport (timeRange = '1h') {
    const now = Date.now()
    const timeRanges = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000
    }

    const rangeMs = timeRanges[timeRange] || timeRanges['1h']
    const cutoff = now - rangeMs

    return {
      timeRange,
      generatedAt: new Date().toISOString(),
      summary: this.getPerformanceSummary(cutoff),
      endpoints: this.getEndpointMetrics(cutoff),
      system: this.getSystemMetrics(cutoff),
      alerts: this.getActiveAlerts(),
      trends: this.getPerformanceTrends(cutoff)
    }
  }

  /**
     * Get performance summary
     */
  getPerformanceSummary (cutoff) {
    let totalRequests = 0
    let totalErrors = 0
    let totalResponseTime = 0
    let slowestEndpoint = null
    let fastestEndpoint = null
    let slowestTime = 0
    let fastestTime = Infinity

    for (const [endpoint, metric] of this.requestMetrics) {
      if (metric.lastRequest < cutoff) continue

      const avgResponseTime = metric.totalResponseTime / metric.totalRequests
      totalRequests += metric.totalRequests
      totalErrors += metric.errors
      totalResponseTime += metric.totalResponseTime

      if (avgResponseTime > slowestTime) {
        slowestTime = avgResponseTime
        slowestEndpoint = endpoint
      }
      if (avgResponseTime < fastestTime) {
        fastestTime = avgResponseTime
        fastestEndpoint = endpoint
      }
    }

    const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0
    const avgResponseTime = totalRequests > 0 ? totalResponseTime / totalRequests : 0

    return {
      totalRequests,
      totalErrors,
      errorRate: Math.round(errorRate * 100) / 100,
      averageResponseTime: Math.round(avgResponseTime),
      slowestEndpoint: {
        endpoint: slowestEndpoint,
        responseTime: Math.round(slowestTime)
      },
      fastestEndpoint: {
        endpoint: fastestEndpoint,
        responseTime: Math.round(fastestTime)
      },
      requestsPerSecond: Math.round(totalRequests / (Date.now() - cutoff) * 1000),
      systemHealth: this.getSystemHealth()
    }
  }

  /**
     * Get endpoint-specific metrics
     */
  getEndpointMetrics (cutoff) {
    const endpoints = []

    for (const [endpoint, metric] of this.requestMetrics) {
      if (metric.lastRequest < cutoff) continue

      const avgResponseTime = metric.totalResponseTime / metric.totalRequests
      const errorRate = (metric.errors / metric.totalRequests) * 100

      // Calculate percentiles
      const sortedTimes = [...metric.responseTimes].sort((a, b) => a - b)
      const p50 = this.getPercentile(sortedTimes, 50)
      const p95 = this.getPercentile(sortedTimes, 95)
      const p99 = this.getPercentile(sortedTimes, 99)

      endpoints.push({
        endpoint,
        method: metric.method,
        totalRequests: metric.totalRequests,
        averageResponseTime: Math.round(avgResponseTime),
        errorRate: Math.round(errorRate * 100) / 100,
        errors: metric.errors,
        percentiles: {
          p50: Math.round(p50),
          p95: Math.round(p95),
          p99: Math.round(p99)
        },
        statusCodes: Object.fromEntries(metric.statusCodes),
        lastRequest: new Date(metric.lastRequest).toISOString(),
        requestsPerMinute: Math.round(metric.totalRequests / ((Date.now() - metric.firstRequest) / 60000))
      })
    }

    return endpoints.sort((a, b) => b.totalRequests - a.totalRequests)
  }

  /**
     * Get system metrics within time range
     */
  getSystemMetrics (cutoff) {
    const recentMetrics = this.systemMetrics.filter(m => m.timestamp >= cutoff)

    if (recentMetrics.length === 0) return null

    const latest = recentMetrics[recentMetrics.length - 1]
    const avgMemory = recentMetrics.reduce((sum, m) => sum + m.memory.heapUsedPercent, 0) / recentMetrics.length
    const maxMemory = Math.max(...recentMetrics.map(m => m.memory.heapUsedPercent))
    const avgEventLoopLag = recentMetrics.reduce((sum, m) => sum + m.eventLoop.lag, 0) / recentMetrics.length

    return {
      current: {
        memoryUsedPercent: Math.round(latest.memory.heapUsedPercent * 100) / 100,
        systemMemoryUsedPercent: Math.round(latest.memory.systemUsedPercent * 100) / 100,
        cpuLoadAverage: latest.cpu.loadAverage,
        eventLoopLag: Math.round(latest.eventLoop.lag * 100) / 100,
        uptime: {
          process: this.formatUptime(latest.uptime.process),
          system: this.formatUptime(latest.uptime.system)
        }
      },
      averages: {
        memoryUsedPercent: Math.round(avgMemory * 100) / 100,
        maxMemoryUsedPercent: Math.round(maxMemory * 100) / 100,
        eventLoopLag: Math.round(avgEventLoopLag * 100) / 100
      },
      history: recentMetrics.map(m => ({
        timestamp: m.timestamp,
        memory: Math.round(m.memory.heapUsedPercent * 100) / 100,
        eventLoopLag: Math.round(m.eventLoop.lag * 100) / 100
      }))
    }
  }

  /**
     * Get current system health
     */
  getSystemHealth () {
    if (this.systemMetrics.length === 0) return 'unknown'

    const latest = this.systemMetrics[this.systemMetrics.length - 1]
    const memoryPercent = latest.memory.heapUsedPercent
    const systemMemoryPercent = latest.memory.systemUsedPercent
    const eventLoopLag = latest.eventLoop.lag

    if (memoryPercent > 90 || systemMemoryPercent > 95 || eventLoopLag > 100) {
      return 'critical'
    } else if (memoryPercent > 80 || systemMemoryPercent > 85 || eventLoopLag > 50) {
      return 'warning'
    } else {
      return 'healthy'
    }
  }

  /**
     * Get performance trends
     */
  getPerformanceTrends (cutoff) {
    const hourlyData = new Map()

    // Aggregate hourly data
    for (const [endpoint, metric] of this.requestMetrics) {
      for (const [hourKey, hourStat] of metric.hourlyStats) {
        const hourTime = new Date(hourKey.split('-')[0] + ' ' + hourKey.split('-')[1] + ':00:00').getTime()
        if (hourTime < cutoff) continue

        if (!hourlyData.has(hourKey)) {
          hourlyData.set(hourKey, {
            timestamp: hourTime,
            requests: 0,
            totalTime: 0,
            errors: 0
          })
        }

        const hourData = hourlyData.get(hourKey)
        hourData.requests += hourStat.requests
        hourData.totalTime += hourStat.totalTime
        hourData.errors += hourStat.errors
      }
    }

    const trends = Array.from(hourlyData.values())
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(hour => ({
        timestamp: hour.timestamp,
        requests: hour.requests,
        averageResponseTime: hour.requests > 0 ? Math.round(hour.totalTime / hour.requests) : 0,
        errorRate: hour.requests > 0 ? Math.round((hour.errors / hour.requests) * 10000) / 100 : 0
      }))

    return {
      hourly: trends,
      summary: {
        trend: this.calculateTrend(trends.map(t => t.requests)),
        responseTrend: this.calculateTrend(trends.map(t => t.averageResponseTime)),
        errorTrend: this.calculateTrend(trends.map(t => t.errorRate))
      }
    }
  }

  /**
     * Calculate trend direction
     */
  calculateTrend (values) {
    if (values.length < 2) return 'stable'

    const recent = values.slice(-Math.min(6, values.length)) // Last 6 hours
    const slope = this.calculateSlope(recent)

    if (slope > 0.1) return 'increasing'
    if (slope < -0.1) return 'decreasing'
    return 'stable'
  }

  /**
     * Calculate slope of values
     */
  calculateSlope (values) {
    const n = values.length
    const sumX = (n * (n - 1)) / 2
    const sumY = values.reduce((sum, val) => sum + val, 0)
    const sumXY = values.reduce((sum, val, i) => sum + (i * val), 0)
    const sumXX = values.reduce((sum, val, i) => sum + (i * i), 0)

    return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX)
  }

  /**
     * Check for performance alerts
     */
  checkAlerts (endpoint, metric, responseTime, statusCode) {
    const alerts = []

    // Response time alert
    if (responseTime > this.alertThresholds.responseTime) {
      alerts.push({
        type: 'response_time',
        severity: responseTime > this.alertThresholds.responseTime * 2 ? 'critical' : 'warning',
        endpoint,
        value: responseTime,
        threshold: this.alertThresholds.responseTime,
        timestamp: Date.now()
      })
    }

    // Error rate alert
    const errorRate = (metric.errors / metric.totalRequests) * 100
    if (errorRate > this.alertThresholds.errorRate) {
      alerts.push({
        type: 'error_rate',
        severity: errorRate > this.alertThresholds.errorRate * 2 ? 'critical' : 'warning',
        endpoint,
        value: errorRate,
        threshold: this.alertThresholds.errorRate,
        timestamp: Date.now()
      })
    }

    // Emit alerts
    alerts.forEach(alert => this.emit('alert', alert))
  }

  /**
     * Check system alerts
     */
  checkSystemAlerts (metric) {
    const alerts = []

    // Memory usage alert
    if (metric.memory.heapUsedPercent > this.alertThresholds.memoryUsage) {
      alerts.push({
        type: 'memory_usage',
        severity: metric.memory.heapUsedPercent > 90 ? 'critical' : 'warning',
        value: metric.memory.heapUsedPercent,
        threshold: this.alertThresholds.memoryUsage,
        timestamp: Date.now()
      })
    }

    // Event loop lag alert
    if (metric.eventLoop.lag > 50) {
      alerts.push({
        type: 'event_loop_lag',
        severity: metric.eventLoop.lag > 100 ? 'critical' : 'warning',
        value: metric.eventLoop.lag,
        threshold: 50,
        timestamp: Date.now()
      })
    }

    // Emit alerts
    alerts.forEach(alert => this.emit('alert', alert))
  }

  /**
     * Get active alerts
     */
  getActiveAlerts () {
    // This would typically store alerts in a database or memory store
    // For now, return an empty array
    return []
  }

  /**
     * Calculate percentile
     */
  getPercentile (sortedArray, percentile) {
    if (sortedArray.length === 0) return 0
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))]
  }

  /**
     * Format uptime
     */
  formatUptime (ms) {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`
    if (hours > 0) return `${hours}h ${minutes % 60}m`
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
  }

  /**
     * Reset metrics
     */
  resetMetrics () {
    this.requestMetrics.clear()
    this.systemMetrics = []
    console.log('Performance metrics reset')
  }

  /**
     * Export metrics for external monitoring
     */
  exportMetrics (format = 'json') {
    const data = {
      requests: Object.fromEntries(this.requestMetrics),
      system: this.systemMetrics,
      exportedAt: new Date().toISOString()
    }

    if (format === 'prometheus') {
      return this.toPrometheusFormat(data)
    }

    return data
  }

  /**
     * Convert metrics to Prometheus format
     */
  toPrometheusFormat (data) {
    const output = []

    // Request metrics
    for (const [endpoint, metric] of Object.entries(data.requests)) {
      const labels = `{endpoint="${endpoint}", method="${metric.method}"}`
      output.push(`http_requests_total${labels} ${metric.totalRequests}`)
      output.push(`http_request_duration_seconds${labels} ${metric.totalResponseTime / 1000}`)
      output.push(`http_errors_total${labels} ${metric.errors}`)
    }

    // System metrics
    if (data.system.length > 0) {
      const latest = data.system[data.system.length - 1]
      output.push(`process_memory_heap_used_bytes ${latest.memory.heapUsed}`)
      output.push(`process_memory_heap_total_bytes ${latest.memory.heapTotal}`)
      output.push(`nodejs_eventloop_lag_milliseconds ${latest.eventLoop.lag}`)
    }

    return output.join('\n')
  }

  /**
     * Cleanup resources
     */
  cleanup () {
    this.stopCollection()
    this.removeAllListeners()
    console.log('Performance metrics service cleaned up')
  }
}

module.exports = PerformanceMetricsService
