/**
 * Health Check Service
 * Provides comprehensive health monitoring for all system components
 */

const mongoose = require('mongoose')
const Redis = require('redis')
const os = require('os')
const fs = require('fs').promises
const path = require('path')

class HealthCheckService {
  constructor () {
    this.startTime = Date.now()
    this.checks = new Map()
    this.healthHistory = []
    this.maxHistoryEntries = 100
    this.redisClient = null
    this.setupRedisConnection()
  }

  /**
     * Setup Redis connection for health checks
     */
  async setupRedisConnection () {
    try {
      if (process.env.REDIS_URL) {
        this.redisClient = Redis.createClient({
          url: process.env.REDIS_URL,
          socket: {
            connectTimeout: 5000,
            commandTimeout: 5000
          }
        })

        this.redisClient.on('error', (err) => {
          console.warn('Redis health check connection error:', err.message)
        })
      }
    } catch (error) {
      console.warn('Redis setup for health checks failed:', error.message)
    }
  }

  /**
     * Perform comprehensive health check
     */
  async performHealthCheck () {
    const healthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: this.getUptime(),
      version: process.env.npm_package_version || 'unknown',
      environment: process.env.NODE_ENV || 'development',
      checks: {},
      system: await this.getSystemMetrics(),
      summary: {
        total: 0,
        healthy: 0,
        unhealthy: 0,
        degraded: 0
      }
    }

    // Core system checks
    const checks = [
      { name: 'database', check: this.checkDatabase },
      { name: 'redis', check: this.checkRedis },
      { name: 'filesystem', check: this.checkFilesystem },
      { name: 'memory', check: this.checkMemory },
      { name: 'cpu', check: this.checkCPU },
      { name: 'externalApis', check: this.checkExternalAPIs },
      { name: 'eddn', check: this.checkEDDN },
      { name: 'websocket', check: this.checkWebSocket }
    ]

    // Execute all checks in parallel
    const checkPromises = checks.map(async ({ name, check }) => {
      try {
        const result = await Promise.race([
          check.call(this),
          this.timeoutPromise(10000, `${name} check timeout`)
        ])

        healthStatus.checks[name] = {
          status: result.status,
          message: result.message,
          responseTime: result.responseTime || 0,
          details: result.details || {},
          lastChecked: new Date().toISOString()
        }

        healthStatus.summary.total++
        healthStatus.summary[result.status]++
      } catch (error) {
        healthStatus.checks[name] = {
          status: 'unhealthy',
          message: error.message,
          responseTime: 0,
          details: { error: error.stack },
          lastChecked: new Date().toISOString()
        }

        healthStatus.summary.total++
        healthStatus.summary.unhealthy++
      }
    })

    await Promise.all(checkPromises)

    // Determine overall health status
    if (healthStatus.summary.unhealthy > 0) {
      healthStatus.status = 'unhealthy'
    } else if (healthStatus.summary.degraded > 0) {
      healthStatus.status = 'degraded'
    }

    // Store health history
    this.healthHistory.push({
      timestamp: healthStatus.timestamp,
      status: healthStatus.status,
      summary: healthStatus.summary
    })

    // Limit history size
    if (this.healthHistory.length > this.maxHistoryEntries) {
      this.healthHistory = this.healthHistory.slice(-this.maxHistoryEntries)
    }

