import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  stages: [
    { duration: '30s', target: 10 }, // Ramp up to 10 users
    { duration: '1m', target: 10 },  // Stay at 10 users
    { duration: '30s', target: 0 },  // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests must complete within 500ms
    http_req_failed: ['rate<0.1'],    // Error rate must be less than 10%
  },
}

const BASE_URL = __ENV.TEST_BASE_URL || 'http://localhost:3000'

export default function () {
  // Test health endpoint
  const healthRes = http.get(`${BASE_URL}/api/health`)
  check(healthRes, {
    'health status is 200': (r) => r.status === 200,
    'health response time < 200ms': (r) => r.timings.duration < 200,
  })

  sleep(1)

  // Test market endpoint
  const marketRes = http.get(`${BASE_URL}/api/market`)
  check(marketRes, {
    'market status is 200': (r) => r.status === 200,
    'market response time < 1000ms': (r) => r.timings.duration < 1000,
  })

  sleep(1)

  // Test commodities endpoint
  const commoditiesRes = http.get(`${BASE_URL}/api/commodities`)
  check(commoditiesRes, {
    'commodities status is 200': (r) => r.status === 200,
    'commodities response time < 1000ms': (r) => r.timings.duration < 1000,
  })

  sleep(1)

  // Test statistics endpoint
  const statsRes = http.get(`${BASE_URL}/api/statistics`)
  check(statsRes, {
    'statistics status is 200': (r) => r.status === 200,
    'statistics response time < 2000ms': (r) => r.timings.duration < 2000,
  })

  sleep(2)
}