const axios = require('axios')
const logger = require('../services/logger')

class InaraClient {
  constructor (config) {
    this.apiUrl = 'https://inara.cz/inapi/v1/'
    this.appName = config.appName || 'EliteMiningDataServer'
    this.appVersion = config.appVersion || '1.0.0'
    this.apiKey = config.apiKey // Optional, for higher rate limits
    this.isDeveloper = config.isDeveloper || false
    this.commanderName = config.commanderName || null
    this.commanderFID = config.commanderFID || null

    // Rate limiting (per Inara API docs)
    this.rateLimitDelay = 1000 // 1 second between requests
    this.lastRequestTime = 0
    this.requestQueue = []
    this.isProcessingQueue = false
  }

  async makeRequest (events) {
    const requestData = {
      header: {
        appName: this.appName,
        appVersion: this.appVersion,
        isDeveloped: true,
        APIkey: this.apiKey,
        commanderName: null
      },
      events
    }

    try {
      const response = await axios.post(this.apiUrl, requestData, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000
      })

      if (response.data && response.data.events) {
        return response.data.events
      } else {
        throw new Error('Invalid response format from Inara API')
      }
    } catch (error) {
      logger.error('Inara API request failed:', error.message)
      throw error
    }
  }

  async getSystemStations (systemName) {
    const events = [{
      eventName: 'getSystemStations',
      eventTimestamp: new Date().toISOString(),
      eventData: {
        systemName
      }
    }]

    try {
      const results = await this.makeRequest(events)
      return results[0]?.eventData || []
    } catch (error) {
      logger.error(`Failed to get stations for system ${systemName}:`, error.message)
      return []
    }
  }

  async getStationMarket (stationId) {
    const events = [{
      eventName: 'getStationMarket',
      eventTimestamp: new Date().toISOString(),
      eventData: {
        stationId
      }
    }]

    try {
      const results = await this.makeRequest(events)
      return results[0]?.eventData || {}
    } catch (error) {
      logger.error(`Failed to get market data for station ${stationId}:`, error.message)
      return {}
    }
  }

  async getCommodityPrices (commodityId) {
    const events = [{
      eventName: 'getCommodityPrices',
      eventTimestamp: new Date().toISOString(),
      eventData: {
        commodityId
      }
    }]

    try {
      const results = await this.makeRequest(events)
      return results[0]?.eventData || []
    } catch (error) {
      logger.error(`Failed to get commodity prices for ${commodityId}:`, error.message)
      return []
    }
  }

  async getMiningCommodityPrices () {
    const miningCommodities = [
      { id: 144, name: 'Painite' },
      { id: 291, name: 'Void Opals' },
      { id: 284, name: 'Low Temperature Diamonds' },
      { id: 271, name: 'Alexandrite' },
      { id: 276, name: 'Benitoite' },
      { id: 287, name: 'Grandidierite' },
      { id: 289, name: 'Monazite' },
      { id: 286, name: 'Musgravite' },
      { id: 288, name: 'Rhodplumsite' },
      { id: 285, name: 'Serendibite' },
      { id: 290, name: 'Taaffeite' },
      { id: 306, name: 'Tritium' },
      { id: 55, name: 'Platinum' },
      { id: 54, name: 'Osmium' },
      { id: 49, name: 'Gold' },
      { id: 56, name: 'Silver' },
      { id: 53, name: 'Palladium' }
    ]

    const allPrices = {}

    for (const commodity of miningCommodities) {
      try {
        await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay))

        const prices = await this.getCommodityPrices(commodity.id)
        allPrices[commodity.name] = {
          id: commodity.id,
          prices: prices.slice(0, 10) // Top 10 best prices
        }

        logger.info(`Retrieved prices for ${commodity.name}: ${prices.length} stations`)
      } catch (error) {
        logger.error(`Failed to get prices for ${commodity.name}:`, error.message)
        allPrices[commodity.name] = { id: commodity.id, prices: [] }
      }
    }

    return allPrices
  }

  async getNearbyStations (systemName, maxDistance = 50) {
    const events = [{
      eventName: 'getNearbyStations',
      eventTimestamp: new Date().toISOString(),
      eventData: {
        systemName,
        maxDistance
      }
    }]

    try {
      const results = await this.makeRequest(events)
      return results[0]?.eventData || []
    } catch (error) {
      logger.error(`Failed to get nearby stations for ${systemName}:`, error.message)
      return []
    }
  }

  async searchCommodities (searchTerm) {
    const events = [{
      eventName: 'searchCommodities',
      eventTimestamp: new Date().toISOString(),
      eventData: {
        searchName: searchTerm
      }
    }]

    try {
      const results = await this.makeRequest(events)
      return results[0]?.eventData || []
    } catch (error) {
      logger.error(`Failed to search commodities for "${searchTerm}":`, error.message)
      return []
    }
  }
}

module.exports = InaraClient
