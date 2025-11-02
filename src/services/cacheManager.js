/**
 * Unified Cache Manager
 * Integrates Redis and In-Memory caching with performance optimization
 */

const RedisCacheService = require('./redisCacheService')
const InMemoryCacheService = require('./inMemoryCacheService')
const CacheInvalidationManager = require('./cacheInvalidationManager')
const logger = require('./logger')

class CacheManager {
  constructor (config = {}) {
    this.config = {
      redis: config.redis || {},
      inMemory: config.inMemory || {},
      strategy: config.strategy || 'hybrid', // 'redis-only', 'memory-only', 'hybrid'
      performanceOptimization: config.performanceOptimization !== false
    }

    this.redisCache = null
    this.inMemoryCache = null
    this.invalidationManager = null

    this.stats = {
      totalRequests: 0,
      redisHits: 0,
      memoryHits: 0,
      misses: 0,
      errors: 0
    }
  }

  /**
   * Initialize cache manager
   */
  async initialize () {
    try {
      logger.info('Initializing Cache Manager...')

      // Initialize in-memory cache (always available)
      if (this.config.strategy === 'memory-only' || this.config.strategy === 'hybrid') {
        this.inMemoryCache = new InMemoryCacheService(this.config.inMemory)
        logger.info('In-memory cache initialized')
      }

      // Initialize Redis cache (if configured)
      if (this.config.strategy === 'redis-only' || this.config.strategy === 'hybrid') {
        try {
          this.redisCache = new RedisCacheService(this.config.redis)
          await this.redisCache.initialize()
          logger.info('Redis cache initialized')
        } catch (error) {
          logger.warn('Redis cache initialization failed, falling back to memory-only:', error)

          if (this.config.strategy === 'redis-only') {
            throw new Error('Redis cache required but initialization failed')
          }

          // Fall back to memory-only for hybrid strategy
          this.config.strategy = 'memory-only'
        }
      }

      // Initialize invalidation manager
      this.invalidationManager = new CacheInvalidationManager(
        this.redisCache,
        this.inMemoryCache
      )

      // Set up scheduled invalidation
      this.invalidationManager.setupScheduledInvalidation()

      logger.info(`Cache Manager initialized with strategy: ${this.config.strategy}`)

      return {
        status: 'initialized',
        strategy: this.config.strategy,
        redis: !!this.redisCache,
        inMemory: !!this.inMemoryCache
      }
    } catch (error) {
      logger.error('Cache Manager initialization failed:', error)
      throw error
    }
  }

  /**
   * Get data from cache with fallback strategy
   */
  async get (key, options = {}) {
    this.stats.totalRequests++

    try {
      // Try in-memory cache first (fastest)
      if (this.inMemoryCache && (this.config.strategy === 'hybrid' || this.config.strategy === 'memory-only')) {
        const memoryValue = this.inMemoryCache.get(key)
        if (memoryValue !== null) {
          this.stats.memoryHits++
          return memoryValue
        }
      }

      // Try Redis cache second
      if (this.redisCache && (this.config.strategy === 'hybrid' || this.config.strategy === 'redis-only')) {
        const redisValue = await this.redisCache.get(key)
        if (redisValue !== null) {
          this.stats.redisHits++

          // Populate in-memory cache for future requests (if hybrid)
          if (this.config.strategy === 'hybrid' && this.inMemoryCache) {
            const ttl = options.memoryTTL || 60 // Default 1 minute for memory cache
            this.inMemoryCache.set(key, redisValue, ttl)
          }

          return redisValue
        }
      }

      this.stats.misses++
      return null
    } catch (error) {
      logger.error(`Cache GET error for key ${key}:`, error)
      this.stats.errors++
      return null
    }
  }

  /**
   * Set data in cache with multi-tier strategy
   */
  async set (key, value, options = {}) {
    const {
      redisTTL = 300, // 5 minutes default for Redis
      memoryTTL = 60, // 1 minute default for memory
      strategy = null // Override default strategy
    } = options

    const useStrategy = strategy || this.config.strategy
    let redisSuccess = false
    let memorySuccess = false

    try {
      // Set in Redis
      if (this.redisCache && (useStrategy === 'hybrid' || useStrategy === 'redis-only')) {
        redisSuccess = await this.redisCache.set(key, value, redisTTL)
      }

      // Set in memory
      if (this.inMemoryCache && (useStrategy === 'hybrid' || useStrategy === 'memory-only')) {
        memorySuccess = this.inMemoryCache.set(key, value, memoryTTL)
      }

      return redisSuccess || memorySuccess
    } catch (error) {
      logger.error(`Cache SET error for key ${key}:`, error)
      this.stats.errors++
      return false
    }
  }

