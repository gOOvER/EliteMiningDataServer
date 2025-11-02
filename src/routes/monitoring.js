/**
 * Monitoring Routes
 * Comprehensive monitoring endpoints for health checks, metrics, errors, and alerts
 */

const express = require('express')
const router = express.Router()
const HealthCheckService = require('../services/healthCheckService')
const PerformanceMetricsService = require('../services/performanceMetricsService')
const ErrorTrackingService = require('../services/errorTrackingService')
const AlertingSystem = require('../services/alertingSystem')

// Initialize services
const healthCheck = new HealthCheckService()
const performanceMetrics = new PerformanceMetricsService()
const errorTracking = new ErrorTrackingService()
const alerting = new AlertingSystem();

// Initialize services
(async () => {
  await healthCheck.initialize?.()
  await errorTracking.initialize()
  await alerting.initialize()
  performanceMetrics.startCollection()
})()

// Middleware to track request metrics
router.use((req, res, next) => {
  const startTime = Date.now()

  res.on('finish', () => {
    const responseTime = Date.now() - startTime
    const size = parseInt(res.get('Content-Length') || '0')

    performanceMetrics.recordRequest(
      req.route?.path || req.path,
      req.method,
      res.statusCode,
      responseTime,
      size
    )
  })

  next()
})

/**
 * @swagger
 * /monitoring/health:
 *   get:
 *     summary: Get comprehensive health status
 *     description: Returns detailed health information for all system components
 *     tags:
 *       - Monitoring
 *     responses:
 *       200:
 *         description: Health check results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [healthy, degraded, unhealthy]
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: object
 *                 checks:
 *                   type: object
 *                 system:
 *                   type: object
 */
router.get('/health', async (req, res) => {
  try {
    const healthStatus = await healthCheck.performHealthCheck()

    const statusCode = healthStatus.status === 'healthy'
      ? 200
      : healthStatus.status === 'degraded' ? 200 : 503

    res.status(statusCode).json({
      success: true,
      data: healthStatus,
      metadata: {
        source: 'health_check',
        processingTime: Date.now() - req.startTime,
        timestamp: new Date().toISOString()
      }
    })
  } catch (error) {
    await errorTracking.trackError(error, {
      type: 'HEALTH_CHECK_ERROR',
      endpoint: '/monitoring/health',
      method: req.method
    })

    res.status(500).json({
      success: false,
      error: 'HEALTH_CHECK_FAILED',
      message: 'Health check failed',
      timestamp: new Date().toISOString()
    })
  }
})

/**
 * @swagger
 * /monitoring/health/history:
 *   get:
 *     summary: Get health check history
 *     description: Returns historical health check data
 *     tags:
 *       - Monitoring
 */
router.get('/health/history', async (req, res) => {
  try {
    const history = healthCheck.getHealthHistory()

    res.json({
      success: true,
      data: {
        history,
        totalEntries: history.length
      },
      metadata: {
        source: 'health_history',
        processingTime: Date.now() - req.startTime,
        timestamp: new Date().toISOString()
      }
    })
  } catch (error) {
    await errorTracking.trackError(error, {
      type: 'HEALTH_HISTORY_ERROR',
      endpoint: '/monitoring/health/history',
      method: req.method
    })

    res.status(500).json({
      success: false,
      error: 'HEALTH_HISTORY_FAILED',
      message: 'Failed to retrieve health history',
      timestamp: new Date().toISOString()
    })
  }
})

/**
 * @swagger
 * /monitoring/metrics:
 *   get:
 *     summary: Get performance metrics
 *     description: Returns comprehensive performance metrics and statistics
 *     tags:
 *       - Monitoring
 *     parameters:
 *       - in: query
 *         name: timeRange
 *         schema:
 *           type: string
 *           enum: [1h, 6h, 24h, 7d]
 *           default: 1h
 *         description: Time range for metrics
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, prometheus]
 *           default: json
 *         description: Response format
 */
router.get('/metrics', async (req, res) => {
  try {
    const timeRange = req.query.timeRange || '1h'
    const format = req.query.format || 'json'

    if (format === 'prometheus') {
      const metricsData = performanceMetrics.exportMetrics('prometheus')
      res.set('Content-Type', 'text/plain')
      res.send(metricsData)
      return
    }

    const report = performanceMetrics.getPerformanceReport(timeRange)

    res.json({
      success: true,
      data: report,
      metadata: {
        source: 'performance_metrics',
        processingTime: Date.now() - req.startTime,
        timestamp: new Date().toISOString()
      }
    })
  } catch (error) {
    await errorTracking.trackError(error, {
      type: 'METRICS_ERROR',
      endpoint: '/monitoring/metrics',
      method: req.method
    })

    res.status(500).json({
      success: false,
      error: 'METRICS_FAILED',
      message: 'Failed to retrieve metrics',
      timestamp: new Date().toISOString()
    })
  }
})

