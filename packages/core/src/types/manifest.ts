/**
 * Service Manifest Types
 *
 * Minimal manifest schema for Pulumix services.
 */

/**
 * Service metadata.
 *
 * @example
 * ```yaml
 * metadata:
 *   name: my-service
 *   version: 1.0.0
 * ```
 */
export interface ServiceMetadata {
  /** Service name (must match directory name) */
  name: string

  /** Service version (semver) */
  version: string
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
 *
 * Stack config is passed to services via `ctx.globalConfig`. Services
 * can access any values defined here (e.g., `ctx.globalConfig.namespace`).
 */
export interface StackConfig {
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
 * The top-level structure of a pulumix.yaml file.
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
 * With build configuration:
 * ```yaml
 * metadata:
 *   name: my-service
 *   version: 1.0.0
 *
 * build:
 *   context: root
 *   dockerfile: services/my-service/Dockerfile
 *
 * stacks:
 *   local:
 *     replicas: 1
 *   production:
 *     replicas: 5
 * ```
 */
export interface ServiceManifest {
  /** Service metadata */
  metadata: ServiceMetadata

  /** Docker build configuration */
  build?: BuildConfig

  /** Stack-specific configuration */
  stacks: Record<string, Record<string, unknown>>
}
