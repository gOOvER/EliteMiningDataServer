/**
 * Alerting System
 * Comprehensive alerting and notification management
 */

const EventEmitter = require('events')
const nodemailer = require('nodemailer')
const fs = require('fs').promises
const path = require('path')

class AlertingSystem extends EventEmitter {
  constructor () {
    super()
    this.alerts = new Map()
    this.alertHistory = []
    this.alertRules = new Map()
    this.notificationChannels = new Map()
    this.alertQueue = []
    this.isProcessing = false
    this.maxHistoryEntries = 1000
    this.rateLimitWindow = 5 * 60 * 1000 // 5 minutes
    this.maxAlertsPerWindow = 10
    this.setupDefaultRules()
  }

  /**
     * Initialize alerting system
     */
  async initialize () {
    try {
      await this.setupNotificationChannels()
      this.startAlertProcessing()
      console.log('Alerting system initialized')
    } catch (error) {
      console.error('Failed to initialize alerting system:', error)
    }
  }

  /**
     * Setup default alert rules
     */
  setupDefaultRules () {
    const defaultRules = [
      {
        id: 'high_error_rate',
        name: 'High Error Rate',
        description: 'Alert when error rate exceeds threshold',
        condition: (metrics) => {
          const errorRate = metrics.errorRate || 0
          return errorRate > 5 // 5 errors per minute
        },
        severity: 'warning',
        channels: ['email', 'webhook'],
        cooldown: 10 * 60 * 1000, // 10 minutes
        enabled: true
      },
      {
        id: 'critical_error',
        name: 'Critical Error',
        description: 'Alert on any critical error',
        condition: (error) => {
          return error.severity === 'critical'
        },
        severity: 'critical',
        channels: ['email', 'webhook', 'sms'],
        cooldown: 0, // No cooldown for critical errors
        enabled: true
      },
      {
        id: 'high_response_time',
        name: 'High Response Time',
        description: 'Alert when response time is consistently high',
        condition: (metrics) => {
          const avgResponseTime = metrics.averageResponseTime || 0
          return avgResponseTime > 2000 // 2 seconds
        },
        severity: 'warning',
        channels: ['email'],
        cooldown: 15 * 60 * 1000, // 15 minutes
        enabled: true
      },
      {
        id: 'memory_usage_high',
        name: 'High Memory Usage',
        description: 'Alert when memory usage is high',
        condition: (metrics) => {
          const memoryUsage = metrics.memoryUsagePercent || 0
          return memoryUsage > 85
        },
        severity: 'warning',
        channels: ['email', 'webhook'],
        cooldown: 5 * 60 * 1000, // 5 minutes
        enabled: true
      },
      {
        id: 'memory_usage_critical',
        name: 'Critical Memory Usage',
        description: 'Alert when memory usage is critical',
        condition: (metrics) => {
          const memoryUsage = metrics.memoryUsagePercent || 0
          return memoryUsage > 95
        },
        severity: 'critical',
        channels: ['email', 'webhook', 'sms'],
        cooldown: 0,
        enabled: true
      },
      {
        id: 'service_down',
        name: 'Service Down',
        description: 'Alert when critical service is down',
        condition: (healthCheck) => {
          return healthCheck.status === 'unhealthy'
        },
        severity: 'critical',
        channels: ['email', 'webhook', 'sms'],
        cooldown: 0,
        enabled: true
      },
      {
        id: 'database_connection_error',
        name: 'Database Connection Error',
        description: 'Alert when database connection fails',
        condition: (healthCheck) => {
          return healthCheck.checks &&
                           healthCheck.checks.database &&
                           healthCheck.checks.database.status === 'unhealthy'
        },
        severity: 'critical',
        channels: ['email', 'webhook'],
        cooldown: 2 * 60 * 1000, // 2 minutes
        enabled: true
      },
      {
        id: 'external_api_degraded',
        name: 'External API Degraded',
        description: 'Alert when external APIs are degraded',
        condition: (healthCheck) => {
          return healthCheck.checks &&
                           healthCheck.checks.externalApis &&
                           healthCheck.checks.externalApis.status === 'degraded'
        },
        severity: 'warning',
        channels: ['email'],
        cooldown: 30 * 60 * 1000, // 30 minutes
        enabled: true
      }
    ]

    defaultRules.forEach(rule => {
      this.alertRules.set(rule.id, {
        ...rule,
        lastTriggered: 0,
        triggerCount: 0
      })
    })
  }

