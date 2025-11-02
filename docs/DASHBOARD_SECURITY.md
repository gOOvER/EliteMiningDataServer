# Dashboard and Security Integration Guide

This guide covers the new Web Dashboard and CrowdSec security integration for the Elite Mining Data Server.

## 🎯 New Features Overview

### **Web Dashboard**
- **Real-time Status Monitoring**: Live server health, memory, CPU usage
- **Data Source Tracking**: EDDN, Inara, EDSM connection status and rates
- **Interactive Charts**: Data processing rates and source distribution
- **Mining Data View**: Recent mining opportunities and market data
- **System Logs**: Real-time log viewing with filtering
- **WebSocket Integration**: Live updates without page refresh

### **CrowdSec Security**
- **Threat Detection**: Automatic IP blocking based on behavior analysis
- **Traefik Integration**: Seamless integration with reverse proxy
- **Log Analysis**: Monitors Traefik and application logs
- **Customizable Profiles**: Different response actions for different threats
- **Dashboard Monitoring**: Security metrics in the web interface

## 🚀 Quick Start

### **Development with Dashboard**

```bash
# Start basic development environment
make dev

# Start with security features
make dev-full

# Configure hosts file
make setup-hosts
```

**Access Points:**
- **Main Dashboard**: `http://elite-mining.localhost`
- **MongoDB Admin**: `http://mongo.localhost`
- **Traefik Dashboard**: `http://traefik.localhost`
- **CrowdSec Dashboard**: `http://crowdsec.localhost` (with dev-full)

### **Production Deployment**

```bash
# Configure environment
cp .env.production.example .env.production
# Edit .env.production with your settings

# Deploy with security and monitoring
make prod-monitor
```

**Production URLs:**
- **Main Dashboard**: `https://elite-mining.yourdomain.com`
- **Traefik Dashboard**: `https://traefik.yourdomain.com`
- **CrowdSec Dashboard**: `https://crowdsec.yourdomain.com`
- **Prometheus**: `https://prometheus.yourdomain.com`
- **Grafana**: `https://grafana.yourdomain.com`

## 📊 Web Dashboard Features

### **System Health Monitoring**

The dashboard provides real-time monitoring of:

- **Server Uptime**: How long the server has been running
- **Memory Usage**: Heap usage and system memory consumption
- **CPU Usage**: Current CPU utilization percentage
- **Connection Counts**: Active WebSocket, API, and database connections

### **Data Source Status**

Monitor the health and activity of data sources:

- **EDDN**: Live stream connection status and message rates
- **Inara API**: API connection status and request rates  
- **EDSM API**: System data connection and update frequencies

### **Real-time Charts**

- **Data Processing Rate**: Line chart showing messages processed per second
- **Source Distribution**: Pie chart showing data distribution across sources

### **Mining Data Table**

Recent mining opportunities with:
- Timestamp and system location
- Station and commodity information
- Current prices and supply levels
- Data source attribution

### **System Logs**

Real-time log viewer with:
- Filterable log levels (Error, Warning, Info, Debug)
- Automatic scrolling for new entries
- Color-coded log levels
- Timestamp display

### **WebSocket API**

The dashboard uses WebSocket for real-time updates:

```javascript
// Connect to WebSocket
const ws = new WebSocket('ws://elite-mining.localhost/ws');

// Subscribe to specific events
ws.send(JSON.stringify({
  type: 'subscribe',
  events: ['status', 'miningData', 'logs']
}));

// Handle incoming data
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // Handle different message types
};
```

## 🛡️ CrowdSec Security

### **Threat Detection**

CrowdSec monitors logs and detects:

- **Brute Force Attacks**: Failed authentication attempts
- **HTTP Flooding**: Excessive request rates
- **Crawling/Scraping**: Automated bot activities
- **CVE Exploits**: Known vulnerability exploitation attempts

### **Response Actions**

Different threat levels trigger different responses:

- **Ban**: Block IP for specified duration (4-24 hours)
- **Captcha**: Require human verification (1 hour)
- **Rate Limit**: Slow down requests (2 hours)

### **Configuration Files**

**Acquisition Configuration** (`crowdsec/acquis.yaml`):
```yaml
filenames:
  - /var/log/traefik/access.log
labels:
  type: traefik

---

filenames:
  - /var/log/elite-mining/*.log
labels:
  type: nodejs
```

**Response Profiles** (`crowdsec/profiles.yaml`):
```yaml
name: default_ip_remediation
filters:
  - Alert.Remediation == true && Alert.GetScope() == "Ip"
decisions:
  - type: ban
    duration: 4h
    scope: Ip
```

