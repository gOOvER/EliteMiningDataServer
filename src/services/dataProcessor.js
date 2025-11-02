const logger = require('../services/logger')

class DataProcessor {
  constructor(database) {
    this.database = database
    this.processingQueue = []
    this.isProcessing = false
    this.statistics = {
      totalProcessed: 0,
      miningReports: 0,
      commodityUpdates: 0,
      systemUpdates: 0,
      errors: 0,
    }
  }

  async processEDDNMessage(data) {
    try {
      const schema = data.$schemaRef
      const message = data.message

      if (schema.includes('commodity')) {
        await this.processCommodityMessage(message)
        this.statistics.commodityUpdates++
      } else if (schema.includes('journal')) {
        await this.processJournalMessage(message)
      }

      this.statistics.totalProcessed++
    } catch (error) {
      logger.error('Error processing EDDN message:', error)
      this.statistics.errors++
    }
  }

  async processCommodityMessage(message) {
    try {
      // Extract station and system information
      const stationName = message.stationName
      const systemName = message.systemName
      // const timestamp = data.message?.timestamp || data.timestamp || new Date().toISOString()

      // Store station if not exists
      await this.storeStation({
        name: stationName,
        systemName,
        stationType: message.stationType,
        distanceFromStar: message.distFromStarLS,
        hasMarket: true,
        source: 'eddn',
      })

      // Store system if not exists
      await this.storeSystem({
        name: systemName,
        coordinates: message.systemCoordinates,
        source: 'eddn',
      })

      // Process commodities
      if (message.commodities && Array.isArray(message.commodities)) {
        for (const commodity of message.commodities) {
          await this.database.insertCommodityPrice({
            commodityName: commodity.name,
            commodityId: commodity.id,
            stationName,
            systemName,
            buyPrice: commodity.buyPrice || 0,
            sellPrice: commodity.sellPrice || 0,
            supply: commodity.stock || 0,
            demand: commodity.demand || 0,
            distanceFromStar: message.distFromStarLS,
            stationType: message.stationType,
            source: 'eddn',
          })
        }
      }

      logger.info(
        `Processed commodity data for ${stationName} in ${systemName}`
      )
    } catch (error) {
      logger.error('Error processing commodity message:', error)
    }
  }

  async processJournalMessage(message) {
    try {
      const event = message.event

      switch (event) {
        case 'MiningRefined':
          await this.processMiningRefined(message)
          break

        case 'ProspectedAsteroid':
          await this.processProspectedAsteroid(message)
          break

        case 'AsteroidCracked':
          await this.processAsteroidCracked(message)
          break

        case 'MarketSell':
          await this.processMarketSell(message)
          break

        default:
          // Log unknown mining-related events for future implementation
          if (this.isMiningRelated(message)) {
            logger.info(`Unknown mining event: ${event}`, { message })
          }
      }
    } catch (error) {
      logger.error(`Error processing journal event ${message.event}:`, error)
    }
  }

  async processMiningRefined(message) {
    await this.database.insertMiningReport({
      commanderName: null, // EDDN anonymizes commander names
      systemName: message.StarSystem,
      bodyName: message.Body,
      materialRefined: message.Type,
      amount: 1,
      source: 'eddn',
    })

    this.statistics.miningReports++
    logger.info(`Mining refined: ${message.Type} in ${message.StarSystem}`)
  }

  async processProspectedAsteroid(message) {
    // Store information about prospected asteroids
    // This could be used to build a database of asteroid compositions
    if (message.Materials && Array.isArray(message.Materials)) {
      for (const material of message.Materials) {
        // Could store prospect data for analysis
        logger.debug(
          `Asteroid prospect: ${material.Name} (${material.Proportion}%) in ${message.StarSystem}`
        )
      }
    }
  }

  async processAsteroidCracked(message) {
    // Log asteroid cracking events
    logger.info(`Asteroid cracked in ${message.StarSystem} at ${message.Body}`)
  }

  async processMarketSell(message) {
    // If it's a mining commodity being sold, track it
    if (this.isMiningCommodity(message.Type)) {
      logger.info(
        `Mining commodity sold: ${message.Count}x ${message.Type} for ${message.TotalSale} credits`
      )
    }
  }

  async storeStation(stationData) {
    try {
      const sql = `
        INSERT OR IGNORE INTO stations 
        (name, system_name, station_type, distance_from_star, has_market, source)
        VALUES (?, ?, ?, ?, ?, ?)
      `

      await this.database.runQuery(sql, [
        stationData.name,
        stationData.systemName,
        stationData.stationType,
        stationData.distanceFromStar,
        stationData.hasMarket ? 1 : 0,
        stationData.source,
      ])
    } catch (error) {
      logger.error('Error storing station:', error)
    }
  }

