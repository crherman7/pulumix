/**
 * Kubernetes cluster inspection and management
 *
 * Queries for service discovery, deployment env extraction, and pod lifecycle.
 */

import type { K8sClients } from './client'

/**
 * Service info discovered from the cluster
 */
export interface ClusterServiceInfo {
  readonly name: string
  readonly namespace: string
  readonly clusterIP: string
  readonly ports: readonly ClusterServicePort[]
  /** DNS forms: "name", "name.namespace", "name.namespace.svc.cluster.local" */
  readonly dnsNames: readonly string[]
}

export interface ClusterServicePort {
  readonly name?: string
  readonly port: number
  readonly targetPort: number | string
  readonly protocol: string
}

/**
 * Env var from a Deployment spec
 */
export interface DeploymentEnvVar {
  readonly name: string
  readonly value?: string
  readonly valueFrom?: {
    readonly configMapKeyRef?: { name: string; key: string }
    readonly secretKeyRef?: { name: string; key: string }
    readonly fieldRef?: { fieldPath: string }
    readonly resourceFieldRef?: { resource: string }
  }
}

/**
 * List all services in a namespace with their ports and DNS forms
 */
export async function listNamespaceServices(
  clients: K8sClients,
  namespace: string
): Promise<ClusterServiceInfo[]> {
  const response = await clients.coreV1.listNamespacedService({ namespace })
  const services: ClusterServiceInfo[] = []

  for (const svc of response.items) {
    const name = svc.metadata?.name
    if (!name) continue

    const clusterIP = svc.spec?.clusterIP ?? ''
    const ports: ClusterServicePort[] = (svc.spec?.ports ?? []).map(p => ({
      name: p.name,
      port: p.port,
      targetPort: (p.targetPort as number | string) ?? p.port,
      protocol: p.protocol ?? 'TCP',
    }))

    const dnsNames = [
      name,
      `${name}.${namespace}`,
      `${name}.${namespace}.svc`,
      `${name}.${namespace}.svc.cluster.local`,
    ]

    services.push({ name, namespace, clusterIP, ports, dnsNames })
  }

  return services
}

/**
 * Read env vars from a Deployment's first container spec.
 * Returns raw env var definitions (including ConfigMap/Secret refs).
 */
export async function getDeploymentEnvVars(
  clients: K8sClients,
  namespace: string,
  deploymentName: string
): Promise<DeploymentEnvVar[]> {
  const deployment = await clients.appsV1.readNamespacedDeployment({
    name: deploymentName,
    namespace,
  })

  const containers = deployment.spec?.template?.spec?.containers ?? []
  if (containers.length === 0) return []

  // Read from first container only
  const envVars = containers[0].env ?? []

  return envVars.map(e => ({
    name: e.name,
    value: e.value ?? undefined,
    valueFrom: e.valueFrom ? {
      configMapKeyRef: e.valueFrom.configMapKeyRef
        ? { name: e.valueFrom.configMapKeyRef.name ?? '', key: e.valueFrom.configMapKeyRef.key }
        : undefined,
      secretKeyRef: e.valueFrom.secretKeyRef
        ? { name: e.valueFrom.secretKeyRef.name ?? '', key: e.valueFrom.secretKeyRef.key }
        : undefined,
      fieldRef: e.valueFrom.fieldRef
        ? { fieldPath: e.valueFrom.fieldRef.fieldPath }
        : undefined,
      resourceFieldRef: e.valueFrom.resourceFieldRef
        ? { resource: e.valueFrom.resourceFieldRef.resource }
        : undefined,
    } : undefined,
  }))
}

/**
 * Resolve a ConfigMap key to its value.
 * Returns undefined if not accessible.
 */
export async function resolveConfigMapValue(
  clients: K8sClients,
  namespace: string,
  configMapName: string,
  key: string
): Promise<string | undefined> {
  try {
    const cm = await clients.coreV1.readNamespacedConfigMap({
      name: configMapName,
      namespace,
    })
    return cm.data?.[key]
  } catch {
    return undefined
  }
}

