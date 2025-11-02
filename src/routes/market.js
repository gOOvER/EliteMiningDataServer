const express = require('express')
const router = express.Router()
const logger = require('../services/logger')

/**
 * Calculate distance between two 3D coordinates using Euclidean distance
 * @param {Object} coord1 - First coordinate with x, y, z properties
 * @param {Object} coord2 - Second coordinate with x, y, z properties
 * @returns {number} Distance in light years
 */
const calculateDistance = (coord1, coord2) => {
  if (!coord1 || !coord2 ||
      typeof coord1.x !== 'number' || typeof coord1.y !== 'number' || typeof coord1.z !== 'number' ||
      typeof coord2.x !== 'number' || typeof coord2.y !== 'number' || typeof coord2.z !== 'number') {
    return 0
  }

  const dx = coord1.x - coord2.x
  const dy = coord1.y - coord2.y
  const dz = coord1.z - coord2.z

  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

// Middleware to ensure all services are available
const ensureServices = (req, res, next) => {
  const requiredServices = ['marketDataService', 'cacheManager']
  // const optionalServices = ['inaraApiService', 'edsmApiService', 'rateLimitService', 'errorHandlingService']

  // Check required services
  for (const service of requiredServices) {
    if (!req.app.locals[service]) {
      return res.status(503).json({
        error: `${service} unavailable`,
        message: 'Required service not initialized'
      })
    }
  }

  // Attach services to request for easy access
  req.services = {
    marketData: req.app.locals.marketDataService,
    cache: req.app.locals.cacheManager,
    inara: req.app.locals.inaraApiService || null,
    edsm: req.app.locals.edsmApiService || null,
    rateLimit: req.app.locals.rateLimitService || null,
    errorHandler: req.app.locals.errorHandlingService || null
  }

  next()
}

/**
 * Enhanced Market Routes - Comprehensive market data endpoints
 * Integrates MongoDB data, External APIs (Inara/EDSM), Caching, and Analytics
 */

// Get market data for specific commodity - COMPREHENSIVE IMPLEMENTATION
router.get('/commodity/:commodityId', ensureServices, async (req, res) => {
  const startTime = Date.now()

  try {
    const { commodityId } = req.params
    const {
      systemName,
      stationName,
      maxAge = 24,
      includeHistory = false,
      includeTrends = false,
      includeInaraData = false,
      maxDistance = 50,
      sortBy = 'profit',
      limit = 50,
      format = 'json'
    } = req.query

    logger.info('Comprehensive commodity data requested', {
      commodityId,
      systemName,
      stationName,
      maxAge: parseInt(maxAge),
      includeHistory: includeHistory === 'true',
      includeTrends: includeTrends === 'true',
      includeInaraData: includeInaraData === 'true'
    })

    // Generate comprehensive cache key
    const cacheKey = `commodity:${commodityId}:${systemName || 'all'}:${stationName || 'all'}:${maxAge}:${includeHistory}:${includeTrends}:${includeInaraData}`

    // Try cache first
    let cachedData = null
    if (req.services.cache) {
      try {
        cachedData = await req.services.cache.get(cacheKey)
        if (cachedData) {
          logger.debug('Cache hit for commodity data', { commodityId, cacheKey })
          return res.json({
            success: true,
            data: cachedData,
            metadata: {
              source: 'cache',
              processingTime: Date.now() - startTime,
              timestamp: new Date().toISOString()
            }
          })
        }
      } catch (cacheError) {
        logger.warn('Cache retrieval failed, continuing with database query', {
          error: cacheError.message
        })
      }
    }

    // Step 1: Query MongoDB for recent commodity data from EDDN stream
    const options = {
      systemName,
      stationName,
      maxAge: parseInt(maxAge)
    }

    const eddnMarketData = await req.services.marketData.getCommodityData(commodityId, options)

    // Step 2: Initialize result structure
    const result = {
      commodity: {
        id: commodityId,
        name: commodityId,
        category: await getCommodityCategory(commodityId, req.services),
        rarity: await getCommodityRarity(commodityId, req.services)
      },
      filter: {
        systemName,
        stationName,
        maxAge: parseInt(maxAge),
        maxDistance: parseInt(maxDistance)
      },
      sources: {
        eddn: {
          enabled: true,
          locations: eddnMarketData.locations || [],
          statistics: eddnMarketData.statistics || {},
          lastUpdated: eddnMarketData.lastUpdated || null
        },
        inara: {
          enabled: includeInaraData === 'true',
          data: null,
          lastUpdated: null
        }
      },
      analytics: {
        priceAnalysis: null,
        profitOpportunities: [],
        marketVolatility: null,
        regionalComparison: null
      },
      metadata: {
        totalLocations: eddnMarketData.totalLocations || 0,
        dataFreshness: calculateDataFreshness(eddnMarketData.locations || []),
        processingTime: null,
        cacheStatus: 'miss',
        timestamp: new Date().toISOString()
      }
    }

    // Step 3: Integrate with Inara API for additional market data
    if (includeInaraData === 'true' && req.services.inara) {
      try {
        logger.debug('Fetching Inara market data', { commodityId })

        const inaraOptions = {
          maxDistance: parseInt(maxDistance),
          maxAge: parseInt(maxAge)
        }

        // Use error handling service if available
        let inaraData
        if (req.services.errorHandler) {
          inaraData = await req.services.errorHandler.executeWithErrorHandling(
            'inara',
            () => req.services.inara.getCommodityPrices(commodityId, inaraOptions)
          )
        } else {
          inaraData = await req.services.inara.getCommodityPrices(commodityId, inaraOptions)
        }

        result.sources.inara = {
          enabled: true,
          data: inaraData.prices || [],
          lastUpdated: inaraData.lastUpdated,
          count: inaraData.prices ? inaraData.prices.length : 0
        }

        logger.debug('Inara data integrated successfully', {
          commodityId,
          inaraLocations: result.sources.inara.count
        })
      } catch (inaraError) {
        logger.warn('Failed to fetch Inara market data', {
          commodityId,
          error: inaraError.message
        })

        result.sources.inara = {
          enabled: true,
          data: null,
          error: inaraError.message,
          lastUpdated: null
        }
      }
    }

    // Step 4: Add price history and trend analysis
    if (includeHistory === 'true' || includeTrends === 'true') {
      try {
        const historyData = await req.services.marketData.getCommodityPriceHistory(
          commodityId,
          {
            systemName,
            days: 30,
            intervals: includeTrends === 'true' ? ['daily', 'weekly'] : ['daily']
          }
        )

        result.analytics.priceHistory = historyData.history || []

        if (includeTrends === 'true') {
          result.analytics.trends = {
            daily: historyData.trends?.daily || null,
            weekly: historyData.trends?.weekly || null,
            prediction: historyData.prediction || null
          }
        }
      } catch (historyError) {
        logger.warn('Failed to fetch price history', {
          commodityId,
          error: historyError.message
        })
      }
    }

    // Step 5: Calculate comprehensive price analysis
    result.analytics.priceAnalysis = calculatePriceAnalysis(
      result.sources.eddn.locations,
      result.sources.inara.data
    )

    // Step 6: Identify profit opportunities
    result.analytics.profitOpportunities = calculateProfitOpportunities(
      result.sources.eddn.locations,
      {
        sortBy,
        limit: parseInt(limit),
        minProfit: 100 // Minimum profit per unit
      }
    )

    // Step 7: Calculate market volatility indicators
    result.analytics.marketVolatility = calculateMarketVolatility(
      result.sources.eddn.locations,
      result.analytics.priceHistory
    )

    // Step 8: Add regional price comparison
    if (systemName) {
      result.analytics.regionalComparison = await calculateRegionalComparison(
        commodityId,
        systemName,
        req.services,
        parseInt(maxDistance)
      )
    }

    // Step 9: Add data freshness indicators and source attribution
    result.metadata.dataFreshness = calculateDataFreshness([
      ...result.sources.eddn.locations,
      ...(result.sources.inara.data || [])
    ])

    result.metadata.sourceAttribution = {
      eddn: {
        provider: 'Elite Dangerous Data Network',
        reliability: 'High',
        updateFrequency: 'Real-time',
        coverage: 'Global'
      },
      inara: result.sources.inara.enabled
        ? {
            provider: 'Inara Elite Dangerous Community',
            reliability: 'High',
            updateFrequency: 'Community-driven',
            coverage: 'Selective'
          }
        : null
    }

    // Step 10: Cache results for performance
    result.metadata.processingTime = Date.now() - startTime

    if (req.services.cache) {
      try {
        const cacheTimeout = result.metadata.dataFreshness.averageAge < 3600000 ? 300 : 600 // 5-10 minutes
        await req.services.cache.set(cacheKey, result, cacheTimeout)
        result.metadata.cacheStatus = 'stored'
        logger.debug('Commodity data cached successfully', { commodityId, cacheTimeout })
      } catch (cacheError) {
        logger.warn('Failed to cache commodity data', {
          commodityId,
          error: cacheError.message
        })
      }
    }

    // Step 11: Handle different output formats
    if (format === 'csv') {
      return sendCSVResponse(res, result, commodityId)
    }

    if (format === 'trading-tool') {
      return sendTradingToolResponse(res, result, commodityId)
    }

    // Default JSON response
    res.json({
      success: true,
      data: result,
      metadata: result.metadata
    })
  } catch (error) {
    logger.error('Error fetching commodity data', {
      commodityId: req.params.commodityId,
      error: error.message,
      stack: error.stack
    })

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to fetch commodity data',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
})

/**
 * Trading Routes Calculation Endpoint
 * GET /api/market/routes
 *
 * Calculate optimal trading routes based on:
 * - Start system coordinates
 * - Jump range and cargo capacity
 * - Market data analysis
 * - Profit optimization
 * - Risk factors
 */
router.get('/routes', async (req, res) => {
  try {
    const {
      // Required parameters
      startSystem,
      jumpRange = 20,
      cargoCapacity = 100,

      // Optional ship parameters
      shipSize = 'medium', // small, medium, large
      credits = 1000000, // Available credits for trading

      // Route parameters
      maxHops = 3,
      minProfitPerTon = 500,
      maxRouteTime = 60, // minutes

      // Filters
      securityLevel = 'any', // high, medium, low, any
      stationType = 'any', // planetary, orbital, any
      excludeSystems,
      onlyHighTech = false,

      // Output options
      includeRisk = true,
      includeVisualization = true,
      sortBy = 'totalProfit', // totalProfit, profitPerTon, profitPerHour
      limit = 50
    } = req.query

    // Validate required parameters
    if (!startSystem) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter',
        message: 'startSystem is required'
      })
    }

    // Step 1: Get start system coordinates using EDSM API
    let startSystemData = null
    try {
      if (req.services.edsm) {
        startSystemData = await req.services.edsm.getSystemInfo(startSystem)
        if (!startSystemData || !startSystemData.coords) {
          return res.status(404).json({
            success: false,
            error: 'System not found',
            message: `System '${startSystem}' not found in EDSM database`
          })
        }
      } else {
        // Fallback: try to get coordinates from local database
        startSystemData = await req.services.marketData.getSystemCoordinates(startSystem)
        if (!startSystemData) {
          return res.status(503).json({
            success: false,
            error: 'Service unavailable',
            message: 'EDSM service not available and system not in local database'
          })
        }
      }
    } catch (coordError) {
      logger.warn('Failed to get system coordinates', {
        startSystem,
        error: coordError.message
      })
      return res.status(404).json({
        success: false,
        error: 'System lookup failed',
        message: 'Could not retrieve system coordinates'
      })
    }

    logger.info('Starting trading route calculation', {
      startSystem,
      jumpRange,
      cargoCapacity,
      maxHops,
      coordinates: startSystemData.coords
    })

    // Step 2: Query nearby systems within jump range (sphere calculation)
    const nearbySystemsData = await getNearbyTradingSystems(
      startSystemData.coords,
      parseFloat(jumpRange),
      req.services,
      {
        excludeSystems: excludeSystems ? excludeSystems.split(',') : [],
        securityLevel,
        onlyHighTech: onlyHighTech === 'true'
      }
    )

    logger.info('Found nearby systems for trading', {
      systemCount: nearbySystemsData.length,
      maxDistance: jumpRange
    })

    // Step 3: Fetch market data for all stations in range
    const marketDataResults = await getMarketDataForSystems(
      nearbySystemsData,
      req.services,
      {
        shipSize,
        stationType,
        maxAge: 24 // hours
      }
    )

    logger.info('Retrieved market data', {
      stationCount: marketDataResults.totalStations,
      commodityCount: marketDataResults.totalCommodities
    })

    // Step 4: Calculate profit margins for all commodity combinations
    const profitAnalysis = await calculateTradingProfits(
      marketDataResults.marketData,
      {
        cargoCapacity: parseInt(cargoCapacity),
        credits: parseInt(credits),
        minProfitPerTon: parseFloat(minProfitPerTon)
      }
    )

    // Step 5: Generate trading routes with multi-hop optimization
    const tradingRoutes = await generateOptimalRoutes(
      startSystemData,
      profitAnalysis,
      nearbySystemsData,
      {
        maxHops: parseInt(maxHops),
        jumpRange: parseFloat(jumpRange),
        cargoCapacity: parseInt(cargoCapacity),
        maxRouteTime: parseInt(maxRouteTime),
        sortBy,
        limit: parseInt(limit)
      }
    )

    // Step 6: Add risk factors and security analysis
    if (includeRisk === 'true') {
      await addRiskAnalysis(tradingRoutes, req.services)
    }

    // Step 7: Add route visualization data
    let visualizationData = null
    if (includeVisualization === 'true') {
      visualizationData = generateRouteVisualization(tradingRoutes, startSystemData)
    }

    // Step 8: Calculate route statistics and metadata
    const routeStatistics = calculateRouteStatistics(tradingRoutes, {
      totalSystemsAnalyzed: nearbySystemsData.length,
      totalStationsAnalyzed: marketDataResults.totalStations,
      searchRadius: parseFloat(jumpRange),
      calculationTime: Date.now() - req.startTime || 0
    })

    // Cache results for performance
    const cacheKey = `trading_routes:${startSystem}:${jumpRange}:${cargoCapacity}:${maxHops}`
    if (req.services.cache) {
      await req.services.cache.set(cacheKey, {
        routes: tradingRoutes,
        statistics: routeStatistics,
        visualization: visualizationData
      }, 1800) // Cache for 30 minutes
    }

    // Prepare response
    const response = {
      success: true,
      request: {
        startSystem,
        coordinates: startSystemData.coords,
        jumpRange: parseFloat(jumpRange),
        cargoCapacity: parseInt(cargoCapacity),
        maxHops: parseInt(maxHops),
        parameters: {
          shipSize,
          credits: parseInt(credits),
          minProfitPerTon: parseFloat(minProfitPerTon),
          securityLevel,
          stationType
        }
      },
      routes: tradingRoutes,
      statistics: routeStatistics,
      visualization: includeVisualization === 'true' ? visualizationData : undefined,
      metadata: {
        generatedAt: new Date().toISOString(),
        dataFreshness: marketDataResults.dataFreshness,
        servicesUsed: {
          edsm: !!req.services.edsm,
          inara: !!req.services.inara,
          cache: !!req.services.cache
        }
      }
    }

    res.json(response)
  } catch (error) {
    logger.error('Error calculating trading routes', {
      startSystem: req.query.startSystem,
      error: error.message,
      stack: error.stack
    })

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to calculate trading routes',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      metadata: {
        processingTime: Date.now() - (req.startTime || Date.now()),
        timestamp: new Date().toISOString()
      }
    })
  }
})

