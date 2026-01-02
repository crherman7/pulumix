/**
 * Service Types
 *
 * Simplified types for service-based deployment.
 * No provider abstraction - services handle their own resources.
 */

import * as pulumi from '@pulumi/pulumi'
import type { ServiceMetadata, ObservabilityConfig, SecurityConfig, BuildConfig } from './manifest'

/**
 * Configuration passed to a service's deploy function.
 *
 * Provides access to configuration, dependencies, metadata, and pre-built images.
 * Services use this context to create their Pulumi resources with full type safety.
 *
 * @template TDeps - Type of dependency outputs (for type-safe access to dependency services)
 *
 * @see {@link ServiceResult} for the return type
 * @see {@link ServiceDeployFn} for the function signature
 * @see {@link ServiceMetadata} for metadata structure
 *
 * @example
 * Basic usage without typed dependencies
 * ```typescript
 * export default async (ctx: ServiceContext) => {
 *   const config = ctx.config
 *   const namespace = ctx.namespace
 *
 *   // Create resources...
 *   return { outputs: { endpoint: '...' } }
 * }
 * ```
 *
 * @example
 * Advanced usage with typed dependencies
 * ```typescript
 * // Define dependency outputs
 * interface ProviderOutputs {
 *   registry: string
 *   clusterName: string
 * }
 *
 * interface IngressOutputs {
 *   className: string
 * }
 *
 * // Define dependencies interface
 * interface MyDependencies {
 *   provider: ProviderOutputs
 *   ingress: IngressOutputs
 * }
 *
 * // Use in service
 * export default async (ctx: ServiceContext<MyDependencies>) => {
 *   const registry = ctx.dependencies.provider.registry // ✅ Fully typed!
 *   const ingressClass = ctx.dependencies.ingress.className // ✅ Autocomplete works!
 *
 *   // Create resources with dependency values...
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
 * Result returned from a service's deploy function.
 *
 * Services return outputs that other services can consume as dependencies.
 * Outputs are strongly typed for type-safe dependency injection.
 *
 * @template TOutputs - Type of output values (for downstream consumers)
 *
 * @see {@link ServiceContext} for the input context
 * @see {@link ServiceDeployFn} for the function signature
 *
 * @example
 * Service with typed outputs
 * ```typescript
 * export interface ProviderOutputs {
 *   clusterName: string
 *   registry: string
 * }
 *
 * export default async (ctx: ServiceContext): Promise<ServiceResult<ProviderOutputs>> => {
 *   // Create resources...
 *
 *   return {
 *     outputs: {
 *       clusterName: 'my-cluster',
 *       registry: 'localhost:5001'
 *     }
 *   }
 * }
 * ```
 *
 * @example
 * Service without outputs (terminal service)
 * ```typescript
 * export default async (ctx: ServiceContext): Promise<void> => {
 *   // Create resources that don't need to expose outputs
 *   // Other services won't depend on this one
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
 * Service deploy function signature.
 *
 * The main entry point for a service. Each service exports a default function
 * that receives a ServiceContext and returns ServiceResult or void.
 *
 * @template TDeps - Type of dependency outputs (services this service depends on)
 * @template TOutputs - Type of service outputs (values this service exposes)
 *
 * @see {@link ServiceContext} for the context parameter
 * @see {@link ServiceResult} for the return type
 *
 * @example
 * Basic service (pulumix.ts)
 * ```typescript
 * import * as k8s from '@pulumi/kubernetes'
 * import { ServiceContext, ServiceResult } from '@pulumix/core'
 *
 * export default async (ctx: ServiceContext): Promise<ServiceResult> => {
 *   const deployment = new k8s.apps.v1.Deployment(ctx.serviceName, {
 *     metadata: { namespace: ctx.namespace },
 *     spec: { ... }
 *   })
 *
 *   return {
 *     outputs: { deploymentName: deployment.metadata.name }
 *   }
 * }
 * ```
 */
export type ServiceDeployFn<
  TDeps = Record<string, Record<string, unknown>>,
  TOutputs = Record<string, unknown>
> = (ctx: ServiceContext<TDeps>) => Promise<ServiceResult<TOutputs> | void>

/**
 * Discovered service from the codebase.
 *
 * Represents a service found during the discovery phase. Contains all metadata,
 * configuration, and file paths needed to deploy the service.
 *
 * Services are discovered by finding directories with both `pulumix.ts` and
 * `pulumix.yaml` files.
 *
 * @see {@link ResolvedService} for service with resolved stack config
 *
 * @example
 * Service discovery finds services with this structure:
 * ```
 * services/
 *   my-service/
 *     pulumix.ts      ← Deploy function
 *     pulumix.yaml    ← Service configuration
 *     Dockerfile      ← Optional
 *     package.json    ← Dependencies
 * ```
 */
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
  /** Docker build configuration */
  readonly build?: BuildConfig
  /** Observability configuration */
  readonly observability?: ObservabilityConfig
  /** Security configuration */
  readonly security?: SecurityConfig
}

/**
 * Service with resolved stack-specific configuration.
 *
 * Extends DiscoveredService with stack-specific config values resolved
 * from the `stacks` section of pulumix.yaml.
 *
 * @see {@link DiscoveredService} for base service information
 *
 * @example
 * Stack config resolution from pulumix.yaml:
 * ```yaml
 * stacks:
 *   local:
 *     replicas: 1
 *     imagePullPolicy: IfNotPresent
 *   production:
 *     replicas: 5
 *     imagePullPolicy: Always
 * ```
 * When deploying to 'production', stackConfig will be:
 * ```typescript
 * { replicas: 5, imagePullPolicy: 'Always' }
 * ```
 */
export interface ResolvedService extends DiscoveredService {
  /** Stack-specific config */
  readonly stackConfig: Record<string, unknown>
}
