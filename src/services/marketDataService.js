const logger = require('./logger')

/**
 * Market Data Service
 * Handles all market-related database operations and calculations
 */
class MarketDataService {
  constructor (mongoService, cacheManager = null) {
    this.mongo = mongoService
    this.cache = cacheManager
    this.collections = {
      marketData: 'market_data',
      stations: 'stations',
      systems: 'systems',
      commodities: 'commodities',
      prices: 'commodity_prices'
    }
  }

  /**
   * Get commodity market data with filtering and aggregation
   */
  async getCommodityData (commodityId, options = {}) {
    try {
      const { systemName, stationName, maxAge = 24 } = options

      // Generate cache key
      const cacheKey = `commodity:${commodityId}:${systemName || 'all'}:${stationName || 'all'}:${maxAge}`

      // Try to get from cache if available
      if (this.cache) {
        const cached = await this.cache.get(cacheKey)
        if (cached) {
          logger.debug(`Cache hit for commodity data: ${cacheKey}`)
          return cached
        }
      }

      const maxAgeMs = maxAge * 60 * 60 * 1000 // Convert hours to milliseconds
      const cutoffTime = new Date(Date.now() - maxAgeMs)

      const pipeline = [
        {
          $match: {
            commodityId,
            timestamp: { $gte: cutoffTime }
          }
        }
      ]

      // Add system filter if provided
      if (systemName) {
        pipeline[0].$match.systemName = new RegExp(systemName, 'i')
      }

      // Add station filter if provided
      if (stationName) {
        pipeline[0].$match.stationName = new RegExp(stationName, 'i')
      }

      // Aggregate price data
      pipeline.push(
        {
          $group: {
            _id: {
              systemName: '$systemName',
              stationName: '$stationName'
            },
            avgBuyPrice: { $avg: '$buyPrice' },
            avgSellPrice: { $avg: '$sellPrice' },
            maxBuyPrice: { $max: '$buyPrice' },
            minSellPrice: { $min: '$sellPrice' },
            supply: { $last: '$supply' },
            demand: { $last: '$demand' },
            lastUpdated: { $last: '$timestamp' },
            dataPoints: { $sum: 1 }
          }
        },
        {
          $sort: { lastUpdated: -1 }
        },
        {
          $limit: 50 // Limit results for performance
        }
      )

      const db = await this.mongo.getDatabase()
      const results = await db.collection(this.collections.prices)
        .aggregate(pipeline)
        .toArray()

      // Calculate overall statistics
      const stats = this.calculatePriceStatistics(results)

      const result = {
        commodity: commodityId,
        filter: { systemName, stationName },
        statistics: stats,
        locations: results.map(result => ({
          system: result._id.systemName,
          station: result._id.stationName,
          prices: {
            buy: Math.round(result.avgBuyPrice || 0),
            sell: Math.round(result.avgSellPrice || 0),
            maxBuy: Math.round(result.maxBuyPrice || 0),
            minSell: Math.round(result.minSellPrice || 0)
          },
          supply: result.supply || 0,
          demand: result.demand || 0,
          lastUpdated: result.lastUpdated,
          dataPoints: result.dataPoints,
          freshness: this.calculateFreshness(result.lastUpdated)
        })),
        totalLocations: results.length,
        maxAge
      }

      // Cache the result if cache manager is available
      if (this.cache) {
        await this.cache.set(cacheKey, result, 300) // Cache for 5 minutes
        logger.debug(`Cached commodity data: ${cacheKey}`)
      }

      return result
    } catch (error) {
      logger.error('Error fetching commodity data:', error)
      throw new Error(`Failed to fetch commodity data: ${error.message}`)
    }
  }

