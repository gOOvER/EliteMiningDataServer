const { MongoClient } = require('mongodb')
const logger = require('./logger')

class MongoService {
  constructor (config) {
    this.connectionString = config.uri || 'mongodb://localhost:27017'
    this.dbName = config.dbName || 'elite_mining'
    this.maxConnections = config.maxConnections || 100

    this.client = null
    this.db = null
    this.cache = new Map()
    this.cacheTimeout = config.cacheTimeout || 15 * 60 * 1000 // 15 minutes

    // Performance monitoring
    this.stats = {
      connectionsActive: 0,
      queriesExecuted: 0,
      documentsProcessed: 0,
      cacheHits: 0,
      cacheMisses: 0
    }
  }

  async initialize () {
    try {
      logger.info('Connecting to MongoDB...')

      this.client = new MongoClient(this.connectionString, {
        maxPoolSize: this.maxConnections,
        minPoolSize: 5,
        maxIdleTimeMS: 30000,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000
        // Compression disabled to avoid optional dependency issues
        // Can be re-enabled by installing @mongodb-js/zstd and @mongodb-js/zlib
        // compressors: ['zstd', 'zlib']
      })

      await this.client.connect()
      this.db = this.client.db(this.dbName)

      // Test connection
      await this.db.admin().ping()
      logger.info(`Connected to MongoDB database: ${this.dbName}`)

      // Create collections and indexes
      await this.setupCollections()

      // Setup periodic cache cleanup
      setInterval(() => this.clearExpiredCache(), 5 * 60 * 1000) // Every 5 minutes
    } catch (error) {
      logger.error('MongoDB connection error:', error)
      throw error
    }
  }

  async setupCollections () {
    try {
      // Create collections if they don't exist
      const collections = [
        'mining_sites',
        'commodity_prices',
        'systems',
        'stations',
        'mining_reports',
        'mining_analytics' // For aggregated data
      ]

      for (const collectionName of collections) {
        try {
          await this.db.createCollection(collectionName)
        } catch (error) {
          // Collection might already exist, that's fine
          if (error.code !== 48) { // NamespaceExists
            logger.warn(`Could not create collection ${collectionName}:`, error.message)
          }
        }
      }

      await this.createIndexes()
      logger.info('MongoDB collections and indexes created successfully')
    } catch (error) {
      logger.error('Error setting up collections:', error)
      throw error
    }
  }

  async createIndexes () {
    try {
      // Systems collection - Geospatial and text search
      await this.db.collection('systems').createIndexes([
        {
          key: { coordinates: '2dsphere' },
          name: 'coordinates_2dsphere'
        },
        {
          key: { name: 'text' },
          name: 'name_text'
        },
        {
          key: { name: 1 },
          name: 'name_1',
          unique: true
        },
        {
          key: { lastUpdated: -1 },
          name: 'lastUpdated_-1'
        }
      ])

      // Mining sites - Spatial and material queries
      await this.db.collection('mining_sites').createIndexes([
        {
          key: { systemName: 1, bodyName: 1, siteType: 1 },
          name: 'site_unique',
          unique: true
        },
        {
          key: { systemName: 1, materialType: 1 },
          name: 'system_material_1'
        },
        {
          key: { hotspotMaterials: 1 },
          name: 'hotspot_materials_1'
        },
        {
          key: { coordinates: '2dsphere' },
          name: 'site_coordinates_2dsphere'
        },
        {
          key: { lastUpdated: -1 },
          name: 'site_lastUpdated_-1'
        }
      ])

      // Commodity prices - High-frequency updates
      await this.db.collection('commodity_prices').createIndexes([
        {
          key: { commodityName: 1, stationName: 1, systemName: 1 },
          name: 'commodity_station_unique',
          unique: true
        },
        {
          key: { commodityName: 1, 'prices.sell': -1 },
          name: 'commodity_sell_price'
        },
        {
          key: { commodityName: 1, 'prices.buy': 1 },
          name: 'commodity_buy_price'
        },
        {
          key: { systemName: 1, lastUpdated: -1 },
          name: 'system_updated'
        },
        {
          key: { lastUpdated: -1 },
          name: 'price_lastUpdated_-1',
          expireAfterSeconds: 86400 * 7 // Auto-delete after 7 days
        }
      ])

      // Mining reports - Time series data
      await this.db.collection('mining_reports').createIndexes([
        {
          key: { systemName: 1, materialRefined: 1, timestamp: -1 },
          name: 'mining_activity'
        },
        {
          key: { timestamp: -1 },
          name: 'timestamp_-1'
        },
        {
          key: { timestamp: 1 },
          name: 'timestamp_ttl',
          expireAfterSeconds: 86400 * 30 // Auto-delete after 30 days
        }
      ])

      // Stations
      await this.db.collection('stations').createIndexes([
        {
          key: { name: 1, systemName: 1 },
          name: 'station_unique',
          unique: true
        },
        {
          key: { systemName: 1, distanceFromStar: 1 },
          name: 'system_distance'
        }
      ])

      logger.info('MongoDB indexes created successfully')
    } catch (error) {
      logger.error('Error creating indexes:', error)
      throw error
    }
  }

