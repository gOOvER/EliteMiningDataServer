const express = require('express')
const router = express.Router()
const logger = require('../services/logger')

// Get server status and statistics
router.get('/', async (req, res) => {
  try {
    const database = req.app.locals.database

    // Get database statistics
    const [
      systemCount,
      stationCount,
      commodityCount,
      miningReportCount,
      miningSiteCount,
    ] = await Promise.all([
      database.getQuery('SELECT COUNT(*) as count FROM systems'),
      database.getQuery('SELECT COUNT(*) as count FROM stations'),
      database.getQuery(
        'SELECT COUNT(DISTINCT commodity_name) as count FROM commodity_prices'
      ),
      database.getQuery('SELECT COUNT(*) as count FROM mining_reports'),
      database.getQuery('SELECT COUNT(*) as count FROM mining_sites'),
    ])

    // Get recent activity
    const recentActivity = await database.allQuery(`
      SELECT 'mining_report' as type, timestamp as last_activity, source
      FROM mining_reports 
      ORDER BY timestamp DESC 
      LIMIT 5
    `)

    // Get data freshness
    const dataFreshness = await database.allQuery(`
      SELECT 
        'commodity_prices' as table_name,
        COUNT(*) as total_records,
        MAX(last_updated) as latest_update,
        MIN(last_updated) as oldest_update
      FROM commodity_prices
      WHERE last_updated > datetime('now', '-24 hours')
      
      UNION ALL
      
      SELECT 
        'mining_reports' as table_name,
        COUNT(*) as total_records,
        MAX(timestamp) as latest_update,
        MIN(timestamp) as oldest_update
      FROM mining_reports
      WHERE timestamp > datetime('now', '-24 hours')
    `)

    const status = {
      server: {
        status: 'online',
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
      },

      database: {
        connected: true,
        systems: systemCount.count,
        stations: stationCount.count,
        commodities: commodityCount.count,
        miningReports: miningReportCount.count,
        miningSites: miningSiteCount.count,
      },

      dataSources: {
        eddn: {
          status: 'connected', // This would be updated by EDDN client
          lastMessage: null,
        },
        inara: {
          status: req.app.locals.inaraClient ? 'available' : 'not configured',
          apiKey: req.app.locals.inaraClient ? 'configured' : 'missing',
        },
        edsm: {
          status: req.app.locals.edsmClient ? 'available' : 'not configured',
          apiKey: req.app.locals.edsmClient?.apiKey
            ? 'configured'
            : 'not configured',
        },
      },

      recentActivity,
      dataFreshness,

      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        external: Math.round(process.memoryUsage().external / 1024 / 1024),
      },
    }

    res.json(status)
  } catch (error) {
    logger.error('Error fetching server status:', error)
    res.status(500).json({
      server: {
        status: 'error',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      },
      error: 'Failed to fetch complete status',
    })
  }
})

// Get EDDN statistics
router.get('/eddn', async (req, res) => {
  try {
    // This would get statistics from the EDDN client
    // For now, return placeholder data
    res.json({
      status: 'connected',
      relay: 'tcp://eddn.edcd.io:9500',
      messagesReceived: 0,
      miningMessagesFiltered: 0,
      uptime: 0,
      messagesPerSecond: 0,
      lastMessage: null,
    })
  } catch (error) {
    logger.error('Error fetching EDDN status:', error)
    res.status(500).json({ error: 'Failed to fetch EDDN status' })
  }
})

// Get API endpoints documentation
router.get('/endpoints', (req, res) => {
  const endpoints = {
    description: 'Elite Dangerous Mining Data Server API Endpoints',
    version: '1.0.0',
    baseUrl: `${req.protocol}://${req.get('host')}/api`,

    endpoints: {
      status: {
        'GET /status': 'Get server status and statistics',
        'GET /status/eddn': 'Get EDDN connection status',
        'GET /status/endpoints': 'Get this endpoints documentation',
      },

      mining: {
        'GET /mining/sites/:systemName': 'Get mining sites in a system',
        'GET /mining/reports':
          'Get recent mining reports (query: limit, system, material)',
        'GET /mining/stats': 'Get mining statistics',
        'GET /mining/opportunities/:systemName':
          'Find mining opportunities near system (query: radius)',
        'GET /mining/hotspots': 'Get hotspot information (query: material)',
      },

      systems: {
        'GET /systems/:systemName': 'Get system information',
        'GET /systems/search/:searchTerm':
          'Search systems by name (query: limit)',
        'GET /systems/:systemName/nearby': 'Get nearby systems (query: radius)',
        'GET /systems/:system1/distance/:system2':
          'Calculate distance between systems',
        'GET /systems/:systemName/stations': 'Get stations in system',
      },

      commodities: {
        'GET /commodities/:commodityName/sell':
          'Get best sell prices (query: limit)',
        'GET /commodities/:commodityName/buy':
          'Get best buy prices (query: limit)',
        'GET /commodities/:commodityName/prices':
          'Get all prices for commodity',
        'GET /commodities/mining/overview': 'Get mining commodities overview',
        'GET /commodities/:commodityName/history':
          'Get price history (query: days, station, system)',
        'GET /commodities/search/:searchTerm':
          'Search commodities (query: limit)',
        'GET /commodities/station/:stationName/:systemName':
          'Get station market data',
      },
    },

    websocket: {
      url: `ws://${req.get('host')}`,
      description: 'WebSocket connection for real-time data',
      channels: [
        'mining - Mining-related data from EDDN',
        'eddn - All EDDN data',
        'commodities - Commodity price updates',
      ],

      messageTypes: {
        subscribe: { type: 'subscribe', channel: 'channel_name' },
        unsubscribe: { type: 'unsubscribe', channel: 'channel_name' },
        ping: { type: 'ping' },
      },
    },
  }

  res.json(endpoints)
})

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    pid: process.pid,
  })
})

module.exports = router
