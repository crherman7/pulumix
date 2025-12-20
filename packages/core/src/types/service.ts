/**
 * Service Types
 *
 * Simplified types for service-based deployment.
 * No provider abstraction - services handle their own resources.
 */

import * as pulumi from '@pulumi/pulumi'

/**
 * Configuration passed to a service's deploy function
 */
export interface ServiceContext {
  /** Stack name (local, staging, production) */
  readonly stackName: string
  /** Service name */
  readonly serviceName: string
  /** Stack-scoped config from deploy.yaml */
  readonly config: Record<string, unknown>
  /** Global config from root deploy.yaml */
  readonly globalConfig: Record<string, unknown>
  /** Namespace for resources */
  readonly namespace: string
  /** Outputs from dependency services */
  readonly dependencies: Record<string, Record<string, unknown>>
  /** Pre-built image reference (if applicable) */
  readonly image?: string
}

/**
 * Result returned from a service's deploy function
 */
export interface ServiceResult {
  /** Output values to expose */
  readonly outputs?: Record<string, unknown>
  /** Resources created (for tracking) */
  readonly resources?: pulumi.Resource[]
}

/**
 * Service deploy function signature
 */
export type ServiceDeployFn = (ctx: ServiceContext) => Promise<ServiceResult | void>

/**
 * Discovered service from services/*/
export interface DiscoveredService {
  /** Service name (directory name) */
  readonly name: string
  /** Path to service directory */
  readonly path: string
  /** Path to deploy.ts */
  readonly deployPath: string
  /** Path to deploy.yaml */
  readonly configPath: string
  /** Dependencies from deploy.yaml */
  readonly dependencies: string[]
  /** Has Dockerfile */
  readonly hasDockerfile: boolean
  /** Full config from deploy.yaml */
  readonly rawConfig: Record<string, unknown>
}

/**
 * Service with resolved stack config
 */
export interface ResolvedService extends DiscoveredService {
  /** Stack-specific config */
  readonly stackConfig: Record<string, unknown>
}