  /**
     * Setup notification channels
     */
  async setupNotificationChannels () {
    // Email channel
    if (process.env.SMTP_HOST) {
      const emailTransporter = nodemailer.createTransporter({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      })

      this.notificationChannels.set('email', {
        type: 'email',
        transporter: emailTransporter,
        from: process.env.SMTP_FROM || 'alerts@elitemining.com',
        to: process.env.ALERT_EMAIL_TO || 'admin@elitemining.com',
        enabled: true
      })
    }

    // Webhook channel
    if (process.env.WEBHOOK_URL) {
      this.notificationChannels.set('webhook', {
        type: 'webhook',
        url: process.env.WEBHOOK_URL,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: process.env.WEBHOOK_AUTH || ''
        },
        enabled: true
      })
    }

    // Slack channel
    if (process.env.SLACK_WEBHOOK_URL) {
      this.notificationChannels.set('slack', {
        type: 'slack',
        url: process.env.SLACK_WEBHOOK_URL,
        channel: process.env.SLACK_CHANNEL || '#alerts',
        username: process.env.SLACK_USERNAME || 'EliteMining Bot',
        enabled: true
      })
    }

    // Discord channel
    if (process.env.DISCORD_WEBHOOK_URL) {
      this.notificationChannels.set('discord', {
        type: 'discord',
        url: process.env.DISCORD_WEBHOOK_URL,
        username: process.env.DISCORD_USERNAME || 'EliteMining Bot',
        enabled: true
      })
    }

    // SMS channel (example with Twilio)
    if (process.env.TWILIO_ACCOUNT_SID) {
      this.notificationChannels.set('sms', {
        type: 'sms',
        accountSid: process.env.TWILIO_ACCOUNT_SID,
        authToken: process.env.TWILIO_AUTH_TOKEN,
        from: process.env.TWILIO_FROM,
        to: process.env.TWILIO_TO,
        enabled: true
      })
    }