/**
 * @swagger
 * /monitoring/errors:
 *   get:
 *     summary: Get error statistics
 *     description: Returns comprehensive error tracking statistics
 *     tags:
 *       - Monitoring
 *     parameters:
 *       - in: query
 *         name: timeRange
 *         schema:
 *           type: string
 *           enum: [1h, 6h, 24h, 7d]
 *           default: 24h
 *         description: Time range for error statistics
 *       - in: query
 *         name: severity
 *         schema:
 *           type: string
 *           enum: [critical, high, medium, low]
 *         description: Filter by error severity
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by error type
 */
router.get('/errors', async (req, res) => {
  try {
    const timeRange = req.query.timeRange || '24h'
    const errorStats = errorTracking.getErrorStatistics(timeRange)

    // Apply filters if provided
    if (req.query.severity || req.query.type) {
      const filters = {}
      if (req.query.severity) filters.severity = req.query.severity
      if (req.query.type) filters.type = req.query.type

      errorStats.filteredErrors = errorTracking.searchErrors(filters)
    }

    res.json({
      success: true,
      data: errorStats,
      metadata: {
        source: 'error_tracking',
        processingTime: Date.now() - req.startTime,
        timestamp: new Date().toISOString()
      }
    })
  } catch (error) {
    await errorTracking.trackError(error, {
      type: 'ERROR_STATS_ERROR',
      endpoint: '/monitoring/errors',
      method: req.method
    })

    res.status(500).json({
      success: false,
      error: 'ERROR_STATS_FAILED',
      message: 'Failed to retrieve error statistics',
      timestamp: new Date().toISOString()
    })
  }
})

/**
 * @swagger
 * /monitoring/errors/{errorId}:
 *   get:
 *     summary: Get specific error details
 *     description: Returns detailed information about a specific error
 *     tags:
 *       - Monitoring
 *     parameters:
 *       - in: path
 *         name: errorId
 *         required: true
 *         schema:
 *           type: string
 *         description: Error ID
 */
router.get('/errors/:errorId', async (req, res) => {
  try {
    const errorDetails = errorTracking.getErrorDetails(req.params.errorId)

    if (!errorDetails) {
      return res.status(404).json({
        success: false,
        error: 'ERROR_NOT_FOUND',
        message: 'Error not found',
        timestamp: new Date().toISOString()
      })
    }

    res.json({
      success: true,
      data: errorDetails,
      metadata: {
        source: 'error_tracking',
        processingTime: Date.now() - req.startTime,
        timestamp: new Date().toISOString()
      }
    })
  } catch (error) {
    await errorTracking.trackError(error, {
      type: 'ERROR_DETAIL_ERROR',
      endpoint: `/monitoring/errors/${req.params.errorId}`,
      method: req.method
    })

    res.status(500).json({
      success: false,
      error: 'ERROR_DETAIL_FAILED',
      message: 'Failed to retrieve error details',
      timestamp: new Date().toISOString()
    })
  }
})

/**
 * @swagger
 * /monitoring/errors/{errorId}/resolve:
 *   post:
 *     summary: Mark error as resolved
 *     description: Mark a specific error as resolved with optional resolution note
 *     tags:
 *       - Monitoring
 *     parameters:
 *       - in: path
 *         name: errorId
 *         required: true
 *         schema:
 *           type: string
 *         description: Error ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               resolution:
 *                 type: string
 *                 description: Resolution note
 *               resolvedBy:
 *                 type: string
 *                 description: Who resolved the error
 */
router.post('/errors/:errorId/resolve', async (req, res) => {
  try {
    const { resolution = '', resolvedBy = 'user' } = req.body
    const success = errorTracking.resolveError(req.params.errorId, resolution)

    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'ERROR_NOT_FOUND',
        message: 'Error not found or already resolved',
        timestamp: new Date().toISOString()
      })
    }

    res.json({
      success: true,
      data: {
        errorId: req.params.errorId,
        resolved: true,
        resolution,
        resolvedBy,
        resolvedAt: new Date().toISOString()
      },
      metadata: {
        source: 'error_tracking',
        processingTime: Date.now() - req.startTime,
        timestamp: new Date().toISOString()
      }
    })
  } catch (error) {
    await errorTracking.trackError(error, {
      type: 'ERROR_RESOLVE_ERROR',
      endpoint: `/monitoring/errors/${req.params.errorId}/resolve`,
      method: req.method
    })

    res.status(500).json({
      success: false,
      error: 'ERROR_RESOLVE_FAILED',
      message: 'Failed to resolve error',
      timestamp: new Date().toISOString()
    })
  }
})

