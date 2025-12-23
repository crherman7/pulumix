/**
 * Environment variable builder for Pulumix dev mode
 *
 * Builds environment variables that map cluster services and local
 * dev services to localhost URLs.
 */

import {
  DevConfig,
  LocalDevService,
  PortForwardMapping,
  PROTOCOL_PREFIXES,
  STANDARD_PORTS,
} from './types'

/**
 * Convert a service name to an environment variable name
 *
 * Examples:
 * - "api" -> "API_URL"
 * - "auth-service" -> "AUTH_SERVICE_URL"
 * - "my-api" -> "MY_API_URL"
 */
export function serviceToEnvVar(serviceName: string): string {
  return serviceName
    .toUpperCase()
    .replace(/-/g, '_')
    + '_URL'
}

/**
 * Get the protocol prefix for a service based on its name
 *
 * Database services get their specific protocol, HTTP services get http://
 */
export function getServiceProtocol(serviceName: string): string {
  const lowerName = serviceName.toLowerCase()

  // Check for known database/service types
  for (const [key, protocol] of Object.entries(PROTOCOL_PREFIXES)) {
    if (lowerName.includes(key)) {
      return protocol
    }
  }

  // Default to HTTP for unknown services
  return 'http'
}

/**
 * Check if a service is a database/stateful service
 */
export function isDatabaseService(serviceName: string): boolean {
  const lowerName = serviceName.toLowerCase()
  return Object.keys(STANDARD_PORTS).some(key => lowerName.includes(key))
}

/**
 * Build URL for a port-forwarded cluster service
 */
export function buildPortForwardUrl(mapping: PortForwardMapping): string {
  const protocol = mapping.protocol || getServiceProtocol(mapping.serviceName)

  // Database URLs don't use // prefix
  if (['postgres', 'postgresql', 'mysql', 'redis', 'mongodb', 'mongo'].includes(protocol)) {
    return `${protocol}://localhost:${mapping.localPort}`
  }

  return `${protocol}://localhost:${mapping.localPort}`
}

/**
 * Build URL for a local dev service
 */
export function buildLocalServiceUrl(localService: LocalDevService): string {
  return `http://localhost:${localService.localPort}`
}

/**
 * Build environment variables for a single dev service
 *
 * Includes URLs for:
 * - Other local dev services (direct localhost)
 * - Cluster services (via port-forward)
 */
export function buildDevEnvironment(
  targetService: LocalDevService,
  allLocalServices: LocalDevService[],
  portForwards: PortForwardMapping[],
  devConfig: DevConfig
): Record<string, string> {
  const env: Record<string, string> = {}

  // Add URLs for other local dev services
  for (const localService of allLocalServices) {
    // Skip self
    if (localService.service.name === targetService.service.name) {
      continue
    }

    const envVar = serviceToEnvVar(localService.service.name)
    env[envVar] = buildLocalServiceUrl(localService)
  }

  // Add URLs for port-forwarded cluster services
  for (const mapping of portForwards) {
    const envVar = mapping.envVar || serviceToEnvVar(mapping.serviceName)
    env[envVar] = buildPortForwardUrl(mapping)
  }

  // Add dev config env vars (these take precedence)
  if (devConfig.env) {
    Object.assign(env, devConfig.env)
  }

  // Always set NODE_ENV to development
  env.NODE_ENV = 'development'

  return env
}

/**
 * Build environment variables for all dev services
 *
 * Returns a map of service name -> env vars
 */
export function buildAllDevEnvironments(
  localServices: LocalDevService[],
  portForwards: PortForwardMapping[]
): Map<string, Record<string, string>> {
  const envMap = new Map<string, Record<string, string>>()

  for (const localService of localServices) {
    const env = buildDevEnvironment(
      localService,
      localServices,
      portForwards,
      localService.devConfig
    )
    envMap.set(localService.service.name, env)
  }

  return envMap
}
