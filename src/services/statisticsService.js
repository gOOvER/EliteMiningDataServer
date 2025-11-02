const logger = require('./logger')

/**
 * Statistics Service
 * Handles all statistics-related calculations and data aggregation
 */
class StatisticsService {
  constructor (mongoService, cacheManager = null) {
    this.mongo = mongoService
    this.cache = cacheManager
    this.collections = {
      marketData: 'market_data',
      systems: 'systems',
      stations: 'stations',
      miningLocations: 'mining_locations',
      apiUsage: 'api_usage_logs',
      eddnLogs: 'eddn_logs',
      websocketConnections: 'websocket_connections'
    }

    // In-memory statistics cache (fallback if no cacheManager)
    this.statsCache = {
      global: null,
      eddn: null,
      mining: null,
      apiUsage: null,
      websocket: null,
      lastUpdated: null
    }

    this.cacheTimeout = 5 * 60 * 1000 // 5 minutes
  }

  /**
   * Get comprehensive global statistics
   */
  async getGlobalStatistics () {
    try {
      const cacheKey = 'global_statistics'

      // Try external cache first if available
      if (this.cache) {
        const cached = await this.cache.get(cacheKey)
        if (cached) {
          logger.debug('Cache hit for global statistics')
          return cached
        }
      }

      // Fallback to internal cache
      if (this.isCacheValid('global')) {
        return this.statsCache.global
      }

      const db = await this.mongo.getDatabase()

      // Run multiple aggregations in parallel
      const [
        systemStats,
        stationStats,
        commodityStats,
        miningStats,
        recentActivity
      ] = await Promise.all([
        this.getSystemStatistics(db),
        this.getStationStatistics(db),
        this.getCommodityStatistics(db),
        this.getMiningLocationStatistics(db),
        this.getRecentActivityStatistics(db)
      ])

      const stats = {
        server: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          nodeVersion: process.version,
          platform: process.platform,
          startTime: new Date(Date.now() - process.uptime() * 1000).toISOString()
        },
        data: {
          totalSystems: systemStats.total,
          totalStations: stationStats.total,
          totalCommodities: commodityStats.total,
          totalMiningLocations: miningStats.total,
          lastUpdated: new Date().toISOString()
        },
        activity: recentActivity,
        performance: {
          averageResponseTime: this.calculateAverageResponseTime(),
          requestsPerMinute: this.calculateRequestsPerMinute(),
          errorRate: this.calculateErrorRate()
        },
        timestamp: new Date().toISOString()
      }

      this.statsCache.global = stats
      this.statsCache.lastUpdated = Date.now()

      // Cache in external cache if available
      if (this.cache) {
        await this.cache.set(cacheKey, stats, 300) // Cache for 5 minutes
        logger.debug('Cached global statistics')
      }

      return stats
    } catch (error) {
      logger.error('Error fetching global statistics:', error)
      throw new Error(`Failed to fetch global statistics: ${error.message}`)
    }
  }

  /**
   * Get EDDN-specific statistics
   */
  async getEDDNStatistics () {
    try {
      if (this.isCacheValid('eddn')) {
        return this.statsCache.eddn
      }

      const db = await this.mongo.getDatabase()
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)

      // Aggregate EDDN message statistics
      const messageStats = await db.collection(this.collections.eddnLogs).aggregate([
        {
          $facet: {
            total: [{ $count: 'count' }],
            today: [
              { $match: { timestamp: { $gte: oneDayAgo } } },
              { $count: 'count' }
            ],
            lastHour: [
              { $match: { timestamp: { $gte: oneHourAgo } } },
              { $count: 'count' }
            ],
            byType: [
              { $match: { timestamp: { $gte: oneDayAgo } } },
              { $group: { _id: '$messageType', count: { $sum: 1 } } }
            ],
            errors: [
              {
                $match: {
                  timestamp: { $gte: oneDayAgo },
                  error: { $exists: true }
                }
              },
              { $count: 'count' }
            ]
          }
        }
      ]).toArray()

      const stats = messageStats[0]

      const eddnStats = {
        connection: {
          status: this.getEDDNConnectionStatus(),
          connectedSince: this.getEDDNConnectionTime(),
          reconnections: this.getEDDNReconnectionCount()
        },
        messages: {
          total: stats.total[0]?.count || 0,
          today: stats.today[0]?.count || 0,
          lastHour: stats.lastHour[0]?.count || 0,
          types: this.formatMessageTypes(stats.byType)
        },
        processing: {
          queue: this.getEDDNQueueSize(),
          processed: stats.total[0]?.count || 0,
          errors: stats.errors[0]?.count || 0,
          avgProcessingTime: this.getEDDNAvgProcessingTime()
        },
        timestamp: new Date().toISOString()
      }

      this.statsCache.eddn = eddnStats
      return eddnStats
    } catch (error) {
      logger.error('Error fetching EDDN statistics:', error)
      throw new Error(`Failed to fetch EDDN statistics: ${error.message}`)
    }
  }

  /**
   * Get mining-specific statistics
   */
  async getMiningStatistics () {
    try {
      if (this.isCacheValid('mining')) {
        return this.statsCache.mining
      }

      const db = await this.mongo.getDatabase()

      const miningStats = await db.collection(this.collections.miningLocations).aggregate([
        {
          $facet: {
            total: [{ $count: 'count' }],
            byType: [
              { $group: { _id: '$locationType', count: { $sum: 1 } } }
            ],
            systems: [
              { $group: { _id: '$systemName' } },
              { $count: 'count' }
            ],
            commodities: [
              { $unwind: '$commodities' },
              { $group: { _id: '$commodities.name', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 10 }
            ],
            profitability: [
              { $unwind: '$commodities' },
              {
                $group: {
                  _id: '$commodities.name',
                  avgProfitability: { $avg: '$commodities.profitPerHour' }
                }
              },
              { $sort: { avgProfitability: -1 } },
              { $limit: 5 }
            ]
          }
        }
      ]).toArray()

      const stats = miningStats[0]
      const locationTypes = this.formatLocationTypes(stats.byType)

      const result = {
        locations: {
          total: stats.total[0]?.count || 0,
          hotspots: locationTypes.hotspot || 0,
          rings: locationTypes.ring || 0,
          belts: locationTypes.belt || 0,
          systems: stats.systems[0]?.count || 0
        },
        commodities: {
          total: stats.commodities.length,
          mostCommon: stats.commodities.slice(0, 5).map(c => ({
            name: c._id,
            locations: c.count
          })),
          mostProfitable: stats.profitability.map(p => ({
            name: p._id,
            profitPerHour: Math.round(p.avgProfitability || 0)
          }))
        },
        analysis: {
          opportunitiesGenerated: this.getMiningOpportunitiesGenerated(),
          avgProfitability: this.calculateAverageMiningProfitability(stats.profitability),
          topCommodity: stats.profitability[0]?._id || null
        },
        timestamp: new Date().toISOString()
      }

      this.statsCache.mining = result
      return result
    } catch (error) {
      logger.error('Error fetching mining statistics:', error)
      throw new Error(`Failed to fetch mining statistics: ${error.message}`)
    }
  }

  /**
   * Get API usage statistics
   */
  async getAPIUsageStatistics () {
    try {
      if (this.isCacheValid('apiUsage')) {
        return this.statsCache.apiUsage
      }

      const db = await this.mongo.getDatabase()
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

      const usageStats = await db.collection(this.collections.apiUsage).aggregate([
        {
          $match: { timestamp: { $gte: oneDayAgo } }
        },
        {
          $facet: {
            endpoints: [
              {
                $group: {
                  _id: '$endpoint',
                  count: { $sum: 1 },
                  avgResponseTime: { $avg: '$responseTime' }
                }
              },
              { $sort: { count: -1 } }
            ],
            statusCodes: [
              { $group: { _id: '$statusCode', count: { $sum: 1 } } }
            ],
            performance: [
              {
                $group: {
                  _id: null,
                  avgResponseTime: { $avg: '$responseTime' },
                  maxResponseTime: { $max: '$responseTime' },
                  minResponseTime: { $min: '$responseTime' }
                }
              }
            ],
            rateLimiting: [
              { $match: { statusCode: 429 } },
              { $count: 'count' }
            ]
          }
        }
      ]).toArray()

      const stats = usageStats[0]
      const performance = stats.performance[0] || {}

      const result = {
        endpoints: {
          total: stats.endpoints.reduce((sum, ep) => sum + ep.count, 0),
          mostUsed: stats.endpoints[0]?._id || null,
          avgResponseTime: Math.round(performance.avgResponseTime || 0),
          breakdown: stats.endpoints.slice(0, 10).map(ep => ({
            endpoint: ep._id,
            requests: ep.count,
            avgResponseTime: Math.round(ep.avgResponseTime || 0)
          }))
        },
        rateLimiting: {
          triggeredToday: stats.rateLimiting[0]?.count || 0,
          currentlyLimited: 0 // This would be tracked in real-time
        },
        performance: {
          avgResponseTime: Math.round(performance.avgResponseTime || 0),
          slowestEndpoint: this.findSlowestEndpoint(stats.endpoints),
          fastestEndpoint: this.findFastestEndpoint(stats.endpoints)
        },
        errors: {
          total: this.countErrorsByStatus(stats.statusCodes),
          byCode: this.formatStatusCodes(stats.statusCodes)
        },
        timestamp: new Date().toISOString()
      }

      this.statsCache.apiUsage = result
      return result
    } catch (error) {
      logger.error('Error fetching API usage statistics:', error)
      throw new Error(`Failed to fetch API usage statistics: ${error.message}`)
    }
  }

  /**
   * Get WebSocket statistics
   */
  async getWebSocketStatistics () {
    try {
      if (this.isCacheValid('websocket')) {
        return this.statsCache.websocket
      }

      const db = await this.mongo.getDatabase()
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

      const wsStats = await db.collection(this.collections.websocketConnections).aggregate([
        {
          $facet: {
            total: [{ $count: 'count' }],
            active: [
              { $match: { disconnectedAt: { $exists: false } } },
              { $count: 'count' }
            ],
            today: [
              { $match: { connectedAt: { $gte: oneDayAgo } } },
              { $count: 'count' }
            ],
            peak: [
              {
                $group: {
                  _id: {
                    $dateToString: {
                      format: '%Y-%m-%d-%H',
                      date: '$connectedAt'
                    }
                  },
                  concurrent: { $sum: 1 }
                }
              },
              { $sort: { concurrent: -1 } },
              { $limit: 1 }
            ],
            messages: [
              { $match: { connectedAt: { $gte: oneDayAgo } } },
              {
                $group: {
                  _id: null,
                  sent: { $sum: '$messagesSent' },
                  broadcast: { $sum: '$messagesBroadcast' },
                  errors: { $sum: '$messageErrors' }
                }
              }
            ]
          }
        }
      ]).toArray()

      const stats = wsStats[0]
      const messages = stats.messages[0] || {}

      const result = {
        connections: {
          active: stats.active[0]?.count || 0,
          total: stats.total[0]?.count || 0,
          peak: stats.peak[0]?.concurrent || 0,
          todayConnections: stats.today[0]?.count || 0
        },
        messages: {
          sent: messages.sent || 0,
          broadcast: messages.broadcast || 0,
          errors: messages.errors || 0,
          successRate: this.calculateMessageSuccessRate(messages)
        },
        timestamp: new Date().toISOString()
      }

      this.statsCache.websocket = result
      return result
    } catch (error) {
      logger.error('Error fetching WebSocket statistics:', error)
      throw new Error(`Failed to fetch WebSocket statistics: ${error.message}`)
    }
  }

  // Helper methods

  isCacheValid (type) {
    return this.statsCache[type] &&
           this.statsCache.lastUpdated &&
           (Date.now() - this.statsCache.lastUpdated) < this.cacheTimeout
  }

  async getSystemStatistics (db) {
    const result = await db.collection(this.collections.systems).countDocuments()
    return { total: result }
  }

  async getStationStatistics (db) {
    const result = await db.collection(this.collections.stations).countDocuments()
    return { total: result }
  }

  async getCommodityStatistics (db) {
    const result = await db.collection('commodities').countDocuments()
    return { total: result }
  }

  async getMiningLocationStatistics (db) {
    const result = await db.collection(this.collections.miningLocations).countDocuments()
    return { total: result }
  }

  async getRecentActivityStatistics (db) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)

    const activity = await db.collection(this.collections.marketData).aggregate([
      {
        $match: { timestamp: { $gte: oneHourAgo } }
      },
      {
        $group: {
          _id: null,
          priceUpdates: { $sum: 1 },
          uniqueSystems: { $addToSet: '$systemName' },
          uniqueStations: { $addToSet: '$stationName' }
        }
      }
    ]).toArray()

    const stats = activity[0] || {}
    return {
      priceUpdatesLastHour: stats.priceUpdates || 0,
      activeSystemsLastHour: stats.uniqueSystems?.length || 0,
      activeStationsLastHour: stats.uniqueStations?.length || 0
    }
  }

  calculateAverageResponseTime () {
    // This would be calculated from request timing middleware
    return 150 // Mock value in ms
  }

  calculateRequestsPerMinute () {
    // This would be calculated from API usage logs
    return 25 // Mock value
  }

  calculateErrorRate () {
    // This would be calculated from error logs
    return 2.5 // Mock value as percentage
  }

  getEDDNConnectionStatus () {
    // This would check actual EDDN client status
    return 'connected'
  }

  getEDDNConnectionTime () {
    // This would return actual connection timestamp
    return new Date(Date.now() - 3600000).toISOString() // 1 hour ago
  }

  getEDDNReconnectionCount () {
    // This would track actual reconnections
    return 2
  }

  formatMessageTypes (types) {
    const formatted = {
      commodity: 0,
      outfitting: 0,
      shipyard: 0,
      journal: 0
    }

    types.forEach(type => {
      if (formatted.hasOwnProperty(type._id)) {
        formatted[type._id] = type.count
      }
    })

    return formatted
  }

  getEDDNQueueSize () {
    return 0 // Mock queue size
  }

  getEDDNAvgProcessingTime () {
    return 25 // Mock processing time in ms
  }

  formatLocationTypes (types) {
    const formatted = {}
    types.forEach(type => {
      formatted[type._id] = type.count
    })
    return formatted
  }

  getMiningOpportunitiesGenerated () {
    return 150 // Mock value
  }

  calculateAverageMiningProfitability (profitability) {
    if (!profitability.length) return 0
    const total = profitability.reduce((sum, p) => sum + (p.avgProfitability || 0), 0)
    return Math.round(total / profitability.length)
  }

  findSlowestEndpoint (endpoints) {
    if (!endpoints.length) return null
    return endpoints.reduce((slowest, current) =>
      current.avgResponseTime > (slowest?.avgResponseTime || 0) ? current : slowest
    )?._id
  }

  findFastestEndpoint (endpoints) {
    if (!endpoints.length) return null
    return endpoints.reduce((fastest, current) =>
      current.avgResponseTime < (fastest?.avgResponseTime || Infinity) ? current : fastest
    )?._id
  }

  countErrorsByStatus (statusCodes) {
    return statusCodes.reduce((total, code) => {
      return code._id >= 400 ? total + code.count : total
    }, 0)
  }

  formatStatusCodes (statusCodes) {
    const formatted = {}
    statusCodes.forEach(code => {
      formatted[code._id] = code.count
    })
    return formatted
  }

  calculateMessageSuccessRate (messages) {
    const total = (messages.sent || 0) + (messages.errors || 0)
    if (total === 0) return 100
    return Math.round(((messages.sent || 0) / total) * 100)
  }

  /**
   * Track API usage for statistics
   * @param {string} path - API endpoint path
   * @param {string} method - HTTP method
   * @param {number} statusCode - Response status code
   * @param {number} duration - Request duration in ms
   */
  async trackAPIUsage (path, method, statusCode, duration) {
    try {
      const usageData = {
        path,
        method,
        statusCode,
        duration,
        timestamp: new Date(),
        date: new Date().toISOString().split('T')[0] // YYYY-MM-DD format
      }

      // Store in database for persistent tracking
      await this.db.getCollection('api_usage').insertOne(usageData)

      // Update in-memory cache for quick access
      const cacheKey = 'api_usage_today'
      let todayUsage = this.cache.get(cacheKey) || []

      // Keep only last 1000 requests in memory to prevent memory bloat
      if (todayUsage.length >= 1000) {
        todayUsage = todayUsage.slice(-900) // Keep last 900, add new one
      }

      todayUsage.push(usageData)
      this.cache.set(cacheKey, todayUsage, 24 * 60 * 60) // Cache for 24 hours
    } catch (error) {
      // Log error but don't throw to avoid breaking request flow
      console.error('Failed to track API usage:', error)
    }
  }
}

module.exports = StatisticsService
