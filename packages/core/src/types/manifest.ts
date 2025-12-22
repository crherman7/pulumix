/**
 * Service Manifest Types
 *
 * Standard manifest schema for Pulumix federated services.
 * Provides metadata, observability, security, and deployment configuration.
 */

/**
 * Service metadata for governance and discovery
 */
export interface ServiceMetadata {
  /** Service name (must match directory name) */
  name: string

  /** Service version (semver) */
  version: string

  /** Brief service description */
  description?: string

  /** Owning team name */
  team?: string

  /** Service owner email */
  owner?: string

  /** Source code repository URL */
  repository?: string

  /** Documentation URL */
  documentation?: string

  /** Custom tags for categorization */
  tags?: Record<string, string>

  /** Service level agreement */
  sla?: ServiceSLA

  /** Support contact information */
  support?: SupportInfo

  /** Output contract versioning */
  contract?: ContractInfo
}

/**
 * Service level agreement definition
 */
export interface ServiceSLA {
  /** Target availability (e.g., '99.9%') */
  availability?: string

  /** Target response time (e.g., '200ms') */
  responseTime?: string

  /** Maximum error rate (e.g., '0.1%') */
  errorRate?: string
}

/**
 * Support contact information
 */
export interface SupportInfo {
  /** Support email */
  email?: string

  /** Slack channel (e.g., '#platform-support') */
  slack?: string

  /** PagerDuty service name */
  pagerduty?: string

  /** On-call rotation URL */
  oncall?: string
}

/**
 * Contract versioning information
 */
export interface ContractInfo {
  /** Contract version (semver) */
  version: string

  /** Breaking changes in this version */
  breaking?: string[]

  /** Deprecated output fields */
  deprecated?: DeprecatedField[]
}

/**
 * Information about a deprecated field
 */
export interface DeprecatedField {
  /** Field name */
  field: string

  /** Version when deprecated */
  since: string

  /** Version when it will be removed */
  removeIn?: string

  /** Replacement field or instruction */
  replacement?: string
}

/**
 * Observability configuration
 */
export interface ObservabilityConfig {
  /** Health check configuration */
  health?: HealthConfig

  /** Metrics configuration */
  metrics?: MetricsConfig

  /** Logging configuration */
  logs?: LogsConfig
}

/**
 * Health check configuration
 */
export interface HealthConfig {
  /** Health endpoint path */
  endpoint?: string

  /** Health endpoint port */
  port?: number

  /** URL scheme */
  scheme?: 'http' | 'https'
}

/**
 * Metrics configuration
 */
export interface MetricsConfig {
  /** Metrics endpoint path */
  endpoint?: string

  /** Metrics endpoint port */
  port?: number

  /** Metrics format */
  format?: 'prometheus' | 'opentelemetry'
}

/**
 * Logging configuration
 */
export interface LogsConfig {
  /** Log output format */
  format?: 'json' | 'text'

  /** Log level */
  level?: 'debug' | 'info' | 'warn' | 'error'
}

/**
 * Security policies
 */
export interface SecurityConfig {
  /** Network policy configuration */
  networkPolicy?: NetworkPolicyConfig

  /** RBAC configuration */
  rbac?: RBACConfig

  /** Secrets management configuration */
  secrets?: SecretsConfig
}

/**
 * Network policy configuration
 */
export interface NetworkPolicyConfig {
  /** Enable network policies */
  enabled?: boolean

  /** Ingress rules */
  ingress?: NetworkPolicyRule[]

  /** Egress rules */
  egress?: NetworkPolicyRule[]
}

/**
 * Network policy rule
 */
export interface NetworkPolicyRule {
  /** Source/destination selectors */
  from?: any[]

  /** Allowed ports */
  ports?: number[]
}

/**
 * RBAC configuration
 */
export interface RBACConfig {
  /** Service account name */
  serviceAccount?: string

  /** Required roles */
  roles?: string[]
}

/**
 * Secrets management configuration
 */
export interface SecretsConfig {
  /** Secrets provider */
  provider?: 'kubernetes' | 'vault' | 'aws-secrets-manager' | 'azure-keyvault'

  /** Secrets path */
  path?: string
}

/**
 * Complete service manifest
 */
export interface ServiceManifest {
  /** Service metadata */
  metadata: ServiceMetadata

  /** Observability configuration */
  observability?: ObservabilityConfig

  /** Security configuration */
  security?: SecurityConfig

  /** Stack-specific configuration */
  stacks: Record<string, Record<string, unknown>>
}
