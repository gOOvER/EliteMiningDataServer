/* eslint-env k6 */
/* global __ENV */
import http from 'k6/http'
import { check, sleep } from 'k6'

// Simple load test configuration for demo
export const options = {
  stages: [
    { duration: '10s', target: 5 },  // Ramp up to 5 users
    { duration: '20s', target: 5 },  // Stay at 5 users for 20 seconds
    { duration: '10s', target: 0 },  // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95% of requests must complete within 2s
    http_req_failed: ['rate<0.1'],     // Error rate must be less than 10%
  },
}

const BASE_URL = __ENV.TEST_BASE_URL || 'https://httpbin.org'

// Simple test function
export default function () {
  // Test different HTTP methods
  const responses = [
    http.get(`${BASE_URL}/get`),
    http.post(`${BASE_URL}/post`, { test: 'data' }),
    http.get(`${BASE_URL}/status/200`),
  ]

  // Check responses
  responses.forEach((response, index) => {
    check(response, {
      [`request ${index + 1} successful`]: (r) => r.status >= 200 && r.status < 400,
      [`request ${index + 1} fast`]: (r) => r.timings.duration < 1000,
    })
  })

  sleep(1) // Wait 1 second between iterations
}

// Setup function
export function setup() {
  console.log('🎯 k6 Load Test Demo Started!')
  console.log(`📊 Target: ${BASE_URL}`)
  console.log('⏱️  Duration: 40 seconds')
  
  return { baseUrl: BASE_URL }
}

// Teardown function
export function teardown(data) {
  console.log('✅ k6 Load Test Demo Completed!')
  console.log(`🌐 Tested: ${data.baseUrl}`)
}