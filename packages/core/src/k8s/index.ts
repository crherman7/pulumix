/**
 * Kubernetes cluster inspection module
 *
 * Thin wrapper around @kubernetes/client-node for read-only cluster queries.
 */

export { createK8sClients } from './client'
export type { K8sClients } from './client'

export {
  listNamespaceServices,
  getDeploymentEnvVars,
  resolveConfigMapValue,
  resolveSecretValue,
  resolveDeploymentEnv,
} from './inspect'

export type {
  ClusterServiceInfo,
  ClusterServicePort,
  DeploymentEnvVar,
} from './inspect'
