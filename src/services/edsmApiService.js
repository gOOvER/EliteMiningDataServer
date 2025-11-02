const axios = require('axios')
const logger = require('./logger')

/**
 * Enhanced EDSM API Service
 * Comprehensive integration with Elite Dangerous Star Map API
 * Includes rate limiting, error handling, caching, and retry mechanisms
 */
class EDSMApiService {
  constructor (config = {}) {
    this.baseURL = config.baseURL || 'https://www.edsm.net/api-v1'
    this.timeout = config.timeout || 10000
    this.maxRetries = config.maxRetries || 3
    this.retryDelay = config.retryDelay || 1000
    this.rateLimit = config.rateLimit || { maxRequests: 100, windowMs: 60000 }

    // Rate limiting tracking
    this.requestQueue = []
    this.requestHistory = []

    // Circuit breaker state
    this.circuitBreaker = {
      isOpen: false,
      failureCount: 0,
      lastFailureTime: null,
      threshold: config.circuitBreakerThreshold || 5,
      timeout: config.circuitBreakerTimeout || 60000
    }

    // Initialize HTTP client with optimized settings
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'User-Agent': 'EliteMiningDataServer/2.0',
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      // Connection pooling
      maxRedirects: 3,
      validateStatus: (status) => status < 500 // Don't throw for 4xx errors
    })

    // Setup request/response interceptors
    this.setupInterceptors()

    // Start rate limiter cleanup
    this.startRateLimiterCleanup()

    logger.info('EDSM API Service initialized', {
      baseURL: this.baseURL,
      rateLimit: this.rateLimit,
      timeout: this.timeout
    })
  }

  /**
   * Setup axios interceptors for logging and error handling
   */
  setupInterceptors () {
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        logger.debug('EDSM API Request', {
          method: config.method,
          url: config.url,
          params: config.params
        })
        return config
      },
      (error) => {
        logger.error('EDSM API Request Error', error)
        return Promise.reject(error)
      }
    )

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        logger.debug('EDSM API Response', {
          status: response.status,
          url: response.config.url,
          dataLength: response.data ? Object.keys(response.data).length : 0
        })

        // Reset circuit breaker on successful response
        this.resetCircuitBreaker()

        return response
      },
      (error) => {
        logger.error('EDSM API Response Error', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          url: error.config?.url,
          message: error.message
        })

        // Update circuit breaker on error
        this.recordFailure()

        return Promise.reject(error)
      }
    )
  }

  /**
   * Rate limiting implementation
   */
  async checkRateLimit () {
    const now = Date.now()

    // Clean old requests from history
    this.requestHistory = this.requestHistory.filter(
      timestamp => now - timestamp < this.rateLimit.windowMs
    )

    // Check if we're within rate limits
    if (this.requestHistory.length >= this.rateLimit.maxRequests) {
      const oldestRequest = this.requestHistory[0]
      const waitTime = this.rateLimit.windowMs - (now - oldestRequest)

      if (waitTime > 0) {
        logger.warn('EDSM API rate limit reached, waiting', { waitTime })
        await this.sleep(waitTime)
      }
    }

    // Record this request
    this.requestHistory.push(now)
  }

  /**
   * Circuit breaker implementation
   */
  checkCircuitBreaker () {
    if (!this.circuitBreaker.isOpen) {
      return true
    }

    const now = Date.now()
    if (now - this.circuitBreaker.lastFailureTime > this.circuitBreaker.timeout) {
      logger.info('EDSM API circuit breaker half-open, attempting request')
      this.circuitBreaker.isOpen = false
      this.circuitBreaker.failureCount = 0
      return true
    }

    throw new Error('EDSM API circuit breaker is open')
  }

  /**
   * Record API failure for circuit breaker
   */
  recordFailure () {
    this.circuitBreaker.failureCount++
    this.circuitBreaker.lastFailureTime = Date.now()

    if (this.circuitBreaker.failureCount >= this.circuitBreaker.threshold) {
      this.circuitBreaker.isOpen = true
      logger.warn('EDSM API circuit breaker opened', {
        failureCount: this.circuitBreaker.failureCount,
        threshold: this.circuitBreaker.threshold
      })
    }
  }

  /**
   * Reset circuit breaker on successful request
   */
  resetCircuitBreaker () {
    if (this.circuitBreaker.failureCount > 0) {
      this.circuitBreaker.failureCount = 0
      this.circuitBreaker.isOpen = false
      logger.info('EDSM API circuit breaker reset')
    }
  }

  /**
   * Make HTTP request with retry logic
   */
  async makeRequest (endpoint, params = {}, options = {}) {
    // Check circuit breaker
    this.checkCircuitBreaker()

    // Apply rate limiting
    await this.checkRateLimit()

    const maxRetries = options.maxRetries || this.maxRetries

        for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await this.client.get(endpoint, { params })

        // Validate response
        if (response.status >= 400) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        return response.data
      } catch (error) {
        const isLastAttempt = attempt === maxRetries
        const shouldRetry = this.shouldRetry(error, attempt)

        if (!isLastAttempt && shouldRetry) {
          const delay = this.calculateRetryDelay(attempt)
          logger.warn('EDSM API request failed, retrying', {
            endpoint,
            attempt,
            maxRetries,
            delay,
            error: error.message
          })

          await this.sleep(delay)
          continue
        }

        // Final failure
        logger.error('EDSM API request failed permanently', {
          endpoint,
          attempts: attempt,
          error: error.message
        })

        throw new Error(`EDSM API request failed: ${error.message}`)
      }
    }
  }

  /**
   * Determine if request should be retried
   */
  shouldRetry (error, attempt) {
    // Don't retry on client errors (4xx)
    if (error.response && error.response.status >= 400 && error.response.status < 500) {
      return false
    }

    // Retry on network errors, timeouts, and server errors (5xx)
    return error.code === 'ECONNRESET' ||
           error.code === 'ETIMEDOUT' ||
           error.code === 'ECONNREFUSED' ||
           (error.response && error.response.status >= 500)
  }

  /**
   * Calculate exponential backoff delay
   */
  calculateRetryDelay (attempt) {
    const exponentialDelay = this.retryDelay * Math.pow(2, attempt - 1)
    const jitter = Math.random() * 1000 // Add jitter to prevent thundering herd
    return Math.min(exponentialDelay + jitter, 30000) // Cap at 30 seconds
  }

  /**
   * Utility sleep function
   */
  sleep (ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Start rate limiter cleanup interval
   */
  startRateLimiterCleanup () {
    setInterval(() => {
      const now = Date.now()
      this.requestHistory = this.requestHistory.filter(
        timestamp => now - timestamp < this.rateLimit.windowMs
      )
    }, this.rateLimit.windowMs)
  }

  /**
   * Get system information by name
   */
  async getSystem (systemName, options = {}) {
    try {
      const params = {
        systemName,
        showCoordinates: options.showCoordinates !== false ? 1 : 0,
        showInformation: options.showInformation !== false ? 1 : 0,
        showId: options.showId !== false ? 1 : 0,
        showPermit: options.showPermit !== false ? 1 : 0,
        showPrimaryStar: options.showPrimaryStar !== false ? 1 : 0
      }

      const data = await this.makeRequest('/system', params)

      if (!data || Object.keys(data).length === 0) {
        throw new Error(`System '${systemName}' not found`)
      }

      return this.transformSystemData(data)
    } catch (error) {
      logger.error('Failed to get system data', { systemName, error: error.message })
      throw new Error(`Failed to get system data: ${error.message}`)
    }
  }

  /**
   * Get multiple systems within radius
   */
  async getSystemsInRadius (referenceSystem, radius, options = {}) {
    try {
      const params = {
        systemName: referenceSystem,
        radius: Math.min(radius, 100), // EDSM max radius is 100ly
        showCoordinates: 1,
        showInformation: options.showInformation ? 1 : 0,
        showId: options.showId ? 1 : 0
      }

      const data = await this.makeRequest('/sphere-systems', params)

      if (!Array.isArray(data)) {
        throw new Error('Invalid response format from EDSM API')
      }

      return data.map(system => this.transformSystemData(system))
    } catch (error) {
      logger.error('Failed to get systems in radius', {
        referenceSystem,
        radius,
        error: error.message
      })
      throw new Error(`Failed to get systems in radius: ${error.message}`)
    }
  }

  /**
   * Get system bodies (planets, stars, etc.)
   */
  async getSystemBodies (systemName) {
    try {
      const params = {
        systemName
      }

      const data = await this.makeRequest('/system/bodies', params)

      if (!data || !data.bodies) {
        throw new Error(`No bodies found for system '${systemName}'`)
      }

      return {
        system: data.name,
        bodyCount: data.bodyCount || 0,
        bodies: data.bodies.map(body => this.transformBodyData(body))
      }
    } catch (error) {
      logger.error('Failed to get system bodies', { systemName, error: error.message })
      throw new Error(`Failed to get system bodies: ${error.message}`)
    }
  }

  /**
   * Get system stations
   */
  async getSystemStations (systemName) {
    try {
      const params = {
        systemName
      }

      const data = await this.makeRequest('/system/stations', params)

      if (!data || !data.stations) {
        return {
          system: systemName,
          stationCount: 0,
          stations: []
        }
      }

      return {
        system: data.name,
        stationCount: data.stations.length,
        stations: data.stations.map(station => this.transformStationData(station))
      }
    } catch (error) {
      logger.error('Failed to get system stations', { systemName, error: error.message })
      throw new Error(`Failed to get system stations: ${error.message}`)
    }
  }

  /**
   * Search systems by name
   */
  async searchSystems (query, options = {}) {
    try {
      const params = {
        systemName: query,
        showCoordinates: 1,
        showInformation: options.showInformation ? 1 : 0
      }

      const data = await this.makeRequest('/systems', params)

      if (!Array.isArray(data)) {
        return []
      }

      return data.map(system => this.transformSystemData(system))
    } catch (error) {
      logger.error('Failed to search systems', { query, error: error.message })
      throw new Error(`Failed to search systems: ${error.message}`)
    }
  }

  /**
   * Get traffic report for system
   */
  async getSystemTraffic (systemName) {
    try {
      const params = {
        systemName
      }

      const data = await this.makeRequest('/system/traffic', params)

      return {
        system: systemName,
        traffic: data || {},
        breakdown: data.breakdown || {},
        total: data.total || 0
      }
    } catch (error) {
      logger.error('Failed to get system traffic', { systemName, error: error.message })
      throw new Error(`Failed to get system traffic: ${error.message}`)
    }
  }

  /**
   * Get system deaths (dangerous systems)
   */
  async getSystemDeaths (systemName) {
    try {
      const params = {
        systemName
      }

      const data = await this.makeRequest('/system/deaths', params)

      return {
        system: systemName,
        deaths: data.deaths || 0,
        breakdown: data.breakdown || {}
      }
    } catch (error) {
      logger.error('Failed to get system deaths', { systemName, error: error.message })
      throw new Error(`Failed to get system deaths: ${error.message}`)
    }
  }

  /**
   * Transform raw system data to standardized format
   */
  transformSystemData (system) {
    return {
      name: system.name,
      id: system.id || null,
      id64: system.id64 || null,
      coords: system.coords
        ? {
            x: parseFloat(system.coords.x),
            y: parseFloat(system.coords.y),
            z: parseFloat(system.coords.z)
          }
        : null,
      coordsLocked: system.coordsLocked || false,
      requirePermit: system.requirePermit || false,
      permitName: system.permitName || null,
      information: system.information
        ? {
            allegiance: system.information.allegiance || null,
            government: system.information.government || null,
            faction: system.information.faction || null,
            factionState: system.information.factionState || null,
            population: system.information.population || 0,
            security: system.information.security || null,
            economy: system.information.economy || null,
            secondEconomy: system.information.secondEconomy || null,
            reserve: system.information.reserve || null
          }
        : null,
      primaryStar: system.primaryStar
        ? {
            type: system.primaryStar.type,
            name: system.primaryStar.name,
            isScoopable: system.primaryStar.isScoopable || false
          }
        : null,
      date: system.date || null,
      distanceLy: system.distance || null
    }
  }

  /**
   * Transform raw body data to standardized format
   */
  transformBodyData (body) {
    return {
      id: body.id || null,
      id64: body.id64 || null,
      name: body.name,
      type: body.type || 'Unknown',
      subType: body.subType || null,
      distanceToArrival: body.distanceToArrival || 0,
      isMainStar: body.isMainStar || false,
      isScoopable: body.isScoopable || false,
      age: body.age || null,
      spectralClass: body.spectralClass || null,
      luminosity: body.luminosity || null,
      absoluteMagnitude: body.absoluteMagnitude || null,
      solarMasses: body.solarMasses || null,
      solarRadius: body.solarRadius || null,
      surfaceTemperature: body.surfaceTemperature || null,
      orbitalPeriod: body.orbitalPeriod || null,
      semiMajorAxis: body.semiMajorAxis || null,
      orbitalEccentricity: body.orbitalEccentricity || null,
      orbitalInclination: body.orbitalInclination || null,
      argOfPeriapsis: body.argOfPeriapsis || null,
      rotationalPeriod: body.rotationalPeriod || null,
      rotationalPeriodTidallyLocked: body.rotationalPeriodTidallyLocked || false,
      axialTilt: body.axialTilt || null,
      rings: body.rings || [],
      belts: body.belts || [],
      materials: body.materials || {},
      terraformingState: body.terraformingState || null,
      planetClass: body.planetClass || null,
      atmosphere: body.atmosphere || null,
      atmosphereType: body.atmosphereType || null,
      volcanism: body.volcanism || null,
      massEM: body.massEM || null,
      radius: body.radius || null,
      surfaceGravity: body.surfaceGravity || null,
      surfacePressure: body.surfacePressure || null,
      landable: body.isLandable || false,
      bodyId: body.bodyId || null,
      parents: body.parents || [],
      updateTime: body.updateTime || null
    }
  }

  /**
   * Transform raw station data to standardized format
   */
  transformStationData (station) {
    return {
      id: station.id || null,
      name: station.name,
      type: station.type || 'Unknown',
      distanceToArrival: station.distanceToArrival || 0,
      allegiance: station.allegiance || null,
      government: station.government || null,
      economy: station.economy || null,
      secondEconomy: station.secondEconomy || null,
      haveMarket: station.haveMarket || false,
      haveShipyard: station.haveShipyard || false,
      haveOutfitting: station.haveOutfitting || false,
      otherServices: station.otherServices || [],
      controllingFaction: station.controllingFaction
        ? {
            id: station.controllingFaction.id,
            name: station.controllingFaction.name
          }
        : null,
      updateTime: station.updateTime || null,
      body: station.body
        ? {
            id: station.body.id,
            name: station.body.name
          }
        : null
    }
  }

  /**
   * Get service health status
   */
  getHealthStatus () {
    return {
      service: 'EDSM API',
      status: this.circuitBreaker.isOpen ? 'degraded' : 'healthy',
      circuitBreaker: {
        isOpen: this.circuitBreaker.isOpen,
        failureCount: this.circuitBreaker.failureCount,
        lastFailureTime: this.circuitBreaker.lastFailureTime
      },
      rateLimit: {
        requestsInWindow: this.requestHistory.length,
        maxRequests: this.rateLimit.maxRequests,
        windowMs: this.rateLimit.windowMs
      },
      lastRequest: this.requestHistory[this.requestHistory.length - 1] || null
    }
  }

  /**
   * Get service statistics
   */
  getStatistics () {
    const now = Date.now()
    const recentRequests = this.requestHistory.filter(
      timestamp => now - timestamp < 300000 // Last 5 minutes
    )

    return {
      totalRequestsTracked: this.requestHistory.length,
      recentRequests: recentRequests.length,
      circuitBreakerStatus: this.circuitBreaker.isOpen ? 'open' : 'closed',
      failureCount: this.circuitBreaker.failureCount,
      averageRequestsPerMinute: this.requestHistory.length > 0
        ? (this.requestHistory.length / ((now - this.requestHistory[0]) / 60000))
        : 0
    }
  }
}

module.exports = EDSMApiService
