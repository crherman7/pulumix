/**
 * Kubernetes client factory
 *
 * Loads kubeconfig, sets context, and returns typed API clients.
 */

import * as k8s from '@kubernetes/client-node'

export interface K8sClients {
  readonly coreV1: k8s.CoreV1Api
  readonly appsV1: k8s.AppsV1Api
  readonly kubeConfig: k8s.KubeConfig
}

/**
 * Create Kubernetes API clients from kubeconfig
 */
export function createK8sClients(kubeContext?: string): K8sClients {
  const kc = new k8s.KubeConfig()
  kc.loadFromDefault()

  if (kubeContext) {
    kc.setCurrentContext(kubeContext)
  }

  const coreV1 = kc.makeApiClient(k8s.CoreV1Api)
  const appsV1 = kc.makeApiClient(k8s.AppsV1Api)

  return { coreV1, appsV1, kubeConfig: kc }
}
