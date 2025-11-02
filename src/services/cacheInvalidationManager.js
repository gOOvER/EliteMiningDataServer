/**
 * Cache Invalidation Manager
 * Manages cache invalidation strategies across Redis and in-memory caches
 */

const logger = require('./logger')

class CacheInvalidationManager {
  constructor (redisCache, inMemoryCache) {
    this.redisCache = redisCache
    this.inMemoryCache = inMemoryCache
    this.invalidationStrategies = this.defineInvalidationStrategies()
  }

  /**
   * Define invalidation strategies for different data types
   */
  defineInvalidationStrategies () {
    return {
      // Market data invalidation strategies
      market_data: {
        triggers: ['new_eddn_message', 'manual_update', 'price_change'],
        scope: ['commodity_specific', 'system_specific', 'station_specific'],
        cascading: true, // Invalidate related data
        immediate: true // Invalidate immediately
      },

      // Mining data invalidation strategies
      mining_data: {
        triggers: ['new_mining_session', 'location_update', 'hotspot_change'],
        scope: ['location_specific', 'commodity_specific', 'system_specific'],
        cascading: true,
        immediate: false // Can be delayed
      },

      // Statistics invalidation strategies
      statistics: {
        triggers: ['data_update', 'scheduled_refresh', 'manual_refresh'],
        scope: ['global', 'type_specific', 'time_based'],
        cascading: false,
        immediate: false
      },

      // API usage invalidation strategies
      api_usage: {
        triggers: ['new_request', 'time_window_end', 'manual_reset'],
        scope: ['endpoint_specific', 'global', 'time_based'],
        cascading: false,
        immediate: true
      },

      // Server metrics invalidation
      server_metrics: {
        triggers: ['metric_update', 'health_change', 'manual_refresh'],
        scope: ['global', 'service_specific'],
        cascading: false,
        immediate: true
      }
    }
  }

  /**
   * Invalidate cache based on data type and trigger
   */
  async invalidateCache (dataType, trigger, context = {}) {
    try {
      const strategy = this.invalidationStrategies[dataType]

      if (!strategy) {
        logger.warn(`No invalidation strategy found for data type: ${dataType}`)
        return false
      }

      if (!strategy.triggers.includes(trigger)) {
        logger.debug(`Trigger ${trigger} not configured for ${dataType}`)
        return false
      }

      logger.info(`Invalidating cache for ${dataType} due to ${trigger}`, context)

      // Execute invalidation based on data type
      switch (dataType) {
        case 'market_data':
          await this.invalidateMarketData(trigger, context, strategy)
          break
        case 'mining_data':
          await this.invalidateMiningData(trigger, context, strategy)
          break
        case 'statistics':
          await this.invalidateStatistics(trigger, context, strategy)
          break
        case 'api_usage':
          await this.invalidateAPIUsage(trigger, context, strategy)
          break
        case 'server_metrics':
          await this.invalidateServerMetrics(trigger, context, strategy)
          break
        default:
          logger.warn(`Unknown data type for invalidation: ${dataType}`)
          return false
      }

      return true
    } catch (error) {
      logger.error(`Cache invalidation failed for ${dataType}:`, error)
      return false
    }
  }

  /**
   * Invalidate market data cache
   */
  async invalidateMarketData (trigger, context, strategy) {
    const { commodity, system, station, schema } = context

    // Redis cache invalidation
    if (this.redisCache && this.redisCache.isConnected) {
      if (commodity) {
        await this.redisCache.delPattern(`market:commodity:${commodity}*`)
        await this.redisCache.delPattern(`market:trends:${commodity}*`)

        // Invalidate related routes
        if (strategy.cascading) {
          await this.redisCache.delPattern('market:routes:*')
        }
      }

      if (system) {
        await this.redisCache.delPattern(`market:*:*:${system}`)
        await this.redisCache.delPattern(`market:system_summary:${system}`)

        if (strategy.cascading) {
          await this.redisCache.delPattern('market:routes:*')
        }
      }

      if (station && system) {
        await this.redisCache.delPattern(`market:station:${system}:${station}`)
      }

      // Publish invalidation message for distributed systems
      await this.redisCache.publishInvalidation('market_data_update', context)
    }

    // In-memory cache doesn't typically store market data (too large)
    // But invalidate any statistics that might be affected
    if (this.inMemoryCache) {
      this.inMemoryCache.invalidateStatistics('global')
    }

    logger.info(`Market data cache invalidated for: ${JSON.stringify(context)}`)
  }