  /**
   * Calculate trading routes between systems
   */
  async calculateTradingRoutes (startSystem, options = {}) {
    try {
      const { maxJumps = 20, cargoCapacity = 100, minProfit = 1000 } = options

      // First, get systems within jump range
      const nearbySystemsMap = await this.getNearbySystemsWithCoordinates(startSystem, maxJumps)
      const nearbySystemNames = Array.from(nearbySystemsMap.keys())

      if (nearbySystemNames.length === 0) {
        return {
          startSystem,
          routes: [],
          message: 'No nearby systems found or start system coordinates unavailable'
        }
      }

      // Get market data for all nearby systems
      const marketData = await this.getMarketDataForSystems(nearbySystemNames)

      // Calculate profitable routes
      const routes = this.calculateProfitableRoutes(
        startSystem,
        marketData,
        nearbySystemsMap,
        { cargoCapacity, minProfit }
      )

      return {
        startSystem,
        maxJumps,
        cargoCapacity,
        minProfit,
        systemsAnalyzed: nearbySystemNames.length,
        routes: routes.slice(0, 10), // Top 10 routes
        totalRoutes: routes.length
      }
    } catch (error) {
      logger.error('Error calculating trading routes:', error)
      throw new Error(`Failed to calculate trading routes: ${error.message}`)
    }
  }

  /**
   * Get market trends for commodities
   */
  async getMarketTrends (commodityName, timeRange = '7d') {
    try {
      const days = this.parseTimeRange(timeRange)
      const startDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000))

