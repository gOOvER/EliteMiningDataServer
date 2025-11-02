#!/usr/bin/env node

/**
 * Elite Dangerous Mining Data Server
 * Optimized version with enhanced API clients based on official documentation
 * 
 * Features:
 * - EDDN live stream processing with enhanced filtering
 * - Inara API integration with 70+ endpoints
 * - EDSM API for system coordinates and mining locations
 * - MongoDB with optimized schemas for big data
 * - Real-time WebSocket updates
 * - Mining opportunity analysis
 * - Performance monitoring
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const MiningDataOptimizer = require('./services/miningOptimizer');
const MongoService = require('./services/mongoService');
const logger = require('./services/logger');

// Import optimized API routes
const miningRoutes = require('./routes/mining');
const systemRoutes = require('./routes/systems');
const marketRoutes = require('./routes/market');
const statsRoutes = require('./routes/stats');
const createDashboardRoutes = require('./routes/dashboard');

class EliteMiningDataServer {
  constructor() {
    this.app = express();
    this.server = null;
    this.wss = null;
    this.optimizer = null;
    this.mongoService = null;
    
    this.config = {
      port: process.env.PORT || 3000,
      mongoUrl: process.env.MONGODB_URL || 'mongodb://localhost:27017/elite-mining',
      
      // API configurations based on official documentation
      eddn: {
        relayUrl: 'tcp://eddn.edcd.io:9500',
        reconnectInterval: 30000
      },
      
      inara: {
        appName: 'EliteMiningDataServer',
        appVersion: '2.0.0',
        apiKey: process.env.INARA_API_KEY,
        isDeveloper: process.env.NODE_ENV === 'development',
        commanderName: process.env.COMMANDER_NAME,
        commanderFID: process.env.COMMANDER_FID
      },
      
      edsm: {
        commanderName: process.env.COMMANDER_NAME,
        apiKey: process.env.EDSM_API_KEY
      },
      
      mongodb: {
        url: process.env.MONGODB_URL || 'mongodb://localhost:27017/elite-mining',
        options: {
          useNewUrlParser: true,
          useUnifiedTopology: true,
          maxPoolSize: 100,
          serverSelectionTimeoutMS: 5000,
          socketTimeoutMS: 45000,
          family: 4
        }
      }
    };
  }

  async initialize() {
    logger.info('Initializing Elite Mining Data Server v2.0...');
    
    try {
      // Initialize MongoDB service
      this.mongoService = new MongoService(this.config.mongodb);
      await this.mongoService.connect();
      logger.info('MongoDB connection established');
      
      // Initialize mining data optimizer with enhanced API clients
      this.optimizer = new MiningDataOptimizer(this.config);
      
      // Setup Express middleware
      this.setupMiddleware();
      
      // Setup routes
      this.setupRoutes();
      
      // Create HTTP server and WebSocket server
      this.server = http.createServer(this.app);
      this.wss = new WebSocket.Server({ server: this.server });
      
      // Setup WebSocket handlers
      this.setupWebSocketHandlers();
      
      logger.info('Server initialization complete');
      
    } catch (error) {
      logger.error('Failed to initialize server:', error);
      throw error;
    }
  }

  setupMiddleware() {
    // CORS
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
      credentials: true
    }));
    
    // Compression
    this.app.use(compression({
      level: 6,
      threshold: 1024,
      filter: (req, res) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return compression.filter(req, res);
      }
    }));
    
    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP, please try again later.',
      standardHeaders: true,
      legacyHeaders: false
    });
    this.app.use('/api/', limiter);
    
    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    
    // Request logging
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path} - ${req.ip}`);
      next();
    });
  }

  setupRoutes() {
    // Dashboard routes (serve at root for main interface)
    const dashboardRoutes = createDashboardRoutes(this);
    this.app.use('/', dashboardRoutes);
    
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        services: {
          mongodb: this.mongoService ? this.mongoService.isConnected() : false,
          optimizer: this.optimizer ? this.optimizer.isRunning : false
        }
      });
    });
    
    // API routes with enhanced data
    this.app.use('/api/mining', miningRoutes);
    this.app.use('/api/systems', systemRoutes);
    this.app.use('/api/market', marketRoutes);
    this.app.use('/api/stats', statsRoutes);
    
    // Server statistics
    this.app.get('/api/server/stats', (req, res) => {
      const stats = this.optimizer ? this.optimizer.getStatistics() : {};
      res.json({
        server: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          nodeVersion: process.version
        },
        optimizer: stats,
        timestamp: new Date().toISOString()
      });
    });
    
    // API documentation endpoint
    this.app.get('/api/docs', (req, res) => {
      res.json({
        title: 'Elite Dangerous Mining Data Server API',
        version: '2.0.0',
        description: 'Optimized API server for Elite Dangerous mining data with EDDN, Inara, and EDSM integration',
        endpoints: {
          mining: {
            '/api/mining/opportunities': 'Get current mining opportunities',
            '/api/mining/hotspots': 'Get mining hotspots by activity',
            '/api/mining/recommendations': 'Get personalized mining recommendations',
            '/api/mining/events': 'Get recent mining events'
          },
          systems: {
            '/api/systems/search': 'Search systems by name or coordinates',
            '/api/systems/:name': 'Get detailed system information',
            '/api/systems/:name/bodies': 'Get system bodies with mining potential',
            '/api/systems/:name/stations': 'Get stations in system'
          },
          market: {
            '/api/market/commodities': 'Get commodity market data',
            '/api/market/prices/:commodity': 'Get prices for specific commodity',
            '/api/market/trends': 'Get price trends analysis',
            '/api/market/alerts': 'Get price alerts'
          },
          stats: {
            '/api/stats/overview': 'Get server overview statistics',
            '/api/stats/performance': 'Get performance metrics',
            '/api/stats/api-usage': 'Get API usage statistics'
          }
        },
        websocket: {
          url: `ws://localhost:${this.config.port}/ws`,
          events: [
            'mining-opportunity',
            'price-alert',
            'system-update',
            'hotspot-update'
          ]
        }
      });
    });
    
    // Serve static files (if any)
    this.app.use(express.static('public'));
    
    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Endpoint not found',
        message: 'Please check the API documentation at /api/docs'
      });
    });
    
    // Error handler
    this.app.use((error, req, res, next) => {
      logger.error('Express error:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
      });
    });
  }

  setupWebSocketHandlers() {
    this.wss.on('connection', (ws, req) => {
      logger.info(`WebSocket client connected from ${req.socket.remoteAddress}`);
      
      // Send initial status to new clients
      this.sendInitialStatus(ws);
      
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleWebSocketMessage(ws, data);
        } catch (error) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid JSON message'
          }));
        }
      });
      
      ws.on('close', () => {
        logger.info('WebSocket client disconnected');
      });
      
      ws.on('error', (error) => {
        logger.error('WebSocket error:', error);
      });
      
      // Send welcome message
      ws.send(JSON.stringify({
        type: 'welcome',
        message: 'Connected to Elite Mining Data Server',
        version: '2.0.0',
        timestamp: new Date().toISOString()
      }));
    });
    
    // Setup periodic status updates
    setInterval(() => {
      this.broadcastStatusUpdate();
    }, 30000); // Every 30 seconds
    
    // Broadcast mining opportunities and price alerts
    if (this.optimizer) {
      this.optimizer.on('mining-opportunity', (data) => {
        this.broadcast({
          type: 'miningData',
          payload: data,
          timestamp: new Date().toISOString()
        });
      });
      
      this.optimizer.on('price-alert', (data) => {
        this.broadcast({
          type: 'price-alert',
          data: data,
          timestamp: new Date().toISOString()
        });
      });
    }
  }

  handleWebSocketMessage(ws, message) {
    switch (message.type) {
      case 'subscribe':
        // Handle subscription to specific events
        ws.subscriptions = message.events || [];
        ws.send(JSON.stringify({
          type: 'subscribed',
          events: ws.subscriptions
        }));
        break;
        
      case 'get-stats':
        const stats = this.optimizer ? this.optimizer.getStatistics() : {};
        ws.send(JSON.stringify({
          type: 'stats',
          data: stats
        }));
        break;
        
      case 'get-status':
        this.sendInitialStatus(ws);
        break;
        
      default:
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Unknown message type'
        }));
    }
  }

  async sendInitialStatus(ws) {
    try {
      // Get dashboard controller if available
      const dashboardRoutes = this.app._router.stack.find(layer => 
        layer.route && layer.route.path === '/' && layer.handle.dashboard
      );
      
      if (dashboardRoutes && dashboardRoutes.handle.dashboard) {
        const dashboard = dashboardRoutes.handle.dashboard;
        const status = await dashboard.getSystemStatus();
        const sources = await dashboard.getDataSourceStatus();
        
        ws.send(JSON.stringify({
          type: 'status',
          payload: status
        }));
        
        ws.send(JSON.stringify({
          type: 'dataSource',
          payload: sources
        }));
      }
    } catch (error) {
      logger.error('Error sending initial status:', error);
    }
  }

  async broadcastStatusUpdate() {
    try {
      // Find dashboard routes to get status
      const dashboardLayer = this.app._router.stack.find(layer => 
        layer.regexp.test('/') && layer.handle.dashboard
      );
      
      if (dashboardLayer && dashboardLayer.handle.dashboard) {
        const dashboard = dashboardLayer.handle.dashboard;
        const status = await dashboard.getSystemStatus();
        const sources = await dashboard.getDataSourceStatus();
        
        this.broadcast({
          type: 'status',
          payload: status
        });
        
        this.broadcast({
          type: 'dataSource',
          payload: sources
        });
      }
    } catch (error) {
      logger.error('Error broadcasting status update:', error);
    }
  }

  broadcast(message) {
    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        // Check subscriptions if available
        if (!client.subscriptions || client.subscriptions.includes(message.type)) {
          client.send(JSON.stringify(message));
        }
      }
    });
  }

  async start() {
    try {
      await this.initialize();
      
      // Start the mining data optimizer
      await this.optimizer.start();
      logger.info('Mining data optimizer started');
      
      // Start the HTTP server
      this.server.listen(this.config.port, () => {
        logger.info(`Elite Mining Data Server v2.0 running on port ${this.config.port}`);
        logger.info(`WebSocket endpoint: ws://localhost:${this.config.port}/ws`);
        logger.info(`API documentation: http://localhost:${this.config.port}/api/docs`);
        logger.info(`Health check: http://localhost:${this.config.port}/health`);
      });
      
      // Graceful shutdown handlers
      process.on('SIGTERM', this.shutdown.bind(this));
      process.on('SIGINT', this.shutdown.bind(this));
      
    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  async shutdown() {
    logger.info('Graceful shutdown initiated...');
    
    try {
      // Stop accepting new connections
      if (this.server) {
        this.server.close();
      }
      
      // Close WebSocket connections
      if (this.wss) {
        this.wss.clients.forEach(client => {
          client.close();
        });
        this.wss.close();
      }
      
      // Stop optimizer
      if (this.optimizer) {
        await this.optimizer.stop();
      }
      
      // Close MongoDB connection
      if (this.mongoService) {
        await this.mongoService.disconnect();
      }
      
      logger.info('Graceful shutdown complete');
      process.exit(0);
      
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }
}

// Start the server if this file is run directly
if (require.main === module) {
  const server = new EliteMiningDataServer();
  server.start().catch(error => {
    logger.error('Failed to start server:', error);
    process.exit(1);
  });
}

module.exports = EliteMiningDataServer;