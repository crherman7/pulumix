/**
 * Kubernetes cluster inspection
 *
 * Read-only queries for service discovery and deployment env extraction.
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
