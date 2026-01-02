/**
 * Error types for Pulumix using discriminated unions for type-safe error handling
 */

/**
 * Error code registry for Pulumix errors.
 *
 * Error codes follow the format `PULUMIX_Exxxx` where the range indicates the category:
 * - E001-E099: Discovery errors (service detection, file finding)
 * - E100-E199: Configuration errors (YAML parsing, validation)
 * - E200-E299: Build errors (Docker, image building)
 * - E300-E399: Deployment errors (Pulumi, resource creation)
 * - E400-E499: Provider errors (provider initialization)
 *
 * @example
 * ```typescript
 * if (error.code === ERROR_CODES.DOCKER_BUILD_FAILED) {
 *   // Handle Docker build failure
 * }
 * ```
 */
export const ERROR_CODES = {
  // Discovery Errors (E001-E099)
  ROOT_CONFIG_NOT_FOUND: 'PULUMIX_E001',
  INVALID_YAML: 'PULUMIX_E002',
  PACKAGE_JSON_NOT_FOUND: 'PULUMIX_E003',
  INVALID_GLOB_PATTERN: 'PULUMIX_E004',

  // Configuration Errors (E100-E199)
  STACK_NOT_FOUND: 'PULUMIX_E100',
  INVALID_STACK_CONFIG: 'PULUMIX_E101',
  MISSING_REQUIRED_FIELD: 'PULUMIX_E102',
  INVALID_CONFIG_FORMAT: 'PULUMIX_E103',

  // Build Errors (E200-E299)
  DOCKER_BUILD_FAILED: 'PULUMIX_E200',
  DOCKER_PUSH_FAILED: 'PULUMIX_E201',
  IMAGE_NOT_FOUND: 'PULUMIX_E202',
  DOCKER_DAEMON_NOT_RUNNING: 'PULUMIX_E203',

  // Deployment Errors (E300-E399)
  PULUMI_FAILED: 'PULUMIX_E300',
  RESOURCE_FAILED: 'PULUMIX_E301',
  VALIDATION_FAILED: 'PULUMIX_E302',
  DEPENDENCY_CYCLE: 'PULUMIX_E303',
  PASSPHRASE_REQUIRED: 'PULUMIX_E304',
  HOOK_FAILED: 'PULUMIX_E305',

  // Provider Errors (E400-E499)
  PROVIDER_INIT_FAILED: 'PULUMIX_E400',
  INVALID_PROVIDER_CONFIG: 'PULUMIX_E401',
  SERVICE_CREATION_FAILED: 'PULUMIX_E402',
  UNSUPPORTED_SERVICE_TYPE: 'PULUMIX_E403',
} as const

/**
 * Remediation steps for an error.
 *
 * Provides actionable steps to resolve the error condition.
 *
 * @example
 * ```typescript
 * const remediation: ErrorRemediation = {
 *   summary: 'Docker daemon is not running',
 *   steps: [
 *     'Start Docker Desktop',
 *     'Verify with: docker ps'
 *   ],
 *   docs: 'https://docs.docker.com/get-started/'
 * }
 * ```
 */
export interface ErrorRemediation {
  /** Short description of what went wrong */
  readonly summary: string
  /** Step-by-step remediation instructions */
  readonly steps: readonly string[]
  /** Link to documentation (optional) */
  readonly docs?: string
}

/**
 * Base error interface shared by all error types
 */
export interface BaseError {
  readonly message: string
  readonly code: string
  readonly remediation?: ErrorRemediation
  readonly context?: Record<string, unknown>
  readonly cause?: Error
}

/**
 * Discovery errors - issues during service discovery phase
 */
export interface DiscoveryError extends BaseError {
  readonly _tag: 'DiscoveryError'
  readonly type: 'RootConfigNotFound' | 'InvalidYaml' | 'PackageJsonNotFound' | 'InvalidGlobPattern'
  readonly path?: string
}

/**
 * Configuration errors - issues with configuration loading/validation
 */
