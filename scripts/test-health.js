#!/usr/bin/env node

/**
 * Test script to verify health endpoint functionality
 */
const http = require('http')

function testHealthEndpoint () {
  console.log('🔍 Testing health endpoint...')

  const req = http.get('http://localhost:3000/health', (res) => {
    console.log(`📊 Status Code: ${res.statusCode}`)

    let data = ''
    res.on('data', (chunk) => {
      data += chunk
    })

    res.on('end', () => {
      try {
        const response = JSON.parse(data)
        console.log('✅ Health Response:', JSON.stringify(response, null, 2))
        
        if (res.statusCode === 200) {
          console.log('🎉 Health check successful!')
          process.exit(0)
        } else {
          console.log('❌ Health check failed with status:', res.statusCode)
          process.exit(1)
        }
      } catch (error) {
        console.error('❌ Failed to parse response:', error.message)
        console.log('Raw response:', data)
        process.exit(1)
      }
    })
  })

  req.on('error', (error) => {
    console.error('❌ Health check request failed:', error.message)
    process.exit(1)
  })

  req.setTimeout(5000, () => {
    req.destroy()
    console.error('❌ Health check timeout')
    process.exit(1)
  })
}

// Run the test
testHealthEndpoint()