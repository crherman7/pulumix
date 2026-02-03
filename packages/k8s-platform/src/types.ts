import * as pulumi from '@pulumi/pulumi'

// ============================================================================
// Shared Configuration Types
// ============================================================================

export interface ContainerConfig {
  /** Container image (defaults to ctx.image) */
  image?: string
  /** Container port (default: 3000) */
  port?: number
  /** Environment variables */
  env?: Record<string, pulumi.Input<string>>
  /** Resource requests and limits */
  resources?: ResourceRequirements
  /** Override the container command */
  command?: string[]
  /** Override the container args */
  args?: string[]
}

export interface ResourceRequirements {
  requests?: {
    cpu?: string
    memory?: string
  }
  limits?: {
    cpu?: string
    memory?: string
  }
}

export interface PodConfig {
  /** Number of replicas (default varies by primitive) */
  replicas?: number
  /** Kubernetes node selector */
  nodeSelector?: Record<string, string>
  /** Kubernetes tolerations */
  tolerations?: Toleration[]
  /** ServiceAccount name (overrides auto-created one if applicable) */
  serviceAccountName?: string
  /** Additional pod annotations */
  podAnnotations?: Record<string, string>
  /** Termination grace period in seconds (default varies by primitive) */
  terminationGracePeriodSeconds?: number
}

export interface Toleration {
  key?: string
  operator?: 'Exists' | 'Equal'
  value?: string
  effect?: 'NoSchedule' | 'PreferNoSchedule' | 'NoExecute'
  tolerationSeconds?: number
}

export interface ProbeConfig {
  /** Health check path (default: /health or ctx.observability.health.endpoint) */
  path?: string
  /** Health check port (defaults to container port) */
  port?: number
  /** Seconds before first probe (default: 5) */
  initialDelaySeconds?: number
  /** Seconds between probes (default: 10) */
  periodSeconds?: number
  /** Consecutive failures before unhealthy (default: 3) */
  failureThreshold?: number
}

export interface AutoscalingConfig {
  /** Minimum replicas (default: 2 for PublicApi, 1 for others) */
  minReplicas?: number
  /** Maximum replicas (default: 10) */
  maxReplicas?: number
  /** CPU target percentage (default: 70) */
  targetCPUUtilizationPercentage?: number
}

// ============================================================================
// PublicApi Types
// ============================================================================

export interface PublicApiArgs extends ContainerConfig, PodConfig {
  /** Hostname for the Ingress route (required) */
  domain: string
  /** Namespace (defaults to ctx.stackName) */
  namespace?: string
  /** Ingress path prefix (default: /) */
  pathPrefix?: string
  /** Ingress class name (e.g., 'traefik', 'nginx'). If omitted, uses cluster default. */
  ingressClassName?: string
  /** cert-manager ClusterIssuer name. If omitted, TLS is not configured on the Ingress. */
  tlsIssuer?: string
  /** Additional annotations on the Ingress (e.g., proxy timeouts for WebSockets) */
  ingressAnnotations?: Record<string, string>
  /** Readiness probe configuration */
  readinessProbe?: ProbeConfig
  /** Liveness probe configuration */
  livenessProbe?: ProbeConfig
  /** Horizontal pod autoscaler configuration */
  autoscaling?: AutoscalingConfig
}

export interface PublicApiOutputs {
  /** Public URL for the service */
  url: pulumi.Output<string>
  /** Kubernetes Service name */
  serviceName: pulumi.Output<string>
  /** Kubernetes namespace */
  namespace: pulumi.Output<string>
  /** Kubernetes Deployment name */
  deploymentName: pulumi.Output<string>
}

// ============================================================================
// PrivateService Types
// ============================================================================

export interface NetworkPolicyPeer {
  /** Namespace selector labels */
  namespaceSelector?: Record<string, string>
  /** Pod selector labels */
  podSelector?: Record<string, string>
}

export interface PrivateServiceArgs extends ContainerConfig, PodConfig {
  /** Namespace (defaults to ctx.stackName) */
  namespace?: string
  /** Allow ingress from specific sources */
  allowFrom?: NetworkPolicyPeer[]
  /** Create a ServiceAccount (default: true) */
  createServiceAccount?: boolean
  /** Readiness probe configuration */
  readinessProbe?: ProbeConfig
  /** Liveness probe configuration */
  livenessProbe?: ProbeConfig
  /** Horizontal pod autoscaler configuration (opt-in) */
  autoscaling?: AutoscalingConfig
}

export interface PrivateServiceOutputs {
  /** Internal DNS name (svc.cluster.local) */
  internalDnsName: pulumi.Output<string>
  /** Service port */
  servicePort: pulumi.Output<number>
  /** Kubernetes namespace */
  namespace: pulumi.Output<string>
  /** Kubernetes Deployment name */
  deploymentName: pulumi.Output<string>
  /** ServiceAccount name */
  serviceAccountName: pulumi.Output<string>
}

// ============================================================================
// WorkerService Types
// ============================================================================

export interface WorkerServiceArgs extends ContainerConfig, PodConfig {
  /** Namespace (defaults to ctx.stackName) */
  namespace?: string
  /** Enable liveness probe (default: false for workers) */
  enableLivenessProbe?: boolean
  /** Liveness probe configuration (only used if enableLivenessProbe is true) */
  livenessProbe?: ProbeConfig
  /** Horizontal pod autoscaler configuration (opt-in) */
  autoscaling?: AutoscalingConfig
}

export interface WorkerServiceOutputs {
  /** Kubernetes Deployment name */
  deploymentName: pulumi.Output<string>
  /** Kubernetes namespace */
  namespace: pulumi.Output<string>
}

// ============================================================================
// CronJob Types
// ============================================================================

export interface CronJobArgs extends ContainerConfig {
  /** Cron schedule expression (required) */
  schedule: string
  /** Namespace (defaults to ctx.stackName) */
  namespace?: string
  /** Concurrency policy (default: Forbid) */
  concurrencyPolicy?: 'Allow' | 'Forbid' | 'Replace'
  /** Number of successful finished jobs to retain (default: 3) */
  successfulJobsHistoryLimit?: number
  /** Number of failed finished jobs to retain (default: 1) */
  failedJobsHistoryLimit?: number
  /** Deadline in seconds for starting the job (optional) */
  startingDeadlineSeconds?: number
  /** Backoff limit for failed pods (default: 3) */
  backoffLimit?: number
  /** Restart policy (default: Never) */
  restartPolicy?: 'Never' | 'OnFailure'
  /** Active deadline in seconds for the job (optional) */
  activeDeadlineSeconds?: number
  /** Kubernetes node selector */
  nodeSelector?: Record<string, string>
  /** Kubernetes tolerations */
  tolerations?: Toleration[]
  /** ServiceAccount name */
  serviceAccountName?: string
  /** Additional pod annotations */
  podAnnotations?: Record<string, string>
}

export interface CronJobOutputs {
  /** Kubernetes CronJob name */
  cronJobName: pulumi.Output<string>
  /** Kubernetes namespace */
  namespace: pulumi.Output<string>
  /** Cron schedule */
  schedule: pulumi.Output<string>
}