export interface ConfigError extends BaseError {
  readonly _tag: 'ConfigError'
  readonly type: 'StackNotFound' | 'InvalidStackConfig' | 'MissingRequiredField' | 'InvalidConfigFormat'
  readonly stackName?: string
  readonly field?: string
}

/**
 * Build errors - issues during Docker image building
 */
export interface BuildError extends BaseError {
  readonly _tag: 'BuildError'
  readonly type: 'DockerBuildFailed' | 'DockerPushFailed' | 'ImageNotFound' | 'DockerDaemonNotRunning'
  readonly service: string
  readonly exitCode?: number
}

/**
 * Deployment errors - issues during Pulumi deployment
 */
export interface DeploymentError extends BaseError {
  readonly _tag: 'DeploymentError'
  readonly type: 'PulumiFailed' | 'ResourceFailed' | 'ValidationFailed' | 'DependencyCycle' | 'HookFailed'
  readonly resourceUrn?: string
}

/**
 * Provider errors - issues with provider initialization or operations
 */
export interface ProviderError extends BaseError {
  readonly _tag: 'ProviderError'
  readonly type: 'InitializationFailed' | 'InvalidProviderConfig' | 'ServiceCreationFailed' | 'UnsupportedServiceType'
  readonly providerName: string
}

/**
 * Union of all possible deployment errors
 */
export type DeployError =
  | DiscoveryError
  | ConfigError
  | BuildError
  | DeploymentError
  | ProviderError

/**
 * Helper function to create a DiscoveryError
 */
export function createDiscoveryError(
  type: DiscoveryError['type'],
  message: string,
  path?: string,
  context?: Record<string, unknown>,
  cause?: Error
): DiscoveryError {
  const codeMap: Record<DiscoveryError['type'], string> = {
    'RootConfigNotFound': ERROR_CODES.ROOT_CONFIG_NOT_FOUND,
    'InvalidYaml': ERROR_CODES.INVALID_YAML,
    'PackageJsonNotFound': ERROR_CODES.PACKAGE_JSON_NOT_FOUND,
    'InvalidGlobPattern': ERROR_CODES.INVALID_GLOB_PATTERN,
  }

  return {
    _tag: 'DiscoveryError',
    type,
    code: codeMap[type],
    message,
    remediation: getErrorRemediation(type),
    path,
    context,
    cause
  }
}

/**
 * Helper function to create a ConfigError
 */
export function createConfigError(
  type: ConfigError['type'],
  message: string,
  stackName?: string,
  field?: string,
  context?: Record<string, unknown>,
  cause?: Error
): ConfigError {
  const codeMap: Record<ConfigError['type'], string> = {
    'StackNotFound': ERROR_CODES.STACK_NOT_FOUND,
    'InvalidStackConfig': ERROR_CODES.INVALID_STACK_CONFIG,
    'MissingRequiredField': ERROR_CODES.MISSING_REQUIRED_FIELD,
    'InvalidConfigFormat': ERROR_CODES.INVALID_CONFIG_FORMAT,
  }

  return {
    _tag: 'ConfigError',
    type,
    code: codeMap[type],
    message,
    remediation: getErrorRemediation(type),
    stackName,
    field,
    context,
    cause
  }
}

/**
 * Helper function to create a BuildError
 */
export function createBuildError(
  type: BuildError['type'],
  message: string,
  service: string,
  exitCode?: number,
  context?: Record<string, unknown>,
  cause?: Error
): BuildError {
  const codeMap: Record<BuildError['type'], string> = {
    'DockerBuildFailed': ERROR_CODES.DOCKER_BUILD_FAILED,
    'DockerPushFailed': ERROR_CODES.DOCKER_PUSH_FAILED,
    'ImageNotFound': ERROR_CODES.IMAGE_NOT_FOUND,
    'DockerDaemonNotRunning': ERROR_CODES.DOCKER_DAEMON_NOT_RUNNING,
  }

  return {
    _tag: 'BuildError',
    type,
    code: codeMap[type],
    message,
    remediation: getErrorRemediation(type),
    service,
    exitCode,
    context,
    cause
  }
}

/**
 * Helper function to create a DeploymentError
 */
