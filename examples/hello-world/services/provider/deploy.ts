/**
 * Provider Service
 *
 * Sets up the Kubernetes cluster based on stack configuration.
 * - local: Creates k3d cluster with registry
 * - production: Assumes cluster exists
 */

import { execSync } from 'child_process'
import type { ServiceContext, ServiceResult } from '@pulumix/core'

export default async (ctx: ServiceContext): Promise<ServiceResult> => {
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

    try {
      // Check if cluster exists
      execSync(`k3d cluster list | grep -w ${clusterName}`, { stdio: 'ignore' })
      console.log(`k3d cluster '${clusterName}' already exists`)
    } catch {
      // Create cluster with registry
      console.log(`Creating k3d cluster: ${clusterName}`)
      execSync(
        `k3d cluster create ${clusterName} ` +
        `--registry-create ${clusterName}-registry:0.0.0.0:${registryPort} ` +
        `--port "${port}:80@loadbalancer" ` +
        `--agents 2 --wait`,
        { stdio: 'inherit' }
      )
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
