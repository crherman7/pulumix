/**
 * Simple Hello World Express App
 *
 * Demonstrates a basic HTTP service deployment with Pulumix
 */

const express = require('express')
const os = require('os')

const app = express()
const port = process.env.PORT || 3000

// Health check endpoint (for Kubernetes liveness/readiness probes)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  })
})

// Main endpoint
app.get('/', (req, res) => {
  const response = {
    message: 'Hello from Pulumix!',
    hostname: os.hostname(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.APP_VERSION || '1.0.0',
    timestamp: new Date().toISOString()
  }

  res.json(response)
})

// Info endpoint
app.get('/info', (req, res) => {
  res.json({
    app: 'hello-world',
    version: process.env.APP_VERSION || '1.0.0',
    node: process.version,
    platform: os.platform(),
    arch: os.arch(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  })
})

// Start server
app.listen(port, () => {
  console.log(`Hello World app listening on port ${port}`)
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`Hostname: ${os.hostname()}`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server')
  server.close(() => {
    console.log('HTTP server closed')
    process.exit(0)
  })
})