      const pipeline = [
        {
          $match: {
            commodityId: commodityName ? new RegExp(commodityName, 'i') : { $exists: true },
            timestamp: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: {
              commodity: '$commodityId',
              date: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$timestamp'
                }
              }
            },
            avgPrice: { $avg: { $avg: ['$buyPrice', '$sellPrice'] } },
            volume: { $sum: { $add: ['$supply', '$demand'] } },
            dataPoints: { $sum: 1 }
          }
        },
        {
          $sort: { '_id.date': 1 }
        }
      ]

      const db = await this.mongo.getDatabase()
      const results = await db.collection(this.collections.prices)
        .aggregate(pipeline)
        .toArray()

      // Group by commodity and calculate trends
      const trendsBycommodity = this.groupTrendsBycommodity(results)
      const trendsWithAnalysis = this.analyzeTrends(trendsBycommodity)

      return {
        commodity: commodityName || 'all',
        timeRange,
        period: `${days} days`,
        trends: trendsWithAnalysis,
        dataPoints: results.length
      }
    } catch (error) {
      logger.error('Error fetching market trends:', error)
      throw new Error(`Failed to fetch market trends: ${error.message}`)
    }
  }

  /**
   * Get complete station market data
   */
  async getStationMarketData (systemName, stationName) {
    try {
      const pipeline = [
        {
          $match: {
            systemName: new RegExp(systemName, 'i'),
            stationName: new RegExp(stationName, 'i'),
            timestamp: {
              $gte: new Date(Date.now() - (24 * 60 * 60 * 1000)) // Last 24 hours
            }
          }
        },
        {
          $sort: { timestamp: -1 }
        },
        {
          $group: {
            _id: '$commodityId',
            buyPrice: { $first: '$buyPrice' },
            sellPrice: { $first: '$sellPrice' },
            supply: { $first: '$supply' },
            demand: { $first: '$demand' },
            lastUpdated: { $first: '$timestamp' }
          }
        },
        {
          $sort: { _id: 1 }
        }
      ]

      const db = await this.mongo.getDatabase()
      const commodities = await db.collection(this.collections.prices)
        .aggregate(pipeline)
        .toArray()

      // Get station information
      const stationInfo = await this.getStationInfo(systemName, stationName)

      return {
        system: systemName,
        station: stationName,
        stationInfo,
        commodities: commodities.map(commodity => ({
          name: commodity._id,
          buyPrice: commodity.buyPrice || 0,
          sellPrice: commodity.sellPrice || 0,
          supply: commodity.supply || 0,
          demand: commodity.demand || 0,
          profit: this.calculateProfit(commodity.buyPrice, commodity.sellPrice),
          lastUpdated: commodity.lastUpdated,
          freshness: this.calculateFreshness(commodity.lastUpdated)
        })),
        totalCommodities: commodities.length,
        lastUpdated: new Date().toISOString()
      }
    } catch (error) {
      logger.error('Error fetching station market data:', error)
      throw new Error(`Failed to fetch station market data: ${error.message}`)
    }
  }

  // Helper methods

  calculatePriceStatistics (results) {
    if (results.length === 0) return null

    const buyPrices = results.map(r => r.avgBuyPrice).filter(p => p > 0)
    const sellPrices = results.map(r => r.avgSellPrice).filter(p => p > 0)

    return {
      avgBuyPrice: buyPrices.length > 0 ? Math.round(buyPrices.reduce((a, b) => a + b, 0) / buyPrices.length) : 0,
      avgSellPrice: sellPrices.length > 0 ? Math.round(sellPrices.reduce((a, b) => a + b, 0) / sellPrices.length) : 0,
      priceSpread: sellPrices.length > 0 && buyPrices.length > 0
        ? Math.round(Math.max(...sellPrices) - Math.min(...buyPrices))
        : 0,
      locations: results.length
    }
  }

  async getNearbySystemsWithCoordinates (systemName, maxJumps) {
    // This would integrate with EDSM API to get system coordinates
    // For now, return a mock implementation
    const systemsMap = new Map()
    systemsMap.set('Sol', { x: 0, y: 0, z: 0, distance: 0 })
    systemsMap.set('Alpha Centauri', { x: 3.03, y: -0.01, z: 3.15, distance: 4.3 })
    return systemsMap
  }

  async getMarketDataForSystems (systemNames) {
    const db = await this.mongo.getDatabase()
    return await db.collection(this.collections.prices)
      .find({ systemName: { $in: systemNames } })
      .toArray()
  }

  calculateProfitableRoutes (startSystem, marketData, systemsMap, options) {
    // Complex route calculation logic would go here
    // For now, return a mock profitable route
    return [{
      from: { system: startSystem, station: 'Mock Station A' },
      to: { system: 'Alpha Centauri', station: 'Mock Station B' },
      commodity: 'Gold',
      buyPrice: 9000,
      sellPrice: 12000,
      profit: 3000,
      profitPerTon: 3000,
      totalProfit: 3000 * options.cargoCapacity,
      distance: 4.3,
      jumps: 1
    }]
  }

  parseTimeRange (timeRange) {
    const match = timeRange.match(/(\d+)([dwmy])/)
    if (!match) return 7 // Default to 7 days

    const [, number, unit] = match
    const multipliers = { d: 1, w: 7, m: 30, y: 365 }
    return parseInt(number) * (multipliers[unit] || 1)
  }

  groupTrendsBycommodity (results) {
    const grouped = {}
    results.forEach(result => {
      const commodity = result._id.commodity
      if (!grouped[commodity]) {
        grouped[commodity] = []
      }
      grouped[commodity].push({
        date: result._id.date,
        price: result.avgPrice,
        volume: result.volume,
        dataPoints: result.dataPoints
      })
    })
    return grouped
  }

  analyzeTrends (trendsBycommodity) {
    const analyzed = []
    for (const [commodity, trends] of Object.entries(trendsBycommodity)) {
      if (trends.length < 2) continue

      const prices = trends.map(t => t.price)
      const firstPrice = prices[0]
      const lastPrice = prices[prices.length - 1]
      const priceChange = lastPrice - firstPrice
      const priceChangePercent = (priceChange / firstPrice) * 100

      analyzed.push({
        commodity,
        dataPoints: trends,
        analysis: {
          priceChange: Math.round(priceChange),
          priceChangePercent: Math.round(priceChangePercent * 100) / 100,
          trend: priceChange > 0 ? 'rising' : priceChange < 0 ? 'falling' : 'stable',
          volatility: this.calculateVolatility(prices),
          avgPrice: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
        }
      })
    }
    return analyzed
  }

  calculateVolatility (prices) {
    if (prices.length < 2) return 0
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length
    const variance = prices.reduce((sum, price) => sum + Math.pow(price - avg, 2), 0) / prices.length
    return Math.round(Math.sqrt(variance))
  }

  async getStationInfo (systemName, stationName) {
    // This would query station details from database
    return {
      type: 'Coriolis Starport',
      services: ['Market', 'Shipyard', 'Outfitting', 'Repair'],
      landingPadSize: 'Large',
      distanceFromStar: 'Unknown'
    }
  }

  calculateProfit (buyPrice, sellPrice) {
    if (!buyPrice || !sellPrice) return 0
    return Math.max(0, sellPrice - buyPrice)
  }

  calculateFreshness (timestamp) {
    const ageMs = Date.now() - new Date(timestamp).getTime()
    const ageHours = ageMs / (1000 * 60 * 60)

    if (ageHours < 1) return 'Fresh'
    if (ageHours < 6) return 'Recent'
    if (ageHours < 24) return 'Moderate'
    return 'Stale'
  }
}

module.exports = MarketDataService
