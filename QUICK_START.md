# Quick Reference Commands

## Development
```bash
make dev          # Start development with dashboard
make dev-full     # Start with security features
make setup-hosts  # Show hosts configuration
make logs         # View development logs
```

## Production
```bash
make prod         # Deploy production
make prod-monitor # Deploy with monitoring
make prod-logs    # View production logs
```

## Maintenance
```bash
make build        # Build application
make clean        # Stop containers
make clean-all    # Clean everything
make status       # Show container status
make update       # Update services
```

## Access Points

### Development
- Dashboard: http://elite-mining.localhost
- MongoDB: http://mongo.localhost  
- Traefik: http://traefik.localhost
- CrowdSec: http://crowdsec.localhost

### Production
- Dashboard: https://elite-mining.yourdomain.com
- Traefik: https://traefik.yourdomain.com
- CrowdSec: https://crowdsec.yourdomain.com
- Grafana: https://grafana.yourdomain.com