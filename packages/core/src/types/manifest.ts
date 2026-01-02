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

// ============================================================================
// Build Configuration Types
// ============================================================================

/**
 * Docker build configuration.
 *
 * Configures how the service's Docker image is built, including context path
 * and Dockerfile location. Useful for monorepos where the build context needs
 * to include files from the repository root (e.g., pnpm-lock.yaml).
 *
 * @example
 * Build with monorepo root as context:
 * ```yaml
 * build:
 *   context: root
 *   dockerfile: services/api/Dockerfile
 * ```
 *
 * @example
 * Build with custom relative context:
 * ```yaml
 * build:
 *   context: ../..
 *   dockerfile: Dockerfile
 * ```
 *
 * @example
 * Default behavior (service directory as context):
 * ```yaml
 * build:
 *   context: .
 * ```
 */
export interface BuildConfig {
  /**
   * Build context path.
   *
   * - `"root"` - Use the project root as build context (for monorepos)
   * - `"."` - Use the service directory (default)
   * - Relative path (e.g., `"../.."`) - Relative to service directory
   */
  context?: 'root' | '.' | string

  /**
   * Path to Dockerfile relative to the build context.
   *
   * When using `context: root`, this should be the path from root to the Dockerfile.
   * Defaults to `"Dockerfile"` in the service directory.
   *
   * @example "services/api/Dockerfile" (when context is root)
   * @example "Dockerfile" (when context is service directory)
   */
  dockerfile?: string
}

// ============================================================================
// Backend Configuration Types
// ============================================================================

/**
 * Local file-based backend configuration.
 *
 * Stores Pulumi state on the local filesystem. Best for local development
 * and single-developer workflows.
 *
 * @example
 * ```yaml
 * backend:
 *   type: file
 *   path: dist/   # relative to project root
 * ```
 */
export interface FileBackendConfig {
  type: 'file'
  /** Path relative to project root (default: 'dist/') */
  path?: string
}

/**
 * AWS S3 backend configuration.
 *
 * Stores Pulumi state in an S3 bucket. Requires AWS credentials
 * via environment variables or IAM role.
 *
 * @example
 * ```yaml
 * backend:
 *   type: s3
 *   bucket: my-pulumi-state
 *   region: us-east-1
 *   prefix: myproject/
 * ```
 */
export interface S3BackendConfig {
  type: 's3'
  /** S3 bucket name */
  bucket: string
  /** AWS region (optional, uses AWS_REGION if not specified) */
  region?: string
  /** Path prefix within the bucket */
  prefix?: string
}

/**
 * Google Cloud Storage backend configuration.
 *
 * Stores Pulumi state in a GCS bucket. Requires GCP credentials
 * via GOOGLE_CREDENTIALS or application default credentials.
 *
 * @example
 * ```yaml
 * backend:
 *   type: gcs
 *   bucket: my-pulumi-state
 *   prefix: myproject/
 * ```
 */
export interface GCSBackendConfig {
  type: 'gcs'
  /** GCS bucket name */
  bucket: string
  /** Path prefix within the bucket */
  prefix?: string
}

/**
 * Azure Blob Storage backend configuration.
 *
 * Stores Pulumi state in an Azure Blob container. Requires Azure credentials
 * via environment variables or managed identity.
 *
 * @example
 * ```yaml
 * backend:
 *   type: azblob
 *   container: pulumi-state
 *   prefix: myproject/
 * ```
 */
export interface AzBlobBackendConfig {
  type: 'azblob'
  /** Azure Blob container name */
  container: string
  /** Path prefix within the container */
  prefix?: string
}

/**
 * Pulumi Cloud backend configuration.
 *
 * Uses Pulumi's managed service for state storage. Requires PULUMI_ACCESS_TOKEN.
 *
 * @example
 * ```yaml
 * backend:
 *   type: pulumi
 *   org: myorg  # optional, uses default org if not specified
 * ```
 */
