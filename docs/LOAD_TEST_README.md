# Elite Mining Data Server - Load Testing

## 🚀 Quick Start

The Elite Mining Data Server includes comprehensive load testing capabilities. Choose your preferred approach:

### Option 1: Jest Load Tests (Recommended)
**✅ Built-in, ready to use**
```bash
npm run test:load
```

### Option 2: k6 Load Tests (Advanced)
**📊 Professional performance testing**

First install k6:
```bash
# Windows (PowerShell as Administrator)
choco install k6
# or
winget install k6

# macOS  
brew install k6

# Linux
sudo apt-get install k6
```

Then run:
```bash
npm run test:load:k6
```

## 📈 What Gets Tested

Both load testing approaches verify:

- **🏥 Health Endpoints**: Response time < 100ms
- **📊 Market Data**: Response time < 1000ms  
- **📈 Statistics**: Response time < 2000ms
- **🌌 Systems**: Response time < 800ms
- **⛏️ Mining**: Response time < 1500ms

## 🎯 Performance Targets

- **Error Rate**: < 5%
- **Concurrent Users**: Up to 50
- **Availability**: > 99%
- **Throughput**: > 10 requests/second

## 🔧 Usage Examples

### Jest Load Tests
```bash
# Standard load test
npm run test:load

# All tests including load tests
npm test
```

### k6 Load Tests  
```bash
# Full 4-minute test with up to 50 users
npm run test:load:k6

# Quick 30-second test with 10 users
npm run test:load:k6:short

# Custom configuration
k6 run --duration=2m --vus=25 tests/load/api-load-test.js
```

## 📋 Test Results

### Jest Output
```
Load Tests
  ✓ should handle concurrent load
  ✓ should handle rapid requests to health endpoint

Test Suites: 1 passed, 1 total
Tests: 2 passed, 2 total
```

### k6 Output
```
running (4m30s), 00/50 VUs, 2847 complete and 0 interrupted iterations
default ✓ [======================================] 50 VUs  4m30s

✓ health status is 200
✓ health response time < 100ms
✓ market status is 200
✓ stats response time < 2000ms

checks.........................: 100.00% ✓ 11388    ✗ 0
data_received..................: 2.8 MB  10 kB/s
data_sent......................: 284 kB  1.0 kB/s
http_req_duration..............: avg=85ms    min=12ms med=67ms max=892ms p(90)=156ms p(95)=234ms
http_req_failed................: 0.00%   ✓ 0        ✗ 2847
http_reqs......................: 2847    10.32/s
iteration_duration.............: avg=2.8s    min=2.1s med=2.7s max=5.2s p(90)=3.4s  p(95)=3.8s
```

## 🔍 Troubleshooting

### Server Not Running
```bash
# Start the server first
npm start
# or in development mode  
npm run dev

# Verify it's running
curl http://localhost:3000/api/health
```

### k6 Command Not Found
1. Install k6 using the instructions above
2. Restart your terminal
3. Verify: `k6 version`

### Alternative: Docker k6
```bash
docker run --rm -i grafana/k6 run - < tests/load/api-load-test.js
```

## 🏗️ CI/CD Integration

Jest load tests are automatically included in:
- GitHub Actions workflows  
- Docker container testing
- Local test suites (`npm test`)

For k6 in CI/CD, add k6 installation to your workflow.

## 📚 More Information

See [`docs/LOAD_TESTING.md`](docs/LOAD_TESTING.md) for detailed documentation including:
- Advanced k6 configuration
- Performance monitoring
- Capacity planning
- Custom scenarios

---

**Ready to test?** Just run `npm run test:load` and see your server performance! 🚀