export function createDeploymentError(
  type: DeploymentError['type'],
  message: string,
  resourceUrn?: string,
  context?: Record<string, unknown>,
  cause?: Error
): DeploymentError {
  const codeMap: Record<DeploymentError['type'], string> = {
    'PulumiFailed': ERROR_CODES.PULUMI_FAILED,
    'ResourceFailed': ERROR_CODES.RESOURCE_FAILED,
    'ValidationFailed': ERROR_CODES.VALIDATION_FAILED,
    'DependencyCycle': ERROR_CODES.DEPENDENCY_CYCLE,
    'HookFailed': ERROR_CODES.HOOK_FAILED,
  }

  return {
    _tag: 'DeploymentError',
    type,
    code: codeMap[type],
    message,
    remediation: getErrorRemediation(type),
    resourceUrn,
    context,
    cause
  }
}

/**
 * Helper function to create a ProviderError
 */
export function createProviderError(
  type: ProviderError['type'],
  message: string,
  providerName: string,
  context?: Record<string, unknown>,
  cause?: Error
): ProviderError {
  const codeMap: Record<ProviderError['type'], string> = {
    'InitializationFailed': ERROR_CODES.PROVIDER_INIT_FAILED,
    'InvalidProviderConfig': ERROR_CODES.INVALID_PROVIDER_CONFIG,
    'ServiceCreationFailed': ERROR_CODES.SERVICE_CREATION_FAILED,
    'UnsupportedServiceType': ERROR_CODES.UNSUPPORTED_SERVICE_TYPE,
  }

  return {
    _tag: 'ProviderError',
    type,
    code: codeMap[type],
    message,
    remediation: getErrorRemediation(type),
    providerName,
    context,
    cause
  }
}

/**
 * Type guard to check if an error is a DiscoveryError
 */
export function isDiscoveryError(error: DeployError): error is DiscoveryError {
  return error._tag === 'DiscoveryError'
}

/**
 * Type guard to check if an error is a ConfigError
 */
export function isConfigError(error: DeployError): error is ConfigError {
  return error._tag === 'ConfigError'
}

/**
 * Type guard to check if an error is a BuildError
 */
export function isBuildError(error: DeployError): error is BuildError {
  return error._tag === 'BuildError'
}

/**
 * Type guard to check if an error is a DeploymentError
 */
export function isDeploymentError(error: DeployError): error is DeploymentError {
  return error._tag === 'DeploymentError'
}

/**
 * Type guard to check if an error is a ProviderError
 */
export function isProviderError(error: DeployError): error is ProviderError {
  return error._tag === 'ProviderError'
}

/**
 * Get remediation steps for a specific error type.
 *
 * Returns helpful remediation information including a summary, step-by-step
 * instructions, and optional documentation links.
 *
 * @param errorType - The specific error type to get remediation for
 * @returns Remediation information if available, undefined otherwise
 *
 * @example
 * ```typescript
 * const remediation = getErrorRemediation('InvalidYaml')
 * if (remediation) {
 *   console.log(remediation.summary)
 *   remediation.steps.forEach(step => console.log(`- ${step}`))
 * }
 * ```
 */
