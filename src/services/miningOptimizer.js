const EDDNClient = require('./clients/eddnClient')
const InaraClient = require('./clients/inaraClient')
const EDSMClient = require('./clients/edsmClient')
const MongoService = require('./services/mongoService')
const logger = require('./services/logger')

class MiningDataOptimizer {
  constructor (config) {
    this.config = config
    this.eddnClient = new EDDNClient(config.eddn || {})
    this.inaraClient = new InaraClient(config.inara || {})
    this.edsmClient = new EDSMClient(config.edsm || {})
    this.mongoService = new MongoService(config.mongodb || {})

    this.isRunning = false
    this.statistics = {
      eddnMessages: 0,
      inaraRequests: 0,
      edsmRequests: 0,
      miningOpportunities: 0,
      systemsAnalyzed: 0,
      startTime: null
    }
  }

  async start () {
    logger.info('Starting Mining Data Optimizer with enhanced API clients...')

    try {
      // Initialize services
      await this.mongoService.connect()
      logger.info('MongoDB connection established')

      // Test API connections
      await this.testApiConnections()

      // Set up EDDN message handlers
      this.setupEDDNHandlers()

      // Connect to EDDN stream
      await this.eddnClient.connect()

      this.isRunning = true
      this.statistics.startTime = new Date()

      // Start periodic optimization routines
      this.startOptimizationRoutines()

      logger.info('Mining Data Optimizer is now running')
    } catch (error) {
      logger.error('Failed to start Mining Data Optimizer:', error)
      throw error
    }
  }

  async testApiConnections () {
    logger.info('Testing API connections...')

    // Test Inara API
    try {
      const inaraResult = await this.inaraClient.testConnection()
      logger.info(`Inara API: ${inaraResult ? 'Connected' : 'Failed'}`)
    } catch (error) {
      logger.warn('Inara API test failed:', error.message)
    }

    // Test EDSM API
    try {
      const edsmResult = await this.edsmClient.testConnection()
      logger.info(`EDSM API: ${edsmResult ? 'Connected' : 'Failed'}`)
    } catch (error) {
      logger.warn('EDSM API test failed:', error.message)
    }
  }

  setupEDDNHandlers () {
    // Handle mining-specific messages from EDDN
    this.eddnClient.on('miningData', async (data) => {
      this.statistics.eddnMessages++

      try {
        await this.processMiningData(data)
      } catch (error) {
        logger.error('Error processing mining data:', error)
      }
    })

    // Handle general data for analysis
    this.eddnClient.on('data', async (data) => {
      try {
        await this.analyzeGeneralData(data)
      } catch (error) {
        logger.error('Error analyzing general data:', error)
      }
    })
  }

  async processMiningData (data) {
    const schema = data.$schemaRef
    const message = data.message
    const metadata = data._metadata

    // Enhanced processing based on schema type
    if (schema.includes('commodity')) {
      await this.processCommodityData(message, metadata)
    } else if (schema.includes('journal')) {
      await this.processJournalEvent(message, metadata)
    } else if (schema.includes('outfitting')) {
      await this.processOutfittingData(message, metadata)
    } else if (schema.includes('shipyard')) {
      await this.processShipyardData(message, metadata)
    }
  }

  async processCommodityData (message, metadata) {
    if (!message.commodities || !Array.isArray(message.commodities)) {
      return
    }

    // Filter for mining commodities and high-value opportunities
    const miningCommodities = message.commodities.filter(commodity => {
      const name = commodity.name?.toLowerCase() || ''
      return this.isMiningCommodity(name) && commodity.sellPrice > 1000
    })

    if (miningCommodities.length > 0) {
      const miningOpportunity = {
        type: 'commodity_market',
        systemName: message.systemName,
        stationName: message.stationName,
        marketId: message.marketId,
        timestamp: message.timestamp,
        commodities: miningCommodities,
        source: 'EDDN',
        metadata
      }

      await this.mongoService.saveMiningOpportunity(miningOpportunity)
      this.statistics.miningOpportunities++

      // Cross-reference with EDSM for system details
      await this.enhanceWithEDSMData(message.systemName)
    }
  }