export interface PulumiCloudBackendConfig {
  type: 'pulumi'
  /** Pulumi organization name (optional) */
  org?: string
}

/**
 * Union type for all backend configurations.
 */
export type BackendConfig =
  | FileBackendConfig
  | S3BackendConfig
  | GCSBackendConfig
  | AzBlobBackendConfig
  | PulumiCloudBackendConfig

/**
 * Stack-specific configuration with optional backend override.
 */
export interface StackConfig {
  /** Kubernetes namespace for this stack */
  namespace?: string
  /** Backend configuration (overrides project-level default) */
  backend?: BackendConfig
  /** Additional stack-specific settings */
  [key: string]: unknown
}

// ============================================================================
// Hooks Configuration Types
// ============================================================================

/**
 * Hook stage - when the hook runs in the deployment lifecycle.
 *
 * @example
 * ```yaml
 * hooks:
 *   local:
 *     - stage: pre-build
 *       run: "./scripts/ensure-cluster.sh"
 * ```
 */
export type HookStage = 'pre-build' | 'post-build' | 'pre-deploy' | 'post-deploy'

/**
 * Individual hook definition.
 *
 * Defines a script to run at a specific stage in the deployment lifecycle.
 *
 * @example
 * ```yaml
 * - stage: pre-build
 *   run: "./scripts/ensure-cluster.sh"
 *   env:
 *     CLUSTER_NAME: my-cluster
 *   timeout: 300000
 *   continueOnFailure: false
 * ```
 */
export interface HookDefinition {
  /** When to run this hook */
  stage: HookStage
  /** Command or script to run */
  run: string
  /** Environment variables to pass to the script */
  env?: Record<string, string>
  /** Working directory relative to project root */
  cwd?: string
  /** Timeout in milliseconds (default: 300000 = 5 minutes) */
  timeout?: number
  /** Continue deployment if hook fails (default: false) */
  continueOnFailure?: boolean
  /** Description shown in UI */
  description?: string
}

/**
 * Hooks configuration per stack.
 *
 * Maps stack names to arrays of hook definitions.
 *
 * @example
 * ```yaml
 * hooks:
 *   local:
 *     - stage: pre-build
 *       run: "./scripts/ensure-cluster.sh"
 *   production:
 *     - stage: pre-deploy
 *       run: "./scripts/check-creds.sh"
 * ```
 */
export type HooksConfig = Record<string, HookDefinition[]>

/**
 * Root project configuration (pulumix.yaml at project root).
 *
 * Defines project-wide settings including default backend, stack configurations,
 * and lifecycle hooks.
 *
 * @example
 * ```yaml
 * name: my-project
 *
 * backend:
 *   type: file
 *   path: dist/
 *
 * services:
 *   allowed:
 *     - "@platform/*"
 *
 * stacks:
 *   local:
 *     namespace: my-project-dev
 *   production:
 *     namespace: my-project-prod
 *
 * hooks:
 *   local:
 *     - stage: pre-build
 *       run: "./scripts/ensure-cluster.sh"
 *       env:
 *         CLUSTER_NAME: my-cluster
 *   production:
 *     - stage: pre-deploy
 *       run: "./scripts/check-creds.sh"
 * ```
 */
export interface ProjectConfig {
  /** Project name */
  name?: string
  /** Default backend configuration (can be overridden per stack) */
  backend?: BackendConfig
  /** Allowlist for published services */
  services?: {
    allowed?: string[]
  }
  /** Stack-specific configurations */
  stacks?: Record<string, StackConfig>
  /** Lifecycle hooks per stack */
  hooks?: HooksConfig
}

// ============================================================================
// Service Manifest Types
// ============================================================================

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

  /** Docker build configuration */
  build?: BuildConfig

  /** Observability configuration */
  observability?: ObservabilityConfig

  /** Security configuration */
  security?: SecurityConfig

  /** Stack-specific configuration */
  stacks: Record<string, Record<string, unknown>>
}
