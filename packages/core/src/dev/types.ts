/**
 * Types for Pulumix dev mode - local development with HMR
 */

import { DiscoveredService } from '../types/service'

/**
 * Dev configuration from service's pulumix.yaml
 */
export interface DevConfig {
  /** Command to run for local development (e.g., "npm run dev") */
  readonly command: string
  /** Port the local dev server listens on (default: 3000) */
  readonly port?: number
  /** Additional environment variables for dev mode */
  readonly env?: Record<string, string>
  /** Working directory relative to service path (default: ".") */
  readonly cwd?: string
}

/**
 * Port forward mapping from cluster service to localhost
 */
export interface PortForwardMapping {
  /** Service name in cluster */
  readonly serviceName: string
  /** Kubernetes namespace */
  readonly namespace: string
  /** Remote port in cluster */
  readonly remotePort: number
  /** Local port to forward to */
  readonly localPort: number
  /** Environment variable name to inject (e.g., "API_URL") */
  readonly envVar: string
  /** Protocol for URL generation (http, redis, postgres, etc.) */
  readonly protocol: string
}

/**
 * Handle to a running port-forward process
 */
export interface PortForwardHandle {
  /** Kill the port-forward process */
  readonly kill: () => void
  /** Promise that resolves with exit code when process exits */
  readonly exited: Promise<number>
  /** The mapping this handle represents */
  readonly mapping: PortForwardMapping
}

/**
 * Handle to a running local dev server
 */
export interface DevServerHandle {
  /** Kill the dev server process */
  readonly kill: () => void
  /** Promise that resolves with exit code when process exits */
  readonly exited: Promise<number>
  /** The service being run */
  readonly serviceName: string
  /** Local port the server is running on */
  readonly port: number
}

/**
 * Local dev service assignment
 */
export interface LocalDevService {
  /** The discovered service */
  readonly service: DiscoveredService
  /** Dev config from pulumix.yaml */
  readonly devConfig: DevConfig
  /** Assigned local port */
  readonly localPort: number
}

/**
 * Configuration for the dev orchestrator
 */
export interface DevOrchestratorConfig {
  /** Root path of the project */
  readonly rootPath: string
  /** Stack name (e.g., "local") */
  readonly stackName: string
  /** Services to run locally in dev mode */
  readonly devServices: string[]
  /** Callback for Pulumi output during deployment */
  readonly onOutput?: (message: string) => void
}

/**
 * Handle to a swapped service (for restore)
 */
export interface ServiceSwapHandle {
  readonly serviceName: string
  readonly namespace: string
  readonly localPort: number
  readonly restore: () => Promise<void>
}

/**
 * Result from dev orchestrator
 */
export interface DevOrchestratorResult {
  /** Whether dev mode started successfully */
  readonly success: boolean
  /** Stack name */
  readonly stack: string
  /** Kubernetes namespace */
  readonly namespace?: string
  /** Base domain for ingress URLs */
  readonly baseDomain?: string
  /** Services running in dev mode */
  readonly devServices: LocalDevService[]
  /** Active port forwards to cluster services */
  readonly portForwards: PortForwardMapping[]
  /** Handles to running dev servers */
  readonly devServerHandles: DevServerHandle[]
  /** Handles to running port-forwards */
  readonly portForwardHandles: PortForwardHandle[]
  /** Handles to swapped services */
  readonly serviceSwapHandles?: ServiceSwapHandle[]
  /** Ingress URLs pointing to local dev servers */
  readonly ingressUrls?: string[]
}

/**
 * Standard ports for common services
 */
export const STANDARD_PORTS: Record<string, number> = {
  postgres: 5432,
  postgresql: 5432,
  mysql: 3306,
  redis: 6379,
  mongodb: 27017,
  mongo: 27017,
  rabbitmq: 5672,
  kafka: 9092,
  elasticsearch: 9200,
  memcached: 11211,
}

/**
 * Protocol prefixes for URL generation
 */
export const PROTOCOL_PREFIXES: Record<string, string> = {
  postgres: 'postgres',
  postgresql: 'postgres',
  mysql: 'mysql',
  redis: 'redis',
  mongodb: 'mongodb',
  mongo: 'mongodb',
  http: 'http',
  https: 'https',
}

/**
 * Base port for auto-assigned HTTP services
 * HTTP services get ports 10001, 10002, 10003, ...
 */
export const HTTP_PORT_BASE = 10001

/**
 * Base port for local dev servers
 * Local dev servers get ports 3000, 3001, 3002, ...
 */
export const DEV_SERVER_PORT_BASE = 3000