/**
 * Helper Functions for Trading Routes Calculation
 */

// Get nearby systems within jump range for trading
async function getNearbyTradingSystems (startCoords, jumpRange, services, options = {}) {
  try {
    const { excludeSystems = [], securityLevel = 'any', onlyHighTech = false } = options

    let nearbySystems = []

    // Try EDSM API first for accurate system data
    if (services.edsm) {
      try {
        const systemsInRange = await services.edsm.getSystemsInRadius(
          startCoords,
          jumpRange,
          { includeCoordinates: true }
        )

        nearbySystems = systemsInRange
          .filter(system => !excludeSystems.includes(system.name))
          .map(system => ({
            name: system.name,
            coords: system.coords,
            distance: calculateDistance(startCoords, system.coords),
            security: system.security || 'Unknown',
            allegiance: system.allegiance || 'Unknown',
            government: system.government || 'Unknown',
            economy: system.economy || 'Unknown'
          }))
      } catch (edsmError) {
        logger.warn('EDSM query failed, falling back to local database', {
          error: edsmError.message
        })
      }
    }

    // Fallback to local database if EDSM unavailable
    if (nearbySystems.length === 0) {
      nearbySystems = await services.marketData.getSystemsInRadius(
        startCoords,
        jumpRange,
        { includeSystemInfo: true }
      )
    }

    // Apply filters
    let filteredSystems = nearbySystems

    if (securityLevel !== 'any') {
      filteredSystems = filteredSystems.filter(system => {
        const security = system.security?.toLowerCase() || 'unknown'
        switch (securityLevel) {
          case 'high':
            return security === 'high'
          case 'medium':
            return security === 'medium'
          case 'low':
            return security === 'low' || security === 'anarchy'
          default:
            return true
        }
      })
    }

    if (onlyHighTech) {
      filteredSystems = filteredSystems.filter(system =>
        system.economy?.toLowerCase().includes('high tech') ||
        system.economy?.toLowerCase().includes('technology')
      )
    }

    return filteredSystems.slice(0, 100) // Limit to 100 systems for performance
  } catch (error) {
    logger.error('Failed to get nearby trading systems', {
      startCoords,
      jumpRange,
      error: error.message
    })
    return []
  }
}

// Get market data for systems with station filtering
async function getMarketDataForSystems (systems, services, options = {}) {
  try {
    const { shipSize = 'medium', stationType = 'any', maxAge = 24 } = options

    const systemNames = systems.map(sys => sys.name)

    // Get all market data for these systems
    const marketData = await services.marketData.getMarketDataBySystems(
      systemNames,
      {
        maxAge,
        includeStationInfo: true,
        includeSupplyDemand: true
      }
    )

    // Filter stations based on ship requirements
    const filteredMarketData = marketData.filter(data => {
      // Filter by landing pad size
      if (shipSize === 'large' && data.maxLandingPadSize === 'Small') return false
      if (shipSize === 'large' && data.maxLandingPadSize === 'Medium') return false

      // Filter by station type
      if (stationType === 'orbital' && data.stationType?.includes('Planetary')) return false
      if (stationType === 'planetary' && !data.stationType?.includes('Planetary')) return false

      return true
    })

    // Calculate data freshness metrics
    const dataFreshness = calculateDataFreshness(filteredMarketData)

    return {
      marketData: filteredMarketData,
      totalStations: filteredMarketData.length,
      totalCommodities: [...new Set(filteredMarketData.flatMap(data =>
        data.commodities ? Object.keys(data.commodities) : []
      ))].length,
      dataFreshness
    }
  } catch (error) {
    logger.error('Failed to get market data for systems', {
      systemCount: systems.length,
      error: error.message
    })
    return {
      marketData: [],
      totalStations: 0,
      totalCommodities: 0,
      dataFreshness: { freshnessScore: 0 }
    }
  }
}

// Calculate trading profits for all commodity combinations
async function calculateTradingProfits (marketData, options = {}) {
  try {
    const { cargoCapacity = 100, credits = 1000000, minProfitPerTon = 500 } = options

    const profitOpportunities = []

    // Group stations by system for easier processing
    const stationsBySystem = marketData.reduce((acc, station) => {
      if (!acc[station.system]) acc[station.system] = []
      acc[station.system].push(station)
      return acc
    }, {})

    // Calculate profits between all station pairs
    for (const buyStation of marketData) {
      if (!buyStation.commodities) continue

      for (const [commodity, buyData] of Object.entries(buyStation.commodities)) {
        const buyPrice = buyData.buyPrice || buyData.price
        const supply = buyData.supply || 0

        if (!buyPrice || buyPrice <= 0 || supply <= 0) continue
        if (buyPrice * cargoCapacity > credits) continue // Can't afford full cargo

        // Find stations that sell this commodity
        for (const sellStation of marketData) {
          if (sellStation.system === buyStation.system &&
              sellStation.station === buyStation.station) continue

          const sellData = sellStation.commodities?.[commodity]
          if (!sellData) continue

          const sellPrice = sellData.sellPrice || sellData.price
          const demand = sellData.demand || 0

          if (!sellPrice || sellPrice <= 0 || demand <= 0) continue

          const profitPerTon = sellPrice - buyPrice
          if (profitPerTon < minProfitPerTon) continue

          const maxCargo = Math.min(cargoCapacity, supply, demand)
          const totalProfit = profitPerTon * maxCargo

          profitOpportunities.push({
            commodity,
            buy: {
              system: buyStation.system,
              station: buyStation.station,
              price: buyPrice,
              supply,
              coords: buyStation.coords || null,
              distanceToArrival: buyStation.distanceToArrival || 0
            },
            sell: {
              system: sellStation.system,
              station: sellStation.station,
              price: sellPrice,
              demand,
              coords: sellStation.coords || null,
              distanceToArrival: sellStation.distanceToArrival || 0
            },
            profit: {
              perTon: profitPerTon,
              percentage: (profitPerTon / buyPrice) * 100,
              maxCargo,
              total: totalProfit
            }
          })
        }
      }
    }

    // Sort by total profit descending
    profitOpportunities.sort((a, b) => b.profit.total - a.profit.total)

    return profitOpportunities
  } catch (error) {
    logger.error('Failed to calculate trading profits', {
      marketDataCount: marketData.length,
      error: error.message
    })
    return []
  }
}

// Generate optimal multi-hop trading routes
async function generateOptimalRoutes (startSystem, profitOpportunities, systemsData, options = {}) {
  try {
    const {
      maxHops = 3,
      jumpRange = 20,
      cargoCapacity = 100,
      maxRouteTime = 60,
      sortBy = 'totalProfit',
      limit = 50
    } = options

    const routes = []
    const systemCoords = systemsData.reduce((acc, sys) => {
      acc[sys.name] = sys.coords
      return acc
    }, {})

    // Add start system coordinates
    systemCoords[startSystem.name] = startSystem.coords

    // Generate single-hop routes
    for (const opportunity of profitOpportunities.slice(0, 200)) { // Limit for performance
      const buySystem = opportunity.buy.system
      const sellSystem = opportunity.sell.system

      const buyCoords = systemCoords[buySystem]
      const sellCoords = systemCoords[sellSystem]

      if (!buyCoords || !sellCoords) continue

      // Check if route is within jump range constraints
      const startToBuy = calculateDistance(startSystem.coords, buyCoords)
      const buyToSell = calculateDistance(buyCoords, sellCoords)

      if (startToBuy > jumpRange || buyToSell > jumpRange) continue

      // Calculate route time estimate (rough approximation)
      const estimatedTime = calculateRouteTime([
        { system: startSystem.name, coords: startSystem.coords },
        { system: buySystem, coords: buyCoords },
        { system: sellSystem, coords: sellCoords }
      ], options)

      if (estimatedTime > maxRouteTime) continue

      routes.push({
        type: 'single-hop',
        hops: 1,
        totalDistance: startToBuy + buyToSell,
        estimatedTime,
        legs: [
          {
            from: startSystem.name,
            to: buySystem,
            action: 'travel',
            distance: startToBuy
          },
          {
            from: buySystem,
            to: sellSystem,
            action: 'trade',
            distance: buyToSell,
            commodity: opportunity.commodity,
            trade: opportunity
          }
        ],
        profit: {
          total: opportunity.profit.total,
          perTon: opportunity.profit.perTon,
          perHour: opportunity.profit.total / (estimatedTime / 60),
          investment: opportunity.buy.price * opportunity.profit.maxCargo
        },
        risk: {
          level: 'Unknown',
          factors: []
        }
      })
    }

    // Generate multi-hop routes (simplified for now)
    if (maxHops > 1) {
      const multiHopRoutes = generateMultiHopRoutes(
        startSystem,
        profitOpportunities,
        systemCoords,
        { ...options, maxHops: Math.min(maxHops, 3) } // Limit complexity
      )
      routes.push(...multiHopRoutes)
    }

    // Sort routes based on criteria
    routes.sort((a, b) => {
      switch (sortBy) {
        case 'totalProfit':
          return b.profit.total - a.profit.total
        case 'profitPerTon':
          return b.profit.perTon - a.profit.perTon
        case 'profitPerHour':
          return b.profit.perHour - a.profit.perHour
        case 'efficiency':
          return (b.profit.total / b.totalDistance) - (a.profit.total / a.totalDistance)
        default:
          return b.profit.total - a.profit.total
      }
    })

    return routes.slice(0, limit)
  } catch (error) {
    logger.error('Failed to generate optimal routes', {
      profitOpportunityCount: profitOpportunities.length,
      error: error.message
    })
    return []
  }
}

