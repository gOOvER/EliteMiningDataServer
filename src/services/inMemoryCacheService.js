/**
 * In-Memory Cache Service for Statistics and Fast Access Data
 * High-performance in-memory caching for frequently accessed statistics
 */

const logger = require('./logger')

class InMemoryCacheService {
  constructor (config = {}) {
    this.config = {
      maxSize: config.maxSize || 1000, // Maximum number of cached items
      defaultTTL: config.defaultTTL || 300, // 5 minutes default TTL
      cleanupInterval: config.cleanupInterval || 60, // Cleanup every minute
      enableMetrics: config.enableMetrics !== false
    }

    this.cache = new Map()
    this.timers = new Map()
    this.accessTimes = new Map()
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      cleanups: 0
    }

    this.startCleanupTimer()
  }

  /**
   * Get data from cache
   */
  get (key) {
    const item = this.cache.get(key)

    if (!item) {
      this.stats.misses++
      return null
    }

    // Check if item has expired
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.delete(key)
      this.stats.misses++
      return null
    }

    // Update access time for LRU
    this.accessTimes.set(key, Date.now())
    this.stats.hits++

    return item.value
  }

  /**
   * Set data in cache
   */
  set (key, value, ttl = null) {
    const cacheTTL = ttl || this.config.defaultTTL
    const expiresAt = cacheTTL > 0 ? Date.now() + (cacheTTL * 1000) : null

    // Check if we need to evict items due to size limit
    if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
      this.evictLRU()
    }

    // Clear existing timer if key already exists
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key))
      this.timers.delete(key)
    }

    // Set the cache item
    this.cache.set(key, {
      value,
      createdAt: Date.now(),
      expiresAt,
      ttl: cacheTTL
    })

    this.accessTimes.set(key, Date.now())

    // Set expiration timer if TTL is specified
    if (expiresAt) {
      const timer = setTimeout(() => {
        this.delete(key)
      }, cacheTTL * 1000)

      this.timers.set(key, timer)
    }

    this.stats.sets++
    return true
  }

  /**
   * Delete data from cache
   */
  delete (key) {
    const existed = this.cache.has(key)

    if (existed) {
      this.cache.delete(key)
      this.accessTimes.delete(key)

      if (this.timers.has(key)) {
        clearTimeout(this.timers.get(key))
        this.timers.delete(key)
      }

      this.stats.deletes++
    }

    return existed
  }

  /**
   * Check if key exists and is not expired
   */
  has (key) {
    const item = this.cache.get(key)

    if (!item) {
      return false
    }

    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.delete(key)
      return false
    }

    return true
  }

  /**
   * Get TTL for a key in seconds
   */
  getTTL (key) {
    const item = this.cache.get(key)

    if (!item || !item.expiresAt) {
      return -1
    }

    const remaining = item.expiresAt - Date.now()
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0
  }

  /**
   * Get or set pattern - if key exists return it, otherwise set and return new value
   */
  async getOrSet (key, valueFunction, ttl = null) {
    let value = this.get(key)

    if (value === null) {
      // Value not in cache, compute it
      if (typeof valueFunction === 'function') {
        value = await valueFunction()
      } else {
        value = valueFunction
      }

      this.set(key, value, ttl)
    }

    return value
  }

  /**
   * Cache statistics data with specific keys and TTLs
   */
  cacheStatistics (type, data, filters = {}) {
    const key = this.buildStatsKey(type, filters)
    const ttl = this.getStatisticsTTL(type)

    const cacheData = {
      ...data,
      _cached_at: new Date().toISOString(),
      _cache_type: 'statistics'
    }

    return this.set(key, cacheData, ttl)
  }

  /**
   * Get statistics from cache
   */
  getStatistics (type, filters = {}) {
    const key = this.buildStatsKey(type, filters)
    return this.get(key)
  }

  /**
   * Cache server metrics
   */
  cacheServerMetrics (metrics) {
    const key = 'server:metrics:current'
    return this.set(key, metrics, 30) // 30 seconds TTL for server metrics
  }

  /**
   * Get server metrics
   */
  getServerMetrics () {
    return this.get('server:metrics:current')
  }

  /**
   * Cache API response times
   */
  cacheAPIResponseTime (endpoint, method, duration) {
    const key = `api:response_times:${endpoint}:${method}`
    const existing = this.get(key) || { samples: [], avgDuration: 0 }

    // Keep last 100 samples for moving average
    existing.samples.push(duration)
    if (existing.samples.length > 100) {
      existing.samples.shift()
    }

    // Calculate new average
    existing.avgDuration = existing.samples.reduce((sum, d) => sum + d, 0) / existing.samples.length
    existing.lastUpdated = new Date().toISOString()

    return this.set(key, existing, 600) // 10 minutes TTL
  }

  /**
   * Get API response times
   */
  getAPIResponseTimes (endpoint, method) {
    const key = `api:response_times:${endpoint}:${method}`
    return this.get(key)
  }

  /**
   * Cache connection counts
   */
  cacheConnectionCount (type, count) {
    const key = `connections:${type}:count`
    const data = {
      count,
      timestamp: new Date().toISOString()
    }

    return this.set(key, data, 60) // 1 minute TTL
  }

  /**
   * Get connection count
   */
  getConnectionCount (type) {
    const key = `connections:${type}:count`
    return this.get(key)
  }

  /**
   * Build statistics cache key
   */
  buildStatsKey (type, filters) {
    const filterKeys = Object.keys(filters).sort()
    const filterString = filterKeys.map(k => `${k}:${filters[k]}`).join('|')
    return `stats:${type}:${filterString}`
  }

  /**
   * Get TTL for statistics based on type
   */
  getStatisticsTTL (type) {
    const ttls = {
      global: 300, // 5 minutes
      eddn: 60, // 1 minute
      mining: 600, // 10 minutes
      api_usage: 180, // 3 minutes
      websocket: 30, // 30 seconds
      server_metrics: 30 // 30 seconds
    }
    return ttls[type] || this.config.defaultTTL
  }

  /**
   * Evict least recently used item
   */
  evictLRU () {
    let oldestKey = null
    let oldestTime = Date.now()

    for (const [key, time] of this.accessTimes.entries()) {
      if (time < oldestTime) {
        oldestTime = time
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.delete(oldestKey)
      this.stats.evictions++
    }
  }

  /**
   * Clean up expired items
   */
  cleanup () {
    const now = Date.now()
    const keysToDelete = []

    for (const [key, item] of this.cache.entries()) {
      if (item.expiresAt && now > item.expiresAt) {
        keysToDelete.push(key)
      }
    }

    keysToDelete.forEach(key => this.delete(key))

    if (keysToDelete.length > 0) {
      this.stats.cleanups++
      logger.debug(`Cleaned up ${keysToDelete.length} expired cache items`)
    }
  }

  /**
   * Start periodic cleanup timer
   */
  startCleanupTimer () {
    setInterval(() => {
      this.cleanup()
    }, this.config.cleanupInterval * 1000)
  }

  /**
   * Get all keys matching a pattern
   */
  getKeysByPattern (pattern) {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'))
    const matchingKeys = []

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        matchingKeys.push(key)
      }
    }

    return matchingKeys
  }

  /**
   * Delete all keys matching a pattern
   */
  deleteByPattern (pattern) {
    const keys = this.getKeysByPattern(pattern)
    let deletedCount = 0

    keys.forEach(key => {
      if (this.delete(key)) {
        deletedCount++
      }
    })

    return deletedCount
  }

  /**
   * Invalidate statistics cache
   */
  invalidateStatistics (type = null) {
    if (type) {
      return this.deleteByPattern(`stats:${type}:*`)
    } else {
      return this.deleteByPattern('stats:*')
    }
  }

  /**
   * Get cache size and memory usage info
   */
  getMemoryInfo () {
    let estimatedSize = 0

    for (const [key, item] of this.cache.entries()) {
      // Rough estimation of memory usage
      estimatedSize += key.length * 2 // String overhead
      estimatedSize += JSON.stringify(item.value).length * 2
      estimatedSize += 64 // Object overhead
    }

    return {
      itemCount: this.cache.size,
      estimatedSizeBytes: estimatedSize,
      estimatedSizeMB: Math.round(estimatedSize / 1024 / 1024 * 100) / 100,
      maxSize: this.config.maxSize,
      utilizationPercent: Math.round((this.cache.size / this.config.maxSize) * 100)
    }
  }

  /**
   * Get comprehensive cache statistics
   */
  getStats () {
    const memory = this.getMemoryInfo()
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses)) * 100
      : 0

    return {
      ...this.stats,
      hitRate: Math.round(hitRate * 100) / 100,
      memory,
      config: this.config
    }
  }

  /**
   * Clear all cache data
   */
  clear () {
    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }

    this.cache.clear()
    this.timers.clear()
    this.accessTimes.clear()

    // Reset stats
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      cleanups: 0
    }

    logger.info('In-memory cache cleared')
  }

  /**
   * Health check for in-memory cache
   */
  healthCheck () {
    const memory = this.getMemoryInfo()
    const stats = this.getStats()

    const status = memory.utilizationPercent > 90 ? 'warning' : 'healthy'

    return {
      status,
      stats,
      timestamp: new Date().toISOString()
    }
  }

  /**
   * Export cache contents (for debugging)
   */
  exportCache () {
    const export_data = {}

    for (const [key, item] of this.cache.entries()) {
      export_data[key] = {
        value: item.value,
        createdAt: new Date(item.createdAt).toISOString(),
        expiresAt: item.expiresAt ? new Date(item.expiresAt).toISOString() : null,
        ttl: item.ttl,
        timeUntilExpiry: item.expiresAt ? Math.max(0, item.expiresAt - Date.now()) : null
      }
    }

    return export_data
  }
}

module.exports = InMemoryCacheService
