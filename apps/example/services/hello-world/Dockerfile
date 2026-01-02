# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy application package files (from src/)
COPY src/package*.json ./

# Install dependencies
RUN npm install --production

# Production stage
FROM node:18-alpine

# Add labels for metadata
LABEL maintainer="pulumix"
LABEL description="Hello World example app for Pulumix"

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001


WORKDIR /app

# Copy dependencies from builder
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy application code
COPY --chown=nodejs:nodejs src ./src

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

# Start the application
CMD ["node", "src/index.js"]
