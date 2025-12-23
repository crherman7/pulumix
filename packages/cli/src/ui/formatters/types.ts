/**
 * Formatter Types
 *
 * Shared types for UI formatters
 */

import { PhaseName, DiscoveredService } from '@pulumix/core'

/**
 * Deployment configuration for pre-deployment summary
 */
export interface DeploymentConfig {
  readonly stackName: string
  readonly environment: string
  readonly services: DiscoveredService[]
  readonly rootPath: string
}

/**
 * Phase execution metrics
 */
export interface PhaseMetric {
  readonly phase: PhaseName
  readonly duration: number
  readonly status: 'success' | 'error'
}

/**
 * Resource change summary
 */
export interface ResourceSummary {
  readonly created: number
  readonly updated: number
  readonly deleted: number
  readonly replaced: number
  readonly unchanged: number
}

/**
 * Deployment result for final summary
 */
export interface DeploymentResult {
  readonly success: boolean
  readonly stack: string
  readonly servicesDeployed: number
  readonly duration: number
  readonly resourceSummary?: ResourceSummary
}