  /**
   * Delete from all cache tiers
   */
  async del (key) {
    let deleted = false

    try {
      // Delete from Redis
      if (this.redisCache) {
        const redisDeleted = await this.redisCache.del(key)
        deleted = deleted || redisDeleted
      }

      // Delete from memory
      if (this.inMemoryCache) {
        const memoryDeleted = this.inMemoryCache.delete(key)
        deleted = deleted || memoryDeleted
      }

      return deleted
    } catch (error) {
      logger.error(`Cache DEL error for key ${key}:`, error)
      this.stats.errors++
      return false
    }
  }

  /**
   * Cache market data with optimized strategy
   */
  async cacheMarketData (type, key, data, system = null) {
    const options = this.getMarketDataCacheOptions(type)

    // Use Redis for market data (larger, less frequently accessed)
    if (this.redisCache) {
      return await this.redisCache.cacheMarketData(type, key, data, system)
    } else if (this.inMemoryCache) {
      // Fallback to memory cache with shorter TTL
      const cacheKey = this.buildMarketCacheKey(type, key, system)
      return this.inMemoryCache.set(cacheKey, data, options.memoryTTL)
    }

    return false
  }

  /**
   * Get market data with optimized retrieval
   */
  async getMarketData (type, key, system = null) {
    if (this.redisCache) {
      return await this.redisCache.getMarketData(type, key, system)
    } else if (this.inMemoryCache) {
      const cacheKey = this.buildMarketCacheKey(type, key, system)
      return this.inMemoryCache.get(cacheKey)
    }

    return null
  }

  /**
   * Cache statistics with memory-first strategy
   */
  async cacheStatistics (type, data, filters = {}) {
    // const options = this.getStatisticsCacheOptions(type)

    // Statistics are cached in memory first for speed
    if (this.inMemoryCache) {
      this.inMemoryCache.cacheStatistics(type, data, filters)
    }

    // Also cache in Redis for persistence
    if (this.redisCache) {
      await this.redisCache.cacheStatistics(type, data, filters)
    }

    return true
  }

  /**
   * Get statistics with memory-first lookup
   */
  async getStatistics (type, filters = {}) {
    // Try memory first for statistics (faster access)
    if (this.inMemoryCache) {
      const memoryValue = this.inMemoryCache.getStatistics(type, filters)
      if (memoryValue) {
        this.stats.memoryHits++
        return memoryValue
      }
    }

    // Fallback to Redis
    if (this.redisCache) {
      const redisValue = await this.redisCache.getStatistics(type, filters)
      if (redisValue) {
        this.stats.redisHits++

        // Populate memory cache
        if (this.inMemoryCache) {
          this.inMemoryCache.cacheStatistics(type, redisValue, filters)
        }

        return redisValue
      }
    }

    this.stats.misses++
    return null
  }

  /**
   * Cache server metrics (memory-only for speed)
   */
  cacheServerMetrics (metrics) {
    if (this.inMemoryCache) {
      return this.inMemoryCache.cacheServerMetrics(metrics)
    }
    return false
  }

  /**
   * Get server metrics
   */
  getServerMetrics () {
    if (this.inMemoryCache) {
      return this.inMemoryCache.getServerMetrics()
    }
    return null
  }

  /**
   * Cache API response times
   */
  cacheAPIResponseTime (endpoint, method, duration) {
    if (this.inMemoryCache) {
      return this.inMemoryCache.cacheAPIResponseTime(endpoint, method, duration)
    }
    return false
  }

  /**
   * Get API response times
   */
  getAPIResponseTimes (endpoint, method) {
    if (this.inMemoryCache) {
      return this.inMemoryCache.getAPIResponseTimes(endpoint, method)
    }
    return null
  }

  /**
   * Invalidate cache
   */
  async invalidateCache (dataType, trigger, context = {}) {
    if (this.invalidationManager) {
      return await this.invalidationManager.invalidateCache(dataType, trigger, context)
    }
    return false
  }

  /**
   * Get cache options for market data
   */
  getMarketDataCacheOptions (type) {
    const options = {
      commodity: { redisTTL: 300, memoryTTL: 60 }, // 5min Redis, 1min memory
      routes: { redisTTL: 600, memoryTTL: 120 }, // 10min Redis, 2min memory
      trends: { redisTTL: 1800, memoryTTL: 300 }, // 30min Redis, 5min memory
      station: { redisTTL: 300, memoryTTL: 60 } // 5min Redis, 1min memory
    }

    return options[type] || { redisTTL: 300, memoryTTL: 60 }
  }

