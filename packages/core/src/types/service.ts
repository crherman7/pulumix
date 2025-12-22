/**
 * Service Types
 *
 * Simplified types for service-based deployment.
 * No provider abstraction - services handle their own resources.
 */

import * as pulumi from '@pulumi/pulumi'
import type { ServiceMetadata, ObservabilityConfig, SecurityConfig } from './manifest'

/**
 * Configuration passed to a service's deploy function
 *
 * @template TDeps - Type of dependency outputs (for type-safe access)
 *
 * @example
 * ```typescript
 * // Without typed dependencies
 * export default async (ctx: ServiceContext) => { ... }
 *
 * // With typed dependencies
 * interface MyDependencies {
 *   provider: ProviderOutputs
 *   ingress: IngressOutputs
 * }
 * export default async (ctx: ServiceContext<MyDependencies>) => {
 *   const registry = ctx.dependencies.provider.registry // ✅ Type-safe!
 * }
 * ```
 */
export interface ServiceContext<TDeps = Record<string, Record<string, unknown>>> {
  /** Stack name (local, staging, production) */
  readonly stackName: string
  /** Service name */
  readonly serviceName: string
  /** Service metadata from deploy.yaml */
  readonly metadata: ServiceMetadata
  /** Observability configuration */
  readonly observability?: ObservabilityConfig
  /** Security configuration */
  readonly security?: SecurityConfig
  /** Stack-scoped config from deploy.yaml */
  readonly config: Record<string, unknown>
  /** Global config from root deploy.yaml */
  readonly globalConfig: Record<string, unknown>
  /** Namespace for resources */
  readonly namespace: string
  /** Outputs from dependency services */
  readonly dependencies: TDeps
  /** Pre-built image reference (if applicable) */
  readonly image?: string
}

/**
 * Result returned from a service's deploy function
 *
 * @template TOutputs - Type of output values (for consumers to use)
 *
 * @example
 * ```typescript
 * export interface ProviderOutputs {
 *   clusterName: string
 *   registry: string
 * }
 *
 * export default async (ctx: ServiceContext): Promise<ServiceResult<ProviderOutputs>> => {
 *   return {
 *     outputs: {
 *       clusterName: 'my-cluster',
 *       registry: 'localhost:5001'
 *     }
 *   }
 * }
 * ```
 */
export interface ServiceResult<TOutputs = Record<string, unknown>> {
  /** Output values to expose */
  readonly outputs?: TOutputs
  /** Resources created (for tracking) */
  readonly resources?: pulumi.Resource[]
}

/**
 * Service deploy function signature
 *
 * @template TDeps - Type of dependency outputs
 * @template TOutputs - Type of service outputs
 */
export type ServiceDeployFn<
  TDeps = Record<string, Record<string, unknown>>,
  TOutputs = Record<string, unknown>
> = (ctx: ServiceContext<TDeps>) => Promise<ServiceResult<TOutputs> | void>

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
  /** Dependencies from package.json */
  readonly dependencies: string[]
  /** Has Dockerfile */
  readonly hasDockerfile: boolean
  /** Full config from deploy.yaml */
  readonly rawConfig: Record<string, unknown>
  /** Parsed service metadata */
  readonly metadata: ServiceMetadata
  /** Observability configuration */
  readonly observability?: ObservabilityConfig
  /** Security configuration */
  readonly security?: SecurityConfig
}

/**
 * Service with resolved stack config
 */
export interface ResolvedService extends DiscoveredService {
  /** Stack-specific config */
  readonly stackConfig: Record<string, unknown>
}
