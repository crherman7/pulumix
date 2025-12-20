/**
 * Error types for Pulumix using discriminated unions for type-safe error handling
 */

/**
 * Base error interface shared by all error types
 */
export interface BaseError {
  readonly message: string
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
  readonly type: 'PulumiFailed' | 'ResourceFailed' | 'ValidationFailed' | 'DependencyCycle'
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
  return {
    _tag: 'DiscoveryError',
    type,
    message,
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
  return {
    _tag: 'ConfigError',
    type,
    message,
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
  return {
    _tag: 'BuildError',
    type,
    message,
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
  return {
    _tag: 'DeploymentError',
    type,
    message,
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
  return {
    _tag: 'ProviderError',
    type,
    message,
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
