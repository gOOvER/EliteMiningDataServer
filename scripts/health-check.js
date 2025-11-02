#!/usr/bin/env node

/**
 * Health Check Script
 * 
 * This script performs health checks on the application and its services.
 * Useful for CI/CD pipelines and deployment verification.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// Configuration
const DEFAULT_TIMEOUT = 10000; // 10 seconds
const DEFAULT_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

/**
 * Perform HTTP health check
 */
function healthCheck(url, options = {}) {
  return new Promise((resolve, reject) => {
    const {
      timeout = DEFAULT_TIMEOUT,
      expectedStatus = 200,
      expectedContent = null
    } = options;

    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      timeout: timeout,
      headers: {
        'User-Agent': 'Health-Check-Script/1.0'
      }
    };

    const req = client.request(requestOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        const result = {
          url,
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: res.headers,
          body: data,
          responseTime: Date.now() - startTime
        };
        
        // Check status code
        if (res.statusCode !== expectedStatus) {
          return reject(new Error(`Expected status ${expectedStatus}, got ${res.statusCode}`));
        }
        
        // Check content if specified
        if (expectedContent && !data.includes(expectedContent)) {
          return reject(new Error(`Expected content "${expectedContent}" not found in response`));
        }
        
        resolve(result);
      });
    });

    const startTime = Date.now();
    
    req.on('error', (error) => {
      reject(new Error(`Request failed: ${error.message}`));
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout after ${timeout}ms`));
    });
    
    req.end();
  });
}

/**
 * Perform health check with retries
 */
async function healthCheckWithRetries(url, options = {}) {
  const { retries = DEFAULT_RETRIES, retryDelay = RETRY_DELAY } = options;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🔍 Health check attempt ${attempt}/${retries}: ${url}`);
      const result = await healthCheck(url, options);
      console.log(`✅ Health check passed (${result.responseTime}ms)`);
      return result;
    } catch (error) {
      console.log(`❌ Health check failed (attempt ${attempt}/${retries}): ${error.message}`);
      
      if (attempt < retries) {
        console.log(`⏳ Retrying in ${retryDelay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }
  
  throw new Error(`Health check failed after ${retries} attempts`);
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    url: 'http://localhost:3000/health',
    timeout: DEFAULT_TIMEOUT,
    retries: DEFAULT_RETRIES,
    expectedStatus: 200,
    expectedContent: null
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    
    switch (arg) {
      case '--url':
      case '-u':
        if (nextArg) {
          options.url = nextArg;
          i++;
        }
        break;
      case '--timeout':
      case '-t':
        if (nextArg) {
          options.timeout = parseInt(nextArg);
          i++;
        }
        break;
      case '--retries':
      case '-r':
        if (nextArg) {
          options.retries = parseInt(nextArg);
          i++;
        }
        break;
      case '--status':
      case '-s':
        if (nextArg) {
          options.expectedStatus = parseInt(nextArg);
          i++;
        }
        break;
      case '--content':
      case '-c':
        if (nextArg) {
          options.expectedContent = nextArg;
          i++;
        }
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
    }
  }
  
  return options;
}

/**
 * Print help information
 */
function printHelp() {
  console.log(`
Health Check Script

Usage: node health-check.js [options]

Options:
  -u, --url <url>           URL to check (default: http://localhost:3000/health)
  -t, --timeout <ms>        Request timeout in milliseconds (default: 10000)
  -r, --retries <count>     Number of retry attempts (default: 3)
  -s, --status <code>       Expected HTTP status code (default: 200)
  -c, --content <text>      Expected content in response body
  -h, --help                Show this help message

Environment Variables:
  HEALTH_CHECK_URL          Override default URL
  HEALTH_CHECK_TIMEOUT      Override default timeout
  HEALTH_CHECK_RETRIES      Override default retry count

Examples:
  node health-check.js
  node health-check.js --url http://localhost:3000/api/status
  node health-check.js --url http://localhost:3000/health --content "healthy"
  node health-check.js --timeout 5000 --retries 5
`);
}

/**
 * Main function
 */
async function main() {
  try {
    const options = parseArgs();
    
    // Override with environment variables if set
    if (process.env.HEALTH_CHECK_URL) {
      options.url = process.env.HEALTH_CHECK_URL;
    }
    if (process.env.HEALTH_CHECK_TIMEOUT) {
      options.timeout = parseInt(process.env.HEALTH_CHECK_TIMEOUT);
    }
    if (process.env.HEALTH_CHECK_RETRIES) {
      options.retries = parseInt(process.env.HEALTH_CHECK_RETRIES);
    }
    
    console.log('🏥 Starting health check...');
    console.log(`📋 Configuration:
   URL: ${options.url}
   Timeout: ${options.timeout}ms
   Retries: ${options.retries}
   Expected Status: ${options.expectedStatus}
   Expected Content: ${options.expectedContent || 'none'}
`);
    
    const result = await healthCheckWithRetries(options.url, options);
    
    console.log('\n🎉 Health check completed successfully!');
    console.log(`📊 Result:
   Status: ${result.status} ${result.statusText}
   Response Time: ${result.responseTime}ms
   Content Length: ${result.body.length} bytes
`);
    
    process.exit(0);
  } catch (error) {
    console.error('\n💥 Health check failed:', error.message);
    process.exit(1);
  }
}

// Handle script termination
process.on('SIGINT', () => {
  console.log('\n🛑 Health check interrupted');
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Health check terminated');
  process.exit(1);
});

// Run the script
if (require.main === module) {
  main();
}

module.exports = {
  healthCheck,
  healthCheckWithRetries
};