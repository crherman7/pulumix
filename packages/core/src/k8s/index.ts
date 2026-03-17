/**
 * Kubernetes cluster inspection and management module
 *
 * Thin wrapper around @kubernetes/client-node for cluster queries and pod lifecycle.
 */

export { createK8sClients } from './client'
export type { K8sClients } from './client'

export {
  listNamespaceServices,
  getDeploymentEnvVars,
  resolveConfigMapValue,
  resolveSecretValue,
  resolveDeploymentEnv,
  findDeploymentByLabels,
  scaleDeployment,
  createPod,
  deletePod,
  waitForPodRunning,
} from './inspect'

export type {
  ClusterServiceInfo,
  ClusterServicePort,
  DeploymentEnvVar,
  DeploymentInfo,
} from './inspect'
