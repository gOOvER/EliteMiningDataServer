const axios = require('axios')
const logger = require('./logger')

/**
 * Enhanced Inara API Service
 * Comprehensive integration with Inara Elite Dangerous API
 * Includes authentication, rate limiting, error handling, and retry mechanisms
 */
class InaraApiService {
  constructor (config = {}) {
    this.baseURL = config.baseURL || 'https://inara.cz/inapi/v1/'
    this.apiKey = config.apiKey
    this.appName = config.appName || 'EliteMiningDataServer'
    this.appVersion = config.appVersion || '2.0'
    this.isDeveloper = config.isDeveloper || false
    this.timeout = config.timeout || 15000
    this.maxRetries = config.maxRetries || 3
    this.retryDelay = config.retryDelay || 2000
    this.rateLimit = config.rateLimit || { maxRequests: 30, windowMs: 60000 } // Inara limit: 30/min

    // Request tracking for rate limiting
    this.requestQueue = []
    this.requestHistory = []

    // Circuit breaker state
    this.circuitBreaker = {
      isOpen: false,
      failureCount: 0,
      lastFailureTime: null,
      threshold: config.circuitBreakerThreshold || 3,
      timeout: config.circuitBreakerTimeout || 120000 // 2 minutes for Inara
    }

    // API event types mapping
    this.eventTypes = {
      // Commander events
      GET_COMMANDER_PROFILE: 'getCommanderProfile',
      GET_COMMANDER_CREDITS: 'getCommanderCredits',
      GET_COMMANDER_RANKS: 'getCommanderRanks',
      GET_COMMANDER_REPUTATION: 'getCommanderReputation',

      // Market events
      GET_COMMODITY_PRICES: 'getCommodityPrices',
      GET_MARKET_PRICES: 'getMarketPrices',

      // Station events
      GET_STATIONS: 'getStations',
      GET_STATION_MARKET: 'getStationMarket',

      // System events
      GET_SYSTEMS: 'getSystems',
      GET_SYSTEM_STATIONS: 'getSystemStations',

      // Community events
      GET_COMMUNITY_GOALS: 'getCommunityGoals',
      GET_GALNET_ARTICLES: 'getGalnetArticles',

      // Squadron events
      GET_SQUADRON_INFO: 'getSquadronInfo',
      GET_SQUADRON_MEMBERS: 'getSquadronMembers'
    }

    // Initialize HTTP client
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'User-Agent': `${this.appName}/${this.appVersion}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      }
    })

    // Setup interceptors
    this.setupInterceptors()

    // Start rate limiter cleanup
    this.startRateLimiterCleanup()

    if (!this.apiKey) {
      logger.warn('Inara API initialized without API key - some features will be limited')
    } else {
      logger.info('Inara API Service initialized', {
        appName: this.appName,
        appVersion: this.appVersion,
        rateLimit: this.rateLimit
      })
    }
  }

  /**
   * Setup axios interceptors
   */
  setupInterceptors () {
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        logger.debug('Inara API Request', {
          method: config.method,
          url: config.url,
          eventName: config.data?.events?.[0]?.eventName
        })
        return config
      },
      (error) => {
        logger.error('Inara API Request Error', error)
        return Promise.reject(error)
      }
    )

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        logger.debug('Inara API Response', {
          status: response.status,
          eventCount: response.data?.events?.length || 0
        })

        this.resetCircuitBreaker()
        return response
      },
      (error) => {
        logger.error('Inara API Response Error', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          message: error.message
        })

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

    // Clean old requests
    this.requestHistory = this.requestHistory.filter(
      timestamp => now - timestamp < this.rateLimit.windowMs
    )

    // Check if we need to wait
    if (this.requestHistory.length >= this.rateLimit.maxRequests) {
      const oldestRequest = this.requestHistory[0]
      const waitTime = this.rateLimit.windowMs - (now - oldestRequest)

      if (waitTime > 0) {
        logger.warn('Inara API rate limit reached, waiting', { waitTime })
        await this.sleep(waitTime)
      }
    }

    this.requestHistory.push(now)
  }

  /**
   * Circuit breaker check
   */
  checkCircuitBreaker () {
    if (!this.circuitBreaker.isOpen) {
      return true
    }

    const now = Date.now()
    if (now - this.circuitBreaker.lastFailureTime > this.circuitBreaker.timeout) {
      logger.info('Inara API circuit breaker half-open, attempting request')
      this.circuitBreaker.isOpen = false
      this.circuitBreaker.failureCount = 0
      return true
    }

    throw new Error('Inara API circuit breaker is open')
  }

  /**
   * Record API failure
   */
  recordFailure () {
    this.circuitBreaker.failureCount++
    this.circuitBreaker.lastFailureTime = Date.now()

    if (this.circuitBreaker.failureCount >= this.circuitBreaker.threshold) {
      this.circuitBreaker.isOpen = true
      logger.warn('Inara API circuit breaker opened', {
        failureCount: this.circuitBreaker.failureCount
      })
    }
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker () {
    if (this.circuitBreaker.failureCount > 0) {
      this.circuitBreaker.failureCount = 0
      this.circuitBreaker.isOpen = false
      logger.info('Inara API circuit breaker reset')
    }
  }

  /**
   * Make API request with retry logic
   */
  async makeRequest (events, options = {}) {
    this.checkCircuitBreaker()
    await this.checkRateLimit()

    const requestPayload = this.buildRequestPayload(events)
    const maxRetries = options.maxRetries || this.maxRetries

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.client.post('', requestPayload)

        if (response.status !== 200) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        // Validate Inara API response format
        if (!response.data || !Array.isArray(response.data.events)) {
          throw new Error('Invalid response format from Inara API')
        }

        // Check for API errors in response
        const hasErrors = response.data.events.some(event =>
          event.eventStatus !== 200 && event.eventStatus !== 202
        )

        if (hasErrors) {
          const errorEvents = response.data.events.filter(event =>
            event.eventStatus !== 200 && event.eventStatus !== 202
          )
          logger.warn('Inara API returned event errors', { errorEvents })
        }

        return response.data
      } catch (error) {
        const isLastAttempt = attempt === maxRetries
        const shouldRetry = this.shouldRetry(error, attempt)

        if (!isLastAttempt && shouldRetry) {
          const delay = this.calculateRetryDelay(attempt)
          logger.warn('Inara API request failed, retrying', {
            attempt,
            maxRetries,
            delay,
            error: error.message
          })

          await this.sleep(delay)
          continue
        }

        logger.error('Inara API request failed permanently', {
          attempts: attempt,
          error: error.message
        })

        throw new Error(`Inara API request failed: ${error.message}`)
      }
    }
  }

  /**
   * Build standard Inara API request payload
   */
  buildRequestPayload (events) {
    if (!Array.isArray(events)) {
      events = [events]
    }

    return {
      header: {
        appName: this.appName,
        appVersion: this.appVersion,
        isDeveloper: this.isDeveloper,
        APIkey: this.apiKey || '',
        commanderName: '', // Set per request if needed
        commanderFrontierID: '' // Set per request if needed
      },
      events: events.map((event, index) => ({
        eventName: event.eventName,
        eventTimestamp: event.eventTimestamp || new Date().toISOString(),
        eventData: event.eventData || {},
        eventCustomID: event.eventCustomID || index
      }))
    }
  }

  /**
   * Determine if request should be retried
   */
  shouldRetry (error, attempt) {
    // Don't retry on authentication errors
    if (error.response && error.response.status === 401) {
      return false
    }

    // Don't retry on client errors (4xx) except 429 (rate limit)
    if (error.response && error.response.status >= 400 &&
        error.response.status < 500 && error.response.status !== 429) {
      return false
    }

    // Retry on network errors, timeouts, rate limits, and server errors
    return error.code === 'ECONNRESET' ||
           error.code === 'ETIMEDOUT' ||
           error.code === 'ECONNREFUSED' ||
           (error.response && (error.response.status >= 500 || error.response.status === 429))
  }

  /**
   * Calculate exponential backoff delay
   */
  calculateRetryDelay (attempt) {
    const exponentialDelay = this.retryDelay * Math.pow(2, attempt - 1)
    const jitter = Math.random() * 1000
    return Math.min(exponentialDelay + jitter, 60000) // Cap at 1 minute
  }

  /**
   * Utility sleep function
   */
  sleep (ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Start rate limiter cleanup
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
   * Get commodity market prices
   */
  async getCommodityPrices (commodityName, options = {}) {
    try {
      const event = {
        eventName: this.eventTypes.GET_COMMODITY_PRICES,
        eventData: {
          commodityName,
          maxDistanceLy: options.maxDistance || 50,
          maxAge: options.maxAge || 7 // days
        }
      }

      const response = await this.makeRequest(event)
      const eventData = response.events[0]

      if (eventData.eventStatus !== 200) {
        throw new Error(`Inara API error: ${eventData.eventStatusText}`)
      }

      return {
        commodity: commodityName,
        prices: eventData.eventData || [],
        lastUpdated: new Date().toISOString()
      }
    } catch (error) {
      logger.error('Failed to get commodity prices', { commodityName, error: error.message })
      throw new Error(`Failed to get commodity prices: ${error.message}`)
    }
  }

  /**
   * Get station market data
   */
  async getStationMarket (stationId, options = {}) {
    try {
      const event = {
        eventName: this.eventTypes.GET_STATION_MARKET,
        eventData: {
          stationID: stationId,
          maxAge: options.maxAge || 7
        }
      }

      const response = await this.makeRequest(event)
      const eventData = response.events[0]

      if (eventData.eventStatus !== 200) {
        throw new Error(`Inara API error: ${eventData.eventStatusText}`)
      }

      return {
        stationId,
        market: eventData.eventData || [],
        lastUpdated: new Date().toISOString()
      }
    } catch (error) {
      logger.error('Failed to get station market', { stationId, error: error.message })
      throw new Error(`Failed to get station market: ${error.message}`)
    }
  }

  /**
   * Search stations
   */
  async getStations (searchCriteria, options = {}) {
    try {
      const event = {
        eventName: this.eventTypes.GET_STATIONS,
        eventData: {
          stationName: searchCriteria.stationName || '',
          systemName: searchCriteria.systemName || '',
          maxDistanceLy: searchCriteria.maxDistance || 50,
          minLandingPadSize: searchCriteria.minLandingPadSize || 'S',
          hasMarket: searchCriteria.hasMarket || false,
          hasShipyard: searchCriteria.hasShipyard || false,
          hasOutfitting: searchCriteria.hasOutfitting || false
        }
      }

      const response = await this.makeRequest(event)
      const eventData = response.events[0]

      if (eventData.eventStatus !== 200) {
        throw new Error(`Inara API error: ${eventData.eventStatusText}`)
      }

      return {
        searchCriteria,
        stations: eventData.eventData || [],
        lastUpdated: new Date().toISOString()
      }
    } catch (error) {
      logger.error('Failed to get stations', { searchCriteria, error: error.message })
      throw new Error(`Failed to get stations: ${error.message}`)
    }
  }

  /**
   * Get systems
   */
  async getSystems (searchCriteria, options = {}) {
    try {
      const event = {
        eventName: this.eventTypes.GET_SYSTEMS,
        eventData: {
          systemName: searchCriteria.systemName || '',
          maxDistanceLy: searchCriteria.maxDistance || 50,
          refSystemName: searchCriteria.referenceSystem || '',
          allegiance: searchCriteria.allegiance || '',
          government: searchCriteria.government || '',
          economy: searchCriteria.economy || '',
          security: searchCriteria.security || ''
        }
      }

      const response = await this.makeRequest(event)
      const eventData = response.events[0]

      if (eventData.eventStatus !== 200) {
        throw new Error(`Inara API error: ${eventData.eventStatusText}`)
      }

      return {
        searchCriteria,
        systems: eventData.eventData || [],
        lastUpdated: new Date().toISOString()
      }
    } catch (error) {
      logger.error('Failed to get systems', { searchCriteria, error: error.message })
      throw new Error(`Failed to get systems: ${error.message}`)
    }
  }

  /**
   * Get community goals
   */
  async getCommunityGoals (options = {}) {
    try {
      const event = {
        eventName: this.eventTypes.GET_COMMUNITY_GOALS,
        eventData: {
          showInactive: options.showInactive || false
        }
      }

      const response = await this.makeRequest(event)
      const eventData = response.events[0]

      if (eventData.eventStatus !== 200) {
        throw new Error(`Inara API error: ${eventData.eventStatusText}`)
      }

      return {
        communityGoals: eventData.eventData || [],
        lastUpdated: new Date().toISOString()
      }
    } catch (error) {
      logger.error('Failed to get community goals', { error: error.message })
      throw new Error(`Failed to get community goals: ${error.message}`)
    }
  }

  /**
   * Get GalNet articles
   */
  async getGalnetArticles (options = {}) {
    try {
      const event = {
        eventName: this.eventTypes.GET_GALNET_ARTICLES,
        eventData: {
          maxAge: options.maxAge || 30, // days
          articleText: options.includeText || false
        }
      }

      const response = await this.makeRequest(event)
      const eventData = response.events[0]

      if (eventData.eventStatus !== 200) {
        throw new Error(`Inara API error: ${eventData.eventStatusText}`)
      }

      return {
        articles: eventData.eventData || [],
        lastUpdated: new Date().toISOString()
      }
    } catch (error) {
      logger.error('Failed to get GalNet articles', { error: error.message })
      throw new Error(`Failed to get GalNet articles: ${error.message}`)
    }
  }

  /**
   * Get commander profile (requires authentication)
   */
  async getCommanderProfile (commanderName, options = {}) {
    if (!this.apiKey) {
      throw new Error('API key required for commander profile access')
    }

    try {
      const event = {
        eventName: this.eventTypes.GET_COMMANDER_PROFILE,
        eventData: {
          searchName: commanderName,
          showPrivateProfile: options.showPrivate || false
        }
      }

      const response = await this.makeRequest(event)
      const eventData = response.events[0]

      if (eventData.eventStatus !== 200) {
        throw new Error(`Inara API error: ${eventData.eventStatusText}`)
      }

      return {
        commander: eventData.eventData || {},
        lastUpdated: new Date().toISOString()
      }
    } catch (error) {
      logger.error('Failed to get commander profile', { commanderName, error: error.message })
      throw new Error(`Failed to get commander profile: ${error.message}`)
    }
  }

  /**
   * Get squadron information
   */
  async getSquadronInfo (squadronId, options = {}) {
    try {
      const event = {
        eventName: this.eventTypes.GET_SQUADRON_INFO,
        eventData: {
          squadronID: squadronId
        }
      }

      const response = await this.makeRequest(event)
      const eventData = response.events[0]

      if (eventData.eventStatus !== 200) {
        throw new Error(`Inara API error: ${eventData.eventStatusText}`)
      }

      return {
        squadron: eventData.eventData || {},
        lastUpdated: new Date().toISOString()
      }
    } catch (error) {
      logger.error('Failed to get squadron info', { squadronId, error: error.message })
      throw new Error(`Failed to get squadron info: ${error.message}`)
    }
  }

  /**
   * Batch multiple API calls efficiently
   */
  async batchRequests (events, options = {}) {
    try {
      const batchSize = options.batchSize || 10 // Inara allows up to 25 events per request
      const results = []

      for (let i = 0; i < events.length; i += batchSize) {
        const batch = events.slice(i, i + batchSize)
        const response = await this.makeRequest(batch)
        results.push(...response.events)

        // Add delay between batches to respect rate limits
        if (i + batchSize < events.length) {
          await this.sleep(1000)
        }
      }

      return {
        results,
        totalEvents: events.length,
        successful: results.filter(r => r.eventStatus === 200).length,
        failed: results.filter(r => r.eventStatus !== 200).length
      }
    } catch (error) {
      logger.error('Failed to execute batch requests', { error: error.message })
      throw new Error(`Failed to execute batch requests: ${error.message}`)
    }
  }

  /**
   * Get service health status
   */
  getHealthStatus () {
    return {
      service: 'Inara API',
      status: this.circuitBreaker.isOpen ? 'degraded' : 'healthy',
      authenticated: !!this.apiKey,
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
        : 0,
      authenticated: !!this.apiKey,
      availableEvents: Object.keys(this.eventTypes).length
    }
  }
}

module.exports = InaraApiService
