/**
 * Runtime validation for service manifests using JSON Schema.
 *
 * Validates pulumix.yaml files against the JSON schema and provides
 * helpful error messages with specific remediation steps.
 *
 * Uses the createValidator factory for consistent validation patterns.
 */

import { createValidator } from './create-validator'
import type { DeployError } from '../types/errors'
import type { Either } from 'purify-ts/Either'

// Create validator using the factory pattern
const validator = createValidator<Record<string, unknown>>(
  'service-manifest.schema.json',
  'Service manifest'
)

/**
 * Validate a service manifest against the JSON schema.
 *
 * Validates the pulumix.yaml content and returns helpful error messages
 * for any validation failures.
 *
 * @param manifest - Service manifest object to validate
 * @param configPath - Path to the manifest file (for error reporting)
 * @returns Either containing the validated manifest or a validation error
 *
 * @example
 * ```typescript
 * const manifest = yaml.parse(fs.readFileSync('pulumix.yaml', 'utf-8'))
 * const result = validateServiceManifest(manifest, 'pulumix.yaml')
 *
 * result.caseOf({
 *   Right: m => console.log('Valid manifest!'),
 *   Left: e => console.error(formatError(e))
 * })
 * ```
 */
export const validateServiceManifest: (
  manifest: unknown,
  configPath: string
) => Either<DeployError, Record<string, unknown>> = validator.validate

/**
 * Validate manifest and throw on error (convenience function).
 *
 * Use this when you want to validate and fail-fast rather than
 * handling the Either monad.
 *
 * @param manifest - Service manifest to validate
 * @param configPath - Path to manifest file
 * @throws {DeployError} If validation fails
 *
 * @example
 * ```typescript
 * try {
 *   validateServiceManifestOrThrow(manifest, 'pulumix.yaml')
 *   // Proceed with valid manifest
 * } catch (error) {
 *   console.error(formatError(error))
 * }
 * ```
 */
export const validateServiceManifestOrThrow: (
  manifest: unknown,
  configPath: string
) => Record<string, unknown> = validator.validateOrThrow