  async storeSystem(systemData) {
    try {
      const sql = `
        INSERT OR IGNORE INTO systems 
        (name, coordinates_x, coordinates_y, coordinates_z, source)
        VALUES (?, ?, ?, ?, ?)
      `

      const coords = systemData.coordinates || {}

      await this.database.runQuery(sql, [
        systemData.name,
        coords.x || null,
        coords.y || null,
        coords.z || null,
        systemData.source,
      ])

      this.statistics.systemUpdates++
    } catch (error) {
      logger.error('Error storing system:', error)
    }
  }

  isMiningRelated(message) {
    const miningEvents = [
      'MiningRefined',
      'ProspectedAsteroid',
      'AsteroidCracked',
      'LaunchSRV',
      'DockSRV',
    ]

    return miningEvents.includes(message.event)
  }

  isMiningCommodity(commodityName) {
    const miningCommodities = [
      'Painite',
      'Void Opals',
      'Low Temperature Diamonds',
      'Alexandrite',
      'Benitoite',
      'Grandidierite',
      'Monazite',
      'Musgravite',
      'Rhodplumsite',
      'Serendibite',
      'Taaffeite',
      'Tritium',
      'Platinum',
      'Osmium',
      'Gold',
      'Silver',
      'Palladium',
      'Bertrandite',
      'Indite',
      'Gallite',
      'Praseodymium',
      'Samarium',
      'Bromellite',
    ]

    return miningCommodities.includes(commodityName)
  }

  async aggregateHourlyData() {
    try {
      // Aggregate mining reports by hour
      const hourlyMining = await this.database.allQuery(`
        SELECT 
          datetime(timestamp, 'start of hour') as hour,
          material_refined,
          COUNT(*) as count,
          system_name
        FROM mining_reports 
        WHERE timestamp > datetime('now', '-24 hours')
        GROUP BY hour, material_refined, system_name
        ORDER BY hour DESC
      `)

      // Aggregate commodity price changes
      const priceChanges = await this.database.allQuery(`
        SELECT 
          commodity_name,
          COUNT(DISTINCT station_name) as stations_updated,
          AVG(sell_price) as avg_sell_price,
          MAX(sell_price) as max_sell_price,
          datetime(last_updated, 'start of hour') as hour
        FROM commodity_prices 
        WHERE last_updated > datetime('now', '-24 hours')
          AND sell_price > 0
        GROUP BY commodity_name, hour
        ORDER BY hour DESC
      `)

      return {
        hourlyMining,
        priceChanges,
        generatedAt: new Date().toISOString(),
      }
    } catch (error) {
      logger.error('Error aggregating hourly data:', error)
      return null
    }
  }

  async generateMiningHotspotAnalysis() {
    try {
      // Analyze mining reports to identify potential hotspots
      const hotspotAnalysis = await this.database.allQuery(`
        SELECT 
          system_name,
          body_name,
          material_refined,
          COUNT(*) as mining_frequency,
          COUNT(DISTINCT DATE(timestamp)) as active_days,
          MIN(timestamp) as first_report,
          MAX(timestamp) as last_report
        FROM mining_reports 
        WHERE timestamp > datetime('now', '-30 days')
        GROUP BY system_name, body_name, material_refined
        HAVING mining_frequency >= 5
        ORDER BY mining_frequency DESC
      `)

      // Group by system and material for hotspot detection
      const systemHotspots = {}

      for (const report of hotspotAnalysis) {
        const key = `${report.system_name}_${report.material_refined}`

        if (!systemHotspots[key]) {
          systemHotspots[key] = {
            systemName: report.system_name,
            material: report.material_refined,
            bodies: [],
            totalFrequency: 0,
            activeDays: new Set(),
          }
        }

        systemHotspots[key].bodies.push({
          bodyName: report.body_name,
          frequency: report.mining_frequency,
          activeDays: report.active_days,
          firstReport: report.first_report,
          lastReport: report.last_report,
        })

        systemHotspots[key].totalFrequency += report.mining_frequency
        systemHotspots[key].activeDays.add(report.active_days)
      }

      // Convert to array and sort by frequency
      const hotspots = Object.values(systemHotspots)
        .map((hotspot) => ({
          ...hotspot,
          activeDays: Array.from(hotspot.activeDays).reduce((a, b) => a + b, 0),
        }))
        .sort((a, b) => b.totalFrequency - a.totalFrequency)

      return hotspots
    } catch (error) {
      logger.error('Error generating hotspot analysis:', error)
      return []
    }
  }

  getStatistics() {
    return {
      ...this.statistics,
      queueSize: this.processingQueue.length,
      isProcessing: this.isProcessing,
    }
  }

  resetStatistics() {
    this.statistics = {
      totalProcessed: 0,
      miningReports: 0,
      commodityUpdates: 0,
      systemUpdates: 0,
      errors: 0,
    }
  }
}

module.exports = DataProcessor
