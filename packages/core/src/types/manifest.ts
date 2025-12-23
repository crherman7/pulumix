/**
 * Service Manifest Types
 *
 * Standard manifest schema for Pulumix federated services.
 * Provides metadata, observability, security, and deployment configuration.
 */

/**
 * Service metadata for governance and discovery.
 *
 * Provides essential information about a service including ownership,
 * versioning, SLA commitments, and support contacts.
 *
 * @see {@link ServiceManifest} for the complete manifest structure
 * @see {@link ServiceSLA} for SLA definitions
 *
 * @example
 * Complete metadata configuration in pulumix.yaml:
 * ```yaml
 * metadata:
 *   name: user-service
 *   version: 2.1.3
 *   description: User authentication and profile management
 *   team: platform
 *   owner: platform@example.com
 *   repository: https://github.com/myorg/user-service
 *   documentation: https://docs.example.com/services/user-service
 *   tags:
 *     tier: backend
 *     criticality: high
 *     compliance: pci-dss
 *   sla:
 *     availability: 99.95%
 *     responseTime: 100ms
 *     errorRate: 0.1%
 *   support:
 *     slack: "#platform-support"
 *     pagerduty: user-service
 *     oncall: https://oncall.example.com/platform
 *   contract:
 *     version: 2.0.0
 *     breaking:
 *       - "Removed legacy /v1/auth endpoint"
 *     deprecated:
 *       - field: userId
 *         since: 2.0.0
 *         removeIn: 3.0.0
 *         replacement: id
 * ```
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
 * Service level agreement definition.
 *
 * Defines expected performance and reliability targets for a service.
 * Used for monitoring, alerting, and capacity planning.
 *
 * @example
 * SLA configuration in pulumix.yaml:
 * ```yaml
 * sla:
 *   availability: 99.9%   # Three nines uptime
 *   responseTime: 200ms   # P95 latency target
 *   errorRate: 0.5%       # Maximum error percentage
 * ```
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
 * Support contact information.
 *
 * Defines how to reach the team responsible for this service,
 * including emergency contacts and on-call rotations.
 *
 * @example
 * Support configuration in pulumix.yaml:
 * ```yaml
 * support:
 *   email: platform-team@example.com
 *   slack: "#platform-support"
 *   pagerduty: user-service
 *   oncall: https://oncall.example.com/platform
 * ```
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
 * Contract versioning information.
 *
 * Tracks the version of outputs/API this service exposes, along with
 * breaking changes and deprecations. Enables safe dependency upgrades.
 *
 * @see {@link DeprecatedField} for deprecation details
 *
 * @example
 * Contract versioning in pulumix.yaml:
 * ```yaml
 * contract:
 *   version: 2.1.0
 *   breaking:
 *     - "Removed 'legacyEndpoint' output"
 *     - "Changed 'port' from string to number"
 *   deprecated:
 *     - field: oldRegistryUrl
 *       since: 2.0.0
 *       removeIn: 3.0.0
 *       replacement: registryUrl
 * ```
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
 * Observability configuration.
 *
 * Defines health check, metrics, and logging configuration for the service.
 * Used to configure Kubernetes probes and monitoring integrations.
 *
 * @see {@link HealthConfig} for health check settings
 * @see {@link MetricsConfig} for metrics settings
 * @see {@link LogsConfig} for logging settings
 *
 * @example
 * Complete observability configuration in pulumix.yaml:
 * ```yaml
 * observability:
 *   health:
 *     endpoint: /health
 *     port: 8080
 *     scheme: http
 *   metrics:
 *     endpoint: /metrics
 *     port: 8080
 *     format: prometheus
 *   logs:
 *     format: json
 *     level: info
 * ```
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
 * Security policies.
 *
 * Defines network policies, RBAC, and secrets management configuration.
 * Translated into Kubernetes NetworkPolicy and RBAC resources.
 *
 * @see {@link NetworkPolicyConfig} for network policy settings
 * @see {@link RBACConfig} for role-based access control
 * @see {@link SecretsConfig} for secrets management
 *
 * @example
 * Security configuration in pulumix.yaml:
 * ```yaml
 * security:
 *   networkPolicy:
 *     enabled: true
 *     ingress:
 *       - from:
 *           - namespaceSelector:
 *               matchLabels:
 *                 app: frontend
 *         ports: [8080]
 *   rbac:
 *     serviceAccount: user-service-sa
 *     roles:
 *       - secrets-reader
 *       - configmap-reader
 *   secrets:
 *     provider: vault
 *     path: secret/data/user-service
 * ```
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
 * Complete service manifest.
 *
 * The top-level structure of a pulumix.yaml file. Combines metadata,
 * observability, security, and stack-specific configuration.
 *
 * @see {@link ServiceMetadata} for metadata structure
 * @see {@link ObservabilityConfig} for observability settings
 * @see {@link SecurityConfig} for security policies
 *
 * @example
 * Minimal pulumix.yaml:
 * ```yaml
 * metadata:
 *   name: my-service
 *   version: 1.0.0
 *
 * stacks:
 *   local:
 *     replicas: 1
 * ```
 *
 * @example
 * Complete pulumix.yaml with all sections:
 * ```yaml
 * metadata:
 *   name: my-service
 *   version: 1.0.0
 *   description: My awesome service
 *   team: platform
 *   owner: platform@example.com
 *
 * observability:
 *   health:
 *     endpoint: /health
 *     port: 8080
 *   metrics:
 *     endpoint: /metrics
 *     port: 8080
 *     format: prometheus
 *
 * security:
 *   networkPolicy:
 *     enabled: true
 *
 * stacks:
 *   local:
 *     replicas: 1
 *     imagePullPolicy: IfNotPresent
 *   production:
 *     replicas: 5
 *     imagePullPolicy: Always
 * ```
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