  // High-performance bulk operations for large data volumes
  async bulkInsertCommodityPrices (pricesData) {
    try {
      if (!Array.isArray(pricesData) || pricesData.length === 0) {
        return { insertedCount: 0 }
      }

      const operations = pricesData.map(price => ({
        replaceOne: {
          filter: {
            commodityName: price.commodityName,
            stationName: price.stationName,
            systemName: price.systemName
          },
          replacement: {
            ...price,
            lastUpdated: new Date()
          },
          upsert: true
        }
      }))

      const result = await this.db.collection('commodity_prices').bulkWrite(operations, {
        ordered: false, // Continue on errors
        bypassDocumentValidation: false
      })

      this.stats.documentsProcessed += pricesData.length
      logger.info(`Bulk inserted ${result.upsertedCount + result.modifiedCount} commodity prices`)

      return result
    } catch (error) {
      logger.error('Error in bulk insert commodity prices:', error)
      throw error
    }
  }

  async insertMiningReport (data) {
    try {
      const document = {
        commanderName: data.commanderName,
        systemName: data.systemName,
        bodyName: data.bodyName,
        materialRefined: data.materialRefined,
        amount: data.amount || 1,
        timestamp: new Date(),
        source: data.source,
        coordinates: data.coordinates || null
      }

      const result = await this.db.collection('mining_reports').insertOne(document)
      this.stats.documentsProcessed++

      return result
    } catch (error) {
      logger.error('Error inserting mining report:', error)
      throw error
    }
  }

  async insertMiningSite (data) {
    try {
      const document = {
        systemName: data.systemName,
        bodyName: data.bodyName,
        siteType: data.siteType,
        materialType: data.materialType,
        hotspotMaterials: data.hotspotMaterials || [],
        coordinates: {
          type: 'Point',
          coordinates: [data.coordinates?.x || 0, data.coordinates?.y || 0, data.coordinates?.z || 0]
        },
        distanceFromStar: data.distanceFromStar,
        ringData: {
          mass: data.ringMass,
          innerRadius: data.ringInnerRadius,
          outerRadius: data.ringOuterRadius
        },
        lastUpdated: new Date(),
        source: data.source
      }

      const result = await this.db.collection('mining_sites').replaceOne(
        {
          systemName: data.systemName,
          bodyName: data.bodyName,
          siteType: data.siteType
        },
        document,
        { upsert: true }
      )

      this.stats.documentsProcessed++
      return result
    } catch (error) {
      logger.error('Error inserting mining site:', error)
      throw error
    }
  }