  /**
   * Invalidate mining data cache
   */
  async invalidateMiningData (trigger, context, strategy) {
    const { location, commodity, system, mining_type } = context

    // Redis cache invalidation
    if (this.redisCache && this.redisCache.isConnected) {
      if (location) {
        await this.redisCache.delPattern(`mining:*:*${location}*`)
      }

      if (commodity) {
        await this.redisCache.delPattern(`mining:profitability:*${commodity}*`)

        if (strategy.cascading) {
          await this.redisCache.delPattern('mining:hotspots:*')
        }
      }

      if (system) {
        await this.redisCache.delPattern(`mining:*:*${system}*`)
      }

      // Publish invalidation message
      await this.redisCache.publishInvalidation('mining_data_update', context)
    }

    // Invalidate mining statistics
    if (this.inMemoryCache) {
      this.inMemoryCache.invalidateStatistics('mining')
    }

    logger.info(`Mining data cache invalidated for: ${JSON.stringify(context)}`)
  }

  /**
   * Invalidate statistics cache
   */
  async invalidateStatistics (trigger, context, strategy) {
    const { type, scope, time_range } = context

    // Redis cache invalidation
    if (this.redisCache && this.redisCache.isConnected) {
      if (scope === 'all') {
        await this.redisCache.delPattern('stats:*')
      } else if (type) {
        await this.redisCache.delPattern(`stats:${type}:*`)
      }

      // Publish invalidation message
      await this.redisCache.publishInvalidation('statistics_update', context)
    }

    // In-memory cache invalidation
    if (this.inMemoryCache) {
      if (scope === 'all') {
        this.inMemoryCache.invalidateStatistics()
      } else if (type) {
        this.inMemoryCache.invalidateStatistics(type)
      }
    }

    logger.info(`Statistics cache invalidated for: ${JSON.stringify(context)}`)
  }

  /**
   * Invalidate API usage cache
   */
  async invalidateAPIUsage (trigger, context, strategy) {
    const { endpoint, method, time_window } = context

    // Redis cache invalidation
    if (this.redisCache && this.redisCache.isConnected) {
      if (endpoint) {
        await this.redisCache.delPattern(`stats:api_usage:*${endpoint}*`)
      } else {
        await this.redisCache.delPattern('stats:api_usage:*')
      }
    }

    // In-memory cache invalidation
    if (this.inMemoryCache) {
      this.inMemoryCache.invalidateStatistics('api_usage')

      // Also clear API response time caches
      if (endpoint && method) {
        this.inMemoryCache.delete(`api:response_times:${endpoint}:${method}`)
      } else {
        this.inMemoryCache.deleteByPattern('api:response_times:*')
      }
    }

    logger.info(`API usage cache invalidated for: ${JSON.stringify(context)}`)
  }

  /**
   * Invalidate server metrics cache
   */
  async invalidateServerMetrics (trigger, context, strategy) {
    const { service, metric_type } = context

    // In-memory cache invalidation (server metrics are typically cached in-memory)
    if (this.inMemoryCache) {
      this.inMemoryCache.delete('server:metrics:current')
      this.inMemoryCache.deleteByPattern('connections:*:count')
      this.inMemoryCache.invalidateStatistics('server_metrics')
    }

    // Redis cache invalidation (if server metrics are also cached in Redis)
    if (this.redisCache && this.redisCache.isConnected) {
      await this.redisCache.delPattern('server:metrics:*')
    }

    logger.info(`Server metrics cache invalidated for: ${JSON.stringify(context)}`)
  }

