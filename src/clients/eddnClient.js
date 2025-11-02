const zmq = require('zeromq')
const zlib = require('zlib')
const EventEmitter = require('events')
const logger = require('../services/logger')

class EDDNClient extends EventEmitter {
  constructor (config) {
    super()
    this.relayUrl = config.relayUrl || 'tcp://eddn.edcd.io:9500'
    this.reconnectInterval = config.reconnectInterval || 30000
    this.socket = null
    this.isConnected = false
    this.reconnectTimer = null
    this.messageCount = 0
    this.startTime = Date.now()
  }

  async connect () {
    try {
      this.socket = new zmq.Subscriber()
      this.socket.connect(this.relayUrl)
      this.socket.subscribe('')

      logger.info(`EDDN: Connecting to ${this.relayUrl}`)

      // Listen for messages
      for await (const [, message] of this.socket) {
        this.handleMessage(message)
      }
    } catch (error) {
      logger.error('EDDN: Connection error:', error)
      this.scheduleReconnect()
    }
  }

  handleMessage (compressedMessage) {
    try {
      // Check if message is valid
      if (!compressedMessage) {
        logger.warn('EDDN: Received empty message')
        return
      }

      // Decompress the message
      const decompressed = zlib.inflateSync(compressedMessage)
      const data = JSON.parse(decompressed.toString('utf8'))

      this.messageCount++

      // Filter for mining-relevant messages
      if (this.isMiningRelevant(data)) {
        this.emit('miningData', data)
      }

      // Emit all data for other uses
      this.emit('data', data)

      // Log statistics every 1000 messages
      if (this.messageCount % 1000 === 0) {
        const uptime = (Date.now() - this.startTime) / 1000
        const messagesPerSecond = (this.messageCount / uptime).toFixed(2)
        logger.info(`EDDN: Processed ${this.messageCount} messages (${messagesPerSecond} msg/s)`)
      }
    } catch (error) {
      logger.error('EDDN: Message parsing error:', error)
    }
  }

  isMiningRelevant (data) {
    const schema = data.$schemaRef
    const message = data.message
    const header = data.header

    if (!schema || !message) {
      return false
    }

    // Extract schema type from URL (based on EDDN documentation)
    const schemaMatch = schema.match(/\/schemas\/([^/]+)\/(\d+)/)
    if (!schemaMatch) {
      return false
    }

    const schemaType = schemaMatch[1]
    // const schemaVersion = parseInt(schemaMatch[2])

    // Mining-relevant schema types based on EDDN documentation
    const miningSchemas = [
      'commodity', // Market data for mining commodities
      'journal', // Player journal events
      'outfitting', // Mining equipment availability
      'shipyard', // Mining ship availability
      'fsssignaldiscovered', // Fleet Carrier signals (mining locations)
      'navbeaconscan' // Navigation beacon data
    ]

    if (!miningSchemas.includes(schemaType)) {
      return false
    }

    // Enhanced filtering for journal events (based on EDDN dev docs)
    if (schemaType === 'journal' && message.event) {
      const miningEvents = [
        // Core mining events
        'MiningRefined', 'AsteroidCracked', 'ProspectedAsteroid',
        'LaunchDrones', 'CollectCargo', 'Cargo', 'Materials',

        // Location and movement for mining spots
        'Docked', 'Location', 'FSDJump', 'CarrierJump',
        'SupercruiseEntry', 'SupercruiseExit',

        // Market and trading
        'Market', 'MarketBuy', 'MarketSell', 'CommodityPricesUpdated',

        // Ship and equipment for mining builds
        'Loadout', 'ModuleInfo', 'ShipyardBuy', 'ShipyardSell',
        'OutfittingBuy', 'OutfittingSell',

        // Exploration for finding mining sites
        'Scan', 'FSSDiscoveryScan', 'SAAScanComplete', 'FSSSignalDiscovered',

        // SRV operations for surface mining
        'LaunchSRV', 'DockSRV'
      ]

      if (!miningEvents.includes(message.event)) {
        return false
      }

      // Additional filtering for market transactions
      if (message.event === 'MarketSell' || message.event === 'MarketBuy') {
        const commodity = message.Type
        return this.isMiningCommodity(commodity)
      }
    }

    // Enhanced filtering for commodity messages (based on market data)
    if (schemaType === 'commodity') {
      if (message.commodities && Array.isArray(message.commodities)) {
        // Check if any commodity is mining-related
        return message.commodities.some(commodity =>
          this.isMiningCommodity(commodity.name)
        )
      }
    }

    // For outfitting and shipyard, filter by game version and expansion support
    if ((schemaType === 'outfitting' || schemaType === 'shipyard') && header) {
      // Prefer Odyssey/Horizons data for better mining equipment info
      if (message.horizons || message.odyssey) {
        return true
      }
    }

    return true
  }

  isMiningCommodity (commodityName) {
    if (!commodityName) return false

    const name = commodityName.toLowerCase()

    // Comprehensive list of mining commodities (from Elite Dangerous data)
    const miningCommodities = [
      // Core mining (void opals, diamonds, etc.)
      'voidopals', 'lowtemperaturediamond', 'alexandrite', 'benitoite',
      'grandidierite', 'monazite', 'musgravite', 'rhodplumsite',
      'serendibite', 'taaffeite',

      // Laser mining (metallic rings)
      'painite', 'platinum', 'osmium', 'gold', 'silver', 'palladium',
      'bertrandite', 'indite', 'gallite', 'cobalt', 'rutile',
      'chromium', 'manganese', 'zinc', 'arsenic', 'niobium',
      'yttrium', 'cadmium', 'mercury', 'molybdenum', 'technetium',
      'tellurium', 'selenium', 'polonium', 'antimonium', 'thallium',

      // Surface mining / SRV materials
      'praseodymium', 'samarium', 'bromelite', 'methanol',
      'methanolmonohydratecrystals', 'liquidoxygen', 'water',

      // Tritium (carrier fuel from ice rings)
      'tritium',

      // Common metals
      'iron', 'nickel', 'copper', 'tin', 'aluminum', 'lead'
    ]

    return miningCommodities.some(commodity =>
      name.includes(commodity) || commodity.includes(name)
    )
  }

  scheduleReconnect () {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }

    this.reconnectTimer = setTimeout(() => {
      logger.info('EDDN: Attempting to reconnect...')
      this.connect()
    }, this.reconnectInterval)
  }

  disconnect () {
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    this.isConnected = false
    logger.info('EDDN: Disconnected')
  }

  getStatistics () {
    const uptime = (Date.now() - this.startTime) / 1000
    return {
      connected: this.isConnected,
      messageCount: this.messageCount,
      uptime,
      messagesPerSecond: (this.messageCount / uptime).toFixed(2)
    }
  }
}

module.exports = EDDNClient