  // Advanced aggregation for mining opportunities
  async findBestMiningOpportunities (systemName, radius = 50, material = null) {
    const cacheKey = `mining_opportunities_${systemName}_${radius}_${material || 'all'}`
    const cached = this.getCache(cacheKey)
    if (cached) return cached

    try {
      // Get reference system coordinates
      const referenceSystem = await this.db.collection('systems').findOne(
        { name: systemName },
        { projection: { coordinates: 1 } }
      )

      if (!referenceSystem?.coordinates) {
        return []
      }

      const pipeline = [
        {
          $geoNear: {
            near: referenceSystem.coordinates,
            distanceField: 'distanceFromReference',
            maxDistance: radius * 3.26156 * 9461000000000, // ly to meters
            spherical: true,
            distanceMultiplier: 1 / (3.26156 * 9461000000000) // back to ly
          }
        }
      ]

      // Filter by material if specified
      if (material) {
        pipeline.push({
          $match: {
            hotspotMaterials: material
          }
        })
      }

      // Add commodity price data
      pipeline.push(
        {
          $lookup: {
            from: 'commodity_prices',
            let: { materials: '$hotspotMaterials', system: '$systemName' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $in: ['$commodityName', '$$materials'] },
                      { $eq: ['$systemName', '$$system'] }
                    ]
                  }
                }
              },
              { $sort: { 'prices.sell': -1 } },
              { $limit: 5 }
            ],
            as: 'nearbyPrices'
          }
        },
        {
          $addFields: {
            avgSellPrice: { $avg: '$nearbyPrices.prices.sell' },
            maxSellPrice: { $max: '$nearbyPrices.prices.sell' },
            profitabilityScore: {
              $divide: [
                { $max: '$nearbyPrices.prices.sell' },
                { $add: ['$distanceFromReference', 1] }
              ]
            }
          }
        },
        { $sort: { profitabilityScore: -1, distanceFromReference: 1 } },
        { $limit: 20 }
      )

      const opportunities = await this.db.collection('mining_sites').aggregate(pipeline).toArray()

      this.setCache(cacheKey, opportunities, 10 * 60 * 1000) // 10 minutes cache
      this.stats.queriesExecuted++

      return opportunities
    } catch (error) {
      logger.error('Error finding mining opportunities:', error)
      return []
    }
  }

  // Optimized commodity price queries
  async getBestCommodityPrices (commodityName, limit = 10, priceType = 'sell') {
    const cacheKey = `best_${priceType}_${commodityName}_${limit}`
    const cached = this.getCache(cacheKey)
    if (cached) {
      this.stats.cacheHits++
      return cached
    }

    try {
      const sortField = priceType === 'sell' ? 'prices.sell' : 'prices.buy'
      const sortOrder = priceType === 'sell' ? -1 : 1

      const query = {
        commodityName,
        [sortField]: { $gt: 0 }
      }

      const results = await this.db.collection('commodity_prices')
        .find(query)
        .sort({ [sortField]: sortOrder })
        .limit(limit)
        .toArray()

      this.setCache(cacheKey, results, 5 * 60 * 1000) // 5 minutes cache
      this.stats.cacheMisses++
      this.stats.queriesExecuted++

      return results
    } catch (error) {
      logger.error('Error getting commodity prices:', error)
      return []
    }
  }

  // Real-time analytics aggregation
  async generateHourlyMiningStats () {
    try {
      const pipeline = [
        {
          $match: {
            timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          }
        },
        {
          $group: {
            _id: {
              hour: { $dateToString: { format: '%Y-%m-%d-%H', date: '$timestamp' } },
              material: '$materialRefined',
              system: '$systemName'
            },
            count: { $sum: 1 },
            totalAmount: { $sum: '$amount' }
          }
        },
        {
          $group: {
            _id: '$_id.hour',
            materials: {
              $push: {
                material: '$_id.material',
                system: '$_id.system',
                count: '$count',
                amount: '$totalAmount'
              }
            },
            totalReports: { $sum: '$count' }
          }
        },
        { $sort: { _id: -1 } }
      ]

      const stats = await this.db.collection('mining_reports').aggregate(pipeline).toArray()

      // Store aggregated data for faster access
      if (stats.length > 0) {
        await this.db.collection('mining_analytics').replaceOne(
          { type: 'hourly_stats', date: new Date().toISOString().slice(0, 10) },
          {
            type: 'hourly_stats',
            date: new Date().toISOString().slice(0, 10),
            data: stats,
            generatedAt: new Date()
          },
          { upsert: true }
        )
      }

      return stats
    } catch (error) {
      logger.error('Error generating mining stats:', error)
      return []
    }
  }

  // Cache management
  setCache (key, value, customTimeout = null) {
    const timeout = customTimeout || this.cacheTimeout
    const expiry = Date.now() + timeout
    this.cache.set(key, { value, expiry })
  }

  getCache (key) {
    const cached = this.cache.get(key)
    if (!cached) return null

    if (Date.now() > cached.expiry) {
      this.cache.delete(key)
      return null
    }

    return cached.value
  }

  clearExpiredCache () {
    const now = Date.now()
    let cleared = 0

    for (const [key, value] of this.cache.entries()) {
      if (now > value.expiry) {
        this.cache.delete(key)
        cleared++
      }
    }

    if (cleared > 0) {
      logger.debug(`Cleared ${cleared} expired cache entries`)
    }
  }

  // Performance monitoring
  getStatistics () {
    return {
      ...this.stats,
      cacheSize: this.cache.size,
      connected: this.client?.topology?.isConnected() || false
    }
  }

  async close () {
    try {
      if (this.client) {
        await this.client.close()
        logger.info('MongoDB connection closed')
      }
    } catch (error) {
      logger.error('Error closing MongoDB connection:', error)
    }
  }
}

module.exports = MongoService
