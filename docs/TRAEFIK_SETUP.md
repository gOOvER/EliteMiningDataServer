# Traefik Setup and Deployment Guide

This guide explains how to deploy the Elite Mining Data Server with Traefik reverse proxy for production use.

## Overview

Traefik provides:
- **Reverse Proxy**: Routes traffic to appropriate services
- **SSL/TLS Termination**: Automatic HTTPS certificates via Let's Encrypt
- **Load Balancing**: Distributes traffic across multiple instances
- **Dashboard**: Web UI for monitoring and configuration
- **Security**: Rate limiting, security headers, authentication

## Development Setup

For local development with Traefik:

```bash
# Start with Traefik
docker compose -f compose.yaml -f docker-compose.override.yml up -d

# Access services via:
# http://elite-mining.localhost - Main application
# http://mongo.localhost - MongoDB Express
# http://traefik.localhost - Traefik dashboard
```

### Development Hosts

Add these entries to your hosts file (`C:\Windows\System32\drivers\etc\hosts` on Windows):

```
127.0.0.1 elite-mining.localhost
127.0.0.1 mongo.localhost
127.0.0.1 traefik.localhost
```

## Production Deployment

### Prerequisites

1. **Domain**: You need a domain pointing to your server
2. **SSL**: Email address for Let's Encrypt certificates
3. **Security**: Strong passwords and API keys

### Step 1: Configure Environment

```bash
# Copy and edit production environment
cp .env.production.example .env.production

# Edit the file with your actual values
# - Domain names
# - Database passwords
# - API keys
# - Email for certificates
```

### Step 2: Update Traefik Configuration

Edit `traefik/traefik.yml`:
- Update email address for Let's Encrypt
- Configure your domain

Edit `traefik/dynamic/dynamic.yml`:
- Update domain names in routers
- Configure basic auth passwords (use htpasswd)

### Step 3: Deploy

```bash
# Deploy production stack
docker compose -f docker-compose.prod.yml up -d

# Or with monitoring
docker compose -f docker-compose.prod.yml --profile monitoring up -d
```

### Step 4: Verify Deployment

Check services:
```bash
# View logs
docker compose -f docker-compose.prod.yml logs -f

# Check Traefik dashboard
# https://traefik.yourdomain.com

# Test main application
# https://elite-mining.yourdomain.com
```

## Security Configuration

### SSL/TLS Certificates

Traefik automatically obtains and renews Let's Encrypt certificates:
- Certificates stored in `traefik_letsencrypt` volume
- Automatic renewal before expiration
- HTTP to HTTPS redirect enabled

### Security Headers

Traefik applies security headers:
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security` (HSTS)
- `Content-Security-Policy`

### Rate Limiting

Default rate limiting:
- 100 requests per minute average
- 200 request burst capacity
- Configurable per service

### Authentication

Admin interfaces protected with:
- Basic authentication
- Generate passwords with: `htpasswd -nbB admin yourpassword`

## Monitoring (Optional)

Enable monitoring stack:
```bash
docker compose -f docker-compose.prod.yml --profile monitoring up -d
```

Access monitoring:
- **Prometheus**: `https://prometheus.yourdomain.com`
- **Grafana**: `https://grafana.yourdomain.com`
- **Traefik Dashboard**: `https://traefik.yourdomain.com`

## Scaling

Scale the application:
```bash
# Scale to 3 instances
docker compose -f docker-compose.prod.yml up -d --scale elite-mining-server=3
```

Traefik automatically load balances across instances.

## Maintenance

### View Logs

```bash
# Application logs
docker compose -f docker-compose.prod.yml logs elite-mining-server

# Traefik logs
docker compose -f docker-compose.prod.yml logs traefik

# All services
docker compose -f docker-compose.prod.yml logs
```

### Update Services

```bash
# Pull latest images
docker compose -f docker-compose.prod.yml pull

# Restart with zero downtime
docker compose -f docker-compose.prod.yml up -d
```

### Backup

Important volumes to backup:
- `mongodb_data`: Database data
- `traefik_letsencrypt`: SSL certificates

```bash
# Backup MongoDB
docker compose -f docker-compose.prod.yml exec mongodb mongodump --out /data/backup

# Backup certificates
docker run --rm -v traefik_letsencrypt:/data alpine tar czf - /data > certificates.tar.gz
```

## Troubleshooting

### Common Issues

1. **Certificate Issues**
   - Check email configuration in `traefik.yml`
   - Verify domain DNS points to server
   - Check Let's Encrypt rate limits

2. **Service Not Accessible**
   - Verify service labels in docker-compose
   - Check Traefik dashboard for router status
   - Ensure network configuration is correct

3. **SSL Errors**
   - Check certificate resolver configuration
   - Verify domain accessibility on port 80 (ACME challenge)
   - Review Traefik logs for certificate errors

### Debug Commands

```bash
# Check service status
docker compose -f docker-compose.prod.yml ps

# Inspect networks
docker network ls
docker network inspect traefik-proxy

# View Traefik configuration
docker compose -f docker-compose.prod.yml exec traefik cat /etc/traefik/traefik.yml
```

## Advanced Configuration

### Custom Middleware

Add custom middleware in `traefik/dynamic/dynamic.yml`:
```yaml
http:
  middlewares:
    my-custom-middleware:
      # Your middleware configuration
```

### TCP/UDP Services

Configure TCP/UDP routing in `traefik/dynamic/dynamic.yml` for database connections or other protocols.

### Multiple Environments

Use different compose files for different environments:
- `docker-compose.staging.yml`
- `docker-compose.prod.yml`
- `docker-compose.testing.yml`

## Support

For issues and questions:
1. Check Traefik documentation: https://doc.traefik.io/traefik/
2. Review application logs
3. Verify configuration files
4. Check network connectivity