// Generate multi-hop trading routes
function generateMultiHopRoutes (startSystem, profitOpportunities, systemCoords, options) {
  const multiHopRoutes = []
  const { maxHops, jumpRange, maxRouteTime } = options

  // Simple two-hop route generation
  if (maxHops >= 2) {
    for (let i = 0; i < Math.min(profitOpportunities.length, 50); i++) {
      const firstTrade = profitOpportunities[i]

      // Find profitable second trades from the sell system of first trade
      for (let j = 0; j < Math.min(profitOpportunities.length, 20); j++) {
        const secondTrade = profitOpportunities[j]

        if (secondTrade.buy.system !== firstTrade.sell.system) continue
        if (secondTrade.commodity === firstTrade.commodity) continue

        // Check jump range constraints
        const leg1 = calculateDistance(startSystem.coords, systemCoords[firstTrade.buy.system])
        const leg2 = calculateDistance(systemCoords[firstTrade.buy.system], systemCoords[firstTrade.sell.system])
        const leg3 = calculateDistance(systemCoords[secondTrade.buy.system], systemCoords[secondTrade.sell.system])

        if (leg1 > jumpRange || leg2 > jumpRange || leg3 > jumpRange) continue

        const totalDistance = leg1 + leg2 + leg3
        const estimatedTime = calculateRouteTime([
          { system: startSystem.name, coords: startSystem.coords },
          { system: firstTrade.buy.system, coords: systemCoords[firstTrade.buy.system] },
          { system: firstTrade.sell.system, coords: systemCoords[firstTrade.sell.system] },
          { system: secondTrade.sell.system, coords: systemCoords[secondTrade.sell.system] }
        ], options)

        if (estimatedTime > maxRouteTime) continue

        const totalProfit = firstTrade.profit.total + secondTrade.profit.total

        multiHopRoutes.push({
          type: 'multi-hop',
          hops: 2,
          totalDistance,
          estimatedTime,
          legs: [
            {
              from: startSystem.name,
              to: firstTrade.buy.system,
              action: 'travel',
              distance: leg1
            },
            {
              from: firstTrade.buy.system,
              to: firstTrade.sell.system,
              action: 'trade',
              distance: leg2,
              commodity: firstTrade.commodity,
              trade: firstTrade
            },
            {
              from: secondTrade.buy.system,
              to: secondTrade.sell.system,
              action: 'trade',
              distance: leg3,
              commodity: secondTrade.commodity,
              trade: secondTrade
            }
          ],
          profit: {
            total: totalProfit,
            perTon: (firstTrade.profit.perTon + secondTrade.profit.perTon) / 2,
            perHour: totalProfit / (estimatedTime / 60),
            investment: firstTrade.buy.price * firstTrade.profit.maxCargo + secondTrade.buy.price * secondTrade.profit.maxCargo
          },
          risk: {
            level: 'Unknown',
            factors: []
          }
        })
      }
    }
  }

  return multiHopRoutes.slice(0, 10) // Limit multi-hop routes
}

// Add risk analysis to trading routes
async function addRiskAnalysis (routes, services) {
  for (const route of routes) {
    const riskFactors = []
    let riskLevel = 'Low'

    for (const leg of route.legs) {
      if (leg.action === 'travel' || leg.action === 'trade') {
        // Analyze system security
        const systemSecurity = await getSystemSecurity(leg.to, services)

        if (systemSecurity === 'Anarchy' || systemSecurity === 'Low') {
          riskFactors.push(`${leg.to}: Low security system`)
          riskLevel = 'High'
        } else if (systemSecurity === 'Medium') {
          riskFactors.push(`${leg.to}: Medium security system`)
          if (riskLevel === 'Low') riskLevel = 'Medium'
        }

        // Check for known piracy activity (placeholder)
        if (leg.distance > 1000) {
          riskFactors.push(`${leg.to}: Station far from arrival point`)
          if (riskLevel === 'Low') riskLevel = 'Medium'
        }
      }
    }

    // Analyze profit/investment ratio for scam risk
    if (route.profit.total / route.profit.investment > 5) {
      riskFactors.push('Very high profit margin - verify data accuracy')
      if (riskLevel !== 'High') riskLevel = 'Medium'
    }

    route.risk = {
      level: riskLevel,
      factors: riskFactors
    }
  }
}

// Generate route visualization data
function generateRouteVisualization (routes, startSystem) {
  return routes.slice(0, 20).map(route => ({
    routeId: `route_${routes.indexOf(route)}`,
    type: route.type,
    waypoints: [
      {
        system: startSystem.name,
        coords: startSystem.coords,
        type: 'start'
      },
      ...route.legs.map(leg => ({
        system: leg.to,
        coords: leg.coords || null,
        type: leg.action,
        commodity: leg.commodity || null
      }))
    ],
    totalDistance: route.totalDistance,
    profit: route.profit.total,
    riskLevel: route.risk.level
  }))
}

// Calculate route statistics
function calculateRouteStatistics (routes, metadata) {
  if (routes.length === 0) {
    return {
      totalRoutes: 0,
      averageProfit: 0,
      averageDistance: 0,
      averageTime: 0,
      riskDistribution: { Low: 0, Medium: 0, High: 0 },
      metadata
    }
  }

  const totalProfit = routes.reduce((sum, route) => sum + route.profit.total, 0)
  const totalDistance = routes.reduce((sum, route) => sum + route.totalDistance, 0)
  const totalTime = routes.reduce((sum, route) => sum + route.estimatedTime, 0)

  const riskDistribution = routes.reduce((acc, route) => {
    acc[route.risk.level] = (acc[route.risk.level] || 0) + 1
    return acc
  }, { Low: 0, Medium: 0, High: 0 })

  return {
    totalRoutes: routes.length,
    averageProfit: Math.round(totalProfit / routes.length),
    averageDistance: Math.round(totalDistance / routes.length * 100) / 100,
    averageTime: Math.round(totalTime / routes.length),
    bestRoute: {
      profit: Math.max(...routes.map(r => r.profit.total)),
      profitPerHour: Math.max(...routes.map(r => r.profit.perHour))
    },
    riskDistribution,
    commodityDistribution: calculateCommodityDistribution(routes),
    metadata
  }
}

// Get system security level
async function getSystemSecurity (systemName, services) {
  try {
    if (services.edsm) {
      const systemInfo = await services.edsm.getSystemInfo(systemName)
      return systemInfo?.security || 'Unknown'
    }

    // Fallback to local database
    const systemInfo = await services.marketData.getSystemInfo(systemName)
    return systemInfo?.security || 'Unknown'
  } catch (error) {
    return 'Unknown'
  }
}

// Calculate commodity distribution in routes
function calculateCommodityDistribution (routes) {
  const commodities = {}

  for (const route of routes) {
    for (const leg of route.legs) {
      if (leg.commodity) {
        commodities[leg.commodity] = (commodities[leg.commodity] || 0) + 1
      }
    }
  }

  return Object.entries(commodities)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([commodity, count]) => ({ commodity, count }))
}

// Calculate estimated route time
function calculateRouteTime (waypoints, options) {
  let totalTime = 0

  // Base travel time (rough estimates)
  const baseJumpTime = 1 // 1 minute per jump
  const baseDockingTime = 3 // 3 minutes for docking/undocking
  const baseTradingTime = 2 // 2 minutes for trading

  for (let i = 1; i < waypoints.length; i++) {
    const distance = calculateDistance(waypoints[i - 1].coords, waypoints[i].coords)
    const jumps = Math.ceil(distance / (options.jumpRange || 20))

    totalTime += jumps * baseJumpTime // Travel time
    totalTime += baseDockingTime // Docking time

    if (i < waypoints.length - 1 || i === waypoints.length - 1) {
      totalTime += baseTradingTime // Trading time
    }
  }

  return Math.round(totalTime)
}

// Get best trading routes (comprehensive endpoint)
router.get('/routes', async (req, res) => {
  try {
    const {
      // Required parameters
      startSystem,
      jumpRange = 20,
      cargoCapacity = 100,

      // Optional ship parameters
      shipSize = 'medium', // small, medium, large
      credits = 1000000, // Available credits for trading

      // Route parameters
      maxHops = 3,
      minProfitPerTon = 500,
      maxRouteTime = 60, // minutes

      // Filters
      securityLevel = 'any', // high, medium, low, any
      stationType = 'any', // planetary, orbital, any
      excludeSystems,
      onlyHighTech = false,

      // Output options
      includeRisk = true,
      includeVisualization = true,
      sortBy = 'totalProfit', // totalProfit, profitPerTon, profitPerHour
      limit = 50
    } = req.query

    // Validate required parameters
    if (!startSystem) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter',
        message: 'startSystem is required'
      })
    }

    // Step 1: Get start system coordinates using EDSM API
    let startSystemData = null
    try {
      if (req.services.edsm) {
        startSystemData = await req.services.edsm.getSystemInfo(startSystem)
        if (!startSystemData || !startSystemData.coords) {
          return res.status(404).json({
            success: false,
            error: 'System not found',
            message: `System '${startSystem}' not found in EDSM database`
          })
        }
      } else {
        // Fallback: try to get coordinates from local database
        startSystemData = await req.services.marketData.getSystemCoordinates(startSystem)
        if (!startSystemData) {
          return res.status(503).json({
            success: false,
            error: 'Service unavailable',
            message: 'EDSM service not available and system not in local database'
          })
        }
      }
    } catch (coordError) {
      logger.warn('Failed to get system coordinates', {
        startSystem,
        error: coordError.message
      })
      return res.status(404).json({
        success: false,
        error: 'System lookup failed',
        message: 'Could not retrieve system coordinates'
      })
    }

    logger.info('Starting trading route calculation', {
      startSystem,
      jumpRange,
      cargoCapacity,
      maxHops,
      coordinates: startSystemData.coords
    })

    // Step 2: Query nearby systems within jump range (sphere calculation)
    const nearbySystemsData = await getNearbyTradingSystems(
      startSystemData.coords,
      parseFloat(jumpRange),
      req.services,
      {
        excludeSystems: excludeSystems ? excludeSystems.split(',') : [],
        securityLevel,
        onlyHighTech: onlyHighTech === 'true'
      }
    )

    logger.info('Found nearby systems for trading', {
      systemCount: nearbySystemsData.length,
      maxDistance: jumpRange
    })

    // Step 3: Fetch market data for all stations in range
    const marketDataResults = await getMarketDataForSystems(
      nearbySystemsData,
      req.services,
      {
        shipSize,
        stationType,
        maxAge: 24 // hours
      }
    )

    logger.info('Retrieved market data', {
      stationCount: marketDataResults.totalStations,
      commodityCount: marketDataResults.totalCommodities
    })

    // Step 4: Calculate profit margins for all commodity combinations
    const profitAnalysis = await calculateTradingProfits(
      marketDataResults.marketData,
      {
        cargoCapacity: parseInt(cargoCapacity),
        credits: parseInt(credits),
        minProfitPerTon: parseFloat(minProfitPerTon)
      }
    )

    // Step 5: Generate trading routes with multi-hop optimization
    const tradingRoutes = await generateOptimalRoutes(
      startSystemData,
      profitAnalysis,
      nearbySystemsData,
      {
        maxHops: parseInt(maxHops),
        jumpRange: parseFloat(jumpRange),
        cargoCapacity: parseInt(cargoCapacity),
        maxRouteTime: parseInt(maxRouteTime),
        sortBy,
        limit: parseInt(limit)
      }
    )

    // Step 6: Add risk factors and security analysis
    if (includeRisk === 'true') {
      await addRiskAnalysis(tradingRoutes, req.services)
    }

    // Step 7: Add route visualization data
    let visualizationData = null
    if (includeVisualization === 'true') {
      visualizationData = generateRouteVisualization(tradingRoutes, startSystemData)
    }

    // Step 8: Calculate route statistics and metadata
    const routeStatistics = calculateRouteStatistics(tradingRoutes, {
      totalSystemsAnalyzed: nearbySystemsData.length,
      totalStationsAnalyzed: marketDataResults.totalStations,
      searchRadius: parseFloat(jumpRange),
      calculationTime: Date.now() - req.startTime || 0
    })

    // Cache results for performance
    const cacheKey = `trading_routes:${startSystem}:${jumpRange}:${cargoCapacity}:${maxHops}`
    if (req.services.cache) {
      await req.services.cache.set(cacheKey, {
        routes: tradingRoutes,
        statistics: routeStatistics,
        visualization: visualizationData
      }, 1800) // Cache for 30 minutes
    }

    // Prepare response
    const response = {
      success: true,
      request: {
        startSystem,
        coordinates: startSystemData.coords,
        jumpRange: parseFloat(jumpRange),
        cargoCapacity: parseInt(cargoCapacity),
        maxHops: parseInt(maxHops),
        parameters: {
          shipSize,
          credits: parseInt(credits),
          minProfitPerTon: parseFloat(minProfitPerTon),
          securityLevel,
          stationType
        }
      },
      routes: tradingRoutes,
      statistics: routeStatistics,
      visualization: includeVisualization === 'true' ? visualizationData : undefined,
      metadata: {
        generatedAt: new Date().toISOString(),
        dataFreshness: marketDataResults.dataFreshness,
        servicesUsed: {
          edsm: !!req.services.edsm,
          inara: !!req.services.inara,
          cache: !!req.services.cache
        }
      }
    }

    res.json(response)
  } catch (error) {
    logger.error('Error calculating trading routes', {
      startSystem: req.query.startSystem,
      error: error.message,
      stack: error.stack
    })

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to calculate trading routes',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
})