/**
 * @swagger
 * /monitoring/alerts:
 *   get:
 *     summary: Get alerts
 *     description: Returns active alerts and alert statistics
 *     tags:
 *       - Monitoring
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, resolved, all]
 *           default: active
 *         description: Filter alerts by status
 *       - in: query
 *         name: severity
 *         schema:
 *           type: string
 *           enum: [critical, high, warning, medium, low]
 *         description: Filter by alert severity
 */
router.get('/alerts', async (req, res) => {
  try {
    const status = req.query.status || 'active'
    let alerts

    if (status === 'active') {
      alerts = alerting.getActiveAlerts()
    } else {
      // Would implement getting all alerts or resolved alerts
      alerts = alerting.getActiveAlerts()
    }

    // Apply severity filter if provided
    if (req.query.severity) {
      alerts = alerts.filter(alert => alert.severity === req.query.severity)
    }

    const statistics = alerting.getAlertStatistics()

    res.json({
      success: true,
      data: {
        alerts,
        statistics,
        filters: {
          status: req.query.status,
          severity: req.query.severity
        }
      },
      metadata: {
        source: 'alerting_system',
        processingTime: Date.now() - req.startTime,
        timestamp: new Date().toISOString()
      }
    })
  } catch (error) {
    await errorTracking.trackError(error, {
      type: 'ALERTS_ERROR',
      endpoint: '/monitoring/alerts',
      method: req.method
    })

    res.status(500).json({
      success: false,
      error: 'ALERTS_FAILED',
      message: 'Failed to retrieve alerts',
      timestamp: new Date().toISOString()
    })
  }
})

/**
 * @swagger
 * /monitoring/alerts/{alertId}/acknowledge:
 *   post:
 *     summary: Acknowledge alert
 *     description: Mark an alert as acknowledged
 *     tags:
 *       - Monitoring
 *     parameters:
 *       - in: path
 *         name: alertId
 *         required: true
 *         schema:
 *           type: string
 *         description: Alert ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               acknowledgedBy:
 *                 type: string
 *                 description: Who acknowledged the alert
 */
router.post('/alerts/:alertId/acknowledge', async (req, res) => {
  try {
    const { acknowledgedBy = 'user' } = req.body
    const success = alerting.acknowledgeAlert(req.params.alertId, acknowledgedBy)

    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'ALERT_NOT_FOUND',
        message: 'Alert not found or already acknowledged',
        timestamp: new Date().toISOString()
      })
    }

    res.json({
      success: true,
      data: {
        alertId: req.params.alertId,
        acknowledged: true,
        acknowledgedBy,
        acknowledgedAt: new Date().toISOString()
      },
      metadata: {
        source: 'alerting_system',
        processingTime: Date.now() - req.startTime,
        timestamp: new Date().toISOString()
      }
    })
  } catch (error) {
    await errorTracking.trackError(error, {
      type: 'ALERT_ACKNOWLEDGE_ERROR',
      endpoint: `/monitoring/alerts/${req.params.alertId}/acknowledge`,
      method: req.method
    })

    res.status(500).json({
      success: false,
      error: 'ALERT_ACKNOWLEDGE_FAILED',
      message: 'Failed to acknowledge alert',
      timestamp: new Date().toISOString()
    })
  }
})

/**
 * @swagger
 * /monitoring/alerts/{alertId}/resolve:
 *   post:
 *     summary: Resolve alert
 *     description: Mark an alert as resolved
 *     tags:
 *       - Monitoring
 *     parameters:
 *       - in: path
 *         name: alertId
 *         required: true
 *         schema:
 *           type: string
 *         description: Alert ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               resolvedBy:
 *                 type: string
 *                 description: Who resolved the alert
 *               resolution:
 *                 type: string
 *                 description: Resolution note
 */
router.post('/alerts/:alertId/resolve', async (req, res) => {
  try {
    const { resolvedBy = 'user', resolution = '' } = req.body
    const success = alerting.resolveAlert(req.params.alertId, resolvedBy, resolution)

    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'ALERT_NOT_FOUND',
        message: 'Alert not found or already resolved',
        timestamp: new Date().toISOString()
      })
    }

    res.json({
      success: true,
      data: {
        alertId: req.params.alertId,
        resolved: true,
        resolvedBy,
        resolution,
        resolvedAt: new Date().toISOString()
      },
      metadata: {
        source: 'alerting_system',
        processingTime: Date.now() - req.startTime,
        timestamp: new Date().toISOString()
      }
    })
  } catch (error) {
    await errorTracking.trackError(error, {
      type: 'ALERT_RESOLVE_ERROR',
      endpoint: `/monitoring/alerts/${req.params.alertId}/resolve`,
      method: req.method
    })

    res.status(500).json({
      success: false,
      error: 'ALERT_RESOLVE_FAILED',
      message: 'Failed to resolve alert',
      timestamp: new Date().toISOString()
    })
  }
})

