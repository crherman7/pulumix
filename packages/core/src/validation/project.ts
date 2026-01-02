/**
 * Runtime validation for project configuration using JSON Schema.
 *
 * Validates root pulumix.yaml files against the JSON schema and provides
 * helpful error messages with specific remediation steps.
 */

import Ajv, { ErrorObject } from 'ajv'
import addFormats from 'ajv-formats'
import * as fs from 'fs'
import * as path from 'path'
import { createConfigError, DeployError } from '../types/errors'
import { Either, Left, Right } from 'purify-ts/Either'
import type { ProjectConfig } from '../types/manifest'

// Load schema at module initialization
// Look for schema in both src (development) and dist (production) locations
let schemaPath = path.join(__dirname, '../schemas/project-config.schema.json')
if (!fs.existsSync(schemaPath)) {
  // Try src location for when running from compiled code
  schemaPath = path.join(__dirname, '../../src/schemas/project-config.schema.json')
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
const validateConfig = ajv.compile(schema)

/**
 * Format Ajv validation errors into human-readable messages.
 */
function formatValidationErrors(errors: ErrorObject[]): string {
  const messages: string[] = ['Project configuration validation failed:']

  for (const error of errors) {
    const path = error.instancePath || 'root'
    const field = path.replace(/^\//, '').replace(/\//g, '.')

    switch (error.keyword) {
      case 'required':
        messages.push(`  - Missing required field: ${error.params.missingProperty}`)
        break
      case 'type':
        messages.push(`  - Field '${field}' should be ${error.params.type}`)
        break
      case 'enum':
        messages.push(`  - Field '${field}' must be one of: ${error.params.allowedValues.join(', ')}`)
        break
      case 'const':
        messages.push(`  - Field '${field}' must be '${error.params.allowedValue}'`)
        break
      case 'additionalProperties':
        messages.push(`  - Unknown field: ${field}.${error.params.additionalProperty}`)
        break
      case 'oneOf':
        messages.push(`  - Field '${field}' does not match any valid backend type`)
        break
      default:
        messages.push(`  - Validation error at ${field}: ${error.message}`)
    }
  }

  return messages.join('\n')
}

/**
 * Validate a project configuration against the JSON schema.
 *
 * @param config - Project config object to validate
 * @param configPath - Path to the config file (for error reporting)
 * @returns Either containing the validated config or a validation error
 *
 * @example
 * ```typescript
 * const config = yaml.parse(fs.readFileSync('pulumix.yaml', 'utf-8'))
 * const result = validateProjectConfig(config, 'pulumix.yaml')
 *
 * result.caseOf({
 *   Right: c => console.log('Valid config!'),
 *   Left: e => console.error(formatError(e))
 * })
 * ```
 */
export function validateProjectConfig(
  config: unknown,
  configPath: string
): Either<DeployError, ProjectConfig> {
  const valid = validateConfig(config)

  if (!valid && validateConfig.errors) {
    const errorMessage = formatValidationErrors(validateConfig.errors)

    return Left(
      createConfigError(
        'InvalidConfigFormat',
        errorMessage,
        undefined,
        undefined,
        { configPath, validationErrors: validateConfig.errors }
      )
    )
  }

  return Right(config as ProjectConfig)
}

/**
 * Validate project config and throw on error.
 *
 * @param config - Project config to validate
 * @param configPath - Path to config file
 * @throws {DeployError} If validation fails
 */
export function validateProjectConfigOrThrow(
  config: unknown,
  configPath: string
): ProjectConfig {
  const result = validateProjectConfig(config, configPath)

  if (result.isLeft()) {
    throw result.extract()
  }

  return result.unsafeCoerce()
}