/**
 * Market Trends Analysis Endpoint
 * GET /api/market/trends
 *
 * Analyze historical market data and generate trend predictions:
 * - Historical price analysis with moving averages
 * - Seasonal patterns and market cycles
 * - Price volatility and stability indicators
 * - Regional price comparisons
 * - Time series predictions
 * - Supply/demand trend analysis
 * - Commodity correlation analysis
 */
router.get('/trends', async (req, res) => {
  try {
    const {
      // Data selection
      commodity,
      commodityId,
      system,
      region,

      // Time parameters
      timeRange = '30d', // 1d, 7d, 30d, 90d, 1y
      interval = 'daily', // hourly, daily, weekly, monthly
      startDate,
      endDate,

      // Analysis options
      includeMovingAverages = true,
      includeSeasonalAnalysis = true,
      includeVolatilityAnalysis = true,
      includeRegionalComparison = true,
      includePredictions = true,
      includeCorrelationAnalysis = true,
      includeSupplyDemandTrends = true,

      // Visualization options
      includeVisualization = true,
      chartType = 'line', // line, candlestick, area

      // Output options
      format = 'json', // json, csv
      limit = 1000
    } = req.query

    // Validate parameters
    const validTimeRanges = ['1d', '7d', '30d', '90d', '1y']
    const validIntervals = ['hourly', 'daily', 'weekly', 'monthly']

    if (!validTimeRanges.includes(timeRange)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid time range',
        message: `timeRange must be one of: ${validTimeRanges.join(', ')}`
      })
    }

    if (!validIntervals.includes(interval)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid interval',
        message: `interval must be one of: ${validIntervals.join(', ')}`
      })
    }

    logger.info('Market trends analysis requested', {
      commodity: commodity || commodityId,
      system,
      timeRange,
      interval,
      analysisOptions: {
        movingAverages: includeMovingAverages === 'true',
        seasonal: includeSeasonalAnalysis === 'true',
        volatility: includeVolatilityAnalysis === 'true',
        regional: includeRegionalComparison === 'true',
        predictions: includePredictions === 'true'
      }
    })

    // Step 1: Parse time range and calculate date boundaries
    const timeParams = parseTimeRange(timeRange, startDate, endDate)

    // Step 2: Query historical market data from MongoDB collections
    const historicalData = await queryHistoricalMarketData(
      {
        commodity: commodity || commodityId,
        system,
        region,
        startDate: timeParams.startDate,
        endDate: timeParams.endDate,
        interval,
        limit: parseInt(limit)
      },
      req.services
    )

    if (!historicalData || historicalData.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No historical data found',
        message: 'No market data available for the specified parameters'
      })
    }

    // Step 3: Aggregate price data by time intervals
    const aggregatedData = aggregatePriceDataByInterval(historicalData, interval)

    // Step 4: Calculate price trends using moving averages
    let movingAverages = null
    if (includeMovingAverages === 'true') {
      movingAverages = calculateMovingAverages(aggregatedData, {
        periods: [7, 14, 30, 50], // Different MA periods
        includeEMA: true, // Exponential moving averages
        includeSignals: true // Buy/sell signals
      })
    }

    // Step 5: Identify seasonal patterns and market cycles
    let seasonalAnalysis = null
    if (includeSeasonalAnalysis === 'true') {
      seasonalAnalysis = await identifySeasonalPatterns(aggregatedData, {
        cycleLength: determineCycleLength(interval),
        includeWeekly: interval === 'daily' || interval === 'hourly',
        includeMonthly: true,
        includeYearly: timeRange === '1y'
      })
    }

    // Step 6: Detect price volatility and market stability indicators
    let volatilityAnalysis = null
    if (includeVolatilityAnalysis === 'true') {
      volatilityAnalysis = calculateVolatilityIndicators(aggregatedData, {
        includeATR: true, // Average True Range
        includeBollingerBands: true,
        includeRSI: true, // Relative Strength Index
        includeStochastics: true
      })
    }

    // Step 7: Compare regional price differences across systems
    let regionalComparison = null
    if (includeRegionalComparison === 'true' && !system) {
      regionalComparison = await compareRegionalPrices(
        commodity || commodityId,
        timeParams,
        req.services,
        { interval, limit: 20 }
      )
    }

    // Step 8: Generate trend predictions using time series analysis
    let predictions = null
    if (includePredictions === 'true') {
      predictions = await generateTrendPredictions(aggregatedData, {
        forecastPeriods: determineForecastPeriods(interval),
        confidenceIntervals: [80, 95],
        includeSeasonality: seasonalAnalysis !== null,
        method: 'exponential_smoothing' // or 'arima', 'linear_regression'
      })
    }

    // Step 9: Include supply/demand trend analysis
    let supplyDemandTrends = null
    if (includeSupplyDemandTrends === 'true') {
      supplyDemandTrends = analyzeSupplyDemandTrends(historicalData, {
        includeStockLevels: true,
        includeDemandPatterns: true,
        includeMarketBalance: true
      })
    }

    // Step 10: Add correlation analysis between commodities
    let correlationAnalysis = null
    if (includeCorrelationAnalysis === 'true' && !commodity && !commodityId) {
      correlationAnalysis = await calculateCommodityCorrelations(
        timeParams,
        req.services,
        {
          minCorrelation: 0.3,
          includeLagged: true,
          maxCommodities: 50
        }
      )
    }

    // Step 11: Generate visualization data
    let visualizationData = null
    if (includeVisualization === 'true') {
      visualizationData = generateTrendVisualization(
        aggregatedData,
        {
          chartType,
          movingAverages,
          volatilityBands: volatilityAnalysis?.bollingerBands,
          predictions,
          seasonalOverlay: seasonalAnalysis
        }
      )
    }

    // Step 12: Calculate comprehensive trend statistics
    const trendStatistics = calculateTrendStatistics(aggregatedData, {
      timeRange: timeParams,
      interval,
      volatility: volatilityAnalysis,
      seasonal: seasonalAnalysis,
      regional: regionalComparison
    })

    // Cache results for performance
    const cacheKey = `market_trends:${commodity || commodityId || 'all'}:${timeRange}:${interval}`
    if (req.services.cache) {
      await req.services.cache.set(cacheKey, {
        aggregatedData: aggregatedData.slice(0, 500), // Limit cached data
        statistics: trendStatistics,
        lastUpdated: new Date().toISOString()
      }, 3600) // Cache for 1 hour
    }

    // Prepare response
    const response = {
      success: true,
      request: {
        commodity: commodity || commodityId,
        system,
        region,
        timeRange,
        interval,
        period: {
          startDate: timeParams.startDate,
          endDate: timeParams.endDate,
          dataPoints: aggregatedData.length
        }
      },
      data: {
        historical: aggregatedData,
        movingAverages,
        seasonalAnalysis,
        volatilityAnalysis,
        regionalComparison,
        predictions,
        supplyDemandTrends,
        correlationAnalysis
      },
      statistics: trendStatistics,
      visualization: includeVisualization === 'true' ? visualizationData : undefined,
      metadata: {
        generatedAt: new Date().toISOString(),
        dataQuality: calculateDataQuality(historicalData),
        servicesUsed: {
          database: true,
          cache: !!req.services.cache,
          edsm: !!req.services.edsm,
          inara: !!req.services.inara
        }
      }
    }

    // Handle CSV format response
    if (format === 'csv') {
      return sendTrendsCSVResponse(res, response, commodity || commodityId)
    }

    res.json(response)
  } catch (error) {
    logger.error('Error analyzing market trends', {
      commodity: req.query.commodity,
      timeRange: req.query.timeRange,
      error: error.message,
      stack: error.stack
    })

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to analyze market trends',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
})

/**
 * Helper Functions for Market Trends Analysis
 */

// Parse time range and calculate date boundaries
function parseTimeRange (timeRange, startDate, endDate) {
  const now = new Date()
  let start, end

  if (startDate && endDate) {
    start = new Date(startDate)
    end = new Date(endDate)
  } else {
    end = now
    switch (timeRange) {
      case '1d':
        start = new Date(now.getTime() - 24 * 60 * 60 * 1000)
        break
      case '7d':
        start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case '30d':
        start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      case '90d':
        start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        break
      case '1y':
        start = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
        break
      default:
        start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    }
  }

  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    durationDays: Math.ceil((end - start) / (24 * 60 * 60 * 1000))
  }
}

// Query historical market data from MongoDB
async function queryHistoricalMarketData (params, services) {
  try {
    const { commodity, system, region, startDate, endDate, interval, limit } = params

    // Build MongoDB query
    const query = {
      timestamp: {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      }
    }

    if (commodity) {
      query.commodity = commodity
    }

    if (system) {
      query.system = system
    }

    if (region) {
      query.region = region
    }

    // Query market data with aggregation for better performance
    const historicalData = await services.marketData.getHistoricalData(query, {
      sort: { timestamp: 1 },
      limit,
      interval
    })

    return historicalData || []
  } catch (error) {
    logger.error('Failed to query historical market data', {
      params,
      error: error.message
    })
    return []
  }
}