/**
 * Resolve a Secret key to its value.
 * Returns undefined if not accessible (e.g., 403 RBAC).
 */
export async function resolveSecretValue(
  clients: K8sClients,
  namespace: string,
  secretName: string,
  key: string
): Promise<string | undefined> {
  try {
    const secret = await clients.coreV1.readNamespacedSecret({
      name: secretName,
      namespace,
    })
    const raw = secret.data?.[key]
    if (!raw) return undefined
    return Buffer.from(raw, 'base64').toString('utf-8')
  } catch {
    return undefined
  }
}

/**
 * Resolve all env vars from a deployment, including ConfigMap/Secret refs.
 * fieldRef and resourceFieldRef are passed through unchanged (they reference pod metadata).
 */
export async function resolveDeploymentEnv(
  clients: K8sClients,
  namespace: string,
  deploymentName: string,
  onWarn?: (msg: string) => void
): Promise<Record<string, string>> {
  let envVars: DeploymentEnvVar[]
  try {
    envVars = await getDeploymentEnvVars(clients, namespace, deploymentName)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    onWarn?.(`Could not read deployment '${deploymentName}': ${message}`)
    return {}
  }

  const resolved: Record<string, string> = {}

  for (const envVar of envVars) {
    if (envVar.value !== undefined) {
      resolved[envVar.name] = envVar.value
      continue
    }

    if (!envVar.valueFrom) continue

    // fieldRef / resourceFieldRef — pass through, not service references
    if (envVar.valueFrom.fieldRef || envVar.valueFrom.resourceFieldRef) {
      continue
    }

    if (envVar.valueFrom.configMapKeyRef) {
      const { name, key } = envVar.valueFrom.configMapKeyRef
      const val = await resolveConfigMapValue(clients, namespace, name, key)
      if (val !== undefined) {
        resolved[envVar.name] = val
      } else {
        onWarn?.(`Could not resolve ConfigMap '${name}' key '${key}' for ${envVar.name}`)
      }
      continue
    }

    if (envVar.valueFrom.secretKeyRef) {
      const { name, key } = envVar.valueFrom.secretKeyRef
      const val = await resolveSecretValue(clients, namespace, name, key)
      if (val !== undefined) {
        resolved[envVar.name] = val
      } else {
        onWarn?.(`Could not resolve Secret '${name}' key '${key}' for ${envVar.name} (possible RBAC restriction)`)
      }
      continue
    }
  }

  return resolved
}

// ============================================================================
// Deployment & Pod Management
// ============================================================================

/**
 * Check if a K8s client error is a 404 NotFound.
 * @kubernetes/client-node v1.x formats errors with the status code
 * in multiple possible locations.
 */
function isNotFoundError(err: unknown): boolean {
  // Check body.code (v1.x structured error)
  const bodyCode = (err as { body?: { code?: number } })?.body?.code
  if (bodyCode === 404) return true

  // Check response.statusCode (older client format)
  const responseCode = (err as { response?: { statusCode?: number } })?.response?.statusCode
  if (responseCode === 404) return true

  // Check statusCode directly
  const statusCode = (err as { statusCode?: number })?.statusCode
  if (statusCode === 404) return true

  // Check error message for "HTTP-Code: 404" (v1.x toString format)
  if (err instanceof Error && err.message.includes('HTTP-Code: 404')) return true

  return false
}

/**
 * Info about a deployment found by labels
 */
export interface DeploymentInfo {
  readonly name: string
  readonly replicas: number
  readonly podLabels: Record<string, string>
  readonly containers: ReadonlyArray<{
    readonly name: string
    readonly image: string
    readonly env?: ReadonlyArray<{ name: string; value?: string; valueFrom?: unknown }>
    readonly ports?: ReadonlyArray<{ containerPort: number; protocol?: string }>
  }>
  readonly serviceAccount?: string
  readonly volumes?: ReadonlyArray<unknown>
}