  async processJournalEvent (message, metadata) {
    const eventType = message.event

    switch (eventType) {
      case 'MiningRefined':
        await this.processMiningRefinedEvent(message, metadata)
        break
      case 'AsteroidCracked':
        await this.processAsteroidCrackedEvent(message, metadata)
        break
      case 'ProspectedAsteroid':
        await this.processProspectedAsteroidEvent(message, metadata)
        break
      case 'MarketSell':
        if (this.isMiningCommodity(message.Type)) {
          await this.processMiningMarketSell(message, metadata)
        }
        break
      case 'FSSSignalDiscovered':
        await this.processSignalDiscovered(message, metadata)
        break
    }
  }

  async processMiningRefinedEvent (message, metadata) {
    const miningEvent = {
      type: 'mining_refined',
      systemName: message.StarSystem,
      timestamp: message.timestamp,
      commodity: message.Type,
      source: 'EDDN_Journal',
      metadata
    }

    await this.mongoService.saveMiningEvent(miningEvent)

    // Fetch current market prices for this commodity
    await this.fetchCommodityPrices(message.Type, message.StarSystem)
  }

  async processAsteroidCrackedEvent (message, metadata) {
    const miningEvent = {
      type: 'asteroid_cracked',
      systemName: message.StarSystem,
      bodyName: message.Body,
      timestamp: message.timestamp,
      source: 'EDDN_Journal',
      metadata
    }

    await this.mongoService.saveMiningEvent(miningEvent)
  }

  async enhanceWithEDSMData (systemName) {
    try {
      this.statistics.edsmRequests++

      // Get system information and bodies
      const [systemInfo, systemBodies] = await Promise.all([
        this.edsmClient.getSystemInfo(systemName),
        this.edsmClient.getSystemBodies(systemName)
      ])

      if (systemInfo) {
        await this.mongoService.updateSystemInfo(systemName, {
          coordinates: systemInfo.coords,
          information: systemInfo.information,
          primaryStar: systemInfo.primaryStar,
          updatedAt: new Date()
        })
      }

      if (systemBodies && systemBodies.bodies) {
        // Filter for mining-relevant bodies
        const miningBodies = systemBodies.bodies.filter(body =>
          body.type === 'Belt' ||
          (body.rings && body.rings.length > 0) ||
          (body.materials && body.materials.length > 0)
        )

        if (miningBodies.length > 0) {
          await this.mongoService.updateSystemBodies(systemName, miningBodies)
          this.statistics.systemsAnalyzed++
        }
      }
    } catch (error) {
      logger.error(`Failed to enhance system data for ${systemName}:`, error.message)
    }
  }

  async fetchCommodityPrices (commodityName, systemName) {
    try {
      this.statistics.inaraRequests++

      const marketData = await this.inaraClient.getCommodityPrices(systemName)

      if (marketData && marketData.commodities) {
        const commodity = marketData.commodities.find(c =>
          c.commodityName?.toLowerCase() === commodityName.toLowerCase()
        )

        if (commodity) {
          await this.mongoService.updateCommodityPrice({
            name: commodityName,
            systemName,
            stationName: marketData.marketName,
            buyPrice: commodity.buyPrice,
            sellPrice: commodity.sellPrice,
            demand: commodity.demand,
            supply: commodity.supply,
            timestamp: new Date()
          })
        }
      }
    } catch (error) {
      logger.error(`Failed to fetch commodity prices for ${commodityName}:`, error.message)
    }
  }

  startOptimizationRoutines () {
    // Update mining hotspots every 15 minutes
    setInterval(async () => {
      await this.updateMiningHotspots()
    }, 15 * 60 * 1000)

    // Analyze price trends every 30 minutes
    setInterval(async () => {
      await this.analyzePriceTrends()
    }, 30 * 60 * 1000)

    // Clean old data every hour
    setInterval(async () => {
      await this.cleanOldData()
    }, 60 * 60 * 1000)

    // Generate mining recommendations every 2 hours
    setInterval(async () => {
      await this.generateMiningRecommendations()
    }, 2 * 60 * 60 * 1000)
  }