export function getErrorRemediation(errorType: string): ErrorRemediation | undefined {
  const remediations: Record<string, ErrorRemediation> = {
    'RootConfigNotFound': {
      summary: 'pulumix.yaml not found in project root',
      steps: [
        'Create a pulumix.yaml file in your project root',
        'Add required fields: metadata.name and stacks',
        'Example: metadata:\\n  name: my-project\\nstacks:\\n  local: {}'
      ],
    },
    'InvalidYaml': {
      summary: 'YAML syntax error in configuration file',
      steps: [
        'Check YAML syntax (indentation, colons, quotes)',
        'Use a YAML validator like yamllint.com',
        'Ensure no tabs are used (use spaces only)',
        'Check for missing colons after keys'
      ],
    },
    'PackageJsonNotFound': {
      summary: 'package.json not found in service directory',
      steps: [
        'Create a package.json file in the service directory',
        'Run: npm init -y',
        'Add service dependencies to package.json'
      ],
    },
    'DockerBuildFailed': {
      summary: 'Docker image build failed',
      steps: [
        'Check Dockerfile syntax',
        'Ensure Docker daemon is running: docker ps',
        'Verify all dependencies are available',
        'Check build logs for specific errors',
        'Try building manually: docker build .'
      ],
    },
    'DockerPushFailed': {
      summary: 'Docker image push failed',
      steps: [
        'Verify you are authenticated to the registry',
        'Check registry URL is correct',
        'Ensure you have push permissions',
        'Try: docker login <registry>'
      ],
    },
    'DockerDaemonNotRunning': {
      summary: 'Docker daemon is not running',
      steps: [
        'Start Docker Desktop or Docker daemon',
        'Verify with: docker ps',
        'On Linux: sudo systemctl start docker',
        'Check Docker is installed correctly'
      ],
    },
    'ValidationFailed': {
      summary: 'Configuration validation failed',
      steps: [
        'Check the error context for specific validation errors',
        'Verify all required fields are present',
        'Ensure field values match expected types',
        'Run: pulumix validate for detailed errors'
      ],
    },
    'DependencyCycle': {
      summary: 'Circular dependency detected between services',
      steps: [
        'Review package.json dependencies between services',
        'Remove circular references',
        'Visualize dependencies: pulumix graph',
        'Ensure dependencies form a directed acyclic graph (DAG)'
      ],
    },
    'MissingRequiredField': {
      summary: 'Required configuration field is missing',
      steps: [
        'Check the error message for the specific missing field',
        'Add the required field to your configuration',
        'Refer to schema documentation for field requirements'
      ],
    },
    'PulumiFailed': {
      summary: 'Pulumi operation failed',
      steps: [
        'Check Pulumi error output for details',
        'Verify your Pulumi credentials are configured',
        'Ensure stack exists: pulumi stack ls',
        'Check resource configurations for errors'
      ],
    },
    'HookFailed': {
      summary: 'Lifecycle hook script failed',
      steps: [
        'Check the hook script output for errors',
        'Verify the script exists and is executable',
        'Ensure all required environment variables are set',
        'Try running the script manually to debug'
      ],
    },
    'StackNotFound': {
      summary: 'Specified stack not found in configuration',
      steps: [
        'Check available stacks in pulumix.yaml',
        'Verify stack name spelling',
        'Add stack configuration if missing',
        'Run: pulumix list to see available services'
      ],
    },
  }

  return remediations[errorType]
}

/**
 * Format error with code, message, and remediation steps.
 *
 * Transforms an error into a human-readable format with error codes,
 * helpful remediation steps, and context information.
 *
 * @param error - The error to format
 * @returns Formatted error string ready for display
 *
 * @example
 * ```typescript
 * const error = createDiscoveryError('InvalidYaml', 'Failed to parse YAML', 'pulumix.yaml')
 * console.error(formatError(error))
 * // Output:
 * // [PULUMIX_E002] Failed to parse YAML
 * //
 * // YAML syntax error in configuration file
 * //
 * // How to fix:
 * //   1. Check YAML syntax (indentation, colons, quotes)
 * //   2. Use a YAML validator like yamllint.com
 * //   ...
 * ```
 */
export function formatError(error: DeployError): string {
  const parts: string[] = []

  // Error code and message
  parts.push(`[${error.code}] ${error.message}`)

  // Remediation steps
  if (error.remediation) {
    parts.push('')
    parts.push(error.remediation.summary)
    parts.push('')
    parts.push('How to fix:')
    error.remediation.steps.forEach((step, i) => {
      parts.push(`  ${i + 1}. ${step}`)
    })

    if (error.remediation.docs) {
      parts.push('')
      parts.push(`Documentation: ${error.remediation.docs}`)
    }
  }

  // Context (if available and has keys)
  if (error.context && Object.keys(error.context).length > 0) {
    parts.push('')
    parts.push('Context:')
    parts.push(JSON.stringify(error.context, null, 2))
  }

  return parts.join('\n')
}