    // Console channel (always available)
    this.notificationChannels.set('console', {
      type: 'console',
      enabled: true
    })
  }

  /**
     * Trigger alert based on data
     */
  async triggerAlert (alertData, source = 'manual') {
    const alertId = this.generateAlertId(alertData)
    const timestamp = Date.now()

    // Check rate limiting
    if (!this.isWithinRateLimit()) {
      console.warn('Alert rate limit exceeded, queuing alert')
      this.alertQueue.push({ alertData, source, timestamp })
      return null
    }

    const alert = {
      id: alertId,
      timestamp,
      source,
      severity: alertData.severity || 'warning',
      title: alertData.title || 'Alert',
      message: alertData.message || 'An alert was triggered',
      type: alertData.type || 'general',
      data: alertData.data || {},
      channels: alertData.channels || ['console'],
      status: 'active',
      acknowledged: false,
      resolved: false,
      acknowledgedBy: null,
      acknowledgedAt: null,
      resolvedBy: null,
      resolvedAt: null,
      notificationsSent: [],
      retryCount: 0,
      maxRetries: 3
    }

    // Store alert
    this.alerts.set(alertId, alert)
    this.alertHistory.push({ ...alert })

    // Limit history size
    if (this.alertHistory.length > this.maxHistoryEntries) {
      this.alertHistory = this.alertHistory.slice(-this.maxHistoryEntries)
    }

    // Send notifications
    await this.sendNotifications(alert)

    // Emit alert event
    this.emit('alert', alert)

    return alertId
  }

  /**
     * Check alert rules against data
     */
  async checkAlertRules (data, dataType) {
    const triggeredAlerts = []

    for (const [ruleId, rule] of this.alertRules) {
      if (!rule.enabled) continue

      // Check cooldown
      const now = Date.now()
      if (rule.lastTriggered && (now - rule.lastTriggered) < rule.cooldown) {
        continue
      }

      try {
        // Evaluate rule condition
        if (rule.condition(data)) {
          const alertData = {
            title: rule.name,
            message: this.generateAlertMessage(rule, data),
            severity: rule.severity,
            type: rule.id,
            channels: rule.channels,
            data: {
              rule: ruleId,
              dataType,
              triggeredData: data,
              triggerCount: rule.triggerCount + 1
            }
          }

          const alertId = await this.triggerAlert(alertData, 'rule')
          if (alertId) {
            rule.lastTriggered = now
            rule.triggerCount++
            triggeredAlerts.push(alertId)
          }
        }
      } catch (error) {
        console.error(`Error evaluating alert rule ${ruleId}:`, error)
      }
    }

    return triggeredAlerts
  }

  /**
     * Generate alert message based on rule and data
     */
  generateAlertMessage (rule, data) {
    const messages = {
      high_error_rate: `Error rate is ${data.errorRate || 0} errors/minute (threshold: 5)`,
      critical_error: `Critical error occurred: ${data.message || 'Unknown error'}`,
      high_response_time: `Average response time is ${data.averageResponseTime || 0}ms (threshold: 2000ms)`,
      memory_usage_high: `Memory usage is ${data.memoryUsagePercent || 0}% (threshold: 85%)`,
      memory_usage_critical: `Memory usage is critical at ${data.memoryUsagePercent || 0}% (threshold: 95%)`,
      service_down: `Service health check failed: ${data.status || 'Unknown'}`,
      database_connection_error: `Database connection failed: ${data.checks?.database?.message || 'Connection error'}`,
      external_api_degraded: `External APIs are degraded: ${data.checks?.externalApis?.message || 'Performance degraded'}`
    }

    return messages[rule.id] || rule.description
  }

  /**
     * Send notifications for alert
     */
  async sendNotifications (alert) {
    const notifications = []

    for (const channelName of alert.channels) {
      const channel = this.notificationChannels.get(channelName)
      if (!channel || !channel.enabled) continue

      try {
        const success = await this.sendNotification(channel, alert)
        notifications.push({
          channel: channelName,
          success,
          timestamp: Date.now(),
          error: success ? null : 'Failed to send notification'
        })
      } catch (error) {
        notifications.push({
          channel: channelName,
          success: false,
          timestamp: Date.now(),
          error: error.message
        })
      }
    }

    alert.notificationsSent = notifications
    return notifications
  }

  /**
     * Send notification to specific channel
     */
  async sendNotification (channel, alert) {
    switch (channel.type) {
      case 'email':
        return await this.sendEmailNotification(channel, alert)
      case 'webhook':
        return await this.sendWebhookNotification(channel, alert)
      case 'slack':
        return await this.sendSlackNotification(channel, alert)
      case 'discord':
        return await this.sendDiscordNotification(channel, alert)
      case 'sms':
        return await this.sendSMSNotification(channel, alert)
      case 'console':
        return this.sendConsoleNotification(channel, alert)
      default:
        console.warn(`Unknown notification channel type: ${channel.type}`)
        return false
    }
  }

  /**
     * Send email notification
     */
  async sendEmailNotification (channel, alert) {
    try {
      const subject = `[${alert.severity.toUpperCase()}] ${alert.title}`
      const html = this.generateEmailHTML(alert)

      await channel.transporter.sendMail({
        from: channel.from,
        to: channel.to,
        subject,
        html
      })

      return true
    } catch (error) {
      console.error('Failed to send email notification:', error)
      return false
    }
  }

  /**
     * Send webhook notification
     */
  async sendWebhookNotification (channel, alert) {
    try {
      const payload = {
        alert_id: alert.id,
        timestamp: new Date(alert.timestamp).toISOString(),
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        type: alert.type,
        source: alert.source,
        data: alert.data
      }

      const response = await fetch(channel.url, {
        method: channel.method,
        headers: channel.headers,
        body: JSON.stringify(payload),
        timeout: 10000
      })

      return response.ok
    } catch (error) {
      console.error('Failed to send webhook notification:', error)
      return false
    }
  }

  /**
     * Send Slack notification
     */
  async sendSlackNotification (channel, alert) {
    try {
      const color = this.getSeverityColor(alert.severity)
      const payload = {
        channel: channel.channel,
        username: channel.username,
        attachments: [{
          color,
          title: alert.title,
          text: alert.message,
          fields: [
            {
              title: 'Severity',
              value: alert.severity.toUpperCase(),
              short: true
            },
            {
              title: 'Time',
              value: new Date(alert.timestamp).toISOString(),
              short: true
            },
            {
              title: 'Alert ID',
              value: alert.id,
              short: true
            }
          ],
          footer: 'Elite Mining Data Server',
          ts: Math.floor(alert.timestamp / 1000)
        }]
      }

      const response = await fetch(channel.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout: 10000
      })

      return response.ok
    } catch (error) {
      console.error('Failed to send Slack notification:', error)
      return false
    }
  }

  /**
     * Send Discord notification
     */
  async sendDiscordNotification (channel, alert) {
    try {
      const color = this.getSeverityColorCode(alert.severity)
      const payload = {
        username: channel.username,
        embeds: [{
          title: alert.title,
          description: alert.message,
          color,
          fields: [
            {
              name: 'Severity',
              value: alert.severity.toUpperCase(),
              inline: true
            },
            {
              name: 'Alert ID',
              value: alert.id,
              inline: true
            }
          ],
          timestamp: new Date(alert.timestamp).toISOString(),
          footer: {
            text: 'Elite Mining Data Server'
          }
        }]
      }

      const response = await fetch(channel.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout: 10000
      })

      return response.ok
    } catch (error) {
      console.error('Failed to send Discord notification:', error)
      return false
    }
  }

  /**
     * Send SMS notification
     */
  async sendSMSNotification (channel, alert) {
    try {
      // This would use Twilio or similar SMS service
      const message = `[${alert.severity.toUpperCase()}] ${alert.title}: ${alert.message}`

      // Placeholder for SMS implementation
      console.log(`SMS would be sent: ${message}`)
      return true
    } catch (error) {
      console.error('Failed to send SMS notification:', error)
      return false
    }
  }

  /**
     * Send console notification
     */
  sendConsoleNotification (channel, alert) {
    const timestamp = new Date(alert.timestamp).toISOString()
    const severityLabel = `[${alert.severity.toUpperCase()}]`
    console.log(`${timestamp} ${severityLabel} ALERT: ${alert.title} - ${alert.message}`)
    return true
  }

  /**
     * Generate email HTML template
     */
  generateEmailHTML (alert) {
    const severityColor = this.getSeverityColor(alert.severity)

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; }
                .alert-header { background-color: ${severityColor}; color: white; padding: 20px; }
                .alert-content { padding: 20px; }
                .alert-details { background-color: #f5f5f5; padding: 15px; margin: 10px 0; }
                .severity-${alert.severity} { border-left: 5px solid ${severityColor}; }
            </style>
        </head>
        <body>
            <div class="alert-header">
                <h2>${alert.title}</h2>
                <p>Severity: ${alert.severity.toUpperCase()}</p>
            </div>
            <div class="alert-content severity-${alert.severity}">
                <p><strong>Message:</strong> ${alert.message}</p>
                <div class="alert-details">
                    <p><strong>Alert ID:</strong> ${alert.id}</p>
                    <p><strong>Time:</strong> ${new Date(alert.timestamp).toISOString()}</p>
                    <p><strong>Source:</strong> ${alert.source}</p>
                    ${alert.data && Object.keys(alert.data).length > 0
                      ? `<p><strong>Additional Data:</strong> ${JSON.stringify(alert.data, null, 2)}</p>`
                      : ''}
                </div>
            </div>
        </body>
        </html>
        `
  }

  /**
     * Get severity color for notifications
     */
  getSeverityColor (severity) {
    const colors = {
      critical: '#dc3545',
      high: '#fd7e14',
      warning: '#ffc107',
      medium: '#17a2b8',
      low: '#28a745',
      info: '#6c757d'
    }
    return colors[severity] || colors.info
  }

  /**
     * Get severity color code for Discord
     */
  getSeverityColorCode (severity) {
    const colors = {
      critical: 0xdc3545,
      high: 0xfd7e14,
      warning: 0xffc107,
      medium: 0x17a2b8,
      low: 0x28a745,
      info: 0x6c757d
    }
    return colors[severity] || colors.info
  }

  /**
     * Acknowledge alert
     */
  acknowledgeAlert (alertId, acknowledgedBy = 'system') {
    const alert = this.alerts.get(alertId)
    if (alert && !alert.acknowledged) {
      alert.acknowledged = true
      alert.acknowledgedBy = acknowledgedBy
      alert.acknowledgedAt = Date.now()

      this.emit('alertAcknowledged', { alertId, acknowledgedBy })
      return true
    }
    return false
  }

  /**
     * Resolve alert
     */
  resolveAlert (alertId, resolvedBy = 'system', resolution = '') {
    const alert = this.alerts.get(alertId)
    if (alert && !alert.resolved) {
      alert.resolved = true
      alert.resolvedBy = resolvedBy
      alert.resolvedAt = Date.now()
      alert.resolution = resolution
      alert.status = 'resolved'

      this.emit('alertResolved', { alertId, resolvedBy, resolution })
      return true
    }
    return false
  }

  /**
     * Get active alerts
     */
  getActiveAlerts () {
    return Array.from(this.alerts.values())
      .filter(alert => !alert.resolved)
      .sort((a, b) => {
        // Sort by severity first, then by timestamp
        const severityOrder = { critical: 4, high: 3, warning: 2, medium: 1, low: 0 }
        const severityDiff = (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0)
        if (severityDiff !== 0) return severityDiff
        return b.timestamp - a.timestamp
      })
  }

  /**
     * Get alert statistics
     */
  getAlertStatistics (timeRange = '24h') {
    const now = Date.now()
    const timeRanges = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000
    }

    const rangeMs = timeRanges[timeRange] || timeRanges['24h']
    const cutoff = now - rangeMs

    const recentAlerts = this.alertHistory.filter(alert => alert.timestamp >= cutoff)

    const stats = {
      timeRange,
      total: recentAlerts.length,
      active: this.getActiveAlerts().length,
      resolved: recentAlerts.filter(alert => alert.resolved).length,
      acknowledged: recentAlerts.filter(alert => alert.acknowledged).length,
      bySeverity: {},
      byType: {},
      bySource: {},
      avgResolutionTime: 0,
      alertRate: recentAlerts.length / (rangeMs / (60 * 60 * 1000)) // alerts per hour
    }

    // Calculate breakdowns
    recentAlerts.forEach(alert => {
      stats.bySeverity[alert.severity] = (stats.bySeverity[alert.severity] || 0) + 1
      stats.byType[alert.type] = (stats.byType[alert.type] || 0) + 1
      stats.bySource[alert.source] = (stats.bySource[alert.source] || 0) + 1
    })

    // Calculate average resolution time
    const resolvedAlerts = recentAlerts.filter(alert => alert.resolved && alert.resolvedAt)
    if (resolvedAlerts.length > 0) {
      const totalResolutionTime = resolvedAlerts.reduce((sum, alert) => {
        return sum + (alert.resolvedAt - alert.timestamp)
      }, 0)
      stats.avgResolutionTime = Math.round(totalResolutionTime / resolvedAlerts.length / 1000) // seconds
    }

    return stats
  }

  /**
     * Check rate limiting
     */
  isWithinRateLimit () {
    const now = Date.now()
    const cutoff = now - this.rateLimitWindow
    const recentAlerts = this.alertHistory.filter(alert => alert.timestamp >= cutoff)
    return recentAlerts.length < this.maxAlertsPerWindow
  }

  /**
     * Start alert processing
     */
  startAlertProcessing () {
    setInterval(() => {
      this.processAlertQueue()
    }, 30000) // Process queue every 30 seconds
  }

  /**
     * Process queued alerts
     */
  async processAlertQueue () {
    if (this.isProcessing || this.alertQueue.length === 0) return

    this.isProcessing = true

    try {
      while (this.alertQueue.length > 0 && this.isWithinRateLimit()) {
        const queuedAlert = this.alertQueue.shift()
        await this.triggerAlert(queuedAlert.alertData, queuedAlert.source)
      }
    } catch (error) {
      console.error('Error processing alert queue:', error)
    } finally {
      this.isProcessing = false
    }
  }

  /**
     * Generate unique alert ID
     */
  generateAlertId (alertData) {
    const timestamp = Date.now()
    const randomSuffix = Math.random().toString(36).substring(2, 8)
    return `alert_${timestamp}_${randomSuffix}`
  }

  /**
     * Add custom alert rule
     */
  addAlertRule (rule) {
    if (!rule.id || !rule.condition) {
      throw new Error('Alert rule must have id and condition')
    }

    this.alertRules.set(rule.id, {
      name: rule.name || rule.id,
      description: rule.description || '',
      condition: rule.condition,
      severity: rule.severity || 'warning',
      channels: rule.channels || ['console'],
      cooldown: rule.cooldown || 5 * 60 * 1000,
      enabled: rule.enabled !== false,
      lastTriggered: 0,
      triggerCount: 0,
      ...rule
    })
  }

  /**
     * Remove alert rule
     */
  removeAlertRule (ruleId) {
    return this.alertRules.delete(ruleId)
  }

  /**
     * Update notification channel
     */
  updateNotificationChannel (channelName, config) {
    const existingChannel = this.notificationChannels.get(channelName)
    if (existingChannel) {
      this.notificationChannels.set(channelName, { ...existingChannel, ...config })
    } else {
      this.notificationChannels.set(channelName, config)
    }
  }

  /**
     * Test notification channel
     */
  async testNotificationChannel (channelName) {
    const channel = this.notificationChannels.get(channelName)
    if (!channel) {
      throw new Error(`Notification channel '${channelName}' not found`)
    }

    const testAlert = {
      id: 'test_alert',
      timestamp: Date.now(),
      severity: 'info',
      title: 'Test Alert',
      message: 'This is a test alert to verify notification channel configuration',
      type: 'test',
      channels: [channelName],
      source: 'test'
    }

    return await this.sendNotification(channel, testAlert)
  }

  /**
     * Cleanup old alerts
     */
  cleanupOldAlerts (maxAge = 30 * 24 * 60 * 60 * 1000) { // 30 days
    const cutoff = Date.now() - maxAge
    let cleaned = 0

    for (const [alertId, alert] of this.alerts) {
      if (alert.timestamp < cutoff && alert.resolved) {
        this.alerts.delete(alertId)
        cleaned++
      }
    }

    this.alertHistory = this.alertHistory.filter(alert => alert.timestamp >= cutoff)

    console.log(`Cleaned up ${cleaned} old alerts`)
    return cleaned
  }

  /**
     * Export alert data
     */
  exportAlerts (format = 'json') {
    const data = {
      activeAlerts: this.getActiveAlerts(),
      statistics: this.getAlertStatistics(),
      rules: Array.from(this.alertRules.values()),
      exportedAt: new Date().toISOString()
    }

    if (format === 'csv') {
      return this.toCsvFormat(data)
    }

    return data
  }

  /**
     * Convert to CSV format
     */
  toCsvFormat (data) {
    const rows = ['timestamp,severity,title,message,status,acknowledgedBy,resolvedBy']

    data.activeAlerts.forEach(alert => {
      const row = [
        new Date(alert.timestamp).toISOString(),
        alert.severity,
                `"${alert.title.replace(/"/g, '""')}"`,
                `"${alert.message.replace(/"/g, '""')}"`,
                alert.status,
                alert.acknowledgedBy || '',
                alert.resolvedBy || ''
      ].join(',')
      rows.push(row)
    })

    return rows.join('\n')
  }

  /**
     * Cleanup resources
     */
  cleanup () {
    this.removeAllListeners()
    this.alerts.clear()
    this.alertHistory = []
    this.alertQueue = []
    console.log('Alerting system cleaned up')
  }
}

module.exports = AlertingSystem