/**
 * Find a deployment by standard Kubernetes labels
 */
export async function findDeploymentByLabels(
  clients: K8sClients,
  namespace: string,
  labels: Record<string, string>
): Promise<DeploymentInfo | null> {
  const labelSelector = Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(',')

  const response = await clients.appsV1.listNamespacedDeployment({
    namespace,
    labelSelector,
  })

  if (response.items.length === 0) return null

  const deployment = response.items[0]!
  const spec = deployment.spec
  const podSpec = spec?.template?.spec
  const containers = podSpec?.containers ?? []

  return {
    name: deployment.metadata?.name ?? '',
    replicas: spec?.replicas ?? 1,
    podLabels: (spec?.template?.metadata?.labels ?? {}) as Record<string, string>,
    containers: containers.map(c => ({
      name: c.name,
      image: c.image ?? '',
      env: c.env as DeploymentInfo['containers'][number]['env'],
      ports: c.ports?.map(p => ({
        containerPort: p.containerPort,
        protocol: p.protocol,
      })),
    })),
    serviceAccount: podSpec?.serviceAccountName,
    volumes: podSpec?.volumes as ReadonlyArray<unknown> | undefined,
  }
}

/**
 * Scale a deployment to a given replica count.
 * Uses the /scale subresource (PUT, not PATCH) to avoid content-type issues.
 * Returns the previous replica count for restoration.
 */
export async function scaleDeployment(
  clients: K8sClients,
  namespace: string,
  deploymentName: string,
  replicas: number
): Promise<number> {
  const scale = await clients.appsV1.readNamespacedDeploymentScale({
    name: deploymentName,
    namespace,
  })
  const previousReplicas = scale.spec?.replicas ?? 1

  scale.spec = { ...scale.spec, replicas }

  await clients.appsV1.replaceNamespacedDeploymentScale({
    name: deploymentName,
    namespace,
    body: scale,
  })

  return previousReplicas
}

/**
 * Create a pod in a namespace.
 * Returns the pod name.
 */
export async function createPod(
  clients: K8sClients,
  namespace: string,
  podSpec: Record<string, unknown>
): Promise<string> {
  const result = await clients.coreV1.createNamespacedPod({
    namespace,
    body: podSpec as never,
  })
  return result.metadata?.name ?? ''
}

/**
 * Delete a pod in a namespace and wait for it to be fully removed.
 * Silently ignores 404 (pod already gone).
 */
export async function deletePod(
  clients: K8sClients,
  namespace: string,
  podName: string
): Promise<void> {
  try {
    await clients.coreV1.deleteNamespacedPod({
      name: podName,
      namespace,
    })
  } catch (err: unknown) {
    // 404 — pod already gone, nothing to wait for
    if (isNotFoundError(err)) return
    throw err
  }

  // Wait for the pod to actually disappear (deletion is async in K8s)
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      await clients.coreV1.readNamespacedPod({ name: podName, namespace })
      // Still exists — wait and retry
      await new Promise(resolve => setTimeout(resolve, 1000))
    } catch (err: unknown) {
      if (isNotFoundError(err)) return // Gone
      throw err
    }
  }
}

/** Container waiting reasons that indicate a terminal failure */
const TERMINAL_WAITING_REASONS = new Set([
  'ImagePullBackOff',
  'ErrImagePull',
  'InvalidImageName',
  'CreateContainerConfigError',
  'CreateContainerError',
  'PreCreateHookError',
  'RunContainerError',
])

/**
 * Extract error details from container statuses.
 * Returns null if no terminal error is detected.
 */