// Aggregate price data by time intervals
function aggregatePriceDataByInterval (data, interval) {
  if (!data || data.length === 0) return []

  const aggregated = {}
  const intervalMs = getIntervalMilliseconds(interval)

  for (const record of data) {
    const timestamp = new Date(record.timestamp)
    const intervalKey = Math.floor(timestamp.getTime() / intervalMs) * intervalMs
    const intervalDate = new Date(intervalKey)

    if (!aggregated[intervalKey]) {
      aggregated[intervalKey] = {
        timestamp: intervalDate.toISOString(),
        prices: [],
        volumes: [],
        supplies: [],
        demands: [],
        count: 0
      }
    }

    const bucket = aggregated[intervalKey]

    if (record.buyPrice > 0) bucket.prices.push(record.buyPrice)
    if (record.sellPrice > 0) bucket.prices.push(record.sellPrice)
    if (record.volume > 0) bucket.volumes.push(record.volume)
    if (record.supply > 0) bucket.supplies.push(record.supply)
    if (record.demand > 0) bucket.demands.push(record.demand)

    bucket.count++
  }

  // Calculate aggregated values
  return Object.values(aggregated).map(bucket => ({
    timestamp: bucket.timestamp,
    open: bucket.prices[0] || 0,
    high: Math.max(...bucket.prices) || 0,
    low: Math.min(...bucket.prices) || 0,
    close: bucket.prices[bucket.prices.length - 1] || 0,
    average: bucket.prices.reduce((sum, p) => sum + p, 0) / bucket.prices.length || 0,
    volume: bucket.volumes.reduce((sum, v) => sum + v, 0),
    averageSupply: bucket.supplies.reduce((sum, s) => sum + s, 0) / bucket.supplies.length || 0,
    averageDemand: bucket.demands.reduce((sum, d) => sum + d, 0) / bucket.demands.length || 0,
    dataPoints: bucket.count
  })).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
}

// Calculate moving averages
function calculateMovingAverages (data, options) {
  const { periods = [7, 14, 30], includeEMA = true, includeSignals = true } = options
  const result = {
    simple: {},
    exponential: {},
    signals: []
  }

  for (const period of periods) {
    // Simple Moving Average
    result.simple[`ma${period}`] = calculateSMA(data, period)

    // Exponential Moving Average
    if (includeEMA) {
      result.exponential[`ema${period}`] = calculateEMA(data, period)
    }
  }

  // Generate buy/sell signals
  if (includeSignals) {
    result.signals = generateMASignals(data, result.simple, result.exponential)
  }

  return result
}

// Calculate Simple Moving Average
function calculateSMA (data, period) {
  const sma = []

  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1)
    const average = slice.reduce((sum, item) => sum + item.close, 0) / period
    sma.push({
      timestamp: data[i].timestamp,
      value: average
    })
  }

  return sma
}

// Calculate Exponential Moving Average
function calculateEMA (data, period) {
  const ema = []
  const multiplier = 2 / (period + 1)

  // Start with SMA for first value
  let previousEMA = data.slice(0, period).reduce((sum, item) => sum + item.close, 0) / period

  for (let i = period - 1; i < data.length; i++) {
    const currentEMA = (data[i].close * multiplier) + (previousEMA * (1 - multiplier))
    ema.push({
      timestamp: data[i].timestamp,
      value: currentEMA
    })
    previousEMA = currentEMA
  }

  return ema
}

// Identify seasonal patterns and market cycles
async function identifySeasonalPatterns (data, options) {
  const { cycleLength, includeWeekly, includeMonthly, includeYearly } = options

  const patterns = {
    weekly: includeWeekly ? analyzeWeeklyPatterns(data) : null,
    monthly: includeMonthly ? analyzeMonthlyPatterns(data) : null,
    yearly: includeYearly ? analyzeYearlyPatterns(data) : null,
    cycles: detectMarketCycles(data, cycleLength)
  }

  return patterns
}

// Analyze weekly patterns
function analyzeWeeklyPatterns (data) {
  const weeklyData = {}

  for (const item of data) {
    const date = new Date(item.timestamp)
    const dayOfWeek = date.getDay() // 0 = Sunday, 1 = Monday, etc.

    if (!weeklyData[dayOfWeek]) {
      weeklyData[dayOfWeek] = {
        day: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek],
        prices: [],
        volumes: []
      }
    }

    weeklyData[dayOfWeek].prices.push(item.close)
    weeklyData[dayOfWeek].volumes.push(item.volume)
  }

  // Calculate averages and patterns
  return Object.values(weeklyData).map(day => ({
    day: day.day,
    averagePrice: day.prices.reduce((sum, p) => sum + p, 0) / day.prices.length,
    averageVolume: day.volumes.reduce((sum, v) => sum + v, 0) / day.volumes.length,
    priceVariance: calculateVariance(day.prices),
    dataPoints: day.prices.length
  }))
}

// Calculate volatility indicators
function calculateVolatilityIndicators (data, options) {
  const { includeATR, includeBollingerBands, includeRSI, includeStochastics } = options

  const indicators = {}

  if (includeATR) {
    indicators.atr = calculateATR(data, 14)
  }

  if (includeBollingerBands) {
    indicators.bollingerBands = calculateBollingerBands(data, 20, 2)
  }

  if (includeRSI) {
    indicators.rsi = calculateRSI(data, 14)
  }

  if (includeStochastics) {
    indicators.stochastics = calculateStochastics(data, 14, 3)
  }

  return indicators
}

// Calculate Average True Range (ATR)
function calculateATR (data, period) {
  const atr = []
  const trueRanges = []

  for (let i = 1; i < data.length; i++) {
    const high = data[i].high
    const low = data[i].low
    const prevClose = data[i - 1].close

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    )

    trueRanges.push(tr)

    if (trueRanges.length >= period) {
      const atrValue = trueRanges.slice(-period).reduce((sum, tr) => sum + tr, 0) / period
      atr.push({
        timestamp: data[i].timestamp,
        value: atrValue
      })
    }
  }

  return atr
}

// Calculate Bollinger Bands
function calculateBollingerBands (data, period, stdDev) {
  const bands = []

  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1)
    const prices = slice.map(item => item.close)

    const sma = prices.reduce((sum, price) => sum + price, 0) / period
    const variance = prices.reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / period
    const standardDeviation = Math.sqrt(variance)

    bands.push({
      timestamp: data[i].timestamp,
      middle: sma,
      upper: sma + (standardDeviation * stdDev),
      lower: sma - (standardDeviation * stdDev),
      bandwidth: (standardDeviation * stdDev * 2) / sma
    })
  }

  return bands
}

// Generate trend predictions
async function generateTrendPredictions (data, options) {
  const { forecastPeriods, confidenceIntervals, includeSeasonality, method } = options

  if (data.length < 10) {
    return {
      predictions: [],
      confidence: 'low',
      method: 'insufficient_data'
    }
  }

  const predictions = []
  const prices = data.map(item => item.close)

  // Simple linear regression for trend
  const trend = calculateLinearTrend(prices)
  const lastTimestamp = new Date(data[data.length - 1].timestamp)
  const intervalMs = getIntervalMilliseconds('daily') // Default to daily intervals

  for (let i = 1; i <= forecastPeriods; i++) {
    const futureTimestamp = new Date(lastTimestamp.getTime() + (i * intervalMs))
    const predictedPrice = trend.slope * (data.length + i) + trend.intercept

    // Add confidence intervals
    const confidence = {}
    for (const level of confidenceIntervals) {
      const margin = calculatePredictionMargin(prices, level)
      confidence[`${level}%`] = {
        upper: predictedPrice + margin,
        lower: predictedPrice - margin
      }
    }

    predictions.push({
      timestamp: futureTimestamp.toISOString(),
      predicted: Math.max(0, predictedPrice), // Ensure non-negative prices
      confidence
    })
  }

  return {
    predictions,
    trend: {
      direction: trend.slope > 0 ? 'upward' : 'downward',
      strength: Math.abs(trend.slope),
      r_squared: trend.rSquared
    },
    method,
    confidence: trend.rSquared > 0.5 ? 'high' : trend.rSquared > 0.3 ? 'medium' : 'low'
  }
}

// Calculate trend statistics
function calculateTrendStatistics (data, options) {
  if (!data || data.length === 0) {
    return {
      dataPoints: 0,
      priceChange: 0,
      percentageChange: 0,
      volatility: 0,
      trend: 'insufficient_data'
    }
  }

  const prices = data.map(item => item.close)
  const firstPrice = prices[0]
  const lastPrice = prices[prices.length - 1]
  const priceChange = lastPrice - firstPrice
  const percentageChange = (priceChange / firstPrice) * 100

  return {
    dataPoints: data.length,
    period: options.timeRange,
    interval: options.interval,
    priceRange: {
      min: Math.min(...prices),
      max: Math.max(...prices),
      average: prices.reduce((sum, p) => sum + p, 0) / prices.length
    },
    priceChange,
    percentageChange,
    volatility: calculateVariance(prices),
    trend: determineTrendDirection(priceChange, percentageChange),
    volume: {
      total: data.reduce((sum, item) => sum + item.volume, 0),
      average: data.reduce((sum, item) => sum + item.volume, 0) / data.length
    }
  }
}

// Helper functions
function getIntervalMilliseconds (interval) {
  switch (interval) {
    case 'hourly': return 60 * 60 * 1000
    case 'daily': return 24 * 60 * 60 * 1000
    case 'weekly': return 7 * 24 * 60 * 60 * 1000
    case 'monthly': return 30 * 24 * 60 * 60 * 1000
    default: return 24 * 60 * 60 * 1000
  }
}

function determineCycleLength (interval) {
  switch (interval) {
    case 'hourly': return 24 // Daily cycle
    case 'daily': return 7 // Weekly cycle
    case 'weekly': return 4 // Monthly cycle
    case 'monthly': return 12 // Yearly cycle
    default: return 7
  }
}

function determineForecastPeriods (interval) {
  switch (interval) {
    case 'hourly': return 24 // Next 24 hours
    case 'daily': return 7 // Next 7 days
    case 'weekly': return 4 // Next 4 weeks
    case 'monthly': return 3 // Next 3 months
    default: return 7
  }
}

function calculateVariance (values) {
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length
  return Math.sqrt(variance)
}

function calculateLinearTrend (values) {
  const n = values.length
  const x = Array.from({ length: n }, (_, i) => i)
  const y = values

  const sumX = x.reduce((sum, val) => sum + val, 0)
  const sumY = y.reduce((sum, val) => sum + val, 0)
  const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0)
  const sumXX = x.reduce((sum, val) => sum + val * val, 0)

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX)
  const intercept = (sumY - slope * sumX) / n

  // Calculate R-squared
  const yMean = sumY / n
  const totalSumSquares = y.reduce((sum, val) => sum + Math.pow(val - yMean, 2), 0)
  const residualSumSquares = y.reduce((sum, val, i) => {
    const predicted = slope * x[i] + intercept
    return sum + Math.pow(val - predicted, 2)
  }, 0)
  const rSquared = 1 - (residualSumSquares / totalSumSquares)

  return { slope, intercept, rSquared }
}

function calculatePredictionMargin (values, confidenceLevel) {
  const variance = calculateVariance(values)
  const factor = confidenceLevel === 95 ? 1.96 : confidenceLevel === 80 ? 1.28 : 1.0
  return variance * factor
}

function determineTrendDirection (priceChange, percentageChange) {
  if (Math.abs(percentageChange) < 1) return 'stable'
  if (percentageChange > 10) return 'strong_upward'
  if (percentageChange > 2) return 'upward'
  if (percentageChange < -10) return 'strong_downward'
  if (percentageChange < -2) return 'downward'
  return 'stable'
}

// Send CSV response for trends
function sendTrendsCSVResponse (res, data, commodity) {
  const historicalData = data.data.historical || []

  let csv = 'Timestamp,Open,High,Low,Close,Average,Volume,Supply,Demand\n'

  for (const record of historicalData) {
    csv += `"${record.timestamp}",${record.open},${record.high},${record.low},${record.close},${record.average},${record.volume},${record.averageSupply},${record.averageDemand}\n`
  }

  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', `attachment; filename="${commodity || 'market'}_trends.csv"`)
  res.send(csv)
}

// Calculate data quality metrics
function calculateDataQuality (data) {
  if (!data || data.length === 0) {
    return { score: 0, issues: ['No data available'] }
  }

  const issues = []
  let score = 100

  // Check for missing values
  const missingValues = data.filter(item => !item.buyPrice && !item.sellPrice).length
  if (missingValues > 0) {
    issues.push(`${missingValues} records with missing prices`)
    score -= (missingValues / data.length) * 20
  }

  // Check data freshness
  const now = Date.now()
  const oldData = data.filter(item => (now - new Date(item.timestamp).getTime()) > 7 * 24 * 60 * 60 * 1000).length
  if (oldData > data.length * 0.5) {
    issues.push('More than 50% of data is older than 7 days')
    score -= 15
  }

  // Check data continuity
  const timeGaps = checkTimeGaps(data)
  if (timeGaps > 0) {
    issues.push(`${timeGaps} significant time gaps in data`)
    score -= timeGaps * 5
  }

  return {
    score: Math.max(0, Math.round(score)),
    issues: issues.length > 0 ? issues : ['No issues detected'],
    dataPoints: data.length,
    coverage: calculateTemporalCoverage(data)
  }
}

