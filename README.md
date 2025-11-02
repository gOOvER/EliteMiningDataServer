# Elite Dangerous Mining Data Server v2.0

A high-performance Node.js server that aggregates and distributes Elite Dangerous mining data from multiple sources. Features real-time web dashboard, advanced security with CrowdSec, and production-ready deployment with Traefik reverse proxy.

![Elite Dangerous](https://img.shields.io/badge/Elite%20Dangerous-Mining%20Data-orange)
![Node.js](https://img.shields.io/badge/Node.js-LTS+-green)
![MongoDB](https://img.shields.io/badge/MongoDB-v8.0+-green)
![Docker](https://img.shields.io/badge/Docker-Compose-blue)
![Traefik](https://img.shields.io/badge/Traefik-Reverse%20Proxy-blue)
![CrowdSec](https://img.shields.io/badge/CrowdSec-Security-red)
![License](https://img.shields.io/badge/License-GPL--3.0-blue)

## 🚀 Features

### **Data Sources Integration**

- **🌐 EDDN (Elite Dangerous Data Network)**: Live stream processing of game data via ZeroMQ
- **📊 Inara API**: 70+ endpoints for market data, stations, community goals, and commander tracking
- **🌌 EDSM API**: System coordinates, bodies, rings, and exploration data
- **⚡ Real-time Processing**: Handles 50,000+ messages per hour from EDDN

### **Web Dashboard & Monitoring**

- **📊 Real-time Dashboard**: Live server health, memory, CPU, and connection monitoring
- **📈 Interactive Charts**: Data processing rates and source distribution visualization
- **💎 Mining Data View**: Recent mining opportunities and market data in real-time
- **📝 System Logs**: Live log viewer with filtering and real-time updates
- **⚡ WebSocket Integration**: Live updates without page refresh

### **Advanced Security**

- **🛡️ CrowdSec Integration**: Automatic threat detection and IP blocking
- **🔒 Reverse Proxy**: Traefik with SSL/TLS termination and load balancing
- **🚨 Rate Limiting**: Built-in protection against abuse and DDoS
- **🔐 Security Headers**: HSTS, CSP, and other security enhancements
- **📊 Security Monitoring**: Real-time threat level and blocked IP tracking

### **Advanced Mining Intelligence**

- **🎯 Smart Filtering**: AI-powered filtering for mining-relevant data
- **📈 Hotspot Detection**: Real-time identification of active mining areas
- **💰 Price Analysis**: Market trend analysis and profitability calculations
- **🗺️ Mining Recommendations**: Personalized mining suggestions based on activity patterns

### **High-Performance Architecture**

- **🔄 MongoDB 8.0**: Optimized for TB-scale data with geospatial indexing
- **🌊 WebSocket Streaming**: Real-time updates to connected clients
- **📦 Connection Pooling**: 100+ concurrent database connections
- **🗜️ Data Compression**: ZSTD/ZLIB compression for optimal storage
- **⚡ Multi-Tier Caching**: Redis distributed cache with in-memory performance layer
- **🔄 Cache Invalidation**: Smart invalidation strategies with pub/sub messaging
- **📊 Time-Series Analytics**: Advanced aggregation pipelines for market trends
- **🗄️ Automated Data Archival**: Lifecycle management with retention policies
- **🔧 Auto-scaling**: Horizontal scaling support with sharding

### **Production-Ready Deployment**

- **🐳 Docker Compose**: Modern containerized deployment
- **🔄 Traefik Proxy**: Automatic SSL certificates and load balancing
- **📊 Monitoring Stack**: Prometheus and Grafana integration
- **🛡️ Security Stack**: CrowdSec threat detection and prevention
- **⚙️ Configuration Management**: Environment-based configuration

### **Developer-Friendly APIs**

- **📋 RESTful API**: Comprehensive endpoints for all mining data
- **📚 OpenAPI Documentation**: Interactive API documentation
- **⚡ WebSocket API**: Real-time data streaming
- **📊 Performance Monitoring**: Real-time statistics and health checks

## 📦 Quick Start

### Prerequisites

- **Node.js** LTS (Latest Stable Version)
- **MongoDB** v8.0+
- **Docker** (recommended for containerized deployment)

### 🎯 Fast Deployment Options

#### **Option 1: Docker with Dashboard (Recommended)**

```bash
# Clone the repository
git clone https://github.com/gOOvER/EliteMiningDataServer.git
cd EliteMiningDataServer

# Start development environment with web dashboard
make dev

# Or start full environment with security
make dev-full

# Configure hosts file (see setup-hosts command output)
make setup-hosts
```

**Access Points:**

- **Web Dashboard**: `http://elite-mining.localhost` 📊
- **MongoDB Admin**: `http://mongo.localhost`
- **Traefik Dashboard**: `http://traefik.localhost`
- **CrowdSec Dashboard**: `http://crowdsec.localhost` (with dev-full)

#### **Option 2: Production Deployment**

```bash
# Configure production environment
cp .env.production.example .env.production
# Edit .env.production with your domain and credentials

# Deploy production environment with monitoring
make prod-monitor

# Or basic production deployment
make prod
```

**Production Features:**

- ✅ Automatic SSL certificates (Let's Encrypt)
- ✅ CrowdSec security engine
- ✅ Performance monitoring (Prometheus + Grafana)
- ✅ Load balancing and health checks
- ✅ Secure admin authentication

#### **Option 3: Manual Installation**

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Start MongoDB (local or Docker)
docker run -d -p 27017:27017 --name mongodb mongo:8.0

# Start the server
npm run dev
```

## 🎛️ Web Dashboard

The new web dashboard provides comprehensive monitoring and management capabilities:

### **Dashboard Features**

- **📊 System Health**: Real-time server metrics (uptime, memory, CPU)
- **🔌 Connection Monitoring**: WebSocket, API, and database connections
- **📡 Data Source Status**: EDDN, Inara, and EDSM connection health
- **📈 Interactive Charts**: Processing rates and data distribution
- **💎 Mining Data**: Live table of recent mining opportunities
- **📝 System Logs**: Real-time log viewer with filtering
- **🛡️ Security Dashboard**: CrowdSec metrics and threat monitoring

### **Access URLs**

**Development:**
```
http://elite-mining.localhost      # Main Dashboard
http://mongo.localhost             # MongoDB Express
http://traefik.localhost           # Traefik Dashboard
http://crowdsec.localhost          # CrowdSec Dashboard
```

**Production:**
```
https://elite-mining.yourdomain.com    # Main Dashboard
https://traefik.yourdomain.com         # Traefik Dashboard
https://crowdsec.yourdomain.com        # CrowdSec Dashboard
https://grafana.yourdomain.com         # Grafana Monitoring
```

## 🛡️ Security Features

### **CrowdSec Integration**

Advanced threat detection and prevention:

- **🚨 Automatic Threat Detection**: Identifies brute force, DDoS, and CVE exploits
- **⚡ Real-time Response**: Automatic IP blocking and rate limiting
- **🔧 Traefik Integration**: Seamless middleware integration
- **📊 Dashboard Monitoring**: Security metrics in web interface

### **Security Profiles**

- **Ban**: 4-24 hour IP blocking for serious threats
- **Captcha**: Human verification for suspicious behavior
- **Rate Limit**: Traffic throttling for excessive requests

### **Traefik Security**

- **🔒 SSL/TLS Termination**: Automatic Let's Encrypt certificates
- **🛡️ Security Headers**: HSTS, CSP, XSS protection
- **🚨 Rate Limiting**: Request throttling and abuse prevention
- **🔐 Admin Authentication**: Basic auth for admin interfaces

## 🐳 Docker Deployment

### Development with Traefik

For local development with reverse proxy:

```bash
# Start development environment with Traefik
docker compose -f compose.yaml -f docker-compose.override.yml up -d

# Access services:
# http://elite-mining.localhost - Main application
# http://mongo.localhost - MongoDB Express
# http://traefik.localhost - Traefik dashboard
```

**Add to your hosts file** (`C:\Windows\System32\drivers\etc\hosts`):
```
127.0.0.1 elite-mining.localhost
127.0.0.1 mongo.localhost
127.0.0.1 traefik.localhost
127.0.0.1 crowdsec.localhost
```

### Production with SSL

For production deployment with automatic HTTPS:

```bash
# Copy and configure environment
cp .env.production.example .env.production
# Edit .env.production with your domain and credentials

# Deploy production stack
docker compose -f docker-compose.prod.yml up -d

# Or with monitoring (Prometheus + Grafana)
docker compose -f docker-compose.prod.yml --profile monitoring up -d
```

**Production Features:**

- ✅ Automatic SSL certificates (Let's Encrypt)
- ✅ Security headers and rate limiting
- ✅ Load balancing and health checks
- ✅ Monitoring with Prometheus/Grafana
- ✅ Secure admin authentication

See [Traefik Setup Guide](docs/TRAEFIK_SETUP.md) for detailed configuration.

### Simple Docker Compose (Legacy)

```yaml
# Modern compose.yaml (recommended)
services:
  elite-mining-server:
    image: elite-mining-server:latest
    build: .
    ports:
      - "3000:3000"
    environment:
      - MONGODB_CONNECTION_STRING=mongodb://mongodb:27017/elite-mining
      - INARA_API_KEY=${INARA_API_KEY}
      - EDSM_API_KEY=${EDSM_API_KEY}
    depends_on:
      mongodb:
        condition: service_healthy

  mongodb:
    image: mongo:8.0
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  mongodb_data:
```

**Deploy:**
```bash
docker compose up -d
```

## 🔗 API Documentation

### Base URLs

```
Development: http://elite-mining.localhost/api
Production:  https://elite-mining.yourdomain.com/api
```

### Core Endpoints

#### 🏥 Health & Status

```http
GET /health
GET /api/status
GET /api/health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-11-02T12:00:00.000Z",
  "version": "2.0.0",
  "uptime": 3600000,
  "services": {
    "mongodb": true,
    "optimizer": true
  }
}
```

#### 💎 Mining Data

**Get Mining Opportunities**
```http
GET /api/mining/opportunities
```

**Get Mining Hotspots**
```http
GET /api/mining/hotspots
```

**Get Mining Recommendations**
```http
GET /api/mining/recommendations?commander=YourName
```

**Recent Mining Data**
```http
GET /api/mining/recent?limit=20
```

#### 🌌 System Data

**Search Systems**
```http
GET /api/systems/search?name=Sol&radius=50
```

**Get System Details**
```http
GET /api/systems/Sol
```

**Get Bodies in System**
```http
GET /api/systems/Sol/bodies
```

#### 📊 Market Data

**Get Station Market Data**
```http
GET /api/market/station/Jameson%20Memorial
```

**Search Commodities**
```http
GET /api/market/commodities?name=Painite
```

**Price History**
```http
GET /api/market/history/Painite?days=7
```

#### 📈 Statistics

**Server Statistics**
```http
GET /api/stats/server
```

**Mining Statistics**
```http
GET /api/stats/mining
```

**Data Source Statistics**
```http
GET /api/stats/sources
```

### WebSocket API

Connect to real-time data streams:

```javascript
const ws = new WebSocket('ws://elite-mining.localhost/ws');

// Subscribe to events
ws.send(JSON.stringify({
  type: 'subscribe',
  events: ['mining-opportunity', 'price-alert', 'system-update']
}));

// Handle messages
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};
```

**Event Types:**

- `mining-opportunity` - New mining opportunities
- `price-alert` - Significant price changes
- `system-update` - System data updates
- `hotspot-update` - Mining hotspot changes
- `status` - Server status updates
- `log` - System log entries

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PORT` | Server port | `3000` | No |
| `NODE_ENV` | Environment | `development` | No |
| `MONGODB_CONNECTION_STRING` | MongoDB URL | `mongodb://localhost:27017/elite-mining` | Yes |
| `INARA_API_KEY` | Inara API key | - | Recommended |
| `EDSM_API_KEY` | EDSM API key | - | Recommended |
| `COMMANDER_NAME` | Elite commander name | - | Optional |
| `LOG_LEVEL` | Logging level | `info` | No |
| `CORS_ORIGIN` | Allowed CORS origins | `*` | No |
| `CROWDSEC_BOUNCER_API_KEY` | CrowdSec bouncer key | - | Production |

### Production Configuration

Copy and edit the production environment template:

```bash
cp .env.production.example .env.production
```

Key production settings:

```env
# Domain configuration
DOMAIN=yourdomain.com
ELITE_MINING_DOMAIN=elite-mining.yourdomain.com
TRAEFIK_DOMAIN=traefik.yourdomain.com
CROWDSEC_DOMAIN=crowdsec.yourdomain.com

# SSL certificates
ACME_EMAIL=your-email@yourdomain.com

# Security
CROWDSEC_BOUNCER_API_KEY=your-bouncer-api-key
ADMIN_PASSWORD_HASH=$2y$10$...  # Generate with htpasswd

# Database
MONGODB_USERNAME=elitemining
MONGODB_PASSWORD=your-secure-password
```

## 📊 Monitoring & Performance

### Built-in Monitoring

The dashboard provides comprehensive monitoring:

- **System Metrics**: CPU, memory, uptime, connections
- **Data Processing**: Real-time rates and throughput
- **Security Status**: Threat levels and blocked IPs
- **Source Health**: EDDN, Inara, EDSM connection status

### Prometheus Integration

Production deployments include Prometheus metrics:

```bash
# Deploy with monitoring
docker compose -f docker-compose.prod.yml --profile monitoring up -d
```

**Metrics Available:**

- Application performance metrics
- Database connection metrics
- HTTP request metrics
- WebSocket connection metrics
- CrowdSec security metrics

### Grafana Dashboards

Access pre-configured dashboards at `https://grafana.yourdomain.com`:

- **Server Overview**: System health and performance
- **Mining Data**: Processing rates and data quality
- **Security Dashboard**: Threat detection and responses
- **API Performance**: Request rates and response times

## 🛠️ Development

### Local Development Setup

```bash
# Clone repository
git clone https://github.com/gOOvER/EliteMiningDataServer.git
cd EliteMiningDataServer

# Install dependencies
npm install

# Start development environment
make dev

# Or with security features
make dev-full
```

### Available Commands

```bash
# Development
make dev          # Start development environment
make dev-full     # Start with security features
make setup-hosts  # Show hosts file configuration

# Production
make prod         # Deploy production
make prod-monitor # Deploy with monitoring

# Maintenance
make build        # Build application
make logs         # Show logs
make clean        # Clean containers
make clean-all    # Clean everything
```

### Project Structure

```
EliteMiningDataServer/
├── src/                    # Source code
├── routes/                 # API routes
│   ├── dashboard.js       # Dashboard API
│   ├── mining.js          # Mining endpoints
│   ├── systems.js         # System data
│   └── market.js          # Market data
├── public/                 # Web dashboard
│   ├── index.html         # Dashboard HTML
│   ├── css/               # Stylesheets
│   └── js/                # JavaScript
├── docs/                   # Documentation
├── traefik/               # Traefik configuration
├── crowdsec/              # CrowdSec configuration
├── compose.yaml           # Docker Compose
├── docker-compose.prod.yml # Production compose
├── docker-compose.override.yml # Development overrides
└── Makefile              # Deployment commands
```

## 🧪 Testing

### Health Checks

Test server health:

```bash
# Basic health check
curl http://elite-mining.localhost/health

# Detailed status
curl http://elite-mining.localhost/api/status

# Dashboard API
curl http://elite-mining.localhost/api/mining/recent
```

### WebSocket Testing

Test real-time connections:

```javascript
// Browser console
const ws = new WebSocket('ws://elite-mining.localhost/ws');
ws.onopen = () => console.log('Connected');
ws.onmessage = (e) => console.log('Message:', JSON.parse(e.data));
```

### Security Testing

Test CrowdSec integration:

```bash
# Check CrowdSec status
docker compose exec crowdsec cscli metrics

# View active decisions
docker compose exec crowdsec cscli decisions list

# Test rate limiting
for i in {1..100}; do curl http://elite-mining.localhost/api/health; done
```

### Load Testing

The project includes comprehensive k6 load testing for performance validation:

#### **Install k6**

```bash
# Windows (PowerShell)
choco install k6
winget install k6.k6

# macOS
brew install k6

# Linux
sudo apt install k6
```

#### **Available Load Tests**

```bash
# Full Elite Mining API test (requires server running)
npm run test:load:k6

# Quick 30-second test
npm run test:load:k6:short

# CI-friendly test with fallback
npm run test:load:k6:ci

# Demo test (works without server)
npm run test:load:k6:demo
```

#### **Custom Load Tests**

```bash
# Start server first
npm start
# or
make dev

# Run with custom parameters
k6 run tests/load/api-load-test.js --duration 60s --vus 20

# Test specific endpoints
TEST_BASE_URL=http://localhost:3000 k6 run tests/load/api-load-test-ci.js
```

#### **Load Test Reports**

k6 provides detailed performance metrics:

- **Response Times**: P50, P95, P99 percentiles
- **Throughput**: Requests per second
- **Error Rates**: Failed request percentage
- **Resource Usage**: Virtual users and iterations

**Example Output:**
```
✓ http_req_duration..........: avg=245ms p(95)=680ms
✓ http_req_failed............: 0.15% ✓ 8 ✗ 5234
✓ http_reqs..................: 5242 17.47/s
✓ vus........................: 50 min=0 max=50
```

**GitHub Actions Integration:**
Load tests automatically run in CI/CD pipeline with intelligent fallback for environments without full server access.

## 📚 Documentation

- **[Traefik Setup Guide](docs/TRAEFIK_SETUP.md)** - Reverse proxy configuration
- **[Dashboard & Security Guide](docs/DASHBOARD_SECURITY.md)** - Web interface and CrowdSec
- **API Documentation** - Available at `/api/docs` endpoint

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Elite Dangerous Community Developers** for EDDN
- **Inara.cz** for comprehensive game data API
- **EDSM** for exploration and system data
- **Frontier Developments** for Elite Dangerous

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/gOOvER/EliteMiningDataServer/issues)
- **Discussions**: [GitHub Discussions](https://github.com/gOOvER/EliteMiningDataServer/discussions)
- **Discord**: Elite Dangerous Community Servers

---

**Elite Dangerous Mining Data Server v2.0** - Powered by the Elite Dangerous Community 🚀