  /**
   * Schedule automatic cache invalidation
   */
  setupScheduledInvalidation () {
    // Invalidate statistics cache every 5 minutes
    setInterval(async () => {
      await this.invalidateCache('statistics', 'scheduled_refresh', {
        scope: 'time_based',
        reason: 'scheduled_refresh'
      })
    }, 5 * 60 * 1000)

    // Invalidate API usage cache every minute
    setInterval(async () => {
      await this.invalidateCache('api_usage', 'time_window_end', {
        scope: 'time_based',
        reason: 'time_window_refresh'
      })
    }, 60 * 1000)

    // Invalidate server metrics every 30 seconds
    setInterval(async () => {
      await this.invalidateCache('server_metrics', 'metric_update', {
        scope: 'global',
        reason: 'scheduled_refresh'
      })
    }, 30 * 1000)

    logger.info('Scheduled cache invalidation timers set up')
  }

  /**
   * Invalidate cache based on EDDN message
   */
  async invalidateFromEDDNMessage (message) {
    const { $schemaRef, message: data } = message

    if ($schemaRef.includes('commodity')) {
      await this.invalidateCache('market_data', 'new_eddn_message', {
        commodity: data.commodities?.[0]?.name,
        system: data.systemName,
        station: data.stationName,
        schema: $schemaRef
      })
    } else if ($schemaRef.includes('outfitting')) {
      // Outfitting data might affect station statistics
      await this.invalidateCache('statistics', 'data_update', {
        type: 'global',
        scope: 'station_specific',
        system: data.systemName,
        station: data.stationName
      })
    }
  }

  /**
   * Bulk invalidation for maintenance
   */
  async bulkInvalidation (pattern = '*') {
    logger.info(`Starting bulk cache invalidation with pattern: ${pattern}`)

    let totalInvalidated = 0

    // Redis bulk invalidation
    if (this.redisCache && this.redisCache.isConnected) {
      const redisKeys = await this.redisCache.delPattern(pattern)
      totalInvalidated += redisKeys
      logger.info(`Invalidated ${redisKeys} keys from Redis`)
    }

    // In-memory bulk invalidation
    if (this.inMemoryCache) {
      if (pattern === '*') {
        this.inMemoryCache.clear()
        logger.info('Cleared all in-memory cache')
      } else {
        const memoryKeys = this.inMemoryCache.deleteByPattern(pattern)
        totalInvalidated += memoryKeys
        logger.info(`Invalidated ${memoryKeys} keys from in-memory cache`)
      }
    }

    logger.info(`Bulk invalidation completed. Total keys invalidated: ${totalInvalidated}`)
    return totalInvalidated
  }

  /**
   * Get invalidation statistics
   */
  getInvalidationStats () {
    return {
      strategies: Object.keys(this.invalidationStrategies),
      redisConnected: this.redisCache ? this.redisCache.isConnected : false,
      inMemoryAvailable: !!this.inMemoryCache,
      timestamp: new Date().toISOString()
    }
  }

  /**
   * Health check for cache invalidation system
   */
  async healthCheck () {
    const health = {
      status: 'healthy',
      components: {},
      timestamp: new Date().toISOString()
    }

    // Check Redis cache health
    if (this.redisCache) {
      const redisHealth = await this.redisCache.healthCheck()
      health.components.redis = redisHealth
      if (redisHealth.status !== 'healthy') {
        health.status = 'degraded'
      }
    } else {
      health.components.redis = { status: 'not_configured' }
    }

    // Check in-memory cache health
    if (this.inMemoryCache) {
      const memoryHealth = this.inMemoryCache.healthCheck()
      health.components.inMemory = memoryHealth
      if (memoryHealth.status !== 'healthy') {
        health.status = 'degraded'
      }
    } else {
      health.components.inMemory = { status: 'not_configured' }
    }

    health.invalidationStrategies = this.getInvalidationStats()

    return health
  }
}

module.exports = CacheInvalidationManager
