require('dotenv').config()

const Server = require('./server')
const logger = require('./services/logger')

// Configuration
const config = {
  port: process.env.PORT || 3000,

  database: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
    dbName: process.env.MONGODB_DB_NAME || 'elite_mining',
    maxConnections: process.env.MONGODB_MAX_CONNECTIONS || 100,
    cacheTimeout: (process.env.CACHE_DURATION_MINUTES || 15) * 60 * 1000
  },

  eddn: {
    relayUrl: process.env.EDDN_RELAY_URL || 'tcp://eddn.edcd.io:9500',
    reconnectInterval: process.env.EDDN_RECONNECT_INTERVAL || 30000
  },

  inara: {
    apiUrl: process.env.INARA_API_URL || 'https://inara.cz/inapi/v1/',
    apiKey: process.env.INARA_API_KEY,
    appName: process.env.INARA_APP_NAME || 'EliteMiningDataServer',
    appVersion: process.env.INARA_APP_VERSION || '1.0.0'
  },

  edsm: {
    apiUrl: process.env.EDSM_API_URL || 'https://www.edsm.net/api-v1/',
    apiKey: process.env.EDSM_API_KEY
  },

  wsHeartbeatInterval: process.env.WS_HEARTBEAT_INTERVAL || 30000,

  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://localhost:3001']
}

// Create and start server
async function startServer () {
  try {
    logger.info('Starting Elite Mining Data Server...')
    logger.info(`Node.js version: ${process.version}`)
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`)

    const server = new Server(config)

    // Initialize server components
    await server.initialize()

    // Start HTTP server
    await server.start()

    logger.info('Elite Mining Data Server started successfully')
    logger.info('Available endpoints:')
    logger.info(`  Health Check: http://localhost:${config.port}/health`)
    logger.info(`  API Status: http://localhost:${config.port}/api/status`)
    logger.info(`  API Documentation: http://localhost:${config.port}/api/status/endpoints`)
    logger.info(`  WebSocket: ws://localhost:${config.port}`)

    // Log configuration (without sensitive data)
    logger.info('Configuration:')
    logger.info(`  Port: ${config.port}`)
    logger.info(`  Database: ${config.database.dbPath}`)
    logger.info(`  EDDN Relay: ${config.eddn.relayUrl}`)
    logger.info(`  Inara API: ${config.inara.apiKey ? 'Configured' : 'Not configured'}`)
    logger.info(`  EDSM API: ${config.edsm.apiKey ? 'Configured' : 'Not configured'}`)

    // Graceful shutdown handling
    const shutdownHandler = async (signal) => {
      logger.info(`Received ${signal}, shutting down gracefully...`)

      try {
        await server.stop()
        logger.info('Server stopped successfully')
        process.exit(0)
      } catch (error) {
        logger.error('Error during shutdown:', error)
        process.exit(1)
      }
    }

    process.on('SIGTERM', () => shutdownHandler('SIGTERM'))
    process.on('SIGINT', () => shutdownHandler('SIGINT'))

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error)
      process.exit(1)
    })

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason)
      process.exit(1)
    })
  } catch (error) {
    logger.error('Failed to start server:', error)
    process.exit(1)
  }
}

// Start the server
if (require.main === module) {
  startServer()
}

module.exports = { startServer, config }
