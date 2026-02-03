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
  /** Additional environment variables for dev mode (overrides auto-computed) */
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
  /** Kubernetes context override (default: current context) */
  readonly kubeContext?: string
  /** Callback for status/log messages */
  readonly onLog?: (message: string) => void
  /** Callback for dev server output */
  readonly onOutput?: (message: string) => void
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
  readonly namespace: string
  /** Services running in dev mode */
  readonly devServices: LocalDevService[]
  /** Active port forwards to cluster services */
  readonly portForwards: PortForwardMapping[]
  /** Handles to running dev servers */
  readonly devServerHandles: DevServerHandle[]
  /** Handles to running port-forwards */
  readonly portForwardHandles: PortForwardHandle[]
}

/**
 * Base port for local dev servers
 * Local dev servers get ports 3000, 3001, 3002, ...
 */
export const DEV_SERVER_PORT_BASE = 3000
