/**
 * Runtime validation for project configuration using JSON Schema.
 *
 * Validates root pulumix.yaml files against the JSON schema and provides
 * helpful error messages with specific remediation steps.
 *
 * Uses the createValidator factory for consistent validation patterns.
 */

import { createValidator } from './create-validator'
import type { DeployError } from '../types/errors'
import type { Either } from 'purify-ts/Either'
import type { ProjectConfig } from '../types/manifest'

// Create validator using the factory pattern
const validator = createValidator<ProjectConfig>(
  'project-config.schema.json',
  'Project configuration'
)

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
export const validateProjectConfig: (
  config: unknown,
  configPath: string
) => Either<DeployError, ProjectConfig> = validator.validate

/**
 * Validate project config and throw on error.
 *
 * @param config - Project config to validate
 * @param configPath - Path to config file
 * @throws {DeployError} If validation fails
 */
export const validateProjectConfigOrThrow: (
  config: unknown,
  configPath: string
) => ProjectConfig = validator.validateOrThrow