### **Traefik Integration**

CrowdSec integrates with Traefik via middleware:

```yaml
# In traefik/dynamic/dynamic.yml
middlewares:
  crowdsec-bouncer:
    forwardAuth:
      address: "http://crowdsec-bouncer:8080/api/v1/forwardAuth"
      authResponseHeaders:
        - "X-Crowdsec-Decision"
```

## 🔧 Configuration

### **Environment Variables**

Key configuration options in `.env.production`:

```bash
# CrowdSec
CROWDSEC_BOUNCER_API_KEY=your-bouncer-api-key

# Domains
ELITE_MINING_DOMAIN=elite-mining.yourdomain.com
CROWDSEC_DOMAIN=crowdsec.yourdomain.com

# Security
ADMIN_PASSWORD_HASH=$2y$10$...  # htpasswd generated
```

### **Docker Profiles**

Use profiles to control which services start:

```bash
# Basic development
docker compose up -d

# With security
docker compose --profile security up -d

# Production with monitoring
docker compose -f docker-compose.prod.yml --profile monitoring up -d
```

## 📈 Monitoring and Metrics

### **Dashboard API Endpoints**

- `GET /api/status` - System health metrics
- `GET /api/health` - Service health checks
- `GET /api/sources` - Data source status
- `GET /api/mining/recent` - Recent mining data
- `GET /api/metrics` - Processing metrics

### **WebSocket Events**

Real-time event types:
- `status` - System health updates
- `dataSource` - Data source status changes
- `miningData` - New mining opportunities
- `log` - System log entries
- `metrics` - Performance metrics

### **Prometheus Integration**

Production monitoring includes:
- Application metrics collection
- CrowdSec security metrics
- Traefik performance metrics
- MongoDB performance data

## 🚨 Security Best Practices

### **CrowdSec Setup**

1. **Generate Bouncer API Key**:
```bash
docker compose exec crowdsec cscli bouncers add traefik-bouncer
```

2. **Configure Collections**:
```bash
docker compose exec crowdsec cscli collections install crowdsecurity/traefik
docker compose exec crowdsec cscli collections install crowdsecurity/nodejs
```

3. **View Decisions**:
```bash
docker compose exec crowdsec cscli decisions list
```

### **Production Security**

- Use strong passwords for all admin interfaces
- Configure specific CORS origins (not wildcard)
- Enable basic auth for admin endpoints
- Regularly update CrowdSec collections
- Monitor security logs and alerts

## 🔍 Troubleshooting

### **Dashboard Issues**

1. **Dashboard not loading**:
   - Check if static files are served correctly
   - Verify Traefik routing configuration
   - Check browser console for JavaScript errors

2. **WebSocket not connecting**:
   - Ensure WebSocket endpoint is accessible
   - Check firewall rules for WebSocket traffic
   - Verify WebSocket proxy settings in Traefik

3. **No real-time updates**:
   - Check WebSocket connection status
   - Verify server-side WebSocket broadcasting
   - Check for JavaScript errors in browser console

### **CrowdSec Issues**

1. **CrowdSec not blocking threats**:
   - Verify log file paths in acquisition config
   - Check CrowdSec collections are installed
   - Ensure bouncer API key is correct

2. **False positives**:
   - Review decision criteria in profiles
   - Add whitelists for legitimate traffic
   - Adjust detection thresholds

3. **Integration problems**:
   - Check Traefik middleware configuration
   - Verify bouncer service connectivity
   - Review CrowdSec API connectivity

### **Performance Issues**

1. **High memory usage**:
   - Check MongoDB connection pool settings
   - Monitor WebSocket client connections
   - Review log retention policies

2. **Slow dashboard loading**:
   - Enable compression for static assets
   - Optimize chart data processing
   - Implement caching for static data

## 📚 API Documentation

### **Dashboard REST API**

Comprehensive API for programmatic access:

```bash
# Get system status
curl http://elite-mining.localhost/api/status

# Get recent mining data
curl http://elite-mining.localhost/api/mining/recent?limit=10

# Health check
curl http://elite-mining.localhost/api/health
```

### **WebSocket API**

Real-time communication protocol:

```javascript
// Message format
{
  type: 'messageType',
  payload: { /* data */ },
  timestamp: '2024-01-01T00:00:00.000Z'
}

// Subscription format
{
  type: 'subscribe',
  events: ['status', 'miningData', 'logs']
}
```

This integrated dashboard and security system provides comprehensive monitoring and protection for your Elite Dangerous mining data server while maintaining high performance and user-friendly interfaces.