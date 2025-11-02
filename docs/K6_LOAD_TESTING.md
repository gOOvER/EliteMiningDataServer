# k6 Load Testing Setup

## Quick Installation

### Windows (PowerShell)
```powershell
# Using Chocolatey
choco install k6

# Using Winget
winget install k6.k6

# Using Scoop
scoop install k6
```

### macOS
```bash
# Using Homebrew
brew install k6
```

### Linux
```bash
# Ubuntu/Debian
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# CentOS/RHEL
sudo dnf install https://dl.k6.io/rpm/repo.rpm
sudo dnf install k6
```

## Running Load Tests

### Start the Server First
```bash
# Start the Elite Mining Data Server
npm start
# or
docker-compose up
```

### Run Load Tests
```bash
# Full load test (4 minutes, up to 50 users)
k6 run tests/load/api-load-test.js

# Quick test (30 seconds, 10 users)
k6 run tests/load/api-load-test.js --duration 30s --vus 10

# Custom target URL
TEST_BASE_URL=http://localhost:8080 k6 run tests/load/api-load-test.js

# With custom stages
k6 run tests/load/api-load-test.js --stage 10s:5,30s:10,10s:0
```

### NPM Script Integration
```bash
# Use the configured npm scripts
npm run test:load:k6        # Full load test
npm run test:load:k6:short  # Quick test
```

## Test Configuration

The load test includes:
- **Ramp-up**: 20 users over 30s
- **Steady**: 20 users for 2 minutes  
- **Peak**: 50 users for 1 minute
- **Ramp-down**: 0 users over 30s

### Performance Thresholds
- Response time: 95% < 1000ms
- Error rate: < 5%
- Request rate: > 10 req/s

## Interpreting Results

k6 provides detailed metrics:
- **http_req_duration**: Response times (avg, min, max, p95)
- **http_req_failed**: Error rate percentage
- **http_reqs**: Total requests and rate
- **vus**: Active virtual users

Example output:
```
✓ health status is 200
✓ health response time < 500ms
✓ stats response time < 2000ms

http_req_duration..........: avg=245ms min=12ms med=198ms max=1.2s p(95)=680ms
http_req_failed............: 0.15% ✓ 8 ✗ 5234
http_reqs..................: 5242 17.47/s
vus........................: 50 min=0 max=50
```

## Troubleshooting

### Common Issues
1. **Server not running**: Ensure the API server is accessible
2. **High error rates**: Check server capacity and database connections
3. **Slow responses**: Monitor server resources and database performance

### Performance Tips
- Run tests from a separate machine for accurate results
- Monitor server resources during tests
- Use multiple test scenarios for comprehensive coverage