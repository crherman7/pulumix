/**
 * Ingress Service
 *
 * Installs ingress controller based on stack configuration.
 * - local: Skip (k3d includes traefik)
 * - production: Install traefik via Helm
 */

import * as k8s from '@pulumi/kubernetes'
import { ServiceContext, ServiceResult } from '@pulumix/core'

/**
 * Outputs provided by the ingress service
 */
export interface IngressOutputs {
  /** Whether ingress was installed */
  installed?: boolean
  /** Whether ingress installation was skipped */
  skipped?: boolean
  /** Type of ingress controller (traefik, nginx) */
  type?: string
  /** Namespace where ingress is installed */
  namespace?: string
  /** Reason for skipping (if skipped) */
  reason?: string
}

export default async (ctx: ServiceContext): Promise<ServiceResult<IngressOutputs>> => {
  const install = ctx.config.install as boolean
  const type = (ctx.config.type as string) || 'traefik'
  const replicas = (ctx.config.replicas as number) || 1
  const namespace = (ctx.config.namespace as string) || (type === 'traefik' ? 'traefik-system' : 'ingress-nginx')
  const helmRepo = (ctx.config.helmRepo as string) || (type === 'traefik' ? 'https://traefik.github.io/charts' : 'https://kubernetes.github.io/ingress-nginx')
  const helmChart = (ctx.config.helmChart as string) || (type === 'traefik' ? 'traefik' : 'ingress-nginx')
  const dashboardEnabled = (ctx.config.dashboardEnabled as boolean) ?? false

  // Skip if not installing (k3d has traefik built-in)
  if (!install) {
    console.log('Skipping ingress installation (using built-in)')
    return {
      outputs: {
        skipped: true,
        reason: 'Using built-in ingress controller'
      }
    }
  }

  if (type === 'traefik') {
    // Install Traefik via Helm
    const traefik = new k8s.helm.v3.Chart('traefik', {
      chart: helmChart,
      fetchOpts: {
        repo: helmRepo
      },
      namespace,
      values: {
        deployment: {
          replicas
        },
        ingressRoute: {
          dashboard: {
            enabled: dashboardEnabled
          }
        }
      }
    })

    return {
      outputs: {
        installed: true,
        type: 'traefik',
        namespace
      },
      resources: [traefik]
    }
  }

  if (type === 'nginx') {
    // Install nginx-ingress via Helm
    const nginx = new k8s.helm.v3.Chart('nginx-ingress', {
      chart: helmChart,
      fetchOpts: {
        repo: helmRepo
      },
      namespace,
      values: {
        controller: {
          replicaCount: replicas
        }
      }
    })

    return {
      outputs: {
        installed: true,
        type: 'nginx',
        namespace
      },
      resources: [nginx]
    }
  }

  return {
    outputs: {
      skipped: true,
      reason: `Unknown ingress type: ${type}`
    }
  }
}
