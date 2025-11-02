const winston = require('winston')
const path = require('path')
const fs = require('fs')

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs')
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true })
}

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
)

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`
    }
    return log
  })
)

// Create logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'elite-mining-server' },
  transports: [
    // File transport for errors
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      format: logFormat
    }),

    // File transport for all logs
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      format: logFormat
    })
  ]
})

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat
  }))
}

// Add request logging middleware
logger.requestLogger = (req, res, next) => {
  const start = Date.now()

  res.on('finish', () => {
    const duration = Date.now() - start
    const message = `${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`

    if (res.statusCode >= 400) {
      logger.warn(message, {
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        duration,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      })
    } else {
      logger.info(message, {
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        duration
      })
    }
  })

  next()
}

// Add performance monitoring
logger.performance = {
  start: (label) => {
    return {
      label,
      startTime: Date.now(),
      end: function () {
        const duration = Date.now() - this.startTime
        logger.info(`Performance: ${this.label} completed in ${duration}ms`)
        return duration
      }
    }
  }
}

// Add data source specific loggers
logger.eddn = {
  info: (message, meta) => logger.info(`[EDDN] ${message}`, meta),
  warn: (message, meta) => logger.warn(`[EDDN] ${message}`, meta),
  error: (message, meta) => logger.error(`[EDDN] ${message}`, meta)
}

logger.inara = {
  info: (message, meta) => logger.info(`[INARA] ${message}`, meta),
  warn: (message, meta) => logger.warn(`[INARA] ${message}`, meta),
  error: (message, meta) => logger.error(`[INARA] ${message}`, meta)
}

logger.edsm = {
  info: (message, meta) => logger.info(`[EDSM] ${message}`, meta),
  warn: (message, meta) => logger.warn(`[EDSM] ${message}`, meta),
  error: (message, meta) => logger.error(`[EDSM] ${message}`, meta)
}

module.exports = logger