// Additional helper functions for comprehensive analysis
function generateMASignals (data, simpleMA, exponentialMA) {
  // Generate moving average crossover signals
  const signals = []
  return signals // Placeholder implementation
}

function analyzeMonthlyPatterns (data) {
  // Analyze monthly price patterns
  return null // Placeholder implementation
}

function analyzeYearlyPatterns (data) {
  // Analyze yearly price patterns
  return null // Placeholder implementation
}

function detectMarketCycles (data, cycleLength) {
  // Detect market cycles based on price patterns
  return null // Placeholder implementation
}

function calculateRSI (data, period) {
  // Calculate Relative Strength Index
  return [] // Placeholder implementation
}

function calculateStochastics (data, period, smoothing) {
  // Calculate Stochastic oscillator
  return [] // Placeholder implementation
}

function compareRegionalPrices (commodity, timeParams, services, options) {
  // Compare prices across different regions
  return null // Placeholder implementation
}

function analyzeSupplyDemandTrends (data, options) {
  // Analyze supply and demand trends
  return null // Placeholder implementation
}

function calculateCommodityCorrelations (timeParams, services, options) {
  // Calculate correlations between different commodities
  return null // Placeholder implementation
}

function generateTrendVisualization (data, options) {
  // Generate visualization data for charts
  return null // Placeholder implementation
}

function checkTimeGaps (data) {
  // Check for significant time gaps in data
  return 0 // Placeholder implementation
}

function calculateTemporalCoverage (data) {
  // Calculate temporal coverage of the data
  return '100%' // Placeholder implementation
}

