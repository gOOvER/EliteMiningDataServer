# Makefile for Elite Mining Data Server
# Simplifies common Docker and deployment tasks

.PHONY: help dev dev-full prod build logs clean setup-hosts

# Default target
help:
	@echo "Elite Mining Data Server - Available commands:"
	@echo ""
	@echo "Development:"
	@echo "  dev          - Start development environment with Traefik"
	@echo "  dev-full     - Start development with CrowdSec security"
	@echo "  logs         - Show development logs"
	@echo "  setup-hosts  - Show hosts file configuration"
	@echo ""
	@echo "Production:"
	@echo "  prod         - Deploy production environment"
	@echo "  prod-monitor - Deploy production with monitoring"
	@echo "  prod-logs    - Show production logs"
	@echo ""
	@echo "Build & Maintenance:"
	@echo "  build        - Build application image"
	@echo "  clean        - Stop and remove all containers"
	@echo "  clean-all    - Clean everything including volumes"
	@echo ""

# Development environment
dev:
	@echo "🚀 Starting development environment with Traefik..."
	docker compose -f compose.yaml -f docker-compose.override.yml up -d
	@echo ""
	@echo "✅ Development environment started!"
	@echo "📍 Access points:"
	@echo "   - Main app:      http://elite-mining.localhost"
	@echo "   - MongoDB UI:    http://mongo.localhost"
	@echo "   - Traefik UI:    http://traefik.localhost"
	@echo ""
	@echo "💡 Don't forget to configure your hosts file (run: make setup-hosts)"

# Development environment with security
dev-full:
	@echo "🚀 Starting full development environment with CrowdSec..."
	docker compose -f compose.yaml -f docker-compose.override.yml --profile security up -d
	@echo ""
	@echo "✅ Full development environment started!"
	@echo "📍 Access points:"
	@echo "   - Main app:      http://elite-mining.localhost"
	@echo "   - Dashboard:     http://elite-mining.localhost (Status UI)"
	@echo "   - MongoDB UI:    http://mongo.localhost"
	@echo "   - Traefik UI:    http://traefik.localhost"
	@echo "   - CrowdSec UI:   http://crowdsec.localhost"
	@echo ""
	@echo "💡 Don't forget to configure your hosts file (run: make setup-hosts)"

# Production environment
prod:
	@echo "🚀 Deploying production environment..."
	@if [ ! -f .env.production ]; then \
		echo "❌ Error: .env.production file not found!"; \
		echo "📋 Create it from: cp .env.production.example .env.production"; \
		exit 1; \
	fi
	docker compose -f docker-compose.prod.yml up -d
	@echo "✅ Production environment deployed!"

# Production with monitoring
prod-monitor:
	@echo "🚀 Deploying production environment with monitoring..."
	@if [ ! -f .env.production ]; then \
		echo "❌ Error: .env.production file not found!"; \
		exit 1; \
	fi
	docker compose -f docker-compose.prod.yml --profile monitoring up -d
	@echo "✅ Production environment with monitoring deployed!"

# Build application
build:
	@echo "🔨 Building application image..."
	docker compose build elite-mining-server

# Show logs
logs:
	docker compose -f compose.yaml -f docker-compose.override.yml logs -f

prod-logs:
	docker compose -f docker-compose.prod.yml logs -f

# Cleanup
clean:
	@echo "🧹 Stopping and removing containers..."
	docker compose -f compose.yaml -f docker-compose.override.yml down
	docker compose -f docker-compose.prod.yml down

clean-all:
	@echo "🧹 Cleaning everything (containers, networks, volumes)..."
	docker compose -f compose.yaml -f docker-compose.override.yml down -v
	docker compose -f docker-compose.prod.yml down -v
	docker system prune -f

# Setup hosts file information
setup-hosts:
	@echo "📝 Add these entries to your hosts file for development:"
	@echo ""
	@echo "Windows: C:\\Windows\\System32\\drivers\\etc\\hosts"
	@echo "Linux/Mac: /etc/hosts"
	@echo ""
	@echo "127.0.0.1 elite-mining.localhost"
	@echo "127.0.0.1 mongo.localhost"
	@echo "127.0.0.1 traefik.localhost"
	@echo "127.0.0.1 crowdsec.localhost"
	@echo ""
	@echo "💡 You may need administrator/root privileges to edit the hosts file"

# Show status
status:
	@echo "📊 Container Status:"
	docker compose -f compose.yaml -f docker-compose.override.yml ps
	@echo ""
	@echo "📊 Production Status:"
	docker compose -f docker-compose.prod.yml ps

# Update and restart
update:
	@echo "🔄 Updating and restarting services..."
	docker compose -f compose.yaml -f docker-compose.override.yml pull
	docker compose -f compose.yaml -f docker-compose.override.yml up -d

prod-update:
	@echo "🔄 Updating production services..."
	docker compose -f docker-compose.prod.yml pull
	docker compose -f docker-compose.prod.yml up -d