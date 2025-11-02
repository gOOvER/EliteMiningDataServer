const express = require('express')
const router = express.Router()
const logger = require('../services/logger')
const StatisticsService = require('../services/statisticsService')

// Global StatisticsService instance - will be initialized when MongoDB is available
let statisticsService = null

// Middleware to ensure StatisticsService is available
const ensureStatisticsService = (req, res, next) => {
  if (!statisticsService && req.app.locals.mongoService) {
    statisticsService = new StatisticsService(req.app.locals.mongoService)
  }

  if (!statisticsService) {
    return res.status(503).json({
      error: 'Statistics service unavailable',
      message: 'Database connection required'
    })
  }

  next()
}

/**
 * Statistics Routes - Server and data statistics endpoints
 * Provides insights into data collection, processing, and server performance
 */

// Global statistics overview
router.get('/', ensureStatisticsService, async (req, res) => {
  try {
    logger.info('Global statistics requested')

    const stats = await statisticsService.getGlobalStatistics()

    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Error fetching global statistics:', error)
    res.status(500).json({
      error: 'Failed to fetch statistics',
      message: error.message
    })
  }
})

// EDDN statistics
router.get('/eddn', ensureStatisticsService, async (req, res) => {
  try {
    logger.info('EDDN statistics requested')

    const stats = await statisticsService.getEDDNStatistics()

    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Error fetching EDDN statistics:', error)
    res.status(500).json({
      error: 'Failed to fetch EDDN statistics',
      message: error.message
    })
  }
})

// Mining statistics
router.get('/mining', ensureStatisticsService, async (req, res) => {
  try {
    logger.info('Mining statistics requested')

    const stats = await statisticsService.getMiningStatistics()

    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Error fetching mining statistics:', error)
    res.status(500).json({
      error: 'Failed to fetch mining statistics',
      message: error.message
    })
  }
})

// API usage statistics
router.get('/api-usage', ensureStatisticsService, async (req, res) => {
  try {
    logger.info('API usage statistics requested')

    const stats = await statisticsService.getAPIUsageStatistics()

    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Error fetching API usage statistics:', error)
    res.status(500).json({
      error: 'Failed to fetch API usage statistics',
      message: error.message
    })
  }
})

// WebSocket statistics
router.get('/websocket', ensureStatisticsService, async (req, res) => {
  try {
    logger.info('WebSocket statistics requested')

    const stats = await statisticsService.getWebSocketStatistics()

    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Error fetching WebSocket statistics:', error)
    res.status(500).json({
      error: 'Failed to fetch WebSocket statistics',
      message: error.message
    })
  }
})

// Real-time dashboard data
router.get('/dashboard', ensureStatisticsService, async (req, res) => {
  try {
    logger.info('Dashboard statistics requested')

    // Get essential statistics for dashboard
    const [globalStats, eddnStats, miningStats] = await Promise.all([
      statisticsService.getGlobalStatistics(),
      statisticsService.getEDDNStatistics(),
      statisticsService.getMiningStatistics()
    ])

    const dashboardData = {
      server: globalStats.server,
      overview: {
        totalSystems: globalStats.data.totalSystems,
        totalStations: globalStats.data.totalStations,
        totalMiningLocations: globalStats.data.totalMiningLocations,
        eddnMessagesToday: eddnStats.messages.today,
        connectionStatus: eddnStats.connection.status
      },
      activity: globalStats.activity,
      performance: globalStats.performance,
      mining: {
        totalLocations: miningStats.locations.total,
        topCommodity: miningStats.analysis.topCommodity,
        avgProfitability: miningStats.analysis.avgProfitability
      }
    }

    res.json({
      success: true,
      data: dashboardData,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Error fetching dashboard statistics:', error)
    res.status(500).json({
      error: 'Failed to fetch dashboard statistics',
      message: error.message
    })
  }
})

// Health metrics for monitoring
router.get('/health-metrics', ensureStatisticsService, async (req, res) => {
  try {
    logger.info('Health metrics requested')

    const metrics = {
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        nodeVersion: process.version
      },
      database: {
        connected: req.app.locals.mongoService ? req.app.locals.mongoService.isConnected() : false,
        responseTime: await statisticsService.measureDatabaseResponseTime()
      },
      services: {
        eddn: await statisticsService.getServiceHealth('eddn'),
        websocket: await statisticsService.getServiceHealth('websocket')
      },
      timestamp: new Date().toISOString()
    }

    res.json({
      success: true,
      data: metrics,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Error fetching health metrics:', error)
    res.status(500).json({
      error: 'Failed to fetch health metrics',
      message: error.message
    })
  }
})

module.exports = router
