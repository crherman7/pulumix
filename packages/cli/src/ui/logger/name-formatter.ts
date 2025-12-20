/**
 * Name Formatter
 *
 * Pure functions for formatting resource type names and URNs.
 */

/**
 * Capitalize the first letter of a string
 */
const capitalize = (s: string): string =>
  s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Format a resource type for display
 *
 * Examples:
 * - kubernetes:apps/v1:Deployment -> Deployment
 * - pulumi:providers:kubernetes -> Kubernetes Provider
 * - aws:s3:Bucket -> Bucket
 */
export const formatResourceType = (resourceType: string): string => {
  if (resourceType.startsWith('pulumi:providers')) {
    const provider = resourceType.split(':')[2]
    return provider ? `${capitalize(provider)} Provider` : 'Provider'
  }
  return resourceType.split(':').pop() || resourceType
}

/**
 * Format a URN for display
 *
 * URN format: urn:pulumi:stack::project::type::name
 */
export const formatUrn = (urn: string): string => {
  const parts = urn.split('::')
  const name = parts.at(-1) ?? ''
  const resourceType = parts.at(-2) ?? ''

  return `${formatResourceType(resourceType)} ${name}`
}