// Get station market data
router.get('/station/:systemName/:stationName', async (req, res) => {
  try {
    const { systemName, stationName } = req.params

    logger.info(`Station market data requested: ${stationName} in ${systemName}`)

    const stationData = await marketDataService.getStationMarketData(systemName, stationName)

    res.json({
      success: true,
      data: stationData,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Error fetching station market data:', error)
    res.status(500).json({
      error: 'Failed to fetch station market data',
      message: error.message
    })
  }
})

// Get commodity list with basic info
router.get('/commodities', ensureServices, async (req, res) => {
  try {
    logger.info('Commodity list requested')

    // This would typically come from a commodities reference collection
    const commodities = [
      { id: 'gold', name: 'Gold', category: 'Metals', avgPrice: 9000 },
      { id: 'silver', name: 'Silver', category: 'Metals', avgPrice: 4500 },
      { id: 'palladium', name: 'Palladium', category: 'Metals', avgPrice: 13000 },
      { id: 'platinum', name: 'Platinum', category: 'Metals', avgPrice: 19000 },
      { id: 'tritium', name: 'Tritium', category: 'Chemicals', avgPrice: 50000 },
      { id: 'painite', name: 'Painite', category: 'Minerals', avgPrice: 700000 },
      { id: 'void_opals', name: 'Void Opals', category: 'Minerals', avgPrice: 500000 },
      { id: 'low_temperature_diamonds', name: 'Low Temperature Diamonds', category: 'Minerals', avgPrice: 500000 }
    ]

    res.json({
      success: true,
      data: {
        commodities,
        total: commodities.length,
        categories: [...new Set(commodities.map(c => c.category))]
      },
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Error fetching commodity list:', error)
    res.status(500).json({
      error: 'Failed to fetch commodity list',
      message: error.message
    })
  }
})

// Market summary endpoint
router.get('/summary', ensureServices, async (req, res) => {
  try {
    logger.info('Market summary requested')

    // This would aggregate market data for a dashboard view
    const summary = {
      topCommodities: [
        { name: 'Painite', avgPrice: 700000, trend: 'rising' },
        { name: 'Void Opals', avgPrice: 500000, trend: 'stable' },
        { name: 'Low Temperature Diamonds', avgPrice: 500000, trend: 'falling' }
      ],
      marketActivity: {
        activeSystems: 150,
        activeStations: 1200,
        priceUpdatesLast24h: 5000
      },
      trends: {
        risingCommodities: 12,
        fallingCommodities: 8,
        stableCommodities: 25
      }
    }

    res.json({
      success: true,
      data: summary,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Error fetching market summary:', error)
    res.status(500).json({
      error: 'Failed to fetch market summary',
      message: error.message
    })
  }
})

/**
 * Helper Functions for Market Data Processing
 */

// Get commodity category from database or cache
async function getCommodityCategory (commodityId, services) {
  try {
    // Try to get from cache first
    const cacheKey = `commodity:category:${commodityId}`
    if (services.cache) {
      const cached = await services.cache.get(cacheKey)
      if (cached) return cached
    }

    // Query database for commodity information
    const commodityInfo = await services.marketData.getCommodityInfo(commodityId)
    const category = commodityInfo?.category || 'Unknown'

    // Cache for 24 hours
    if (services.cache) {
      await services.cache.set(cacheKey, category, 86400)
    }

    return category
  } catch (error) {
    logger.warn('Failed to get commodity category', { commodityId, error: error.message })
    return 'Unknown'
  }
}

// Get commodity rarity classification
async function getCommodityRarity (commodityId, services) {
  try {
    const cacheKey = `commodity:rarity:${commodityId}`
    if (services.cache) {
      const cached = await services.cache.get(cacheKey)
      if (cached) return cached
    }

    const commodityInfo = await services.marketData.getCommodityInfo(commodityId)
    const rarity = commodityInfo?.rarity || 'Common'

    if (services.cache) {
      await services.cache.set(cacheKey, rarity, 86400)
    }

    return rarity
  } catch (error) {
    logger.warn('Failed to get commodity rarity', { commodityId, error: error.message })
    return 'Common'
  }
}

// Calculate comprehensive data freshness metrics
function calculateDataFreshness (locations) {
  if (!locations || locations.length === 0) {
    return {
      averageAge: 0,
      oldestData: null,
      newestData: null,
      freshnessScore: 0,
      staleCount: 0
    }
  }

  const now = Date.now()
  const ages = locations.map(location => {
    const lastUpdated = new Date(location.lastUpdated || location.timestamp)
    return now - lastUpdated.getTime()
  })

  const averageAge = ages.reduce((sum, age) => sum + age, 0) / ages.length
  const oldestAge = Math.max(...ages)
  const newestAge = Math.min(...ages)

  // Calculate freshness score (0-100, where 100 is very fresh)
  const maxAcceptableAge = 24 * 60 * 60 * 1000 // 24 hours
  const freshnessScore = Math.max(0, 100 - (averageAge / maxAcceptableAge) * 100)

  // Count stale data (older than 12 hours)
  const staleThreshold = 12 * 60 * 60 * 1000
  const staleCount = ages.filter(age => age > staleThreshold).length

  return {
    averageAge,
    oldestData: new Date(now - oldestAge).toISOString(),
    newestData: new Date(now - newestAge).toISOString(),
    freshnessScore: Math.round(freshnessScore),
    staleCount,
    totalLocations: locations.length
  }
}

// Calculate comprehensive price analysis
function calculatePriceAnalysis (eddnLocations, inaraData) {
  const allLocations = [...(eddnLocations || []), ...(inaraData || [])]

  if (allLocations.length === 0) {
    return null
  }

  const buyPrices = allLocations.map(loc => loc.prices?.buy || loc.buyPrice || 0).filter(p => p > 0)
  const sellPrices = allLocations.map(loc => loc.prices?.sell || loc.sellPrice || 0).filter(p => p > 0)

  const analysis = {
    buy: buyPrices.length > 0
      ? {
          min: Math.min(...buyPrices),
          max: Math.max(...buyPrices),
          average: buyPrices.reduce((sum, p) => sum + p, 0) / buyPrices.length,
          median: calculateMedian(buyPrices),
          standardDeviation: calculateStandardDeviation(buyPrices)
        }
      : null,
    sell: sellPrices.length > 0
      ? {
          min: Math.min(...sellPrices),
          max: Math.max(...sellPrices),
          average: sellPrices.reduce((sum, p) => sum + p, 0) / sellPrices.length,
          median: calculateMedian(sellPrices),
          standardDeviation: calculateStandardDeviation(sellPrices)
        }
      : null,
    spread: {
      absolute: buyPrices.length > 0 && sellPrices.length > 0
        ? Math.max(...sellPrices) - Math.min(...buyPrices)
        : 0,
      percentage: buyPrices.length > 0 && sellPrices.length > 0
        ? ((Math.max(...sellPrices) - Math.min(...buyPrices)) / Math.min(...buyPrices)) * 100
        : 0
    },
    liquidity: {
      buyStations: buyPrices.length,
      sellStations: sellPrices.length,
      totalStations: allLocations.length
    }
  }

  return analysis
}

// Calculate profit opportunities
function calculateProfitOpportunities (locations, options = {}) {
  if (!locations || locations.length === 0) {
    return []
  }

  const { sortBy = 'profit', limit = 50, minProfit = 100 } = options

  const buyStations = locations.filter(loc =>
    (loc.prices?.buy || loc.buyPrice) > 0 &&
    (loc.supply || 0) > 0
  )

  const sellStations = locations.filter(loc =>
    (loc.prices?.sell || loc.sellPrice) > 0 &&
    (loc.demand || 0) > 0
  )

  const opportunities = []

  for (const buyStation of buyStations) {
    for (const sellStation of sellStations) {
      if (buyStation.system === sellStation.system &&
          buyStation.station === sellStation.station) {
        continue // Skip same station
      }

      const buyPrice = buyStation.prices?.buy || buyStation.buyPrice
      const sellPrice = sellStation.prices?.sell || sellStation.sellPrice
      const profit = sellPrice - buyPrice

      if (profit >= minProfit) {
        opportunities.push({
          buyLocation: {
            system: buyStation.system,
            station: buyStation.station,
            price: buyPrice,
            supply: buyStation.supply,
            distance: buyStation.distanceToArrival || 0
          },
          sellLocation: {
            system: sellStation.system,
            station: sellStation.station,
            price: sellPrice,
            demand: sellStation.demand,
            distance: sellStation.distanceToArrival || 0
          },
          profit: {
            perUnit: profit,
            percentage: (profit / buyPrice) * 100,
            potential: Math.min(buyStation.supply || 0, sellStation.demand || 0) * profit
          }
        })
      }
    }
  }

  // Sort opportunities
  opportunities.sort((a, b) => {
    switch (sortBy) {
      case 'profit':
        return b.profit.perUnit - a.profit.perUnit
      case 'percentage':
        return b.profit.percentage - a.profit.percentage
      case 'potential':
        return b.profit.potential - a.profit.potential
      default:
        return b.profit.perUnit - a.profit.perUnit
    }
  })

  return opportunities.slice(0, limit)
}

// Calculate market volatility
function calculateMarketVolatility (locations, priceHistory) {
  if (!locations || locations.length === 0) {
    return {
      score: 0,
      classification: 'Unknown',
      priceVariation: 0,
      supplyVariation: 0,
      demandVariation: 0
    }
  }

  const buyPrices = locations.map(loc => loc.prices?.buy || loc.buyPrice || 0).filter(p => p > 0)
  const sellPrices = locations.map(loc => loc.prices?.sell || loc.sellPrice || 0).filter(p => p > 0)
  const supplies = locations.map(loc => loc.supply || 0).filter(s => s > 0)
  const demands = locations.map(loc => loc.demand || 0).filter(d => d > 0)

  const priceVariation = buyPrices.length > 0
    ? calculateStandardDeviation(buyPrices) / (buyPrices.reduce((sum, p) => sum + p, 0) / buyPrices.length)
    : 0

  const supplyVariation = supplies.length > 0
    ? calculateStandardDeviation(supplies) / (supplies.reduce((sum, s) => sum + s, 0) / supplies.length)
    : 0

  const demandVariation = demands.length > 0
    ? calculateStandardDeviation(demands) / (demands.reduce((sum, d) => sum + d, 0) / demands.length)
    : 0

  // Calculate overall volatility score (0-100)
  const volatilityScore = Math.min(100, (priceVariation + supplyVariation + demandVariation) * 100 / 3)

  let classification = 'Stable'
  if (volatilityScore > 60) classification = 'Highly Volatile'
  else if (volatilityScore > 30) classification = 'Volatile'
  else if (volatilityScore > 15) classification = 'Moderately Volatile'

  return {
    score: Math.round(volatilityScore),
    classification,
    priceVariation: Math.round(priceVariation * 100) / 100,
    supplyVariation: Math.round(supplyVariation * 100) / 100,
    demandVariation: Math.round(demandVariation * 100) / 100
  }
}

// Calculate regional price comparison
async function calculateRegionalComparison (commodityId, centerSystem, services, maxDistance) {
  try {
    // Get systems within range using EDSM if available
    let nearbySystems = []

    if (services.edsm) {
      try {
        const systemsInRange = await services.edsm.getSystemsInRadius(centerSystem, maxDistance)
        nearbySystems = systemsInRange.map(sys => sys.name)
      } catch (edsmError) {
        logger.warn('Failed to get nearby systems from EDSM', {
          centerSystem,
          maxDistance,
          error: edsmError.message
        })
      }
    }

    // Get market data for nearby systems
    const regionalData = await services.marketData.getCommodityDataByRegion(
      commodityId,
      nearbySystems.length > 0 ? nearbySystems : [centerSystem],
      { maxAge: 24 }
    )

    if (!regionalData || regionalData.length === 0) {
      return null
    }

    // Calculate regional statistics
    const systemStats = regionalData.map(data => ({
      system: data.system,
      averageBuyPrice: data.averageBuyPrice || 0,
      averageSellPrice: data.averageSellPrice || 0,
      stationCount: data.stationCount || 0,
      totalSupply: data.totalSupply || 0,
      totalDemand: data.totalDemand || 0
    }))

    return {
      centerSystem,
      maxDistance,
      systemCount: systemStats.length,
      systems: systemStats,
      regional: {
        averageBuyPrice: systemStats.reduce((sum, s) => sum + s.averageBuyPrice, 0) / systemStats.length,
        averageSellPrice: systemStats.reduce((sum, s) => sum + s.averageSellPrice, 0) / systemStats.length,
        totalStations: systemStats.reduce((sum, s) => sum + s.stationCount, 0),
        totalSupply: systemStats.reduce((sum, s) => sum + s.totalSupply, 0),
        totalDemand: systemStats.reduce((sum, s) => sum + s.totalDemand, 0)
      }
    }
  } catch (error) {
    logger.warn('Failed to calculate regional comparison', {
      commodityId,
      centerSystem,
      error: error.message
    })
    return null
  }
}

// Send CSV response
function sendCSVResponse (res, result, commodityId) {
  const locations = result.sources.eddn.locations || []

  let csv = 'System,Station,Buy Price,Sell Price,Supply,Demand,Distance,Last Updated\n'

  for (const location of locations) {
    csv += `"${location.system}","${location.station}",${location.prices?.buy || 0},${location.prices?.sell || 0},${location.supply || 0},${location.demand || 0},${location.distanceToArrival || 0},"${location.lastUpdated}"\n`
  }

  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', `attachment; filename="${commodityId}_market_data.csv"`)
  res.send(csv)
}

// Send trading tool compatible response
function sendTradingToolResponse (res, result, commodityId) {
  const tradingToolData = {
    commodity: commodityId,
    timestamp: new Date().toISOString(),
    locations: (result.sources.eddn.locations || []).map(location => ({
      system: location.system,
      station: location.station,
      buy_price: location.prices?.buy || 0,
      sell_price: location.prices?.sell || 0,
      supply: location.supply || 0,
      demand: location.demand || 0,
      distance_to_arrival: location.distanceToArrival || 0,
      last_updated: location.lastUpdated
    })),
    profit_opportunities: result.analytics.profitOpportunities || []
  }

  res.json(tradingToolData)
}

// Mathematical helper functions
function calculateMedian (numbers) {
  const sorted = [...numbers].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function calculateStandardDeviation (numbers) {
  const avg = numbers.reduce((sum, num) => sum + num, 0) / numbers.length
  const variance = numbers.reduce((sum, num) => sum + Math.pow(num - avg, 2), 0) / numbers.length
  return Math.sqrt(variance)
}

// **Station Market Data** - `/api/market/station/:system/:station` - COMPREHENSIVE IMPLEMENTATION
router.get('/station/:system/:station', ensureServices, async (req, res) => {
  const startTime = Date.now()

  try {
    const { system, station } = req.params
    const {
      includeServices = true,
      includeShipyard = false,
      includeOutfitting = false,
      includeProfitOpportunities = true,
      includeNearbyComparison = true,
      maxAge = 24,
      format = 'json',
      limit = 1000,
      sortBy = 'profit_desc',
      filterCommodities,
      minProfit = 0,
      includeInaraData = false
    } = req.query

    logger.info(`Station market data request: ${system}/${station}`, {
      params: req.params,
      query: req.query,
      ip: req.ip
    })

    // Step 1: Validate system and station names against EDSM database
    const validationResults = await validateSystemAndStation(system, station, req.services)
    if (!validationResults.isValid) {
      return res.status(404).json({
        error: 'System or station not found',
        details: validationResults.details,
        suggestions: validationResults.suggestions || []
      })
    }

    // Step 2: Query MongoDB for latest market data at specific station
    const marketData = await queryStationMarketData(
      validationResults.system,
      validationResults.station,
      maxAge,
      req.services
    )

    // Step 3: Fetch complete commodity list with buy/sell prices
    const commodityData = await fetchStationCommodities(
      validationResults.system,
      validationResults.station,
      filterCommodities,
      req.services
    )

    // Step 4: Include stock levels, demand levels, and price age
    const enrichedCommodities = await enrichCommodityData(
      commodityData,
      validationResults.station,
      req.services
    )

    // Step 5: Add station information (type, services, landing pads)
    const stationInfo = await fetchStationInformation(
      validationResults.system,
      validationResults.station,
      includeServices,
      includeShipyard,
      includeOutfitting,
      req.services
    )

    // Step 6: Calculate profit opportunities for each commodity
    let profitAnalysis = null
    if (includeProfitOpportunities) {
      profitAnalysis = await calculateStationProfitOpportunities(
        enrichedCommodities,
        validationResults.system,
        validationResults.station,
        minProfit,
        req.services
      )
    }

    // Step 7: Include price comparison with nearby stations
    let nearbyComparison = null
    if (includeNearbyComparison) {
      nearbyComparison = await compareWithNearbyStations(
        validationResults.system,
        validationResults.station,
        enrichedCommodities,
        req.services
      )
    }

    // Step 8: Add market data freshness indicators
    const freshnessIndicators = calculateMarketDataFreshness(
      marketData,
      enrichedCommodities,
      maxAge
    )

    // Step 9: Integrate with Inara API for additional station details
    let inaraData = null
    if (includeInaraData && req.services.inara) {
      try {
        inaraData = await req.services.inara.getStationMarketData(
          validationResults.system,
          validationResults.station
        )
      } catch (error) {
        logger.warn('Inara API error for station data', { error: error.message })
      }
    }

    // Sort commodities based on sortBy parameter
    const sortedCommodities = sortStationCommodities(enrichedCommodities, sortBy)

    // Apply limit
    const limitedCommodities = limit ? sortedCommodities.slice(0, limit) : sortedCommodities

    // Build comprehensive response
    const response = {
      success: true,
      request: {
        system: validationResults.system,
        station: validationResults.station,
        requestedSystem: system,
        requestedStation: station,
        parameters: {
          includeServices,
          includeShipyard,
          includeOutfitting,
          includeProfitOpportunities,
          includeNearbyComparison,
          maxAge: parseInt(maxAge),
          sortBy,
          minProfit: parseFloat(minProfit),
          limit: limit ? parseInt(limit) : null
        }
      },
      data: {
        station: stationInfo,
        market: {
          commodities: limitedCommodities,
          totalCommodities: enrichedCommodities.length,
          lastUpdated: marketData.lastUpdated,
          freshness: freshnessIndicators
        },
        profitAnalysis,
        nearbyComparison,
        inaraData
      },
      statistics: {
        commodityCount: enrichedCommodities.length,
        displayedCount: limitedCommodities.length,
        profitableCommodities: profitAnalysis ? profitAnalysis.profitable.length : 0,
        averageAge: freshnessIndicators.averageAge,
        freshnessScore: freshnessIndicators.score
      },
      metadata: {
        generatedAt: new Date().toISOString(),
        processingTime: Date.now() - startTime,
        dataQuality: {
          score: freshnessIndicators.score,
          issues: freshnessIndicators.issues,
          coverage: freshnessIndicators.coverage
        },
        servicesUsed: {
          database: true,
          cache: !!req.services.cache,
          edsm: !!validationResults.edsmData,
          inara: !!inaraData
        }
      }
    }

    // Step 10: Provide export options (JSON, CSV, trading tool format)
    if (format === 'csv') {
      return sendStationCSVResponse(res, response)
    }

    // Cache the response
    if (req.services.cache) {
      const cacheKey = `station_market:${validationResults.system}:${validationResults.station}:${JSON.stringify(req.query)}`
      await req.services.cache.set(cacheKey, response, 10 * 60) // 10 minutes cache
    }

    res.json(response)
  } catch (error) {
    logger.error('Station market data error', {
      error: error.message,
      stack: error.stack,
      params: req.params,
      query: req.query
    })

    if (req.services.errorHandler) {
      req.services.errorHandler.handleError(error, 'station_market_data')
    }

    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to fetch station market data',
      timestamp: new Date().toISOString()
    })
  }
})

// **Station Market Data Helper Functions**

async function validateSystemAndStation (system, station, services) {
  try {
    const systemName = system.replace(/\+/g, ' ').trim()
    const stationName = station.replace(/\+/g, ' ').trim()

    // Check EDSM for system validation
    let edsmData = null
    if (services.edsm) {
      try {
        edsmData = await services.edsm.getSystemInfo(systemName)
        if (!edsmData || !edsmData.id) {
          return {
            isValid: false,
            details: 'System not found in EDSM database',
            suggestions: await services.edsm.searchSystems(systemName, 5)
          }
        }
      } catch (error) {
        logger.warn('EDSM validation failed', { system: systemName, error: error.message })
      }
    }

    // Check database for station existence
    const stationExists = await services.marketData.checkStationExists(systemName, stationName)
    if (!stationExists) {
      const suggestions = await services.marketData.findSimilarStations(systemName, stationName, 5)
      return {
        isValid: false,
        details: 'Station not found in market database',
        suggestions
      }
    }

    return {
      isValid: true,
      system: systemName,
      station: stationName,
      edsmData
    }
  } catch (error) {
    logger.error('System/station validation error', { error: error.message })
    return {
      isValid: false,
      details: 'Validation failed',
      error: error.message
    }
  }
}

async function queryStationMarketData (system, station, maxAge, services) {
  try {
    const maxAgeHours = parseInt(maxAge)
    const cutoffTime = new Date(Date.now() - (maxAgeHours * 60 * 60 * 1000))

    const marketData = await services.marketData.aggregate([
      {
        $match: {
          system,
          station,
          timestamp: { $gte: cutoffTime }
        }
      },
      {
        $sort: { timestamp: -1 }
      },
      {
        $group: {
          _id: '$commodity',
          latestData: { $first: '$$ROOT' }
        }
      },
      {
        $replaceRoot: { newRoot: '$latestData' }
      }
    ])

    return {
      data: marketData,
      lastUpdated: marketData.length > 0 ? marketData[0].timestamp : null,
      recordCount: marketData.length
    }
  } catch (error) {
    logger.error('Station market data query error', { error: error.message })
    throw error
  }
}

async function fetchStationCommodities (system, station, filterCommodities, services) {
  try {
    const filter = { system, station }

    if (filterCommodities) {
      const commodityList = filterCommodities.split(',').map(c => c.trim())
      filter.commodity = { $in: commodityList }
    }

    const commodities = await services.marketData.find(filter).sort({ timestamp: -1 })

    // Group by commodity to get latest entry for each
    const latestCommodities = {}
    commodities.forEach(item => {
      if (!latestCommodities[item.commodity] ||
          item.timestamp > latestCommodities[item.commodity].timestamp) {
        latestCommodities[item.commodity] = item
      }
    })

    return Object.values(latestCommodities)
  } catch (error) {
    logger.error('Station commodities fetch error', { error: error.message })
    throw error
  }
}

async function enrichCommodityData (commodityData, station, services) {
  try {
    return commodityData.map(commodity => {
      const ageHours = (Date.now() - new Date(commodity.timestamp)) / (1000 * 60 * 60)

      return {
        commodity: commodity.commodity,
        buyPrice: commodity.buyPrice || 0,
        sellPrice: commodity.sellPrice || 0,
        supply: commodity.supply || 0,
        demand: commodity.demand || 0,
        supplyLevel: commodity.supplyLevel || 'Unknown',
        demandLevel: commodity.demandLevel || 'Unknown',
        timestamp: commodity.timestamp,
        age: {
          hours: Math.round(ageHours * 10) / 10,
          freshness: ageHours < 1
            ? 'Very Fresh'
            : ageHours < 6
              ? 'Fresh'
              : ageHours < 24 ? 'Moderate' : 'Stale'
        },
        availability: {
          canBuy: commodity.buyPrice > 0 && commodity.supply > 0,
          canSell: commodity.sellPrice > 0 && commodity.demand > 0
        }
      }
    })
  } catch (error) {
    logger.error('Commodity data enrichment error', { error: error.message })
    throw error
  }
}

async function fetchStationInformation (system, station, includeServices, includeShipyard, includeOutfitting, services) {
  try {
    // Fetch basic station info from database
    const stationInfo = await services.marketData.findOne({
      system,
      station
    }, {
      projection: {
        stationType: 1,
        economy: 1,
        government: 1,
        allegiance: 1,
        landingPadSize: 1,
        distanceFromStar: 1
      }
    })

    const info = {
      name: station,
      system,
      type: stationInfo?.stationType || 'Unknown',
      economy: stationInfo?.economy || 'Unknown',
      government: stationInfo?.government || 'Unknown',
      allegiance: stationInfo?.allegiance || 'Unknown',
      landingPads: {
        large: stationInfo?.landingPadSize === 'L' || stationInfo?.landingPadSize === 'Mixed',
        medium: stationInfo?.landingPadSize !== 'S',
        small: true
      },
      distanceFromStar: stationInfo?.distanceFromStar || null
    }

    // Add services if requested
    if (includeServices) {
      info.services = await fetchStationServices(system, station, services)
    }

    // Add shipyard if requested
    if (includeShipyard) {
      info.shipyard = await fetchStationShipyard(system, station, services)
    }

    // Add outfitting if requested
    if (includeOutfitting) {
      info.outfitting = await fetchStationOutfitting(system, station, services)
    }

    return info
  } catch (error) {
    logger.error('Station information fetch error', { error: error.message })
    return {
      name: station,
      system,
      type: 'Unknown',
      error: 'Failed to fetch station information'
    }
  }
}

async function fetchStationServices (system, station, services) {
  try {
    // This would typically query a stations/services collection
    // For now, return basic services that most stations have
    return {
      commodityMarket: true,
      blackMarket: false,
      repair: true,
      refuel: true,
      rearm: true,
      outfitting: true,
      shipyard: false,
      material_trader: false,
      technology_broker: false,
      universal_cartographics: true,
      search_and_rescue: false
    }
  } catch (error) {
    logger.error('Station services fetch error', { error: error.message })
    return {}
  }
}

async function fetchStationShipyard (system, station, services) {
  try {
    // Query shipyard data if available
    return {
      available: false,
      ships: [],
      lastUpdated: null
    }
  } catch (error) {
    logger.error('Station shipyard fetch error', { error: error.message })
    return { available: false, error: 'Failed to fetch shipyard data' }
  }
}

async function fetchStationOutfitting (system, station, services) {
  try {
    // Query outfitting data if available
    return {
      available: true,
      modules: [],
      lastUpdated: null
    }
  } catch (error) {
    logger.error('Station outfitting fetch error', { error: error.message })
    return { available: false, error: 'Failed to fetch outfitting data' }
  }
}

async function calculateStationProfitOpportunities (commodities, system, station, minProfit, services) {
  try {
    const profitable = []
    const unprofitable = []

    for (const commodity of commodities) {
      if (commodity.availability.canBuy && commodity.availability.canSell) {
        const profit = commodity.sellPrice - commodity.buyPrice
        const profitMargin = profit / commodity.buyPrice * 100

        const analysis = {
          commodity: commodity.commodity,
          buyPrice: commodity.buyPrice,
          sellPrice: commodity.sellPrice,
          profit,
          profitMargin: Math.round(profitMargin * 100) / 100,
          supply: commodity.supply,
          demand: commodity.demand,
          recommendation: profit >= minProfit ? 'Buy' : 'Hold'
        }

        if (profit >= minProfit) {
          profitable.push(analysis)
        } else {
          unprofitable.push(analysis)
        }
      }
    }

    // Sort by profit descending
    profitable.sort((a, b) => b.profit - a.profit)

    return {
      profitable,
      unprofitable: unprofitable.slice(0, 10), // Limit unprofitable display
      summary: {
        totalOpportunities: profitable.length,
        bestProfit: profitable.length > 0 ? profitable[0].profit : 0,
        averageProfit: profitable.length > 0
          ? profitable.reduce((sum, item) => sum + item.profit, 0) / profitable.length
          : 0
      }
    }
  } catch (error) {
    logger.error('Profit opportunities calculation error', { error: error.message })
    return null
  }
}

async function compareWithNearbyStations (system, station, commodities, services) {
  try {
    // Find nearby stations in the same system first
    const nearbyStations = await services.marketData.distinct('station', {
      system,
      station: { $ne: station }
    })

    if (nearbyStations.length === 0) {
      return {
        comparisons: [],
        summary: 'No other stations found in system for comparison'
      }
    }

    const comparisons = []

    for (const commodity of commodities.slice(0, 10)) { // Limit to top 10 commodities
      const comparison = {
        commodity: commodity.commodity,
        currentStation: {
          station,
          buyPrice: commodity.buyPrice,
          sellPrice: commodity.sellPrice
        },
        nearbyStations: []
      }

      // Get prices from nearby stations
      for (const nearbyStation of nearbyStations.slice(0, 5)) { // Max 5 nearby stations
        const nearbyData = await services.marketData.findOne({
          system,
          station: nearbyStation,
          commodity: commodity.commodity
        }, {
          sort: { timestamp: -1 }
        })

        if (nearbyData) {
          comparison.nearbyStations.push({
            station: nearbyStation,
            buyPrice: nearbyData.buyPrice || 0,
            sellPrice: nearbyData.sellPrice || 0,
            buyPriceDifference: (nearbyData.buyPrice || 0) - commodity.buyPrice,
            sellPriceDifference: (nearbyData.sellPrice || 0) - commodity.sellPrice
          })
        }
      }

      if (comparison.nearbyStations.length > 0) {
        comparisons.push(comparison)
      }
    }

    return {
      comparisons,
      summary: `Compared with ${nearbyStations.length} nearby stations in ${system}`
    }
  } catch (error) {
    logger.error('Nearby stations comparison error', { error: error.message })
    return null
  }
}

function calculateMarketDataFreshness (marketData, commodities, maxAge) {
  try {
    const now = Date.now()
    const maxAgeMs = parseInt(maxAge) * 60 * 60 * 1000

    let totalAge = 0
    let staleCount = 0
    const issues = []

    commodities.forEach(commodity => {
      const age = now - new Date(commodity.timestamp)
      totalAge += age

      if (age > maxAgeMs) {
        staleCount++
      }
    })

    const averageAge = commodities.length > 0 ? totalAge / commodities.length / (1000 * 60 * 60) : 0
    const stalePercentage = commodities.length > 0 ? (staleCount / commodities.length) * 100 : 0

    let score = 100
    if (stalePercentage > 50) {
      score -= 30
      issues.push('More than 50% of data is stale')
    } else if (stalePercentage > 25) {
      score -= 15
      issues.push('More than 25% of data is stale')
    }

    if (averageAge > 24) {
      score -= 20
      issues.push('Average data age exceeds 24 hours')
    }

    if (commodities.length < 50) {
      score -= 10
      issues.push('Limited commodity coverage')
    }

    return {
      score: Math.max(score, 0),
      averageAge: Math.round(averageAge * 10) / 10,
      staleCount,
      totalCount: commodities.length,
      stalePercentage: Math.round(stalePercentage * 10) / 10,
      coverage: commodities.length > 0 ? '100%' : '0%',
      issues: issues.length > 0 ? issues : ['No issues detected']
    }
  } catch (error) {
    logger.error('Market data freshness calculation error', { error: error.message })
    return {
      score: 0,
      averageAge: 0,
      issues: ['Failed to calculate freshness indicators']
    }
  }
}

function sortStationCommodities (commodities, sortBy) {
  try {
    switch (sortBy) {
      case 'profit_desc':
        return commodities.sort((a, b) => {
          const profitA = (a.sellPrice || 0) - (a.buyPrice || 0)
          const profitB = (b.sellPrice || 0) - (b.buyPrice || 0)
          return profitB - profitA
        })

      case 'profit_asc':
        return commodities.sort((a, b) => {
          const profitA = (a.sellPrice || 0) - (a.buyPrice || 0)
          const profitB = (b.sellPrice || 0) - (b.buyPrice || 0)
          return profitA - profitB
        })

      case 'price_desc':
        return commodities.sort((a, b) => (b.sellPrice || 0) - (a.sellPrice || 0))

      case 'price_asc':
        return commodities.sort((a, b) => (a.sellPrice || 0) - (b.sellPrice || 0))

      case 'name_asc':
        return commodities.sort((a, b) => a.commodity.localeCompare(b.commodity))

      case 'age_asc':
        return commodities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))

      case 'supply_desc':
        return commodities.sort((a, b) => (b.supply || 0) - (a.supply || 0))

      case 'demand_desc':
        return commodities.sort((a, b) => (b.demand || 0) - (a.demand || 0))

      default:
        return commodities.sort((a, b) => {
          const profitA = (a.sellPrice || 0) - (a.buyPrice || 0)
          const profitB = (b.sellPrice || 0) - (b.buyPrice || 0)
          return profitB - profitA
        })
    }
  } catch (error) {
    logger.error('Commodity sorting error', { error: error.message })
    return commodities
  }
}

function sendStationCSVResponse (res, data) {
  try {
    const csvHeaders = [
      'Commodity',
      'Buy Price',
      'Sell Price',
      'Profit',
      'Supply',
      'Demand',
      'Supply Level',
      'Demand Level',
      'Age (Hours)',
      'Freshness',
      'Can Buy',
      'Can Sell'
    ]

    let csvContent = csvHeaders.join(',') + '\n'

    data.data.market.commodities.forEach(commodity => {
      const profit = (commodity.sellPrice || 0) - (commodity.buyPrice || 0)
      const row = [
        commodity.commodity,
        commodity.buyPrice || 0,
        commodity.sellPrice || 0,
        profit,
        commodity.supply || 0,
        commodity.demand || 0,
        commodity.supplyLevel || 'Unknown',
        commodity.demandLevel || 'Unknown',
        commodity.age.hours,
        commodity.age.freshness,
        commodity.availability.canBuy,
        commodity.availability.canSell
      ]
      csvContent += row.join(',') + '\n'
    })

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition',
      `attachment; filename="station_market_${data.request.system}_${data.request.station}_${new Date().toISOString().split('T')[0]}.csv"`)

    res.send(csvContent)
  } catch (error) {
    logger.error('CSV export error', { error: error.message })
    res.status(500).json({
      error: 'Failed to generate CSV export',
      message: error.message
    })
  }
}

module.exports = router