function extractContainerErrors(
  containerStatuses: ReadonlyArray<{
    name: string
    state?: {
      waiting?: { reason?: string; message?: string }
      terminated?: { reason?: string; message?: string; exitCode?: number }
    }
  }>
): string[] | null {
  const errors: string[] = []

  for (const s of containerStatuses) {
    const waiting = s.state?.waiting
    const terminated = s.state?.terminated

    if (waiting && TERMINAL_WAITING_REASONS.has(waiting.reason ?? '')) {
      const msg = waiting.message ?? ''
      errors.push(`${s.name}: ${waiting.reason}${msg ? ` — ${msg}` : ''}`)
    }

    if (terminated) {
      const reason = terminated.reason ?? `exit code ${terminated.exitCode ?? 'unknown'}`
      const msg = terminated.message ?? ''
      errors.push(`${s.name}: ${reason}${msg ? ` — ${msg}` : ''}`)
    }
  }

  return errors.length > 0 ? errors : null
}

/**
 * Wait for a pod to reach Running phase.
 * Throws on Failed phase, terminal container errors, or timeout.
 */
export async function waitForPodRunning(
  clients: K8sClients,
  namespace: string,
  podName: string,
  timeoutMs: number = 120_000,
  onLog?: (message: string) => void
): Promise<void> {
  const start = Date.now()
  let lastStatus = ''

  while (Date.now() - start < timeoutMs) {
    const pod = await clients.coreV1.readNamespacedPod({
      name: podName,
      namespace,
    })

    const phase = pod.status?.phase ?? 'Unknown'
    const allStatuses = [
      ...(pod.status?.initContainerStatuses ?? []),
      ...(pod.status?.containerStatuses ?? []),
    ]

    // Log status changes so the user sees progress
    const currentStatus = describeStatus(phase, allStatuses)
    if (currentStatus !== lastStatus) {
      lastStatus = currentStatus
      onLog?.(`Pod status: ${currentStatus}`)
    }

    if (phase === 'Running') {
      return
    }

    // Check for terminal container errors (these happen while phase is still Pending)
    const containerErrors = extractContainerErrors(allStatuses)
    if (containerErrors) {
      const detail = `\n${containerErrors.join('\n')}`
      throw new Error(`Pod '${podName}' failed: ${phase}${detail}${mountHint(containerErrors)}`)
    }

    if (phase === 'Failed' || phase === 'Error' || phase === 'Succeeded') {
      throw new Error(`Pod '${podName}' ended with phase: ${phase}`)
    }

    // Check for scheduling failures in conditions
    const conditions = (pod.status as { conditions?: Array<{ type: string; status: string; reason?: string; message?: string }> })?.conditions ?? []
    const unschedulable = conditions.find(
      c => c.type === 'PodScheduled' && c.status === 'False' && c.reason === 'Unschedulable'
    )
    if (unschedulable) {
      throw new Error(
        `Pod '${podName}' cannot be scheduled: ${unschedulable.message ?? 'Unschedulable'}`
      )
    }

    // Wait 2 seconds before polling again
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  throw new Error(
    `Timed out waiting for pod '${podName}' to reach Running phase (${timeoutMs / 1000}s). Last status: ${lastStatus}`
  )
}

function describeStatus(
  phase: string,
  statuses: ReadonlyArray<{ name: string; state?: { waiting?: { reason?: string }; running?: unknown; terminated?: { reason?: string } } }>
): string {
  if (statuses.length === 0) return phase

  const containerDescs = statuses.map(s => {
    if (s.state?.running) return `${s.name}: running`
    if (s.state?.waiting?.reason) return `${s.name}: ${s.state.waiting.reason}`
    if (s.state?.terminated?.reason) return `${s.name}: ${s.state.terminated.reason}`
    return `${s.name}: waiting`
  })

  return `${phase} (${containerDescs.join(', ')})`
}

function mountHint(errors: string[]): string {
  const combined = errors.join(' ')
  if (combined.includes('MountVolume') || combined.includes('hostPath')) {
    return '\n\nHint: Ensure k3d cluster was created with the host volume mount:\n  k3d cluster create --volume /path/to/project:/src@all'
  }
  return ''
}
