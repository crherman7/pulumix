/**
 * Runtime validation for service manifests using JSON Schema.
 *
 * Validates pulumix.yaml files against the JSON schema and provides
 * helpful error messages with specific remediation steps.
 */

import Ajv, { ErrorObject } from 'ajv'
import addFormats from 'ajv-formats'
import * as fs from 'fs'
import * as path from 'path'
import { createConfigError, DeployError } from '../types/errors'
import { Either, Left, Right } from 'purify-ts/Either'

// Load schema at module initialization
// Look for schema in both src (development) and dist (production) locations
let schemaPath = path.join(__dirname, '../schemas/service-manifest.schema.json')
if (!fs.existsSync(schemaPath)) {
  // Try src location for when running from compiled code
  schemaPath = path.join(__dirname, '../../src/schemas/service-manifest.schema.json')
}
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'))

// Create Ajv instance with strict validation
const ajv = new Ajv({
  allErrors: true,
  verbose: true,
  strict: false,
  $data: true
})

// Add format validators (email, uri, etc.)
addFormats(ajv)

// Compile schema once for performance
const validateManifest = ajv.compile(schema)

/**
 * Format Ajv validation errors into human-readable messages.
 *
 * Transforms technical JSON Schema validation errors into helpful
 * messages with field paths and expected values.
 *
 * @param errors - Array of Ajv validation errors
 * @returns Formatted error message with helpful details
 */
function formatValidationErrors(errors: ErrorObject[]): string {
  const messages: string[] = ['Service manifest validation failed:']

  for (const error of errors) {
    const path = error.instancePath || 'root'
    const field = path.replace(/^\//, '').replace(/\//g, '.')

    switch (error.keyword) {
      case 'required':
        messages.push(`  • Missing required field: ${error.params.missingProperty}`)
        break
      case 'type':
        messages.push(`  • Field '${field}' should be ${error.params.type}`)
        break
      case 'pattern':
        messages.push(`  • Field '${field}' does not match required pattern`)
        if (field === 'metadata.name') {
          messages.push(`    Must be lowercase alphanumeric with hyphens: [a-z0-9-]+`)
        }
        if (field === 'metadata.version') {
          messages.push(`    Must be valid semver: 1.2.3 or 1.2.3-beta.1`)
        }
        break
      case 'format':
        messages.push(`  • Field '${field}' should be valid ${error.params.format}`)
        break
      case 'additionalProperties':
        messages.push(`  • Unknown field: ${error.params.additionalProperty}`)
        break
      case 'enum':
        messages.push(`  • Field '${field}' must be one of: ${error.params.allowedValues.join(', ')}`)
        break
      case 'minimum':
      case 'maximum':
        messages.push(`  • Field '${field}' is out of range`)
        break
      default:
        messages.push(`  • Validation error at ${field}: ${error.message}`)
    }
  }

  return messages.join('\n')
}

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
export function validateServiceManifest(
  manifest: unknown,
  configPath: string
): Either<DeployError, Record<string, unknown>> {
  const valid = validateManifest(manifest)

  if (!valid && validateManifest.errors) {
    const errorMessage = formatValidationErrors(validateManifest.errors)

    return Left(
      createConfigError(
        'InvalidConfigFormat',
        errorMessage,
        undefined,
        undefined,
        { configPath, validationErrors: validateManifest.errors }
      )
    )
  }

  return Right(manifest as Record<string, unknown>)
}

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
export function validateServiceManifestOrThrow(
  manifest: unknown,
  configPath: string
): void {
  const result = validateServiceManifest(manifest, configPath)

  if (result.isLeft()) {
    throw result.extract()
  }
}
