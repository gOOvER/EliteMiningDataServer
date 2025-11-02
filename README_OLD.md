# Elite Dangerous Mining Data Server v2.0

A high-performance Node.js server that aggregates and distributes Elite Dangerous mining data from multiple sources. Features real-time web dashboard, advanced security with CrowdSec, and production-ready deployment with Traefik reverse proxy.

![Elite Dangerous](https://img.shields.io/badge/Elite%20Dangerous-Mining%20Data-orange)
![Node.js](https://img.shields.io/badge/Node.js-LTS+-green)
![MongoDB](https://img.shields.io/badge/MongoDB-v8.0+-green)
![Docker](https://img.shields.io/badge/Docker-Compose-blue)
![Traefik](https://img.shields.io/badge/Traefik-Reverse%20Proxy-blue)
![CrowdSec](https://img.shields.io/badge/CrowdSec-Security-red)
![License](https://img.shields.io/badge/License-MIT-blue)

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

# Install dependencies
npm install
```

### 2. Configuration

Copy the environment template and configure your settings:

```bash
cp .env.example .env
```

**Essential Configuration:**
```env
# Server Configuration
PORT=3000
NODE_ENV=production

# MongoDB Configuration
MONGODB_URL=mongodb://localhost:27017/elite-mining

# API Keys (Optional but recommended for higher rate limits)
INARA_API_KEY=your_inara_api_key
EDSM_API_KEY=your_edsm_api_key

# Commander Information (Optional)
COMMANDER_NAME=your_commander_name
COMMANDER_FID=your_frontier_id

# Security
ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com
```

### 3. Database Setup

**Option A: Local MongoDB**
```bash
# Install MongoDB locally or use Docker
docker run -d -p 27017:27017 --name mongodb mongo:7.0
```

**Option B: Docker Compose (Recommended)**
```bash
docker-compose up -d
```

### 4. Start the Server

**Development Mode:**
```bash
npm run dev
```

**Production Mode:**
```bash
npm start
```

**Optimized Server:**
```bash
node server-optimized.js
```

## 🔗 API Documentation

### Base URL
```
http://localhost:3000/api
```

### Authentication
Most endpoints are public. API keys can be configured for higher rate limits and extended functionality.

### Core Endpoints

#### 🏥 Health & Status
```http
GET /health
```
**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-11-01T12:00:00.000Z",
  "version": "2.0.0",
  "services": {
    "mongodb": true,
    "optimizer": true
  }
}
```

#### 📊 Server Statistics
```http
GET /api/server/stats
```
**Response:**
```json
{
  "server": {
    "uptime": 3600,
    "memory": { "used": 150000000, "total": 500000000 },
    "nodeVersion": "v18.17.0"
  },
  "optimizer": {
    "eddnMessages": 45623,
    "inaraRequests": 1250,
    "edsmRequests": 892,
    "miningOpportunities": 342,
    "systemsAnalyzed": 156
  }
}
```

### ⛏️ Mining Endpoints

#### Get Mining Opportunities
```http
GET /api/mining/opportunities
```
**Query Parameters:**
- `system` (string): Filter by system name
- `commodity` (string): Filter by commodity type
- `minPrice` (number): Minimum sell price
- `limit` (number): Result limit (default: 50)

**Response:**
```json
{
  "opportunities": [
    {
      "id": "648f1a2b3c4d5e6f7a8b9c0d",
      "type": "commodity_market",
      "systemName": "LHS 20",
      "stationName": "Ohm City",
      "commodity": "Painite",
      "sellPrice": 285000,
      "demand": 1520,
      "timestamp": "2025-11-01T11:45:00.000Z",
      "profitability": "high"
    }
  ],
  "total": 342,
  "timestamp": "2025-11-01T12:00:00.000Z"
}
```

#### Get Mining Hotspots
```http
GET /api/mining/hotspots
```
**Query Parameters:**
- `radius` (number): Search radius in LY (default: 50)
- `minActivity` (number): Minimum activity level (default: 5)
- `sortBy` (string): Sort by 'activity' or 'profitability'

**Response:**
```json
{
  "hotspots": [
    {
      "systemName": "HIP 21991",
      "coordinates": { "x": -41.4, "y": -58.8, "z": -354.3 },
      "activityLevel": 95,
      "hotspotScore": 185,
      "commodityTypes": ["Painite", "Platinum", "Osmium"],
      "lastActivity": "2025-11-01T11:30:00.000Z",
      "averageProfit": 180000
    }
  ]
}
```

#### Get Mining Recommendations
```http
GET /api/mining/recommendations
```
**Headers:**
- `X-Commander-Name` (string): Your commander name for personalized recommendations

**Response:**
```json
{
  "recommendations": [
    {
      "systemName": "Borann",
      "recommendationType": "core_mining",
      "targetCommodity": "Low Temperature Diamonds",
      "expectedProfit": 450000,
      "difficulty": "medium",
      "estimatedTime": "2.5 hours",
      "ringInfo": {
        "ringType": "Icy",
        "ringClass": "Pristine",
        "hotspotCount": 3
      }
    }
  ]
}
```

### 🌌 System Endpoints

#### Search Systems
```http
GET /api/systems/search?q=sol
```
**Query Parameters:**
- `q` (string): Search query
- `coordinates` (string): "x,y,z" coordinates
- `radius` (number): Search radius in LY

#### Get System Information
```http
GET /api/systems/{systemName}
```
**Response:**
```json
{
  "name": "Sol",
  "coordinates": { "x": 0, "y": 0, "z": 0 },
  "information": {
    "allegiance": "Federation",
    "economy": "High Tech",
    "security": "High",
    "population": 22780919011
  },
  "miningPotential": {
    "score": 65,
    "bodyCount": 8,
    "ringCount": 4,
    "beltCount": 1
  }
}
```

#### Get System Bodies
```http
GET /api/systems/{systemName}/bodies
```
**Response:**
```json
{
  "bodies": [
    {
      "name": "Sol A Belt Cluster 1",
      "type": "Belt",
      "miningScore": 85,
      "materials": [
        { "name": "Iron", "percentage": 18.5 },
        { "name": "Nickel", "percentage": 12.3 }
      ]
    }
  ]
}
```

#### Get System Stations
```http
GET /api/systems/{systemName}/stations
```
**Response:**
```json
{
  "stations": [
    {
      "name": "Abraham Lincoln",
      "type": "Coriolis Starport",
      "services": ["Commodities", "Refinery", "Outfitting"],
      "landingPadSize": "L",
      "distance": 496,
      "miningServices": true
    }
  ]
}
```

### 💰 Market Endpoints

#### Get Commodity Prices
```http
GET /api/market/commodities
```
**Query Parameters:**
- `commodity` (string): Specific commodity name
- `system` (string): Filter by system
- `minProfit` (number): Minimum profit margin

#### Get Price Trends
```http
GET /api/market/trends
```
**Query Parameters:**
- `commodity` (string): Commodity to analyze
- `timeframe` (string): '24h', '7d', '30d' (default: '24h')

**Response:**
```json
{
  "trends": [
    {
      "commodity": "Painite",
      "priceChange": 0.15,
      "averagePrice": 285000,
      "highestPrice": 320000,
      "lowestPrice": 245000,
      "systemsAffected": 23,
      "trend": "bullish"
    }
  ]
}
```

#### Get Price Alerts
```http
GET /api/market/alerts
```
**Response:**
```json
{
  "alerts": [
    {
      "id": "alert_001",
      "commodityName": "Void Opals",
      "alertType": "price_surge",
      "priceChange": 0.25,
      "currentPrice": 1650000,
      "systemName": "Delkar",
      "timestamp": "2025-11-01T11:50:00.000Z"
    }
  ]
}
```

### 📈 Statistics Endpoints

#### Overview Statistics
```http
GET /api/stats/overview
```

#### Performance Metrics
```http
GET /api/stats/performance
```

#### API Usage Statistics
```http
GET /api/stats/api-usage
```

## 🌐 WebSocket API

### Connection
```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.on('open', () => {
  // Subscribe to specific events
  ws.send(JSON.stringify({
    type: 'subscribe',
    events: ['mining-opportunity', 'price-alert', 'hotspot-update']
  }));
});
```

### Events

#### Mining Opportunity
```json
{
  "type": "mining-opportunity",
  "data": {
    "systemName": "HIP 21991",
    "commodity": "Painite",
    "sellPrice": 290000,
    "profitability": "high"
  },
  "timestamp": "2025-11-01T12:00:00.000Z"
}
```

#### Price Alert
```json
{
  "type": "price-alert",
  "data": {
    "commodity": "Low Temperature Diamonds",
    "priceChange": 0.20,
    "newPrice": 980000,
    "alertLevel": "high"
  },
  "timestamp": "2025-11-01T12:00:00.000Z"
}
```

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

### Standalone Docker

```bash
# Build the image
docker build -t elite-mining-server .

# Run the container
docker run -d \
  -p 3000:3000 \
  -e MONGODB_CONNECTION_STRING=mongodb://host.docker.internal:27017/elite-mining \
  --name elite-mining-server \
  elite-mining-server
```

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PORT` | Server port | `3000` | No |
| `NODE_ENV` | Environment mode | `development` | No |
| `MONGODB_URL` | MongoDB connection string | `mongodb://localhost:27017/elite-mining` | Yes |
| `INARA_API_KEY` | Inara API key for enhanced features | - | No |
| `EDSM_API_KEY` | EDSM API key for commander features | - | No |
| `COMMANDER_NAME` | Your Elite Dangerous commander name | - | No |
| `COMMANDER_FID` | Your Frontier ID | - | No |
| `ALLOWED_ORIGINS` | CORS allowed origins | `*` | No |

### Advanced Configuration

The server supports advanced configuration through the `config` object in `server-optimized.js`:

```javascript
const config = {
  eddn: {
    relayUrl: 'tcp://eddn.edcd.io:9500',
    reconnectInterval: 30000
  },
  mongodb: {
    options: {
      maxPoolSize: 100,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000
    }
  }
};
```

## 🔧 Development

### Project Structure
```
EliteMiningDataServer/
├── src/
│   ├── clients/          # API clients (EDDN, Inara, EDSM)
│   ├── routes/           # Express routes
│   ├── services/         # Business logic services
│   └── models/           # Data models
├── public/               # Static files
├── docs/                 # Documentation
├── docker-compose.yml    # Docker compose configuration
├── Dockerfile           # Docker configuration
└── server-optimized.js  # Main optimized server file
```

### Running Tests
```bash
npm test
```

### Development Mode
```bash
npm run dev
```

### Linting
```bash
npm run lint
```

## 📊 Performance

### Benchmarks
- **EDDN Messages**: 50,000+ per hour
- **Database Operations**: 10,000+ inserts per minute
- **API Response Time**: <100ms average
- **Memory Usage**: ~150MB under normal load
- **WebSocket Connections**: 1,000+ concurrent

### Monitoring

The server includes built-in monitoring endpoints:
- `/health` - Health check
- `/api/server/stats` - Performance statistics
- `/api/stats/performance` - Detailed performance metrics

## 🔒 Security

### Rate Limiting
- **API Endpoints**: 100 requests per 15 minutes per IP
- **WebSocket**: Connection limits and message validation
- **Database**: Connection pooling and query optimization

### Best Practices
- Use environment variables for sensitive data
- Enable CORS only for trusted origins
- Monitor API usage and set appropriate limits
- Regular security updates

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Development Guidelines
- Follow ESLint configuration
- Add tests for new features
- Update documentation
- Ensure backward compatibility

## 📝 API Rate Limits

### Public Endpoints
- **General API**: 100 requests per 15 minutes
- **WebSocket**: 50 connections per IP

### With API Keys
- **Inara Integration**: Higher rate limits when API key is provided
- **EDSM Integration**: Commander-specific features available

## 🐛 Troubleshooting

### Common Issues

**MongoDB Connection Failed**
```bash
# Check MongoDB status
docker ps | grep mongo

# Restart MongoDB
docker-compose restart mongodb
```

**EDDN Connection Issues**
```bash
# Check EDDN relay status
telnet eddn.edcd.io 9500

# Restart the optimizer
curl -X POST http://localhost:3000/api/admin/restart-optimizer
```

**High Memory Usage**
- Adjust MongoDB connection pool size
- Enable data compression
- Implement data archiving

### Debug Mode
```bash
DEBUG=elite-mining:* npm run dev
```

## 📋 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Elite Dangerous Community Developers (EDCD)** for the EDDN network
- **Inara.cz** for the comprehensive API
- **EDSM.net** for system and exploration data
- **Frontier Developments** for Elite Dangerous

## 📞 Support

- **GitHub Issues**: [Report bugs and request features](https://github.com/gOOvER/EliteMiningDataServer/issues)
- **Elite Dangerous Community**: Join the EDCD Discord
- **API Documentation**: Available at `/api/docs` when server is running

---

**Made with ❤️ for the Elite Dangerous mining community**