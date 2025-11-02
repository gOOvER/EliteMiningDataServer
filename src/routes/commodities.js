const express = require('express')
const router = express.Router()
const logger = require('../services/logger')

// Get best sell prices for a commodity
router.get('/:commodityName/sell', async (req, res) => {
  try {
    const { commodityName } = req.params
    const { limit = 10 } = req.query
    const database = req.app.locals.database

    const prices = await database.getBestCommodityPrices(
      commodityName,
      parseInt(limit),
      'sell'
    )

    res.json({
      commodity: commodityName,
      type: 'sell',
      prices,
      count: prices.length,
    })
  } catch (error) {
    logger.error('Error fetching commodity sell prices:', error)
    res.status(500).json({ error: 'Failed to fetch commodity sell prices' })
  }
})

// Get best buy prices for a commodity
router.get('/:commodityName/buy', async (req, res) => {
  try {
    const { commodityName } = req.params
    const { limit = 10 } = req.query
    const database = req.app.locals.database

    const prices = await database.getBestCommodityPrices(
      commodityName,
      parseInt(limit),
      'buy'
    )

    res.json({
      commodity: commodityName,
      type: 'buy',
      prices,
      count: prices.length,
    })
  } catch (error) {
    logger.error('Error fetching commodity buy prices:', error)
    res.status(500).json({ error: 'Failed to fetch commodity buy prices' })
  }
})

// Get all prices for a commodity (both buy and sell)
router.get('/:commodityName/prices', async (req, res) => {
  try {
    const { commodityName } = req.params
    const { limit = 10 } = req.query
    const database = req.app.locals.database

    const [sellPrices, buyPrices] = await Promise.all([
      database.getBestCommodityPrices(commodityName, parseInt(limit), 'sell'),
      database.getBestCommodityPrices(commodityName, parseInt(limit), 'buy'),
    ])

    res.json({
      commodity: commodityName,
      sellPrices,
      buyPrices,
      sellCount: sellPrices.length,
      buyCount: buyPrices.length,
    })
  } catch (error) {
    logger.error('Error fetching commodity prices:', error)
    res.status(500).json({ error: 'Failed to fetch commodity prices' })
  }
})

// Get mining commodities overview
router.get('/mining/overview', async (req, res) => {
  try {
    const database = req.app.locals.database
    // const inaraClient = req.services.inara

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
    ]

    const overview = {}

    for (const commodity of miningCommodities) {
      const [sellPrices, reports] = await Promise.all([
        database.getBestCommodityPrices(commodity, 5, 'sell'),
        database.allQuery(
          `
          SELECT COUNT(*) as count, AVG(amount) as avg_amount
          FROM mining_reports 
          WHERE material_refined = ? AND timestamp > datetime('now', '-7 days')
        `,
          [commodity]
        ),
      ])

      overview[commodity] = {
        bestSellPrice: sellPrices[0]?.sell_price || 0,
        bestSellStation: sellPrices[0]?.station_name || null,
        bestSellSystem: sellPrices[0]?.system_name || null,
        recentReports: reports[0]?.count || 0,
        averageAmount: reports[0]?.avg_amount || 0,
        topStations: sellPrices.slice(0, 3),
      }
    }

    res.json({
      miningCommodities: overview,
      lastUpdated: new Date().toISOString(),
    })
  } catch (error) {
    logger.error('Error fetching mining commodities overview:', error)
    res
      .status(500)
      .json({ error: 'Failed to fetch mining commodities overview' })
  }
})

// Get commodity price history
router.get('/:commodityName/history', async (req, res) => {
  try {
    const { commodityName } = req.params
    const { days = 7, station, system } = req.query
    const database = req.app.locals.database

    let sql = `
      SELECT DATE(last_updated) as date, 
             AVG(sell_price) as avg_sell_price,
             MAX(sell_price) as max_sell_price,
             MIN(sell_price) as min_sell_price,
             COUNT(*) as station_count
      FROM commodity_prices 
      WHERE commodity_name = ? 
        AND sell_price > 0 
        AND last_updated > datetime('now', '-${parseInt(days)} days')
    `
    const params = [commodityName]

    if (station) {
      sql += ' AND station_name = ?'
      params.push(station)
    }

    if (system) {
      sql += ' AND system_name = ?'
      params.push(system)
    }

    sql += ' GROUP BY DATE(last_updated) ORDER BY date DESC'

    const history = await database.allQuery(sql, params)

    res.json({
      commodity: commodityName,
      period: `${days} days`,
      filters: { station, system },
      history,
      count: history.length,
    })
  } catch (error) {
    logger.error('Error fetching commodity price history:', error)
    res.status(500).json({ error: 'Failed to fetch commodity price history' })
  }
})

// Search commodities
router.get('/search/:searchTerm', async (req, res) => {
  try {
    const { searchTerm } = req.params
    const { limit = 10 } = req.query
    const database = req.app.locals.database

    const commodities = await database.allQuery(
      `
      SELECT DISTINCT commodity_name, 
             COUNT(*) as station_count,
             MAX(sell_price) as max_sell_price,
             AVG(sell_price) as avg_sell_price
      FROM commodity_prices 
      WHERE commodity_name LIKE ? AND sell_price > 0
      GROUP BY commodity_name
      ORDER BY commodity_name
      LIMIT ?
    `,
      [`%${searchTerm}%`, parseInt(limit)]
    )

    res.json({
      searchTerm,
      commodities,
      count: commodities.length,
    })
  } catch (error) {
    logger.error('Error searching commodities:', error)
    res.status(500).json({ error: 'Failed to search commodities' })
  }
})

// Get commodity market data for a specific station
router.get('/station/:stationName/:systemName', async (req, res) => {
  try {
    const { stationName, systemName } = req.params
    const database = req.app.locals.database

    const commodities = await database.allQuery(
      `
      SELECT * FROM commodity_prices 
      WHERE station_name = ? AND system_name = ?
      ORDER BY commodity_name
    `,
      [stationName, systemName]
    )

    if (commodities.length === 0) {
      return res
        .status(404)
        .json({ error: 'No market data found for this station' })
    }

    const lastUpdated = commodities.reduce((latest, commodity) => {
      const date = new Date(commodity.last_updated)
      return date > latest ? date : latest
    }, new Date(0))

    res.json({
      station: stationName,
      system: systemName,
      commodities,
      count: commodities.length,
      lastUpdated: lastUpdated.toISOString(),
    })
  } catch (error) {
    logger.error('Error fetching station market data:', error)
    res.status(500).json({ error: 'Failed to fetch station market data' })
  }
})

module.exports = router
