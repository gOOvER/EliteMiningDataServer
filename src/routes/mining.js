const express = require('express')
const router = express.Router()
const logger = require('../services/logger')

// Get mining sites in a system
router.get('/sites/:systemName', async (req, res) => {
  try {
    const { systemName } = req.params
    const database = req.app.locals.database

    const sites = await database.getSystemMiningData(systemName)

    res.json({
      system: systemName,
      sites,
      count: sites.length,
    })
  } catch (error) {
    logger.error('Error fetching mining sites:', error)
    res.status(500).json({ error: 'Failed to fetch mining sites' })
  }
})

// Get recent mining reports
router.get('/reports', async (req, res) => {
  try {
    const { limit = 50, system, material } = req.query
    const database = req.app.locals.database

    let sql = 'SELECT * FROM mining_reports WHERE 1=1'
    const params = []

    if (system) {
      sql += ' AND system_name = ?'
      params.push(system)
    }

    if (material) {
      sql += ' AND material_refined = ?'
      params.push(material)
    }

    sql += ' ORDER BY timestamp DESC LIMIT ?'
    params.push(parseInt(limit))

    const reports = await database.allQuery(sql, params)

    res.json({
      reports,
      count: reports.length,
      filters: { system, material, limit },
    })
  } catch (error) {
    logger.error('Error fetching mining reports:', error)
    res.status(500).json({ error: 'Failed to fetch mining reports' })
  }
})

// Get mining statistics
router.get('/stats', async (req, res) => {
  try {
    const database = req.app.locals.database

    const [totalSites, totalReports, topMaterials, topSystems] =
      await Promise.all([
        database.getQuery('SELECT COUNT(*) as count FROM mining_sites'),
        database.getQuery('SELECT COUNT(*) as count FROM mining_reports'),
        database.allQuery(`
        SELECT material_refined, COUNT(*) as count 
        FROM mining_reports 
        GROUP BY material_refined 
        ORDER BY count DESC 
        LIMIT 10
      `),
        database.allQuery(`
        SELECT system_name, COUNT(*) as count 
        FROM mining_reports 
        GROUP BY system_name 
        ORDER BY count DESC 
        LIMIT 10
      `),
      ])

    res.json({
      statistics: {
        totalMiningSites: totalSites.count,
        totalMiningReports: totalReports.count,
        topMaterials,
        topSystems,
      },
    })
  } catch (error) {
    logger.error('Error fetching mining statistics:', error)
    res.status(500).json({ error: 'Failed to fetch mining statistics' })
  }
})

// Search for mining opportunities near a system
router.get('/opportunities/:systemName', async (req, res) => {
  try {
    const { systemName } = req.params
    const { radius = 50 } = req.query
    const edsmClient = req.app.locals.edsmClient

    if (!edsmClient) {
      return res.status(503).json({ error: 'EDSM client not available' })
    }

    const opportunities = await edsmClient.getMiningSystemsNearby(
      systemName,
      parseInt(radius)
    )

    res.json({
      referenceSystem: systemName,
      searchRadius: parseInt(radius),
      opportunities,
      count: opportunities.length,
    })
  } catch (error) {
    logger.error('Error fetching mining opportunities:', error)
    res.status(500).json({ error: 'Failed to fetch mining opportunities' })
  }
})

// Get hotspots information
router.get('/hotspots', async (req, res) => {
  try {
    const { material } = req.query
    const database = req.app.locals.database

    let sql = `
      SELECT system_name, body_name, hotspot_materials, coordinates_x, coordinates_y, coordinates_z,
             distance_from_star, last_updated
      FROM mining_sites 
      WHERE site_type = 'hotspot'
    `
    const params = []

    if (material) {
      sql += ' AND hotspot_materials LIKE ?'
      params.push(`%"${material}"%`)
    }

    sql += ' ORDER BY last_updated DESC'

    const hotspots = await database.allQuery(sql, params)

    // Parse JSON hotspot materials
    const processedHotspots = hotspots.map((hotspot) => ({
      ...hotspot,
      hotspot_materials: JSON.parse(hotspot.hotspot_materials || '[]'),
    }))

    res.json({
      hotspots: processedHotspots,
      count: processedHotspots.length,
      filter: material || null,
    })
  } catch (error) {
    logger.error('Error fetching hotspots:', error)
    res.status(500).json({ error: 'Failed to fetch hotspots' })
  }
})

module.exports = router
