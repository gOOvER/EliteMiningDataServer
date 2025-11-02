const axios = require('axios')

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000'
const CONCURRENT_USERS = 5
const DURATION_SECONDS = 30
const REQUEST_DELAY_MS = 1000

describe('Load Tests', () => {
  const makeRequest = async (endpoint) => {
    const start = Date.now()
    try {
      const response = await axios.get(`${BASE_URL}${endpoint}`, { timeout: 5000 })
      const duration = Date.now() - start
      return { success: true, duration, status: response.status }
    } catch (error) {
      const duration = Date.now() - start
      return { success: false, duration, status: error.response?.status || 0 }
    }
  }

  const isServiceAvailable = async () => {
    try {
      await axios.get(`${BASE_URL}/api/health`, { timeout: 2000 })
      return true
    } catch (error) {
      return false
    }
  }

  const runUserSession = async (userId) => {
    const userResults = []
    const endTime = Date.now() + (DURATION_SECONDS * 1000)

    while (Date.now() < endTime) {
      // Test different endpoints
      const endpoints = ['/api/health', '/api/market', '/api/commodities', '/api/statistics']

      for (const endpoint of endpoints) {
        const result = await makeRequest(endpoint)
        userResults.push({ userId, endpoint, ...result, timestamp: Date.now() })

        // Wait between requests
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS))
      }
    }

    return userResults
  }

  test('should handle concurrent load', async () => {
    const serviceAvailable = await isServiceAvailable()

    if (!serviceAvailable) {
      console.warn('Service not available for load testing - skipping')
      expect(true).toBe(true)
      return
    }

    console.log(`Starting load test with ${CONCURRENT_USERS} concurrent users for ${DURATION_SECONDS} seconds`)

    // Start concurrent user sessions
    const userPromises = []
    for (let i = 0; i < CONCURRENT_USERS; i++) {
      userPromises.push(runUserSession(i))
    }

    // Wait for all users to complete
    const allResults = await Promise.all(userPromises)
    const flatResults = allResults.flat()

    // Analyze results
    const successfulRequests = flatResults.filter(r => r.success)
    const failedRequests = flatResults.filter(r => !r.success)

    const totalRequests = flatResults.length
    const successRate = (successfulRequests.length / totalRequests) * 100
    const avgResponseTime = successfulRequests.length > 0
      ? successfulRequests.reduce((sum, r) => sum + r.duration, 0) / successfulRequests.length
      : 0

    console.log('Load Test Results:')
    console.log(`- Total Requests: ${totalRequests}`)
    console.log(`- Successful: ${successfulRequests.length} (${successRate.toFixed(2)}%)`)
    console.log(`- Failed: ${failedRequests.length}`)
    console.log(`- Average Response Time: ${avgResponseTime.toFixed(2)}ms`)

    // Assert performance criteria
    expect(successRate).toBeGreaterThan(90) // 90% success rate
    expect(avgResponseTime).toBeLessThan(5000) // Average response time under 5 seconds
  }, DURATION_SECONDS * 1000 + 10000) // Add buffer time for test timeout

  test('should handle rapid requests to health endpoint', async () => {
    const serviceAvailable = await isServiceAvailable()

    if (!serviceAvailable) {
      console.warn('Service not available for rapid request testing - skipping')
      expect(true).toBe(true)
      return
    }

    const promises = []
    const requestCount = 50

    for (let i = 0; i < requestCount; i++) {
      promises.push(makeRequest('/api/health'))
    }

    const results = await Promise.all(promises)
    const successCount = results.filter(r => r.success).length
    const successRate = (successCount / requestCount) * 100

    console.log(`Rapid requests test: ${successCount}/${requestCount} successful (${successRate.toFixed(2)}%)`)

    expect(successRate).toBeGreaterThan(95) // 95% success rate for health endpoint
  })
})
