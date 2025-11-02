const express = require('express')
const router = express.Router()
const logger = require('../services/logger')

// Get system information
router.get('/:systemName', async (req, res) => {
  try {
    const { systemName } = req.params
    const database = req.app.locals.database
    const edsmClient = req.app.locals.edsmClient

    // Get from database first
    let systemInfo = await database.getQuery(
      'SELECT * FROM systems WHERE name = ?',
      [systemName]
    )

    // If not in database and EDSM client available, fetch from EDSM
    if (!systemInfo && edsmClient) {
      try {
        const edsmData = await edsmClient.getSystemInfo(systemName)
        if (edsmData) {
          // Store in database
          await database.runQuery(`
            INSERT OR REPLACE INTO systems 
            (name, coordinates_x, coordinates_y, coordinates_z, population, 
             allegiance, government, economy, security, primary_star_type, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            edsmData.name,
            edsmData.coords?.x,
            edsmData.coords?.y,
            edsmData.coords?.z,
            edsmData.population || 0,
            edsmData.allegiance,
            edsmData.government,
            edsmData.economy,
            edsmData.security,
            edsmData.primaryStar?.type,
            'edsm'
          ])

          systemInfo = edsmData
        }
      } catch (edsmError) {
        logger.warn(`Failed to fetch system ${systemName} from EDSM:`, edsmError.message)
      }
    }

    if (!systemInfo) {
      return res.status(404).json({ error: 'System not found' })
    }

    // Get stations in system
    const stations = await database.allQuery(
      'SELECT * FROM stations WHERE system_name = ?',
      [systemName]
    )

    // Get mining sites in system
    const miningSites = await database.allQuery(
      'SELECT * FROM mining_sites WHERE system_name = ?',
      [systemName]
    )

    res.json({
      system: systemInfo,
      stations,
      miningSites,
      stationCount: stations.length,
      miningSiteCount: miningSites.length
    })
  } catch (error) {
    logger.error('Error fetching system information:', error)
    res.status(500).json({ error: 'Failed to fetch system information' })
  }
})

// Search systems by name
router.get('/search/:searchTerm', async (req, res) => {
  try {
    const { searchTerm } = req.params
    const { limit = 10 } = req.query
    const database = req.app.locals.database
    const edsmClient = req.app.locals.edsmClient

    // Search in local database first
    let systems = await database.allQuery(`
      SELECT * FROM systems 
      WHERE name LIKE ? 
      ORDER BY name 
      LIMIT ?
    `, [`%${searchTerm}%`, parseInt(limit)])

    // If not enough results and EDSM available, search EDSM
    if (systems.length < parseInt(limit) && edsmClient) {
      try {
        const edsmSystems = await edsmClient.findSystemsByName(searchTerm, parseInt(limit))

        // Add EDSM results that aren't in our database
        for (const edsmSystem of edsmSystems) {
          const exists = systems.find(s => s.name === edsmSystem.name)
          if (!exists) {
            systems.push(edsmSystem)

            // Store in database for future use
            await database.runQuery(`
              INSERT OR IGNORE INTO systems 
              (name, coordinates_x, coordinates_y, coordinates_z, population, 
               allegiance, government, economy, security, source)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              edsmSystem.name,
              edsmSystem.coords?.x,
              edsmSystem.coords?.y,
              edsmSystem.coords?.z,
              edsmSystem.population || 0,
              edsmSystem.allegiance,
              edsmSystem.government,
              edsmSystem.economy,
              edsmSystem.security,
              'edsm'
            ])
          }
        }

        // Limit final results
        systems = systems.slice(0, parseInt(limit))
      } catch (edsmError) {
        logger.warn(`EDSM search failed for "${searchTerm}":`, edsmError.message)
      }
    }

    res.json({
      searchTerm,
      systems,
      count: systems.length
    })
  } catch (error) {
    logger.error('Error searching systems:', error)
    res.status(500).json({ error: 'Failed to search systems' })
  }
})

// Get nearby systems
router.get('/:systemName/nearby', async (req, res) => {
  try {
    const { systemName } = req.params
    const { radius = 50 } = req.query
    const edsmClient = req.app.locals.edsmClient

    if (!edsmClient) {
      return res.status(503).json({ error: 'EDSM client not available' })
    }

    const nearbySystems = await edsmClient.getNearbySystemsWithMaterials(
      systemName,
      parseInt(radius)
    )

    res.json({
      referenceSystem: systemName,
      radius: parseInt(radius),
      nearbySystems,
      count: nearbySystems.length
    })
  } catch (error) {
    logger.error('Error fetching nearby systems:', error)
    res.status(500).json({ error: 'Failed to fetch nearby systems' })
  }
})

// Calculate distance between two systems
router.get('/:system1/distance/:system2', async (req, res) => {
  try {
    const { system1, system2 } = req.params
    const edsmClient = req.app.locals.edsmClient

    if (!edsmClient) {
      return res.status(503).json({ error: 'EDSM client not available' })
    }

    const distance = await edsmClient.getDistanceBetweenSystems(system1, system2)

    if (!distance) {
      return res.status(404).json({ error: 'Could not calculate distance' })
    }

    res.json(distance)
  } catch (error) {
    logger.error('Error calculating system distance:', error)
    res.status(500).json({ error: 'Failed to calculate distance' })
  }
})

// Get stations in a system
router.get('/:systemName/stations', async (req, res) => {
  try {
    const { systemName } = req.params
    const database = req.app.locals.database

    const stations = await database.allQuery(`
      SELECT s.*, COUNT(cp.id) as commodity_count
      FROM stations s
      LEFT JOIN commodity_prices cp ON s.name = cp.station_name AND s.system_name = cp.system_name
      WHERE s.system_name = ?
      GROUP BY s.id
      ORDER BY s.distance_from_star ASC
    `, [systemName])

    res.json({
      system: systemName,
      stations,
      count: stations.length
    })
  } catch (error) {
    logger.error('Error fetching system stations:', error)
    res.status(500).json({ error: 'Failed to fetch system stations' })
  }
})

module.exports = router