  async updateMiningHotspots () {
    logger.info('Updating mining hotspots...')

    try {
      // Get recent mining activity data
      const recentActivity = await this.mongoService.getRecentMiningActivity(24) // Last 24 hours

      // Group by system and analyze activity patterns
      const systemActivity = {}
      recentActivity.forEach(activity => {
        if (!systemActivity[activity.systemName]) {
          systemActivity[activity.systemName] = {
            events: 0,
            commodities: new Set(),
            lastSeen: activity.timestamp
          }
        }
        systemActivity[activity.systemName].events++
        if (activity.commodity) {
          systemActivity[activity.systemName].commodities.add(activity.commodity)
        }
        if (activity.timestamp > systemActivity[activity.systemName].lastSeen) {
          systemActivity[activity.systemName].lastSeen = activity.timestamp
        }
      })

      // Update hotspots in database
      for (const [systemName, data] of Object.entries(systemActivity)) {
        if (data.events >= 5) { // Minimum activity threshold
          await this.mongoService.updateMiningHotspot({
            systemName,
            activityLevel: data.events,
            commodityTypes: Array.from(data.commodities),
            lastActivity: data.lastSeen,
            hotspotScore: this.calculateHotspotScore(data),
            updatedAt: new Date()
          })
        }
      }
    } catch (error) {
      logger.error('Failed to update mining hotspots:', error)
    }
  }

  calculateHotspotScore (activityData) {
    let score = 0

    // Base activity score
    score += Math.min(activityData.events * 10, 100)

    // Commodity diversity bonus
    score += activityData.commodities.size * 5

    // Recent activity bonus
    const hoursAgo = (Date.now() - new Date(activityData.lastSeen).getTime()) / (1000 * 60 * 60)
    if (hoursAgo < 2) score += 20
    else if (hoursAgo < 6) score += 10
    else if (hoursAgo < 12) score += 5

    return Math.min(score, 200) // Cap at 200
  }

  async analyzePriceTrends () {
    logger.info('Analyzing commodity price trends...')

    try {
      const trends = await this.mongoService.analyzePriceTrends(7) // Last 7 days

      for (const trend of trends) {
        if (trend.priceChange > 0.15) { // 15% price increase
          await this.mongoService.savePriceAlert({
            commodityName: trend.commodity,
            trendType: 'price_surge',
            priceChange: trend.priceChange,
            averagePrice: trend.averagePrice,
            systemsAffected: trend.systems,
            timestamp: new Date()
          })
        }
      }
    } catch (error) {
      logger.error('Failed to analyze price trends:', error)
    }
  }

  async cleanOldData () {
    logger.info('Cleaning old data...')

    try {
      const cutoffDate = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)) // 7 days ago

      await this.mongoService.cleanOldData({
        miningEvents: cutoffDate,
        commodityPrices: cutoffDate,
        miningOpportunities: cutoffDate
      })
    } catch (error) {
      logger.error('Failed to clean old data:', error)
    }
  }

  async generateMiningRecommendations () {
    logger.info('Generating mining recommendations...')

    try {
      // Get top mining systems by activity and profitability
      const recommendations = await this.mongoService.generateMiningRecommendations()

      // Save recommendations for API endpoints
      await this.mongoService.saveRecommendations(recommendations)

      logger.info(`Generated ${recommendations.length} mining recommendations`)
    } catch (error) {
      logger.error('Failed to generate mining recommendations:', error)
    }
  }

  isMiningCommodity (commodityName) {
    const name = commodityName.toLowerCase()
    const miningCommodities = [
      'painite', 'voidopals', 'lowtemperaturediamond', 'alexandrite',
      'benitoite', 'grandidierite', 'monazite', 'musgravite',
      'rhodplumsite', 'serendibite', 'taaffeite', 'platinum',
      'osmium', 'gold', 'silver', 'palladium', 'tritium'
    ]

    return miningCommodities.some(commodity =>
      name.includes(commodity) || commodity.includes(name)
    )
  }

  getStatistics () {
    const uptime = this.statistics.startTime
      ? Date.now() - this.statistics.startTime.getTime()
      : 0

    return {
      ...this.statistics,
      uptime: Math.floor(uptime / 1000),
      messagesPerMinute: (this.statistics.eddnMessages / (uptime / 60000)).toFixed(2),
      eddnStats: this.eddnClient.getStatistics(),
      inaraStats: this.inaraClient.getStatistics(),
      edsmStats: this.edsmClient.getStatistics()
    }
  }

  async stop () {
    logger.info('Stopping Mining Data Optimizer...')

    this.isRunning = false

    if (this.eddnClient) {
      this.eddnClient.disconnect()
    }

    if (this.mongoService) {
      await this.mongoService.disconnect()
    }

    logger.info('Mining Data Optimizer stopped')
  }
}

module.exports = MiningDataOptimizer
