const axios = require('axios')
const logger = require('../services/logger')

class EDSMClient {
  constructor (config) {
    this.systemApiUrl = 'https://www.edsm.net/api-v1/'
    this.logsApiUrl = 'https://www.edsm.net/api-logs-v1/'
    this.commanderName = config.commanderName || null
    this.apiKey = config.apiKey || null

    // Rate limiting based on EDSM recommendations
    this.rateLimitDelay = 500 // 0.5 second between requests
    this.lastRequestTime = 0
    this.requestQueue = []
    this.isProcessingQueue = false
  }

  async makeRequest (url, params = {}) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ url, params, resolve, reject })
      this.processQueue()
    })
  }

  async processQueue () {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return
    }

    this.isProcessingQueue = true

    while (this.requestQueue.length > 0) {
      const { url, params, resolve, reject } = this.requestQueue.shift()

      try {
        // Rate limiting
        const now = Date.now()
        const timeSinceLastRequest = now - this.lastRequestTime
        if (timeSinceLastRequest < this.rateLimitDelay) {
          await new Promise(res => setTimeout(res, this.rateLimitDelay - timeSinceLastRequest))
        }

        const response = await this.executeRequest(url, params)
        this.lastRequestTime = Date.now()
        resolve(response)
      } catch (error) {
        reject(error)
      }
    }

    this.isProcessingQueue = false
  }

  async executeRequest (url, params) {
    try {
      const response = await axios.get(url, {
        params,
        headers: {
          'User-Agent': 'EliteMiningDataServer/1.0.0'
        },
        timeout: 30000
      })

      return response.data
    } catch (error) {
      logger.error('EDSM API request failed:', error.message)
      throw error
    }
  }

  async getSystemInfo (systemName) {
    try {
      const data = await this.makeRequest('system', {
        systemName,
        showInformation: 1,
        showCoordinates: 1,
        showPrimaryStar: 1
      })

      return data
    } catch (error) {
      logger.error(`Failed to get system info for ${systemName}:`, error.message)
      return null
    }
  }

  async getSystemBodies (systemName) {
    try {
      const data = await this.makeRequest('system', {
        systemName,
        showInformation: 1,
        showCoordinates: 1,
        showPrimaryStar: 1,
        showBodies: 1
      })

      return data?.bodies || []
    } catch (error) {
      logger.error(`Failed to get system bodies for ${systemName}:`, error.message)
      return []
    }
  }

  async getNearbySystemsWithMaterials (systemName, radius = 50) {
    try {
      // First get the reference system coordinates
      const systemInfo = await this.getSystemInfo(systemName)
      if (!systemInfo || !systemInfo.coords) {
        throw new Error(`Could not find coordinates for system ${systemName}`)
      }

      const { x, y, z } = systemInfo.coords

      // Get nearby systems
      const data = await this.makeRequest('sphere-systems', {
        x,
        y,
        z,
        radius,
        showInformation: 1,
        showCoordinates: 1
      })

      return data || []
    } catch (error) {
      logger.error(`Failed to get nearby systems for ${systemName}:`, error.message)
      return []
    }
  }

  async getSystemStations (systemName) {
    try {
      const data = await this.makeRequest('system', {
        systemName,
        showStations: 1
      })

      return data?.stations || []
    } catch (error) {
      logger.error(`Failed to get stations for ${systemName}:`, error.message)
      return []
    }
  }

  async findSystemsByName (searchTerm, limit = 10) {
    try {
      const data = await this.makeRequest('systems', {
        startswith: searchTerm,
        showInformation: 1,
        showCoordinates: 1
      })

      // Limit results
      return (data || []).slice(0, limit)
    } catch (error) {
      logger.error(`Failed to search systems with term "${searchTerm}":`, error.message)
      return []
    }
  }

  async getDistanceBetweenSystems (system1, system2) {
    try {
      const [info1, info2] = await Promise.all([
        this.getSystemInfo(system1),
        this.getSystemInfo(system2)
      ])

      if (!info1?.coords || !info2?.coords) {
        throw new Error('Could not get coordinates for one or both systems')
      }

      const dx = info1.coords.x - info2.coords.x
      const dy = info1.coords.y - info2.coords.y
      const dz = info1.coords.z - info2.coords.z

      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)

      return {
        system1,
        system2,
        distance: Math.round(distance * 100) / 100,
        coords1: info1.coords,
        coords2: info2.coords
      }
    } catch (error) {
      logger.error(`Failed to calculate distance between ${system1} and ${system2}:`, error.message)
      return null
    }
  }

  async getMiningSystemsNearby (systemName, radius = 100) {
    try {
      const nearbySystems = await this.getNearbySystemsWithMaterials(systemName, radius)
      const miningSystems = []

      // Process systems to find those with mining potential
      for (const system of nearbySystems.slice(0, 50)) { // Limit to first 50 to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay))

        try {
          const bodies = await this.getSystemBodies(system.name)

          // Look for asteroid belts and rings
          const miningBodies = bodies.filter(body =>
            body.type === 'Belt' ||
            (body.rings && body.rings.length > 0) ||
            body.subType === 'Metal rich body' ||
            body.subType === 'High metal content body'
          )

          if (miningBodies.length > 0) {
            miningSystems.push({
              ...system,
              miningBodies,
              distance: system.distance
            })
          }
        } catch (bodyError) {
          logger.warn(`Could not get bodies for system ${system.name}:`, bodyError.message)
        }
      }

      return miningSystems.sort((a, b) => a.distance - b.distance)
    } catch (error) {
      logger.error(`Failed to find mining systems near ${systemName}:`, error.message)
      return []
    }
  }

  async getTrafficReport () {
    try {
      const data = await this.makeRequest('stats')
      return data
    } catch (error) {
      logger.error('Failed to get EDSM traffic report:', error.message)
      return null
    }
  }

  async delay () {
    return new Promise(resolve => setTimeout(resolve, this.rateLimitDelay))
  }
}

module.exports = EDSMClient