/**
 * @swagger
 * /monitoring/alerts/test/{channel}:
 *   post:
 *     summary: Test notification channel
 *     description: Send a test alert to verify notification channel configuration
 *     tags:
 *       - Monitoring
 *     parameters:
 *       - in: path
 *         name: channel
 *         required: true
 *         schema:
 *           type: string
 *         description: Notification channel name
 */
router.post('/alerts/test/:channel', async (req, res) => {
  try {
    const channelName = req.params.channel
    const success = await alerting.testNotificationChannel(channelName)

    res.json({
      success: true,
      data: {
        channel: channelName,
        testResult: success,
        message: success ? 'Test notification sent successfully' : 'Test notification failed'
      },
      metadata: {
        source: 'alerting_system',
        processingTime: Date.now() - req.startTime,
        timestamp: new Date().toISOString()
      }
    })
  } catch (error) {
    await errorTracking.trackError(error, {
      type: 'ALERT_TEST_ERROR',
      endpoint: `/monitoring/alerts/test/${req.params.channel}`,
      method: req.method
    })

    res.status(500).json({
      success: false,
      error: 'ALERT_TEST_FAILED',
      message: error.message,
      timestamp: new Date().toISOString()
    })
  }
})

/**
 * @swagger
 * /monitoring/dashboard:
 *   get:
 *     summary: Get monitoring dashboard data
 *     description: Returns comprehensive monitoring dashboard with all key metrics
 *     tags:
 *       - Monitoring
 */
router.get('/dashboard', async (req, res) => {
  try {
    const [
      healthStatus,
      performanceReport,
      errorStats,
      alertStats
    ] = await Promise.all([
      healthCheck.performHealthCheck(),
      Promise.resolve(performanceMetrics.getPerformanceReport('1h')),
      Promise.resolve(errorTracking.getErrorStatistics('24h')),
      Promise.resolve(alerting.getAlertStatistics('24h'))
    ])

    const dashboard = {
      overview: {
        systemHealth: healthStatus.status,
        activeAlerts: alertStats.active,
        errorRate: errorStats.summary.errorRate,
        averageResponseTime: performanceReport.summary.averageResponseTime,
        uptime: healthStatus.uptime,
        lastUpdated: new Date().toISOString()
      },
      health: {
        status: healthStatus.status,
        checks: healthStatus.checks,
        summary: healthStatus.summary
      },
      performance: {
        summary: performanceReport.summary,
        system: performanceReport.system,
        trends: performanceReport.trends
      },
      errors: {
        summary: errorStats.summary,
        topErrors: errorStats.topErrors.slice(0, 5),
        patterns: errorStats.patterns.slice(0, 5)
      },
      alerts: {
        active: alertStats.active,
        total: alertStats.total,
        bySeverity: alertStats.bySeverity,
        recentAlerts: alerting.getActiveAlerts().slice(0, 5)
      }
    }

    res.json({
      success: true,
      data: dashboard,
      metadata: {
        source: 'monitoring_dashboard',
        processingTime: Date.now() - req.startTime,
        timestamp: new Date().toISOString()
      }
    })
  } catch (error) {
    await errorTracking.trackError(error, {
      type: 'DASHBOARD_ERROR',
      endpoint: '/monitoring/dashboard',
      method: req.method
    })

    res.status(500).json({
      success: false,
      error: 'DASHBOARD_FAILED',
      message: 'Failed to retrieve dashboard data',
      timestamp: new Date().toISOString()
    })
  }
})

// Setup real-time monitoring integrations
performanceMetrics.on('alert', async (alert) => {
  await alerting.checkAlertRules(alert, 'performance')
})

errorTracking.on('error', async (error) => {
  await alerting.checkAlertRules(error, 'error')
})

// Periodic health checks and alerting
setInterval(async () => {
  try {
    const healthStatus = await healthCheck.performHealthCheck()
    await alerting.checkAlertRules(healthStatus, 'health')
  } catch (error) {
    console.error('Periodic health check failed:', error)
  }
}, 60000) // Every minute

// Cleanup old data periodically
setInterval(() => {
  errorTracking.clearOldErrors()
  alerting.cleanupOldAlerts()
}, 24 * 60 * 60 * 1000) // Daily cleanup

// Export services for external use
router.healthCheck = healthCheck
router.performanceMetrics = performanceMetrics
router.errorTracking = errorTracking
router.alerting = alerting

module.exports = router