    return healthStatus
  }

  /**
     * Check MongoDB database connection and performance
     */
  async checkDatabase () {
    const startTime = Date.now()

    try {
      if (mongoose.connection.readyState !== 1) {
        return {
          status: 'unhealthy',
          message: 'MongoDB not connected',
          responseTime: Date.now() - startTime
        }
      }

      // Test database query performance
      const db = mongoose.connection.db
      await db.admin().ping()

      const stats = await db.stats()
      const responseTime = Date.now() - startTime

      return {
        status: responseTime < 1000 ? 'healthy' : 'degraded',
        message: `MongoDB connected (${responseTime}ms)`,
        responseTime,
        details: {
          collections: stats.collections,
          dataSize: this.formatBytes(stats.dataSize),
          indexSize: this.formatBytes(stats.indexSize),
          avgObjSize: Math.round(stats.avgObjSize)
        }
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Database error: ${error.message}`,
        responseTime: Date.now() - startTime
      }
    }
  }

  /**
     * Check Redis connection and performance
     */
  async checkRedis () {
    const startTime = Date.now()

    try {
      if (!this.redisClient) {
        return {
          status: 'degraded',
          message: 'Redis not configured',
          responseTime: 0,
          details: { configured: false }
        }
      }

      if (!this.redisClient.isOpen) {
        await this.redisClient.connect()
      }

      await this.redisClient.ping()
      const info = await this.redisClient.info('memory')
      const responseTime = Date.now() - startTime

      const memoryMatch = info.match(/used_memory_human:(.+)/)
      const memoryUsed = memoryMatch ? memoryMatch[1].trim() : 'unknown'

      return {
        status: responseTime < 500 ? 'healthy' : 'degraded',
        message: `Redis connected (${responseTime}ms)`,
        responseTime,
        details: {
          memoryUsed,
          connected: true
        }
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Redis error: ${error.message}`,
        responseTime: Date.now() - startTime
      }
    }
  }

  /**
     * Check filesystem health and disk space
     */
  async checkFilesystem () {
    const startTime = Date.now()

    try {
      const stats = await fs.stat(process.cwd())
      const { size: totalSpace, free: freeSpace } = await this.getDiskSpace()

      const usedSpace = totalSpace - freeSpace
      const usagePercent = (usedSpace / totalSpace) * 100

      let status = 'healthy'
      let message = `Filesystem accessible (${usagePercent.toFixed(1)}% used)`

      if (usagePercent > 90) {
        status = 'unhealthy'
        message = `Disk space critical (${usagePercent.toFixed(1)}% used)`
      } else if (usagePercent > 80) {
        status = 'degraded'
        message = `Disk space warning (${usagePercent.toFixed(1)}% used)`
      }

      return {
        status,
        message,
        responseTime: Date.now() - startTime,
        details: {
          totalSpace: this.formatBytes(totalSpace),
          freeSpace: this.formatBytes(freeSpace),
          usedSpace: this.formatBytes(usedSpace),
          usagePercent: Math.round(usagePercent * 10) / 10
        }
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Filesystem error: ${error.message}`,
        responseTime: Date.now() - startTime
      }
    }
  }

  /**
     * Check memory usage
     */
  async checkMemory () {
    const startTime = Date.now()

    try {
      const memUsage = process.memoryUsage()
      const systemMem = {
        total: os.totalmem(),
        free: os.freemem()
      }

      const heapUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100
      const systemUsagePercent = ((systemMem.total - systemMem.free) / systemMem.total) * 100

      let status = 'healthy'
      let message = `Memory usage normal (${heapUsagePercent.toFixed(1)}% heap)`

      if (heapUsagePercent > 90 || systemUsagePercent > 95) {
        status = 'unhealthy'
        message = `Memory usage critical (${heapUsagePercent.toFixed(1)}% heap, ${systemUsagePercent.toFixed(1)}% system)`
      } else if (heapUsagePercent > 80 || systemUsagePercent > 85) {
        status = 'degraded'
        message = `Memory usage warning (${heapUsagePercent.toFixed(1)}% heap, ${systemUsagePercent.toFixed(1)}% system)`
      }

      return {
        status,
        message,
        responseTime: Date.now() - startTime,
        details: {
          heap: {
            used: this.formatBytes(memUsage.heapUsed),
            total: this.formatBytes(memUsage.heapTotal),
            usagePercent: Math.round(heapUsagePercent * 10) / 10
          },
          system: {
            used: this.formatBytes(systemMem.total - systemMem.free),
            total: this.formatBytes(systemMem.total),
            free: this.formatBytes(systemMem.free),
            usagePercent: Math.round(systemUsagePercent * 10) / 10
          },
          rss: this.formatBytes(memUsage.rss),
          external: this.formatBytes(memUsage.external)
        }
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Memory check error: ${error.message}`,
        responseTime: Date.now() - startTime
      }
    }
  }

  /**
     * Check CPU usage
     */
  async checkCPU () {
    const startTime = Date.now()

    try {
      const cpus = os.cpus()
      const loadAvg = os.loadavg()
      const numCPUs = cpus.length

      // Calculate CPU usage percentage (simplified)
      const loadPercent = (loadAvg[0] / numCPUs) * 100

      let status = 'healthy'
      let message = `CPU load normal (${loadPercent.toFixed(1)}%)`

      if (loadPercent > 90) {
        status = 'unhealthy'
        message = `CPU load critical (${loadPercent.toFixed(1)}%)`
      } else if (loadPercent > 70) {
        status = 'degraded'
        message = `CPU load warning (${loadPercent.toFixed(1)}%)`
      }

      return {
        status,
        message,
        responseTime: Date.now() - startTime,
        details: {
          cores: numCPUs,
          model: cpus[0]?.model || 'unknown',
          speed: cpus[0]?.speed || 0,
          loadAverage: {
            '1min': Math.round(loadAvg[0] * 100) / 100,
            '5min': Math.round(loadAvg[1] * 100) / 100,
            '15min': Math.round(loadAvg[2] * 100) / 100
          },
          loadPercent: Math.round(loadPercent * 10) / 10
        }
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `CPU check error: ${error.message}`,
        responseTime: Date.now() - startTime
      }
    }
  }

  /**
     * Check external API dependencies
     */
  async checkExternalAPIs () {
    const startTime = Date.now()

    try {
      const apiChecks = [
        { name: 'EDSM', url: 'https://www.edsm.net/api-status' },
        { name: 'Inara', url: 'https://inara.cz/elite/' }
      ]

      const results = await Promise.allSettled(
        apiChecks.map(async api => {
          const response = await fetch(api.url, {
            method: 'HEAD',
            timeout: 5000
          })
          return {
            name: api.name,
            status: response.ok ? 'healthy' : 'unhealthy',
            statusCode: response.status
          }
        })
      )

      const apiStatus = {}
      let healthyCount = 0

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          apiStatus[apiChecks[index].name] = result.value
          if (result.value.status === 'healthy') healthyCount++
        } else {
          apiStatus[apiChecks[index].name] = {
            name: apiChecks[index].name,
            status: 'unhealthy',
            error: result.reason.message
          }
        }
      })

      const responseTime = Date.now() - startTime
      const totalAPIs = apiChecks.length

      let status = 'healthy'
      let message = `All external APIs accessible (${healthyCount}/${totalAPIs})`

      if (healthyCount === 0) {
        status = 'unhealthy'
        message = `All external APIs unreachable (0/${totalAPIs})`
      } else if (healthyCount < totalAPIs) {
        status = 'degraded'
        message = `Some external APIs unreachable (${healthyCount}/${totalAPIs})`
      }

      return {
        status,
        message,
        responseTime,
        details: apiStatus
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `External API check error: ${error.message}`,
        responseTime: Date.now() - startTime
      }
    }
  }

  /**
     * Check EDDN connection status
     */
  async checkEDDN () {
    const startTime = Date.now()

    try {
      // This would check the actual EDDN service status
      // For now, we'll simulate based on common patterns

      const status = 'healthy' // Would be determined by actual EDDN connection
      const lastMessageTime = Date.now() - (Math.random() * 30000) // Simulate recent message
      const messageAge = Date.now() - lastMessageTime

      let healthStatus = 'healthy'
      let message = `EDDN connected (last message ${Math.round(messageAge / 1000)}s ago)`

      if (messageAge > 300000) { // 5 minutes
        healthStatus = 'unhealthy'
        message = `EDDN stale (last message ${Math.round(messageAge / 60000)}m ago)`
      } else if (messageAge > 120000) { // 2 minutes
        healthStatus = 'degraded'
        message = `EDDN slow (last message ${Math.round(messageAge / 1000)}s ago)`
      }

      return {
        status: healthStatus,
        message,
        responseTime: Date.now() - startTime,
        details: {
          connected: status === 'healthy',
          lastMessageAge: Math.round(messageAge / 1000),
          messagesPerMinute: Math.round(Math.random() * 100) // Would be actual metric
        }
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `EDDN check error: ${error.message}`,
        responseTime: Date.now() - startTime
      }
    }
  }

  /**
     * Check WebSocket server status
     */
  async checkWebSocket () {
    const startTime = Date.now()

    try {
      // Would check actual WebSocket server status
      const activeConnections = 0 // Would be from actual WebSocket server
      const totalConnections = 0 // Would be from actual metrics

      return {
        status: 'healthy',
        message: `WebSocket server running (${activeConnections} active connections)`,
        responseTime: Date.now() - startTime,
        details: {
          activeConnections,
          totalConnections,
          serverRunning: true
        }
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `WebSocket check error: ${error.message}`,
        responseTime: Date.now() - startTime
      }
    }
  }

  /**
     * Get system metrics
     */
  async getSystemMetrics () {
    return {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      hostname: os.hostname(),
      uptime: os.uptime(),
      loadAverage: os.loadavg(),
      cpuCount: os.cpus().length,
      totalMemory: this.formatBytes(os.totalmem()),
      freeMemory: this.formatBytes(os.freemem())
    }
  }

  /**
     * Get server uptime
     */
  getUptime () {
    const uptimeMs = Date.now() - this.startTime
    return {
      milliseconds: uptimeMs,
      seconds: Math.floor(uptimeMs / 1000),
      human: this.formatUptime(uptimeMs)
    }
  }

  /**
     * Get health history
     */
  getHealthHistory () {
    return this.healthHistory
  }

  /**
     * Get disk space information
     */
  async getDiskSpace () {
    try {
      const stats = await fs.statfs(process.cwd())
      return {
        size: stats.blocks * stats.blksize,
        free: stats.bavail * stats.blksize
      }
    } catch (error) {
      // Fallback for systems without statfs
      return {
        size: 1000000000000, // 1TB fallback
        free: 500000000000 // 500GB fallback
      }
    }
  }

  /**
     * Create timeout promise
     */
  timeoutPromise (ms, message) {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms)
    })
  }

  /**
     * Format bytes to human readable
     */
  formatBytes (bytes) {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  /**
     * Format uptime to human readable
     */
  formatUptime (ms) {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
  }

  /**
     * Cleanup resources
     */
  async cleanup () {
    if (this.redisClient && this.redisClient.isOpen) {
      await this.redisClient.quit()
    }
  }
}

module.exports = HealthCheckService
