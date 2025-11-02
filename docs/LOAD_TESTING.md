# Load Testing Guide

## Overview
This project supports multiple load testing approaches:

1. **Jest-based load tests** (built-in, no additional tools required)
2. **k6 load tests** (requires k6 installation, more comprehensive)

## Jest Load Tests (Recommended for CI/CD)

### Quick Start
```bash
npm run test:load
```

### Features
- ✅ No additional installation required
- ✅ Integrated with existing test suite
- ✅ Works in CI/CD environments
- ✅ Concurrent user simulation
- ✅ Response time measurements
- ✅ Error rate tracking

## k6 Load Tests (Advanced Performance Testing)

### Installation

#### Windows
```powershell
# Using Chocolatey
choco install k6

# Using Scoop
scoop install k6

# Using winget
winget install k6
```

#### macOS
```bash
# Using Homebrew
brew install k6
```

#### Linux
```bash
# Ubuntu/Debian
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# CentOS/RHEL
sudo dnf install https://dl.k6.io/rpm/repo.rpm
sudo dnf install k6
```

#### Docker (Alternative)
```bash
# Run k6 in Docker container
docker run --rm -i grafana/k6 run - < tests/load/api-load-test.js
```

### Usage

#### Full Load Test (4 minutes, up to 50 users)
```bash
npm run test:load:k6
```

#### Quick Load Test (30 seconds, 10 users)
```bash
npm run test:load:k6:short
```

#### Custom Configuration
```bash
# Custom duration and users
k6 run --duration=2m --vus=25 tests/load/api-load-test.js

# With custom base URL
TEST_BASE_URL=http://your-server:3000 k6 run tests/load/api-load-test.js
```

### k6 Features
- 🚀 High-performance load testing
- 📊 Real-time metrics
- 🎯 Advanced thresholds and SLAs
- 📈 Detailed performance insights
- 🌐 Multiple test scenarios
- ⏱️ Realistic user behavior simulation

## Test Scenarios

Both testing approaches cover:

- **Health Endpoints**: `/api/health`, `/api/status`
- **Market Data**: `/api/market`, `/api/commodities`
- **Statistics**: `/api/stats`, `/api/stats/eddn`, `/api/stats/mining`
- **Systems**: `/api/systems`, system search
- **Mining**: `/api/mining`, recommendations, hotspots

## Performance Targets

### Response Times
- Health endpoints: < 100ms
- Market data: < 1000ms
- Statistics: < 2000ms (simple), < 5000ms (detailed)
- Systems: < 800ms
- Mining: < 1500ms

### Reliability
- Error rate: < 5%
- Availability: > 99%
- Concurrent users: Up to 50

## Troubleshooting

### k6 Not Found
If you get "k6: command not found":
1. Install k6 using one of the methods above
2. Restart your terminal
3. Verify installation: `k6 version`

### Server Not Running
Make sure the Elite Mining Data Server is running:
```bash
npm start
# or
npm run dev
```

### Connection Issues
Check if the server is accessible:
```bash
curl http://localhost:3000/api/health
# or
npm run health-check
```

## Integration with CI/CD

The Jest-based load tests (`npm run test:load`) are automatically included in:
- GitHub Actions workflows
- Docker container testing
- Local development testing

For k6 tests in CI/CD, you need to:
1. Install k6 in the CI environment
2. Add k6 test steps to your workflow
3. Configure performance thresholds

## Monitoring and Metrics

Both test types provide:
- Request success/failure rates
- Response time percentiles
- Throughput (requests per second)
- Error distribution
- Performance trends

Use the results to:
- Identify performance bottlenecks
- Validate SLA compliance
- Optimize server configuration
- Plan capacity requirements