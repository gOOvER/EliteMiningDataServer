const request = require('supertest')
const express = require('express')
const mongoose = require('mongoose')

// Import routes
const statisticsRoutes = require('../../src/routes/statistics')
const marketRoutes = require('../../src/routes/market')

// Helper to check if MongoDB is available
const isMongoAvailable = () => {
  return process.env.CI || process.env.GITHUB_ACTIONS || mongoose.connection.readyState === 1
}

// Use conditional describe to skip entire test suite if MongoDB not available
const describeIfMongo = isMongoAvailable() ? describe : describe.skip

describeIfMongo('Elite Dangerous Mining Data Server - Integration Tests', () => {
  let app
  let mockServices

  beforeAll(async () => {
    if (!process.env.CI && !process.env.GITHUB_ACTIONS) {
      try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/test', {
          serverSelectionTimeoutMS: 5000,
          connectTimeoutMS: 5000
        })
        console.log('✅ MongoDB connection successful')
      } catch (error) {
        console.log('⚠️ MongoDB connection failed:', error.message)
        throw error
      }
    }
  })

  beforeEach(() => {
    app = express()
    app.use(express.json())

    // Mock services for testing
    mockServices = {
      database: {
        isConnected: () => true,
        aggregate: jest.fn().mockResolvedValue([]),
        find: jest.fn().mockResolvedValue([]),
        insertOne: jest.fn().mockResolvedValue({ insertedId: 'test123' }),
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 })
      },
      cacheManager: {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(true),
        delete: jest.fn().mockResolvedValue(true)
      },
      statisticsService: {
        getGlobalStatistics: jest.fn().mockResolvedValue({
          systems: { total: 50000, withStations: 30000 },
          commodities: { tracked: 150, totalPrices: 2500000 },
          eddn: { messagesProcessed: 1000000, lastUpdate: new Date() }
        }),
        getEDDNStatistics: jest.fn().mockResolvedValue({
          messagesProcessed: 1000000,
          messagesPerHour: 5000,
          lastMessageTime: new Date()
        }),
        getMiningStatistics: jest.fn().mockResolvedValue({
          totalRocks: 10000,
          totalYield: 50000,
          averageYield: 5.0
        }),
        getAPIUsageStatistics: jest.fn().mockResolvedValue({
          totalRequests: 100000,
          requestsPerHour: 500
        }),
        getWebSocketStatistics: jest.fn().mockResolvedValue({
          connectedClients: 25,
          messagesPerSecond: 10
        })
      },
      marketDataService: {
        getCommodityData: jest.fn().mockResolvedValue({
          commodityId: 'gold',
          name: 'Gold',
          averagePrice: 50000,
          stations: []
        }),
        getCommodityPriceHistory: jest.fn().mockResolvedValue([]),
        getSystemCoordinates: jest.fn().mockResolvedValue({ x: 100, y: 200, z: 300 })
      }
    }

    // Make services available to routes
    Object.keys(mockServices).forEach(serviceName => {
      app.locals[serviceName] = mockServices[serviceName]
    })

    // Mount routes
    app.use('/api/stats', statisticsRoutes)
    app.use('/api/market', marketRoutes)
  })

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect()
    }
  })

  describe('Statistics Routes', () => {
    test('GET /api/stats - should return global statistics', async () => {
      const response = await request(app).get('/api/stats')
      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('systems')
      expect(response.body).toHaveProperty('commodities')
    })

    test('GET /api/stats/eddn - should return EDDN statistics', async () => {
      const response = await request(app).get('/api/stats/eddn')
      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('messagesProcessed')
    })

    test('GET /api/stats/mining - should return mining statistics', async () => {
      const response = await request(app).get('/api/stats/mining')
      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('totalRocks')
    })
  })

  describe('Market Routes', () => {
    test('GET /api/market/commodity/:commodityId - should return commodity data', async () => {
      const response = await request(app).get('/api/market/commodity/gold')
      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('commodityId')
    })

    test('GET /api/market/commodity/invalid - should handle missing commodity', async () => {
      mockServices.marketDataService.getCommodityData.mockRejectedValue(new Error('Not found'))
      const response = await request(app).get('/api/market/commodity/invalid')
      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })

  describe('Error Handling', () => {
    test('should handle service errors gracefully', async () => {
      mockServices.statisticsService.getGlobalStatistics.mockRejectedValue(new Error('Service error'))
      const response = await request(app).get('/api/stats')
      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })
})

// If MongoDB is not available, show a message
if (!isMongoAvailable()) {
  console.log('⚠️ MongoDB not available, skipping integration tests')
  console.log('💡 To run integration tests, start MongoDB or run in CI environment')
}