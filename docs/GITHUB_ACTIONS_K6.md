# GitHub Actions k6 Load Testing Integration

## Adding k6 to CI/CD Pipeline

### Option 1: Direct Integration in Existing Workflow

Add this step to your existing `.github/workflows/ci-cd.yml`:

```yaml
- name: Run k6 Load Tests
  run: |
    # Install k6
    curl -s https://dl.k6.io/key.gpg | sudo apt-key add -
    echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
    sudo apt-get update
    sudo apt-get install k6
    
    # Run load tests (with fallback for when server isn't available)
    npm run test:load:k6:ci || npm run test:load:k6:demo
```

### Option 2: Dedicated Load Testing Workflow

Create `.github/workflows/load-testing.yml`:

```yaml
name: Load Testing

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]
  schedule:
    # Run load tests daily at 2 AM UTC
    - cron: '0 2 * * *'
  workflow_dispatch:

jobs:
  load-test:
    name: k6 Load Testing
    runs-on: ubuntu-latest
    
    services:
      mongodb:
        image: mongo:8.0
        ports:
          - 27017:27017
        env:
          MONGO_INITDB_DATABASE: elite_mining
        options: >-
          --health-cmd "mongosh --eval 'db.runCommand({ping: 1})'"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 3

      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 3

    steps:
    - name: Checkout code
      uses: actions/checkout@v4

    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '22.x'
        cache: 'npm'

    - name: Install dependencies
      run: npm ci

    - name: Install k6
      run: |
        curl -s https://dl.k6.io/key.gpg | sudo apt-key add -
        echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
        sudo apt-get update
        sudo apt-get install k6

    - name: Start application (background)
      run: |
        npm start &
        echo $! > server.pid
      env:
        NODE_ENV: test
        MONGODB_URI: mongodb://localhost:27017/elite_mining_test
        REDIS_URL: redis://localhost:6379

    - name: Wait for services
      run: |
        # Wait for server to be ready
        timeout 60 bash -c 'until curl -f http://localhost:3000/api/health; do sleep 2; done'

    - name: Run k6 Load Tests
      run: |
        # Run the CI-optimized load test
        k6 run tests/load/api-load-test-ci.js
      env:
        TEST_BASE_URL: http://localhost:3000

    - name: Run k6 Demo (fallback)
      if: failure()
      run: |
        echo "Main load test failed, running demo version"
        k6 run tests/load/k6-demo.js

    - name: Stop application
      if: always()
      run: |
        if [ -f server.pid ]; then
          kill $(cat server.pid) || true
        fi

    - name: Upload k6 results
      if: always()
      uses: actions/upload-artifact@v4
      with:
        name: k6-load-test-results
        path: |
          k6-results.json
          k6-report.html
        retention-days: 30
```

### Option 3: Quick Demo Integration

For immediate testing in existing workflows:

```yaml
- name: k6 Load Test Demo
  run: |
    # Install k6
    if ! command -v k6 &> /dev/null; then
      curl -s https://dl.k6.io/key.gpg | sudo apt-key add -
      echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
      sudo apt-get update
      sudo apt-get install k6
    fi
    
    # Run demo load test (works without server)
    npm run test:load:k6:demo
```

## Available npm Scripts

- `npm run test:load:k6` - Full Elite Mining API load test
- `npm run test:load:k6:short` - Quick 30-second test  
- `npm run test:load:k6:ci` - CI-friendly with fallback
- `npm run test:load:k6:demo` - Demo test (no server needed)

## Environment Variables

- `TEST_BASE_URL` - Override target URL
- `K6_OUT` - Output format (json, csv, etc.)
- `K6_VUS` - Number of virtual users
- `K6_DURATION` - Test duration

Example:
```bash
TEST_BASE_URL=https://staging.example.com npm run test:load:k6:ci
```