import http from 'k6/http'
import { check, sleep } from 'k6'

// Load test configuration
export const options = {
  stages: [
    { duration: '30s', target: 20 }, // Ramp up to 20 users
    { duration: '2m', target: 20 },  // Stay at 20 users for 2 minutes
    { duration: '30s', target: 50 }, // Ramp up to 50 users
    { duration: '1m', target: 50 },  // Stay at 50 users for 1 minute
    { duration: '30s', target: 0 },  // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'], // 95% of requests must complete within 1s
    http_req_failed: ['rate<0.05'],    // Error rate must be less than 5%
    http_reqs: ['rate>10'],            // At least 10 requests per second
  },
}

const BASE_URL = __ENV.TEST_BASE_URL || 'http://localhost:3000'

// Test scenarios for different API endpoints
export default function () {
  const scenarios = [
    testHealthEndpoints,
    testMarketEndpoints,
    testStatisticsEndpoints,
    testSystemsEndpoints,
    testMiningEndpoints
  ]

  // Randomly select a scenario to simulate realistic usage patterns
  const scenario = scenarios[Math.floor(Math.random() * scenarios.length)]
  scenario()

  sleep(Math.random() * 3 + 1) // Random sleep between 1-4 seconds
}

function testHealthEndpoints() {
  // Health check endpoint
  const healthRes = http.get(`${BASE_URL}/api/health`)
  check(healthRes, {
    'health status is 200': (r) => r.status === 200,
    'health response time < 100ms': (r) => r.timings.duration < 100,
    'health has uptime': (r) => r.json('uptime') !== undefined,
  })

  // Status endpoint
  const statusRes = http.get(`${BASE_URL}/api/status`)
  check(statusRes, {
    'status endpoint responds': (r) => r.status === 200 || r.status === 503,
    'status response time < 200ms': (r) => r.timings.duration < 200,
  })
}

function testMarketEndpoints() {
  // Market data endpoint
  const marketRes = http.get(`${BASE_URL}/api/market`)
  check(marketRes, {
    'market status is 200': (r) => r.status === 200,
    'market response time < 1000ms': (r) => r.timings.duration < 1000,
  })

  // Commodities endpoint
  const commoditiesRes = http.get(`${BASE_URL}/api/commodities`)
  check(commoditiesRes, {
    'commodities status is 200': (r) => r.status === 200,
    'commodities response time < 1000ms': (r) => r.timings.duration < 1000,
  })

  // Test specific commodity
  const sampleCommodities = ['gold', 'palladium', 'silver', 'platinum', 'tritium']
  const commodity = sampleCommodities[Math.floor(Math.random() * sampleCommodities.length)]
  
  const commodityRes = http.get(`${BASE_URL}/api/market/commodity/${commodity}`)
  check(commodityRes, {
    'specific commodity responds': (r) => r.status === 200 || r.status === 404,
    'commodity response time < 500ms': (r) => r.timings.duration < 500,
  })
}

function testStatisticsEndpoints() {
  // Global statistics
  const statsRes = http.get(`${BASE_URL}/api/stats`)
  check(statsRes, {
    'stats status is 200': (r) => r.status === 200,
    'stats response time < 2000ms': (r) => r.timings.duration < 2000,
  })

  // EDDN statistics
  const eddnStatsRes = http.get(`${BASE_URL}/api/stats/eddn`)
  check(eddnStatsRes, {
    'eddn stats responds': (r) => r.status === 200 || r.status === 503,
    'eddn stats response time < 3000ms': (r) => r.timings.duration < 3000,
  })

  // Mining statistics
  const miningStatsRes = http.get(`${BASE_URL}/api/stats/mining`)
  check(miningStatsRes, {
    'mining stats responds': (r) => r.status === 200 || r.status === 503,
    'mining stats response time < 2000ms': (r) => r.timings.duration < 2000,
  })

  // Detailed statistics
  const detailedStatsRes = http.get(`${BASE_URL}/api/statistics`)
  check(detailedStatsRes, {
    'detailed stats responds': (r) => r.status === 200 || r.status === 503,
    'detailed stats response time < 5000ms': (r) => r.timings.duration < 5000,
  })
}

function testSystemsEndpoints() {
  // Systems endpoint
  const systemsRes = http.get(`${BASE_URL}/api/systems`)
  check(systemsRes, {
    'systems status is 200': (r) => r.status === 200,
    'systems response time < 1000ms': (r) => r.timings.duration < 1000,
  })

  // Test specific system search
  const sampleSystems = ['sol', 'alpha centauri', 'sirius', 'wolf 359', 'lalande 21185']
  const system = sampleSystems[Math.floor(Math.random() * sampleSystems.length)]
  
  const systemSearchRes = http.get(`${BASE_URL}/api/systems/search?name=${encodeURIComponent(system)}`)
  check(systemSearchRes, {
    'system search responds': (r) => r.status === 200 || r.status === 404,
    'system search response time < 800ms': (r) => r.timings.duration < 800,
  })
}

function testMiningEndpoints() {
  // Mining data endpoint
  const miningRes = http.get(`${BASE_URL}/api/mining`)
  check(miningRes, {
    'mining status is 200': (r) => r.status === 200,
    'mining response time < 1500ms': (r) => r.timings.duration < 1500,
  })

  // Mining recommendations
  const miningRecsRes = http.get(`${BASE_URL}/api/mining/recommendations`)
  check(miningRecsRes, {
    'mining recommendations respond': (r) => r.status === 200 || r.status === 503,
    'mining recommendations response time < 2000ms': (r) => r.timings.duration < 2000,
  })

  // Mining hotspots
  const hotspotsRes = http.get(`${BASE_URL}/api/mining/hotspots`)
  check(hotspotsRes, {
    'hotspots respond': (r) => r.status === 200 || r.status === 503,
    'hotspots response time < 1500ms': (r) => r.timings.duration < 1500,
  })
}

// Setup function to run before the test starts
export function setup() {
  console.log('🚀 Starting Elite Mining Data Server API Load Test...')
  console.log(`📊 Target URL: ${BASE_URL}`)
  console.log('⏱️  Test Duration: ~4 minutes`)
  console.log('👥 Max Concurrent Users: 50')
  
  // Verify the API is accessible before starting the load test
  const healthCheck = http.get(`${BASE_URL}/api/health`)
  if (healthCheck.status !== 200) {
    console.error(`❌ Health check failed with status ${healthCheck.status}`)
    console.error('   Make sure the server is running on the specified URL')
    throw new Error('Server not accessible - aborting load test')
  }
  
  console.log('✅ Server is accessible - starting load test')
  return { baseUrl: BASE_URL }
}

// Teardown function to run after the test completes
export function teardown(data) {
  console.log('🏁 Load test completed!')
  console.log(`📈 Results summary available above`)
  console.log(`🌐 Tested server: ${data.baseUrl}`)
}