/**
 * Generic validator factory using higher-order functions.
 *
 * Creates type-safe validators for JSON Schema validation with
 * consistent error handling and formatting.
 */

import Ajv, { ErrorObject } from 'ajv'
import addFormats from 'ajv-formats'
import * as fs from 'fs'
import * as path from 'path'
import { Either, Left, Right } from 'purify-ts/Either'
import { createConfigError, DeployError } from '../types/errors'

/**
 * Format Ajv validation errors into human-readable messages.
 * Pure function - no side effects.
 */
const formatValidationErrors = (errors: ErrorObject[], prefix: string): string => {
  const messages: string[] = [`${prefix} validation failed:`]

  for (const error of errors) {
    const fieldPath = error.instancePath || 'root'
    const field = fieldPath.replace(/^\//, '').replace(/\//g, '.')

    switch (error.keyword) {
      case 'required':
        messages.push(`  - Missing required field: ${error.params.missingProperty}`)
        break
      case 'type':
        messages.push(`  - Field '${field}' should be ${error.params.type}`)
        break
      case 'pattern':
        messages.push(`  - Field '${field}' does not match required pattern`)
        if (field === 'metadata.name') {
          messages.push(`    Must be lowercase alphanumeric with hyphens: [a-z0-9-]+`)
        }
        if (field === 'metadata.version') {
          messages.push(`    Must be valid semver: 1.2.3 or 1.2.3-beta.1`)
        }
        break
      case 'format':
        messages.push(`  - Field '${field}' should be valid ${error.params.format}`)
        break
      case 'additionalProperties':
        messages.push(`  - Unknown field: ${error.params.additionalProperty}`)
        break
      case 'enum':
        messages.push(`  - Field '${field}' must be one of: ${error.params.allowedValues.join(', ')}`)
        break
      case 'const':
        messages.push(`  - Field '${field}' must be '${error.params.allowedValue}'`)
        break
      case 'oneOf':
        messages.push(`  - Field '${field}' does not match any valid type`)
        break
      case 'minimum':
      case 'maximum':
        messages.push(`  - Field '${field}' is out of range`)
        break
      default:
        messages.push(`  - Validation error at ${field}: ${error.message}`)
    }
  }

  return messages.join('\n')
}

/**
 * Load JSON schema with fallback paths (dist vs src).
 * Pure function with controlled side effects (file read).
 */
const loadSchema = (schemaFileName: string): Record<string, unknown> => {
  let schemaPath = path.join(__dirname, `../schemas/${schemaFileName}`)
  if (!fs.existsSync(schemaPath)) {
    schemaPath = path.join(__dirname, `../../src/schemas/${schemaFileName}`)
  }
  return JSON.parse(fs.readFileSync(schemaPath, 'utf-8'))
}

/**
 * Validator interface returned by createValidator.
 */
export interface Validator<T> {
  readonly validate: (data: unknown, configPath: string) => Either<DeployError, T>
  readonly validateOrThrow: (data: unknown, configPath: string) => T
}

/**
 * Higher-order function that creates a type-safe validator.
 * Returns pure validation functions configured for a specific schema.
 *
 * @param schemaFileName - Name of the JSON schema file in the schemas directory
 * @param errorPrefix - Prefix for error messages (e.g., "Service manifest", "Project configuration")
 * @returns Validator object with validate and validateOrThrow functions
 *
 * @example
 * ```typescript
 * const validator = createValidator<ProjectConfig>(
 *   'project-config.schema.json',
 *   'Project configuration'
 * )
 *
 * const result = validator.validate(rawConfig, 'pulumix.yaml')
 * ```
 */
export const createValidator = <T>(
  schemaFileName: string,
  errorPrefix: string
): Validator<T> => {
  // Initialize Ajv once per validator
  const ajv = new Ajv({ allErrors: true, verbose: true, strict: false, $data: true })
  addFormats(ajv)

  const schema = loadSchema(schemaFileName)
  const compiledValidator = ajv.compile(schema)

  const validate = (data: unknown, configPath: string): Either<DeployError, T> => {
    const isValid = compiledValidator(data)

    if (!isValid && compiledValidator.errors) {
      const errorMessage = formatValidationErrors(compiledValidator.errors, errorPrefix)
      return Left(
        createConfigError(
          'InvalidConfigFormat',
          errorMessage,
          undefined,
          undefined,
          { configPath, validationErrors: compiledValidator.errors }
        )
      )
    }

    return Right(data as T)
  }

  const validateOrThrow = (data: unknown, configPath: string): T => {
    const result = validate(data, configPath)
    if (result.isLeft()) {
      throw result.extract()
    }
    return result.unsafeCoerce()
  }

  return { validate, validateOrThrow }
}
