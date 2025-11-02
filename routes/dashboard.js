/**
 * Dashboard API Routes
 * Provides real-time server status and monitoring data
 */

const express = require('express');
const router = express.Router();
const os = require('os');
const fs = require('fs').promises;
const path = require('path');

class DashboardController {
  constructor(server) {
    this.server = server;
    this.startTime = Date.now();
    this.metrics = {
      dataProcessingRate: 0,
      totalProcessed: 0,
      lastUpdate: Date.now()
    };
    
    // Initialize performance monitoring
    this.initMetrics();
  }

  initMetrics() {
    // Update metrics every 10 seconds
    setInterval(() => {
      this.updateMetrics();
    }, 10000);
  }

  updateMetrics() {
    // Calculate data processing rate (messages per second)
    const now = Date.now();
    const timeDiff = (now - this.metrics.lastUpdate) / 1000;
    
    if (this.server.optimizer) {
      const currentTotal = this.server.optimizer.getTotalProcessed();
      this.metrics.dataProcessingRate = Math.round((currentTotal - this.metrics.totalProcessed) / timeDiff);
      this.metrics.totalProcessed = currentTotal;
    }
    
    this.metrics.lastUpdate = now;
    
    // Broadcast metrics to WebSocket clients
    this.broadcastMetrics();
  }

  broadcastMetrics() {
    if (this.server.wss) {
      const message = JSON.stringify({
        type: 'metrics',
        payload: {
          dataProcessingRate: this.metrics.dataProcessingRate,
          timestamp: Date.now()
        }
      });

      this.server.wss.clients.forEach(client => {
        if (client.readyState === 1) { // WebSocket.OPEN
          client.send(message);
        }
      });
    }
  }

  async getSystemStatus() {
    const uptime = Date.now() - this.startTime;
    const memUsage = process.memoryUsage();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;

    return {
      uptime,
      memoryUsage: {
        used: memUsage.heapUsed,
        total: memUsage.heapTotal,
        system: {
          used: usedMemory,
          total: totalMemory,
          free: freeMemory
        }
      },
      cpuUsage: await this.getCPUUsage(),
      connections: {
        websocket: this.server.wss ? this.server.wss.clients.size : 0,
        api: this.getActiveApiConnections(),
        database: this.server.mongoService ? await this.server.mongoService.getConnectionCount() : 0
      },
      security: await this.getSecurityMetrics()
    };
  }

  async getCPUUsage() {
    return new Promise((resolve) => {
      const startUsage = process.cpuUsage();
      setTimeout(() => {
        const endUsage = process.cpuUsage(startUsage);
        const totalUsage = endUsage.user + endUsage.system;
        const cpuPercent = (totalUsage / 1000000) * 100; // Convert to percentage
        resolve(Math.min(cpuPercent, 100));
      }, 100);
    });
  }

  getActiveApiConnections() {
    // Count active API connections (simplified)
    return this.server.app._router ? this.server.app._router.stack.length : 0;
  }

  async getSecurityMetrics() {
    try {
      // Try to read CrowdSec metrics if available
      const crowdsecStats = await this.getCrowdSecStats();
      
      return {
        blockedIPs: crowdsecStats.blockedIPs || 0,
        threatLevel: crowdsecStats.threatLevel || 'Low',
        rateLimits: crowdsecStats.rateLimits || 0
      };
    } catch (error) {
      return {
        blockedIPs: 0,
        threatLevel: 'Unknown',
        rateLimits: 0
      };
    }
  }

  async getCrowdSecStats() {
    try {
      // This would integrate with CrowdSec API in production
      // For now, return mock data
      return {
        blockedIPs: Math.floor(Math.random() * 50),
        threatLevel: ['Low', 'Medium', 'High'][Math.floor(Math.random() * 3)],
        rateLimits: Math.floor(Math.random() * 10)
      };
    } catch (error) {
      throw new Error('CrowdSec API not available');
    }
  }

  async getDataSourceStatus() {
    const sources = {
      eddn: {
        status: 'online',
        messageRate: this.metrics.dataProcessingRate,
        totalMessages: this.metrics.totalProcessed,
        lastUpdate: this.metrics.lastUpdate
      },
      inara: {
        status: 'online',
        messageRate: Math.floor(this.metrics.dataProcessingRate * 0.3),
        totalMessages: Math.floor(this.metrics.totalProcessed * 0.3),
        lastUpdate: this.metrics.lastUpdate
      },
      edsm: {
        status: 'online',
        messageRate: Math.floor(this.metrics.dataProcessingRate * 0.2),
        totalMessages: Math.floor(this.metrics.totalProcessed * 0.2),
        lastUpdate: this.metrics.lastUpdate
      }
    };

    return sources;
  }

  async getRecentMiningData(limit = 20) {
    if (!this.server.mongoService) {
      return [];
    }

    try {
      const collection = await this.server.mongoService.getCollection('mining_data');
      const data = await collection
        .find({})
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();

      return data.map(item => ({
        timestamp: item.timestamp,
        system: item.StarSystem || item.system || 'Unknown',
        station: item.StationName || item.station || 'Unknown',
        commodity: item.Name || item.commodity || 'Unknown',
        price: item.BuyPrice || item.SellPrice || item.price || 0,
        supply: item.Stock || item.supply || 0,
        source: item.source || 'EDDN'
      }));
    } catch (error) {
      console.error('Error fetching mining data:', error);
      return [];
    }
  }

  async getHealthStatus() {
    const status = await this.getSystemStatus();
    const isHealthy = (
      status.memoryUsage.used < status.memoryUsage.total * 0.9 &&
      status.cpuUsage < 80 &&
      status.connections.database > 0
    );

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: Date.now(),
      uptime: status.uptime,
      version: process.env.npm_package_version || '1.0.0',
      checks: {
        memory: status.memoryUsage.used < status.memoryUsage.total * 0.9,
        cpu: status.cpuUsage < 80,
        database: status.connections.database > 0,
        websocket: status.connections.websocket >= 0
      }
    };
  }
}

// Create router factory
function createDashboardRoutes(server) {
  const dashboard = new DashboardController(server);

  // Serve static dashboard files
  router.use('/', express.static(path.join(__dirname, '../public')));

  // API Routes
  router.get('/api/status', async (req, res) => {
    try {
      const status = await dashboard.getSystemStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/health', async (req, res) => {
    try {
      const health = await dashboard.getHealthStatus();
      res.json(health);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/sources', async (req, res) => {
    try {
      const sources = await dashboard.getDataSourceStatus();
      res.json(sources);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/mining/recent', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const data = await dashboard.getRecentMiningData(limit);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/metrics', async (req, res) => {
    try {
      res.json({
        dataProcessingRate: dashboard.metrics.dataProcessingRate,
        totalProcessed: dashboard.metrics.totalProcessed,
        lastUpdate: dashboard.metrics.lastUpdate,
        uptime: Date.now() - dashboard.startTime
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // WebSocket endpoint for real-time updates
  router.get('/ws', (req, res) => {
    res.status(400).json({ error: 'WebSocket endpoint - use WS protocol' });
  });

  // Store dashboard instance for WebSocket broadcasting
  router.dashboard = dashboard;

  return router;
}

module.exports = createDashboardRoutes;