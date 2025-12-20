/**
 * Hello World Service
 *
 * Deploys a simple HTTP service with Ingress.
 * Uses Pulumi Kubernetes SDK directly.
 */

import * as k8s from '@pulumi/kubernetes'
import type { ServiceContext, ServiceResult } from '@pulumix/core'

export default async (ctx: ServiceContext): Promise<ServiceResult> => {
  const name = ctx.serviceName
  const namespace = ctx.namespace
  const labels = { 'app.kubernetes.io/name': name }

  // Get stack-scoped config from deploy.yaml
  const port = (ctx.config.port as number) || 3000
  const replicas = (ctx.config.replicas as number) || 1
  const env = (ctx.config.env as Record<string, string>) || {}

  // Default ingress settings for k3d
  const baseDomain = '127.0.0.1.sslip.io'
  const ingressClassName = 'traefik'

  // Create namespace
  const ns = new k8s.core.v1.Namespace(namespace, {
    metadata: { name: namespace, labels }
  })

  // Get image from context (built by orchestrator) or use default
  const image = ctx.image || `${name}:latest`

  // Create Deployment
  const deployment = new k8s.apps.v1.Deployment(name, {
    metadata: { name, namespace, labels },
    spec: {
      replicas,
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          containers: [{
            name,
            image,
            imagePullPolicy: 'Always',
            ports: [{ containerPort: port }],
            env: Object.entries(env).map(([k, v]) => ({ name: k, value: String(v) })),
            livenessProbe: {
              httpGet: { path: '/health', port },
              initialDelaySeconds: 10
            },
            readinessProbe: {
              httpGet: { path: '/health', port },
              initialDelaySeconds: 5
            }
          }]
        }
      }
    }
  }, { dependsOn: [ns] })

  // Create Service
  const service = new k8s.core.v1.Service(name, {
    metadata: { name, namespace, labels },
    spec: {
      selector: labels,
      ports: [{ port: 80, targetPort: port }]
    }
  }, { dependsOn: [ns] })

  // Create Ingress
  const hostname = `${name}.${baseDomain}`
  const ingress = new k8s.networking.v1.Ingress(`${name}-ingress`, {
    metadata: { name: `${name}-ingress`, namespace, labels },
    spec: {
      ingressClassName,
      rules: [{
        host: hostname,
        http: {
          paths: [{
            path: '/',
            pathType: 'Prefix',
            backend: { service: { name, port: { number: 80 } } }
          }]
        }
      }]
    }
  }, { dependsOn: [service] })

  return {
    outputs: {
      namespace,
      hostname,
      url: `http://${hostname}/`
    },
    resources: [ns, deployment, service, ingress]
  }
}
