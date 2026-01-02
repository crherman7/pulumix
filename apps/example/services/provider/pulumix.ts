/**
 * Provider Service
 *
 * Provides cluster information as outputs.
 * Cluster creation is handled by hooks (scripts/ensure-cluster.sh).
 */

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
  // Simply return configured values - cluster setup is done via hooks
  return {
    outputs: {
      clusterName: (ctx.config.clusterName as string) || 'default',
      registry: (ctx.config.registry as string) || null,
      kubeconfig: ctx.config.kubeconfig as string | undefined
    }
  }
}
