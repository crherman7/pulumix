/**
 * Kubernetes Utilities
 *
 * Helper functions for working with Kubernetes resources.
 */

import type { ServiceContext } from '../types/service'

/**
 * Options for generating standard Kubernetes labels
 */
export interface StandardLabelsOptions {
  /** Application version (semver recommended) */
  version?: string
  /** Component within the architecture (e.g., 'api', 'database', 'frontend') */
  component?: string
  /** Name of the higher-level application this is part of */
  partOf?: string
  /** Additional custom labels to merge */
  customLabels?: Record<string, string>
}

/**
 * Generate standard Kubernetes labels from service context
 *
 * Follows the recommended Kubernetes label standards:
 * https://kubernetes.io/docs/concepts/overview/working-with-objects/common-labels/
 *
 * @param ctx - Service context from Pulumix
 * @param options - Optional parameters for additional labels
 * @returns Object containing recommended Kubernetes labels
 *
 * @example
 * ```typescript
 * const labels = getStandardLabels(ctx, {
 *   version: '1.2.3',
 *   component: 'api',
 *   partOf: 'ecommerce-platform'
 * })
 * // Returns:
 * // {
 * //   'app.kubernetes.io/name': 'my-service',
 * //   'app.kubernetes.io/instance': 'my-service-production',
 * //   'app.kubernetes.io/version': '1.2.3',
 * //   'app.kubernetes.io/component': 'api',
 * //   'app.kubernetes.io/part-of': 'ecommerce-platform',
 * //   'app.kubernetes.io/managed-by': 'pulumix',
 * //   'environment': 'production'
 * // }
 * ```
 */
export const getStandardLabels = <TDeps = any>(
  ctx: ServiceContext<TDeps>,
  options?: StandardLabelsOptions
): Record<string, string> => {
  const baseLabels: Record<string, string> = {
    // Required standard labels
    'app.kubernetes.io/name': ctx.serviceName,
    'app.kubernetes.io/instance': `${ctx.serviceName}-${ctx.stackName}`,
    'app.kubernetes.io/managed-by': 'pulumix',

    // Common environment label
    environment: ctx.stackName
  }

  // Add optional standard labels if provided
  if (options?.version) {
    baseLabels['app.kubernetes.io/version'] = options.version
  }

  if (options?.component) {
    baseLabels['app.kubernetes.io/component'] = options.component
  }

  if (options?.partOf) {
    baseLabels['app.kubernetes.io/part-of'] = options.partOf
  }

  // Merge custom labels if provided
  if (options?.customLabels) {
    return { ...baseLabels, ...options.customLabels }
  }

  return baseLabels
}

/**
 * Validate that a label key/value follows Kubernetes label syntax rules
 *
 * @param key - Label key
 * @param value - Label value
 * @returns true if valid, false otherwise
 */
export const isValidKubernetesLabel = (key: string, value: string): boolean => {
  // Key validation
  const keyRegex = /^([a-z0-9A-Z]([a-z0-9A-Z\-_.]*[a-z0-9A-Z])?\/)?[a-z0-9A-Z]([a-z0-9A-Z\-_.]*[a-z0-9A-Z])?$/
  if (key.length > 253 || !keyRegex.test(key)) {
    return false
  }

  // Value validation (can be empty)
  if (value === '') {
    return true
  }

  const valueRegex = /^[a-z0-9A-Z]([a-z0-9A-Z\-_.]*[a-z0-9A-Z])?$/
  return value.length <= 63 && valueRegex.test(value)
}
