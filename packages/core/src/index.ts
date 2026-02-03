/**
 * @pulumix/core
 *
 * Core types and orchestrator for Pulumix.
 * Service-based deployment orchestration built on Pulumi.
 */

export const version = '0.0.0'

// Service types
export * from './types/service'
export * from './types/manifest'
export * from './types/errors'
export * from './types/events'

// Validation
export * from './validation/manifest'
export * from './validation/project'

// Orchestrator
export * from './orchestrator'
export * from './orchestrator/events'

// Kubernetes utilities
export * from './utils/kubernetes'

// Docker utilities
export * from './docker'

// Kubernetes cluster inspection
export * from './k8s'

// Dev mode
export * from './dev'
