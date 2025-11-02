/**
 * Redis Cache Service for Elite Mining Data Server
 * Distributed caching with invalidation strategies and performance optimization
 */

const redis = require('redis')
const logger = require('../services/logger')

class RedisCacheService {
  constructor (config = {}) {
    this.config = {
      host: config.host || process.env.REDIS_HOST || 'localhost',
      port: config.port || process.env.REDIS_PORT || 6379,
      password: config.password || process.env.REDIS_PASSWORD,
      db: config.db || process.env.REDIS_DB || 0,
      keyPrefix: config.keyPrefix || 'elite_mining:',
      defaultTTL: config.defaultTTL || 300, // 5 minutes
      maxRetries: config.maxRetries || 3,
      retryDelayOnFailover: config.retryDelayOnFailover || 100,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3
    }

    this.client = null
    this.subscriber = null
    this.isConnected = false
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0
    }
  }

  /**
   * Initialize Redis connection
   */
  async initialize () {
    try {
      // Create main Redis client
      this.client = redis.createClient({
        socket: {
          host: this.config.host,
          port: this.config.port
        },
        password: this.config.password,
        database: this.config.db,
        name: 'elite_mining_cache'
      })

      // Create subscriber client for cache invalidation
      this.subscriber = redis.createClient({
        socket: {
          host: this.config.host,
          port: this.config.port
        },
        password: this.config.password,
        database: this.config.db,
        name: 'elite_mining_subscriber'
      })

      // Set up event handlers
      this.setupEventHandlers()

      // Connect to Redis
      await this.client.connect()
      await this.subscriber.connect()

      this.isConnected = true
      logger.info('Redis Cache Service initialized successfully')

      // Set up cache invalidation subscriptions
      await this.setupCacheInvalidation()

      return { status: 'connected', config: this.config }
    } catch (error) {
      logger.error('Failed to initialize Redis Cache Service:', error)
      throw error
    }
  }

  /**
   * Set up Redis event handlers
   */
  setupEventHandlers () {
    this.client.on('error', (error) => {
      logger.error('Redis Client Error:', error)
      this.stats.errors++
      this.isConnected = false
    })

    this.client.on('connect', () => {
      logger.info('Redis Client Connected')
      this.isConnected = true
    })

    this.client.on('reconnecting', () => {
      logger.warn('Redis Client Reconnecting')
      this.isConnected = false
    })

    this.client.on('end', () => {
      logger.warn('Redis Client Connection Ended')
      this.isConnected = false
    })

    this.subscriber.on('error', (error) => {
      logger.error('Redis Subscriber Error:', error)
    })
  }

  /**
   * Set up cache invalidation subscriptions
   */
  async setupCacheInvalidation () {
    // Subscribe to market data updates
    await this.subscriber.subscribe('market_data_update', (message) => {
      this.handleMarketDataInvalidation(JSON.parse(message))
    })

    // Subscribe to mining data updates
    await this.subscriber.subscribe('mining_data_update', (message) => {
      this.handleMiningDataInvalidation(JSON.parse(message))
    })

    // Subscribe to statistics updates
    await this.subscriber.subscribe('statistics_update', (message) => {
      this.handleStatisticsInvalidation(JSON.parse(message))
    })

    logger.info('Cache invalidation subscriptions set up')
  }

  /**
   * Get data from cache
   */
  async get (key) {
    if (!this.isConnected) {
      return null
    }

    try {
      const fullKey = this.getFullKey(key)
      const value = await this.client.get(fullKey)

      if (value) {
        this.stats.hits++
        return JSON.parse(value)
      } else {
        this.stats.misses++
        return null
      }
    } catch (error) {
      logger.error('Redis GET error:', error)
      this.stats.errors++
      return null
    }
  }

  /**
   * Set data in cache
   */
  async set (key, value, ttl = null) {
    if (!this.isConnected) {
      return false
    }

    try {
      const fullKey = this.getFullKey(key)
      const serializedValue = JSON.stringify(value)
      const cacheTTL = ttl || this.config.defaultTTL

      await this.client.setEx(fullKey, cacheTTL, serializedValue)
      this.stats.sets++
      return true
    } catch (error) {
      logger.error('Redis SET error:', error)
      this.stats.errors++
      return false
    }
  }

  /**
   * Delete data from cache
   */
  async del (key) {
    if (!this.isConnected) {
      return false
    }

    try {
      const fullKey = this.getFullKey(key)
      const result = await this.client.del(fullKey)
      this.stats.deletes++
      return result > 0
    } catch (error) {
      logger.error('Redis DEL error:', error)
      this.stats.errors++
      return false
    }
  }

  /**
   * Delete multiple keys by pattern
   */
  async delPattern (pattern) {
    if (!this.isConnected) {
      return 0
    }

    try {
      const fullPattern = this.getFullKey(pattern)
      const keys = await this.client.keys(fullPattern)

      if (keys.length > 0) {
        const result = await this.client.del(keys)
        this.stats.deletes += keys.length
        return result
      }

      return 0
    } catch (error) {
      logger.error('Redis DEL pattern error:', error)
      this.stats.errors++
      return 0
    }
  }

  /**
   * Check if key exists
   */
  async exists (key) {
    if (!this.isConnected) {
      return false
    }

    try {
      const fullKey = this.getFullKey(key)
      const result = await this.client.exists(fullKey)
      return result === 1
    } catch (error) {
      logger.error('Redis EXISTS error:', error)
      this.stats.errors++
      return false
    }
  }

  /**
   * Get TTL for key
   */
  async ttl (key) {
    if (!this.isConnected) {
      return -1
    }

    try {
      const fullKey = this.getFullKey(key)
      return await this.client.ttl(fullKey)
    } catch (error) {
      logger.error('Redis TTL error:', error)
      this.stats.errors++
      return -1
    }
  }

  /**
   * Cache market data with specific TTL based on data type
   */
  async cacheMarketData (type, key, data, system = null) {
    const cacheKey = this.buildMarketCacheKey(type, key, system)
    const ttl = this.getMarketDataTTL(type)

    // Add metadata for invalidation
    const cacheData = {
      ...data,
      _cached_at: new Date().toISOString(),
      _cache_type: 'market_data',
      _cache_key: cacheKey
    }

    return await this.set(cacheKey, cacheData, ttl)
  }

  /**
   * Get market data from cache
   */
  async getMarketData (type, key, system = null) {
    const cacheKey = this.buildMarketCacheKey(type, key, system)
    const data = await this.get(cacheKey)

    if (data && this.isMarketDataFresh(data, type)) {
      return data
    }

    // Data is stale, remove from cache
    if (data) {
      await this.del(cacheKey)
    }

    return null
  }

  /**
   * Cache statistics data
   */
  async cacheStatistics (type, data, filters = {}) {
    const cacheKey = this.buildStatsCacheKey(type, filters)
    const ttl = this.getStatisticsTTL(type)

    const cacheData = {
      ...data,
      _cached_at: new Date().toISOString(),
      _cache_type: 'statistics',
      _cache_key: cacheKey
    }

    return await this.set(cacheKey, cacheData, ttl)
  }

  /**
   * Get statistics from cache
   */
  async getStatistics (type, filters = {}) {
    const cacheKey = this.buildStatsCacheKey(type, filters)
    return await this.get(cacheKey)
  }

  /**
   * Cache mining data
   */
  async cacheMiningData (type, data, filters = {}) {
    const cacheKey = this.buildMiningCacheKey(type, filters)
    const ttl = this.getMiningDataTTL(type)

    const cacheData = {
      ...data,
      _cached_at: new Date().toISOString(),
      _cache_type: 'mining_data',
      _cache_key: cacheKey
    }

    return await this.set(cacheKey, cacheData, ttl)
  }

  /**
   * Get mining data from cache
   */
  async getMiningData (type, filters = {}) {
    const cacheKey = this.buildMiningCacheKey(type, filters)
    return await this.get(cacheKey)
  }

  /**
   * Build market data cache key
   */
  buildMarketCacheKey (type, key, system) {
    const parts = ['market', type, key]
    if (system) {
      parts.push(system)
    }
    return parts.join(':')
  }

  /**
   * Build statistics cache key
   */
  buildStatsCacheKey (type, filters) {
    const filterHash = this.hashFilters(filters)
    return `stats:${type}:${filterHash}`
  }

  /**
   * Build mining data cache key
   */
  buildMiningCacheKey (type, filters) {
    const filterHash = this.hashFilters(filters)
    return `mining:${type}:${filterHash}`
  }

  /**
   * Hash filters for cache key
   */
  hashFilters (filters) {
    const crypto = require('crypto')
    const filterString = JSON.stringify(filters, Object.keys(filters).sort())
    return crypto.createHash('md5').update(filterString).digest('hex').substring(0, 8)
  }

  /**
   * Get TTL for market data based on type
   */
  getMarketDataTTL (type) {
    const ttls = {
      commodity: 300, // 5 minutes
      routes: 600, // 10 minutes
      trends: 1800, // 30 minutes
      station: 300, // 5 minutes
      system_summary: 900 // 15 minutes
    }
    return ttls[type] || this.config.defaultTTL
  }

  /**
   * Get TTL for statistics based on type
   */
  getStatisticsTTL (type) {
    const ttls = {
      global: 600, // 10 minutes
      eddn: 120, // 2 minutes
      mining: 1800, // 30 minutes
      api_usage: 300, // 5 minutes
      websocket: 60 // 1 minute
    }
    return ttls[type] || this.config.defaultTTL
  }

  /**
   * Get TTL for mining data based on type
   */
  getMiningDataTTL (type) {
    const ttls = {
      profitability: 1800, // 30 minutes
      hotspots: 3600, // 1 hour
      locations: 900 // 15 minutes
    }
    return ttls[type] || this.config.defaultTTL
  }

  /**
   * Check if market data is still fresh
   */
  isMarketDataFresh (data, type) {
    if (!data._cached_at) return false

    const cachedAt = new Date(data._cached_at)
    const now = new Date()
    const ageMinutes = (now - cachedAt) / (1000 * 60)

    const freshnessThresholds = {
      commodity: 5,
      routes: 10,
      trends: 30,
      station: 5
    }

    const threshold = freshnessThresholds[type] || 5
    return ageMinutes < threshold
  }

  /**
   * Handle market data invalidation
   */
  async handleMarketDataInvalidation (message) {
    const { commodity, system, station, type } = message

    const patterns = []

    if (commodity) {
      patterns.push(`market:commodity:${commodity}*`)
      patterns.push(`market:trends:${commodity}*`)
    }

    if (system) {
      patterns.push(`market:*:*:${system}`)
      patterns.push(`market:system_summary:${system}`)
    }

    if (station) {
      patterns.push(`market:station:${system}:${station}`)
    }

    // Invalidate routes that might be affected
    if (commodity || system) {
      patterns.push('market:routes:*')
    }

    for (const pattern of patterns) {
      await this.delPattern(pattern)
    }

    logger.info(`Invalidated market cache for: ${JSON.stringify(message)}`)
  }

  /**
   * Handle mining data invalidation
   */
  async handleMiningDataInvalidation (message) {
    const { location, commodity, system } = message

    const patterns = []

    if (location) {
      patterns.push(`mining:*:*${location}*`)
    }

    if (commodity) {
      patterns.push(`mining:profitability:*${commodity}*`)
    }

    if (system) {
      patterns.push(`mining:*:*${system}*`)
    }

    for (const pattern of patterns) {
      await this.delPattern(pattern)
    }

    logger.info(`Invalidated mining cache for: ${JSON.stringify(message)}`)
  }

  /**
   * Handle statistics invalidation
   */
  async handleStatisticsInvalidation (message) {
    const { type, scope } = message

    if (scope === 'all') {
      await this.delPattern('stats:*')
    } else if (type) {
      await this.delPattern(`stats:${type}:*`)
    }

    logger.info(`Invalidated statistics cache for: ${JSON.stringify(message)}`)
  }

  /**
   * Publish cache invalidation message
   */
  async publishInvalidation (channel, message) {
    if (!this.isConnected) {
      return false
    }

    try {
      await this.client.publish(channel, JSON.stringify(message))
      return true
    } catch (error) {
      logger.error('Failed to publish invalidation message:', error)
      return false
    }
  }

  /**
   * Warm up cache with frequently accessed data
   */
  async warmupCache () {
    logger.info('Starting cache warmup...')

    try {
      // This would typically load frequently accessed data
      // Implementation depends on your specific use cases

      // Example: Pre-load popular commodities
      const popularCommodities = ['Gold', 'Painite', 'Void Opals', 'Low Temperature Diamonds']

      for (const commodity of popularCommodities) {
        // Pre-load recent market data for popular commodities
        // This would call your market data service and cache the results
        logger.info(`Warming up cache for commodity: ${commodity}`)
      }

      logger.info('Cache warmup completed')
      return true
    } catch (error) {
      logger.error('Cache warmup failed:', error)
      return false
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats () {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses)) * 100
      : 0

    return {
      ...this.stats,
      hitRate: Math.round(hitRate * 100) / 100,
      isConnected: this.isConnected,
      config: {
        host: this.config.host,
        port: this.config.port,
        db: this.config.db,
        keyPrefix: this.config.keyPrefix
      }
    }
  }

  /**
   * Clear all cache data
   */
  async clearCache () {
    if (!this.isConnected) {
      return false
    }

    try {
      await this.client.flushDb()
      logger.info('Cache cleared successfully')
      return true
    } catch (error) {
      logger.error('Failed to clear cache:', error)
      return false
    }
  }

  /**
   * Get full cache key with prefix
   */
  getFullKey (key) {
    return `${this.config.keyPrefix}${key}`
  }

  /**
   * Health check for Redis service
   */
  async healthCheck () {
    try {
      if (!this.isConnected) {
        return { status: 'unhealthy', message: 'Redis not connected' }
      }

      const ping = await this.client.ping()
      if (ping === 'PONG') {
        return {
          status: 'healthy',
          stats: this.getCacheStats(),
          timestamp: new Date().toISOString()
        }
      } else {
        return { status: 'unhealthy', message: 'Redis ping failed' }
      }
    } catch (error) {
      return { status: 'unhealthy', message: error.message }
    }
  }

  /**
   * Gracefully close Redis connections
   */
  async close () {
    try {
      if (this.client) {
        await this.client.quit()
      }
      if (this.subscriber) {
        await this.subscriber.quit()
      }
      this.isConnected = false
      logger.info('Redis Cache Service closed')
    } catch (error) {
      logger.error('Error closing Redis connections:', error)
    }
  }
}

module.exports = RedisCacheService
