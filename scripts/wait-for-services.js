#!/usr/bin/env node

/**
 * Wait for Services Script
 * 
 * This script waits for external services (MongoDB, Redis, etc.) to be ready
 * before proceeding with tests or application startup.
 */

const { execSync } = require('child_process');
const net = require('net');

// Service configuration
const SERVICES = {
  mongodb: {
    host: process.env.MONGODB_HOST || 'localhost',
    port: process.env.MONGODB_PORT || 27017,
    name: 'MongoDB'
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    name: 'Redis'
  }
};

// Configuration
const MAX_RETRIES = 30;
const RETRY_INTERVAL = 2000; // 2 seconds
const TIMEOUT = 5000; // 5 seconds per connection attempt

/**
 * Check if a service is available on the given host and port
 */
function checkService(host, port, timeout = TIMEOUT) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    
    const onError = () => {
      socket.destroy();
      resolve(false);
    };
    
    socket.setTimeout(timeout);
    socket.once('error', onError);
    socket.once('timeout', onError);
    
    socket.connect(port, host, () => {
      socket.end();
      resolve(true);
    });
  });
}

/**
 * Wait for a service to become available
 */
async function waitForService(service, maxRetries = MAX_RETRIES) {
  console.log(`⏳ Waiting for ${service.name} on ${service.host}:${service.port}...`);
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const isAvailable = await checkService(service.host, service.port);
      
      if (isAvailable) {
        console.log(`✅ ${service.name} is ready! (attempt ${attempt}/${maxRetries})`);
        return true;
      }
      
      if (attempt < maxRetries) {
        console.log(`⏳ ${service.name} not ready, retrying in ${RETRY_INTERVAL/1000}s... (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
      }
    } catch (error) {
      console.log(`❌ Error checking ${service.name}: ${error.message}`);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
      }
    }
  }
  
  console.log(`❌ ${service.name} failed to become ready after ${maxRetries} attempts`);
  return false;
}

/**
 * Check MongoDB with authentication if credentials are provided
 */
async function checkMongoDB() {
  const { host, port, name } = SERVICES.mongodb;
  
  // First check if MongoDB port is accessible
  const portAccessible = await waitForService(SERVICES.mongodb);
  if (!portAccessible) {
    return false;
  }
  
  // If we have MongoDB credentials, try to authenticate
  const username = process.env.MONGO_INITDB_ROOT_USERNAME || process.env.MONGODB_USERNAME;
  const password = process.env.MONGO_INITDB_ROOT_PASSWORD || process.env.MONGODB_PASSWORD;
  
  if (username && password) {
    console.log(`🔐 Testing MongoDB authentication for user: ${username}`);
    
    try {
      const authCommand = `mongosh --host ${host}:${port} --username ${username} --password ${password} --authenticationDatabase admin --eval "db.adminCommand('ping')" --quiet`;
      execSync(authCommand, { stdio: 'pipe', timeout: 10000 });
      console.log(`✅ MongoDB authentication successful!`);
      return true;
    } catch (error) {
      console.log(`❌ MongoDB authentication failed: ${error.message}`);
      return false;
    }
  }
  
  return true;
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 Starting service availability check...\n');
  
  const servicesToCheck = [];
  
  // Determine which services to check based on environment
  if (process.env.NODE_ENV === 'test' || process.env.CHECK_MONGODB !== 'false') {
    servicesToCheck.push('mongodb');
  }
  
  if (process.env.REDIS_ENABLED === 'true' || process.env.CHECK_REDIS === 'true') {
    servicesToCheck.push('redis');
  }
  
  // If no specific services are requested, check MongoDB by default
  if (servicesToCheck.length === 0) {
    servicesToCheck.push('mongodb');
  }
  
  console.log(`📋 Services to check: ${servicesToCheck.join(', ')}\n`);
  
  let allServicesReady = true;
  
  // Check each service
  for (const serviceName of servicesToCheck) {
    if (serviceName === 'mongodb') {
      const ready = await checkMongoDB();
      if (!ready) allServicesReady = false;
    } else if (SERVICES[serviceName]) {
      const ready = await waitForService(SERVICES[serviceName]);
      if (!ready) allServicesReady = false;
    } else {
      console.log(`❌ Unknown service: ${serviceName}`);
      allServicesReady = false;
    }
    
    console.log(''); // Empty line for better readability
  }
  
  if (allServicesReady) {
    console.log('🎉 All services are ready!');
    process.exit(0);
  } else {
    console.log('💥 Some services failed to become ready');
    process.exit(1);
  }
}

// Handle script termination
process.on('SIGINT', () => {
  console.log('\n🛑 Service check interrupted');
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Service check terminated');
  process.exit(1);
});

// Run the script
if (require.main === module) {
  main().catch((error) => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });
}

module.exports = {
  checkService,
  waitForService,
  checkMongoDB,
  SERVICES
};