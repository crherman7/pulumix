/**
 * Kubernetes client factory
 *
 * Loads kubeconfig, sets context, and returns typed API clients.
 *
 * Uses dynamic import() because @kubernetes/client-node is ESM-only
 * and this package compiles to CommonJS.
 */

import type * as k8sTypes from '@kubernetes/client-node'

export interface K8sClients {
  readonly coreV1: k8sTypes.CoreV1Api
  readonly appsV1: k8sTypes.AppsV1Api
  readonly kubeConfig: k8sTypes.KubeConfig
}

/**
 * Create Kubernetes API clients from kubeconfig
 */
export async function createK8sClients(kubeContext?: string): Promise<K8sClients> {
  // @kubernetes/client-node v1.x is ESM-only. TypeScript "module":"commonjs"
  // rewrites import() to require(), which cannot load ESM. The Function
  // constructor preserves the native import() in the compiled output.
  const k8s = await (new Function(
    'return import("@kubernetes/client-node")'
  )() as Promise<typeof import('@kubernetes/client-node')>)

  const kc = new k8s.KubeConfig()
  kc.loadFromDefault()

  if (kubeContext) {
    kc.setCurrentContext(kubeContext)
  }

  const coreV1 = kc.makeApiClient(k8s.CoreV1Api)
  const appsV1 = kc.makeApiClient(k8s.AppsV1Api)

  return { coreV1, appsV1, kubeConfig: kc }
}
