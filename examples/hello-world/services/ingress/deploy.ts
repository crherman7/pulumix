/**
 * Ingress Service
 *
 * Installs ingress controller based on stack configuration.
 * - local: Skip (k3d includes traefik)
 * - production: Install traefik via Helm
 */

import * as k8s from '@pulumi/kubernetes'
import type { ServiceContext, ServiceResult } from '@pulumix/core'

export default async (ctx: ServiceContext): Promise<ServiceResult> => {
  const install = ctx.config.install as boolean
  const type = (ctx.config.type as string) || 'traefik'
  const replicas = (ctx.config.replicas as number) || 1

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
      chart: 'traefik',
      fetchOpts: {
        repo: 'https://traefik.github.io/charts'
      },
      namespace: 'traefik-system',
      values: {
        deployment: {
          replicas
        },
        ingressRoute: {
          dashboard: {
            enabled: false
          }
        }
      }
    })

    return {
      outputs: {
        installed: true,
        type: 'traefik',
        namespace: 'traefik-system'
      },
      resources: [traefik]
    }
  }

  if (type === 'nginx') {
    // Install nginx-ingress via Helm
    const nginx = new k8s.helm.v3.Chart('nginx-ingress', {
      chart: 'ingress-nginx',
      fetchOpts: {
        repo: 'https://kubernetes.github.io/ingress-nginx'
      },
      namespace: 'ingress-nginx',
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
        namespace: 'ingress-nginx'
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
