/**
 * Hello World Service
 *
 * Deploys a simple HTTP service with Ingress.
 * Uses Pulumi Kubernetes SDK directly.
 */

import * as k8s from '@pulumi/kubernetes'
import { ServiceContext, ServiceResult, getStandardLabels } from '@pulumix/core'
import type { ProviderOutputs } from '../provider/pulumix'
import type { IngressOutputs } from '../ingress/pulumix'

/**
 * Dependencies required by hello-world service
 */
interface HelloWorldDependencies {
  provider: ProviderOutputs
  ingress: IngressOutputs
}

/**
 * Outputs provided by hello-world service
 */
export interface HelloWorldOutputs {
  /** Namespace where service is deployed */
  namespace: string
  /** Hostname for accessing the service */
  hostname: string
  /** Full URL for accessing the service */
  url: string
}

export default async (ctx: ServiceContext<HelloWorldDependencies>): Promise<ServiceResult<HelloWorldOutputs>> => {
  const name = ctx.serviceName
  const namespace = (ctx.globalConfig.namespace as string) || ctx.stackName

  // Access typed dependencies (with intellisense!)
  // const providerRegistry = ctx.dependencies.provider.registry
  // const ingressNamespace = ctx.dependencies.ingress.namespace

  // Get observability config from manifest
  const port = ctx.observability?.health?.port || 3000
  const healthEndpoint = ctx.observability?.health?.endpoint || '/health'

  // Get stack-scoped config from deploy.yaml
  const replicas = (ctx.config.replicas as number) || 1
  const env = (ctx.config.env as Record<string, string>) || {}
  const baseDomain = (ctx.config.baseDomain as string) || '127.0.0.1.sslip.io'
  const ingressClassName = (ctx.config.ingressClassName as string) || 'traefik'
  const imagePullPolicy = (ctx.config.imagePullPolicy as string) || 'Always'

  // Generate standard Kubernetes labels (uses metadata.version)
  const labels = getStandardLabels(ctx, {
    version: ctx.metadata.version,
    component: 'api'
  })

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
            imagePullPolicy,
            ports: [{ containerPort: port }],
            env: Object.entries(env).map(([k, v]) => ({ name: k, value: String(v) })),
            livenessProbe: {
              httpGet: { path: healthEndpoint, port },
              initialDelaySeconds: 10,
              periodSeconds: 10
            },
            readinessProbe: {
              httpGet: { path: healthEndpoint, port },
              initialDelaySeconds: 5,
              periodSeconds: 5
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
