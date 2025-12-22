/**
 * Provider Service
 *
 * Sets up the Kubernetes cluster based on stack configuration.
 * - local: Creates k3d cluster with registry
 * - production: Assumes cluster exists
 */

import { spawnSync } from 'child_process'
import { ServiceContext, ServiceResult } from '@pulumix/core'

/**
 * Outputs provided by the provider service
 */
export interface ProviderOutputs {
  /** Name of the Kubernetes cluster */
  clusterName: string
  /** Registry URL for pushing images */
  registry: string | null
  /** Kubeconfig context name */
  kubeconfig?: string
}

export default async (ctx: ServiceContext): Promise<ServiceResult<ProviderOutputs>> => {
  const k3d = ctx.config.k3d as {
    enabled?: boolean
    clusterName?: string
    port?: number
    registryPort?: number
  } | undefined

  // If k3d is enabled, ensure cluster exists
  if (k3d?.enabled) {
    const clusterName = k3d.clusterName || 'pulumix-dev'
    const port = k3d.port || 80
    const registryPort = k3d.registryPort || 5001

    // Check if cluster exists
    const listResult = spawnSync('k3d', ['cluster', 'list'], { encoding: 'utf-8' })
    const clusterExists = listResult.stdout?.includes(clusterName)

    if (clusterExists) {
      console.log(`k3d cluster '${clusterName}' already exists`)
    } else {
      // Create cluster with registry
      console.log(`Creating k3d cluster: ${clusterName}`)
      const createResult = spawnSync('k3d', [
        'cluster', 'create', clusterName,
        '--registry-create', `${clusterName}-registry:0.0.0.0:${registryPort}`,
        '--port', `${port}:80@loadbalancer`,
        '--agents', '2',
        '--wait'
      ], { stdio: 'inherit' })

      if (createResult.error) {
        throw new Error(`Failed to create k3d cluster: ${createResult.error.message}`)
      }
      if (createResult.status !== 0) {
        throw new Error(`k3d cluster create exited with code ${createResult.status}`)
      }
    }

    return {
      outputs: {
        clusterName,
        registry: `localhost:${registryPort}`,
        kubeconfig: `k3d-${clusterName}`
      }
    }
  }

  // Non-k3d: assume cluster exists
  return {
    outputs: {
      clusterName: (ctx.config.clusterName as string) || 'default',
      registry: (ctx.config.registry as string) || null
    }
  }
}
