const sqlite3 = require('sqlite3').verbose()
const path = require('path')
const fs = require('fs')
const logger = require('./logger')

class DatabaseService {
  constructor (config) {
    this.dbPath = config.dbPath || './data/mining_data.db'
    this.db = null
    this.cache = new Map()
    this.cacheTimeout = config.cacheTimeout || 15 * 60 * 1000 // 15 minutes

    this.ensureDirectoryExists()
  }

  ensureDirectoryExists () {
    const dir = path.dirname(this.dbPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  async initialize () {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          logger.error('Database connection error:', err)
          reject(err)
        } else {
          logger.info(`Connected to SQLite database: ${this.dbPath}`)
          this.createTables().then(resolve).catch(reject)
        }
      })
    })
  }

  async createTables () {
    const tables = [
      // Mining sites table
      `CREATE TABLE IF NOT EXISTS mining_sites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        system_name TEXT NOT NULL,
        body_name TEXT,
        site_type TEXT NOT NULL, -- 'asteroid_belt', 'planetary_ring', 'hotspot'
        material_type TEXT, -- 'metallic', 'metal_rich', 'rocky', 'icy'
        hotspot_materials TEXT, -- JSON array of materials
        coordinates_x REAL,
        coordinates_y REAL,
        coordinates_z REAL,
        distance_from_star INTEGER,
        ring_mass REAL,
        ring_inner_radius REAL,
        ring_outer_radius REAL,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        source TEXT NOT NULL, -- 'eddn', 'edsm', 'inara'
        UNIQUE(system_name, body_name, site_type)
      )`,

      // Commodity prices table
      `CREATE TABLE IF NOT EXISTS commodity_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        commodity_name TEXT NOT NULL,
        commodity_id INTEGER,
        station_name TEXT NOT NULL,
        system_name TEXT NOT NULL,
        buy_price INTEGER DEFAULT 0,
        sell_price INTEGER DEFAULT 0,
        supply INTEGER DEFAULT 0,
        demand INTEGER DEFAULT 0,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        distance_from_star INTEGER,
        station_type TEXT,
        source TEXT NOT NULL,
        UNIQUE(commodity_name, station_name, system_name)
      )`,

      // Systems table
      `CREATE TABLE IF NOT EXISTS systems (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        coordinates_x REAL,
        coordinates_y REAL,
        coordinates_z REAL,
        population BIGINT DEFAULT 0,
        allegiance TEXT,
        government TEXT,
        economy TEXT,
        security TEXT,
        primary_star_type TEXT,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        source TEXT NOT NULL
      )`,

      // Stations table
      `CREATE TABLE IF NOT EXISTS stations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        system_name TEXT NOT NULL,
        station_type TEXT,
        distance_from_star INTEGER,
        has_market BOOLEAN DEFAULT 0,
        has_shipyard BOOLEAN DEFAULT 0,
        has_outfitting BOOLEAN DEFAULT 0,
        has_refuel BOOLEAN DEFAULT 0,
        has_repair BOOLEAN DEFAULT 0,
        has_rearm BOOLEAN DEFAULT 0,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        source TEXT NOT NULL,
        UNIQUE(name, system_name)
      )`,

      // Mining reports table (from EDDN)
      `CREATE TABLE IF NOT EXISTS mining_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        commander_name TEXT,
        system_name TEXT NOT NULL,
        body_name TEXT,
        material_refined TEXT NOT NULL,
        amount INTEGER DEFAULT 1,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        source TEXT NOT NULL
      )`
    ]

    for (const table of tables) {
      await this.runQuery(table)
    }

    // Create indexes for better performance
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_commodity_prices_commodity ON commodity_prices(commodity_name)',
      'CREATE INDEX IF NOT EXISTS idx_commodity_prices_system ON commodity_prices(system_name)',
      'CREATE INDEX IF NOT EXISTS idx_commodity_prices_updated ON commodity_prices(last_updated)',
      'CREATE INDEX IF NOT EXISTS idx_mining_sites_system ON mining_sites(system_name)',
      'CREATE INDEX IF NOT EXISTS idx_mining_sites_material ON mining_sites(material_type)',
      'CREATE INDEX IF NOT EXISTS idx_systems_name ON systems(name)',
      'CREATE INDEX IF NOT EXISTS idx_stations_system ON stations(system_name)',
      'CREATE INDEX IF NOT EXISTS idx_mining_reports_system ON mining_reports(system_name)',
      'CREATE INDEX IF NOT EXISTS idx_mining_reports_material ON mining_reports(material_refined)'
    ]

    for (const index of indexes) {
      await this.runQuery(index)
    }

    logger.info('Database tables and indexes created successfully')
  }

  runQuery (sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) {
          logger.error('Database query error:', err)
          reject(err)
        } else {
          resolve({ id: this.lastID, changes: this.changes })
        }
      })
    })
  }

  getQuery (sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          logger.error('Database query error:', err)
          reject(err)
        } else {
          resolve(row)
        }
      })
    })
  }

  allQuery (sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          logger.error('Database query error:', err)
          reject(err)
        } else {
          resolve(rows)
        }
      })
    })
  }

  // Cache methods
  setCache (key, value, customTimeout = null) {
    const timeout = customTimeout || this.cacheTimeout
    const expiry = Date.now() + timeout
    this.cache.set(key, { value, expiry })
  }

  getCache (key) {
    const cached = this.cache.get(key)
    if (!cached) return null

    if (Date.now() > cached.expiry) {
      this.cache.delete(key)
      return null
    }

    return cached.value
  }

  clearCache () {
    this.cache.clear()
  }

  clearExpiredCache () {
    const now = Date.now()
    for (const [key, value] of this.cache.entries()) {
      if (now > value.expiry) {
        this.cache.delete(key)
      }
    }
  }

  // Data insertion methods
  async insertCommodityPrice (data) {
    const sql = `
      INSERT OR REPLACE INTO commodity_prices 
      (commodity_name, commodity_id, station_name, system_name, buy_price, sell_price, 
       supply, demand, distance_from_star, station_type, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

    const params = [
      data.commodityName,
      data.commodityId,
      data.stationName,
      data.systemName,
      data.buyPrice || 0,
      data.sellPrice || 0,
      data.supply || 0,
      data.demand || 0,
      data.distanceFromStar,
      data.stationType,
      data.source
    ]

    return this.runQuery(sql, params)
  }

  async insertMiningSite (data) {
    const sql = `
      INSERT OR REPLACE INTO mining_sites 
      (system_name, body_name, site_type, material_type, hotspot_materials,
       coordinates_x, coordinates_y, coordinates_z, distance_from_star,
       ring_mass, ring_inner_radius, ring_outer_radius, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

    const params = [
      data.systemName,
      data.bodyName,
      data.siteType,
      data.materialType,
      JSON.stringify(data.hotspotMaterials || []),
      data.coordinates?.x,
      data.coordinates?.y,
      data.coordinates?.z,
      data.distanceFromStar,
      data.ringMass,
      data.ringInnerRadius,
      data.ringOuterRadius,
      data.source
    ]

    return this.runQuery(sql, params)
  }

  async insertMiningReport (data) {
    const sql = `
      INSERT INTO mining_reports 
      (commander_name, system_name, body_name, material_refined, amount, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `

    const params = [
      data.commanderName,
      data.systemName,
      data.bodyName,
      data.materialRefined,
      data.amount || 1,
      data.source
    ]

    return this.runQuery(sql, params)
  }

  // Query methods
  async getBestCommodityPrices (commodityName, limit = 10, priceType = 'sell') {
    const cacheKey = `best_${priceType}_${commodityName}_${limit}`
    const cached = this.getCache(cacheKey)
    if (cached) return cached

    const orderBy = priceType === 'sell' ? 'sell_price DESC' : 'buy_price ASC'
    const priceField = priceType === 'sell' ? 'sell_price' : 'buy_price'

    const sql = `
      SELECT * FROM commodity_prices 
      WHERE commodity_name = ? AND ${priceField} > 0
      ORDER BY ${orderBy}
      LIMIT ?
    `

    const results = await this.allQuery(sql, [commodityName, limit])
    this.setCache(cacheKey, results, 10 * 60 * 1000) // 10 minutes
    return results
  }

  async getSystemMiningData (systemName) {
    const cacheKey = `mining_data_${systemName}`
    const cached = this.getCache(cacheKey)
    if (cached) return cached

    const sql = `
      SELECT * FROM mining_sites 
      WHERE system_name = ?
      ORDER BY distance_from_star ASC
    `

    const results = await this.allQuery(sql, [systemName])
    this.setCache(cacheKey, results)
    return results
  }

  async close () {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            logger.error('Error closing database:', err)
          } else {
            logger.info('Database connection closed')
          }
          resolve()
        })
      } else {
        resolve()
      }
    })
  }
}

module.exports = DatabaseService