  /**
   * Get cache options for statistics
   */
  getStatisticsCacheOptions (type) {
    const options = {
      global: { redisTTL: 600, memoryTTL: 60 }, // 10min Redis, 1min memory
      eddn: { redisTTL: 120, memoryTTL: 30 }, // 2min Redis, 30sec memory
      mining: { redisTTL: 1800, memoryTTL: 300 }, // 30min Redis, 5min memory
      api_usage: { redisTTL: 300, memoryTTL: 60 }, // 5min Redis, 1min memory
      websocket: { redisTTL: 60, memoryTTL: 30 } // 1min Redis, 30sec memory
    }

    return options[type] || { redisTTL: 300, memoryTTL: 60 }
  }

  /**
   * Build market cache key
   */
  buildMarketCacheKey (type, key, system) {
    const parts = ['market', type, key]
    if (system) {
      parts.push(system)
    }
    return parts.join(':')
  }

  /**
   * Warm up cache with frequently accessed data
   */
  async warmupCache () {
    logger.info('Starting cache warmup...')

    try {
      // Redis warmup
      if (this.redisCache) {
        await this.redisCache.warmupCache()
      }

      // Memory cache warmup with essential statistics
      if (this.inMemoryCache) {
        // Pre-load essential server metrics structure
        this.inMemoryCache.cacheServerMetrics({
          initialized: true,
          startup_time: new Date().toISOString()
        })
      }

      logger.info('Cache warmup completed')
      return true
    } catch (error) {
      logger.error('Cache warmup failed:', error)
      return false
    }
  }

  /**
   * Get comprehensive cache statistics
   */
  async getCacheStats () {
    const stats = {
      manager: { ...this.stats },
      timestamp: new Date().toISOString()
    }

    // Get Redis stats
    if (this.redisCache) {
      stats.redis = this.redisCache.getCacheStats()
    }

    // Get memory stats
    if (this.inMemoryCache) {
      stats.inMemory = this.inMemoryCache.getStats()
    }

    // Calculate overall hit rate
    const totalHits = this.stats.redisHits + this.stats.memoryHits
    const totalRequests = this.stats.totalRequests
    stats.manager.overallHitRate = totalRequests > 0
      ? Math.round((totalHits / totalRequests) * 10000) / 100
      : 0

    return stats
  }

  /**
   * Health check for entire cache system
   */
  async healthCheck () {
    const health = {
      status: 'healthy',
      strategy: this.config.strategy,
      components: {},
      stats: await this.getCacheStats(),
      timestamp: new Date().toISOString()
    }

    // Check Redis health
    if (this.redisCache) {
      const redisHealth = await this.redisCache.healthCheck()
      health.components.redis = redisHealth
      if (redisHealth.status !== 'healthy') {
        health.status = 'degraded'
      }
    }

    // Check memory cache health
    if (this.inMemoryCache) {
      const memoryHealth = this.inMemoryCache.healthCheck()
      health.components.inMemory = memoryHealth
      if (memoryHealth.status !== 'healthy') {
        health.status = 'degraded'
      }
    }

    // Check invalidation manager health
    if (this.invalidationManager) {
      const invalidationHealth = await this.invalidationManager.healthCheck()
      health.components.invalidation = invalidationHealth
      if (invalidationHealth.status !== 'healthy') {
        health.status = 'degraded'
      }
    }

    return health
  }

  /**
   * Clear all caches
   */
  async clearAll () {
    logger.info('Clearing all caches...')

    let cleared = 0

    if (this.redisCache) {
      const redisCleared = await this.redisCache.clearCache()
      if (redisCleared) cleared++
    }

    if (this.inMemoryCache) {
      this.inMemoryCache.clear()
      cleared++
    }

    // Reset stats
    this.stats = {
      totalRequests: 0,
      redisHits: 0,
      memoryHits: 0,
      misses: 0,
      errors: 0
    }

    logger.info(`Cleared ${cleared} cache layers`)
    return cleared
  }

  /**
   * Gracefully close cache connections
   */
  async close () {
    logger.info('Closing Cache Manager...')

    if (this.redisCache) {
      await this.redisCache.close()
    }

    if (this.inMemoryCache) {
      this.inMemoryCache.clear()
    }

    logger.info('Cache Manager closed')
  }
}

module.exports = CacheManager
