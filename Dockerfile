# Dockerfile für Elite Mining Data Server
FROM node:lts-alpine

# Set working directory
WORKDIR /app

# Create app user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S eliteuser -u 1001

# Install dependencies first (for better caching)
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Create necessary directories
RUN mkdir -p logs data && \
    chown -R eliteuser:nodejs /app

# Copy source code
COPY --chown=eliteuser:nodejs src/ ./src/

# Switch to non-root user
USER eliteuser

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Start application
CMD ["node", "src/index.js"]