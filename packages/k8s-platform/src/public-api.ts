import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'
import { type ServiceContext, getStandardLabels } from '@pulumix/core'

import { createRoute } from './routing'
import type { ProbeConfig, PublicApiArgs, PublicApiOutputs } from './types'

function resolveProbe(
  ctx: ServiceContext,
  override: ProbeConfig | undefined,
  containerPort: number
): k8s.types.input.core.v1.Probe {
  const healthEndpoint = ctx.observability?.health?.endpoint ?? '/health'
  const healthPort = ctx.observability?.health?.port ?? containerPort

  return {
    httpGet: {
      path: override?.path ?? healthEndpoint,
      port: override?.port ?? healthPort
    },
    initialDelaySeconds: override?.initialDelaySeconds ?? 5,
    periodSeconds: override?.periodSeconds ?? 10,
    failureThreshold: override?.failureThreshold ?? 3
  }
}

export class PublicApi
  extends pulumi.ComponentResource
  implements PublicApiOutputs
{
  public readonly url: pulumi.Output<string>
  public readonly serviceName: pulumi.Output<string>
  public readonly namespace: pulumi.Output<string>
  public readonly deploymentName: pulumi.Output<string>

  constructor(
    ctx: ServiceContext,
    args: PublicApiArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    const name = ctx.serviceName
    super('pulumix:k8s:PublicApi', name, {}, opts)

    const image = args.image ?? ctx.image
    if (!image) {
      throw new Error(
        `[${name}] No container image provided. Set 'image' in args or ensure ctx.image is available.`
      )
    }

    const ns = args.namespace ?? ctx.stackName
    const port = args.port ?? 3000
    const replicas = args.replicas ?? 2
    const pathPrefix = args.pathPrefix ?? '/'
    const labels = getStandardLabels(ctx, { component: 'api' })

    const env = args.env
      ? Object.entries(args.env).map(([k, v]) => ({ name: k, value: v }))
      : undefined

    // Deployment
    const deployment = new k8s.apps.v1.Deployment(
      name,
      {
        metadata: {
          namespace: ns,
          labels
        },
        spec: {
          replicas,
          selector: { matchLabels: labels },
          strategy: {
            type: 'RollingUpdate',
            rollingUpdate: {
              maxUnavailable: 0,
              maxSurge: 1
            }
          },
          template: {
            metadata: {
              labels,
              annotations: args.podAnnotations
            },
            spec: {
              serviceAccountName: args.serviceAccountName,
              terminationGracePeriodSeconds:
                args.terminationGracePeriodSeconds ?? 30,
              nodeSelector: args.nodeSelector,
              tolerations: args.tolerations?.map((t) => ({
                key: t.key,
                operator: t.operator,
                value: t.value,
                effect: t.effect,
                tolerationSeconds: t.tolerationSeconds
              })),
              containers: [
                {
                  name,
                  image,
                  ports: [{ containerPort: port }],
                  command: args.command,
                  args: args.args,
                  env,
                  resources: args.resources
                    ? {
                        requests: args.resources.requests,
                        limits: args.resources.limits
                      }
                    : undefined,
                  readinessProbe: resolveProbe(ctx, args.readinessProbe, port),
                  livenessProbe: resolveProbe(ctx, args.livenessProbe, port)
                }
              ]
            }
          }
        }
      },
      { parent: this }
    )

    // Service (ClusterIP)
    const svc = new k8s.core.v1.Service(
      name,
      {
        metadata: {
          namespace: ns,
          labels
        },
        spec: {
          type: 'ClusterIP',
          selector: labels,
          ports: [
            {
              port,
              targetPort: port,
              protocol: 'TCP'
            }
          ]
        }
      },
      { parent: this }
    )

    // Ingress (via internal route abstraction)
    createRoute(name, {
      namespace: ns,
      domain: args.domain,
      serviceName: svc.metadata.name,
      servicePort: port,
      pathPrefix,
      ingressClassName: args.ingressClassName,
      tlsIssuer: args.tlsIssuer,
      annotations: args.ingressAnnotations,
      labels,
      parent: this
    })

    // HPA (always created for PublicApi)
    const minReplicas = args.autoscaling?.minReplicas ?? 2
    const maxReplicas = args.autoscaling?.maxReplicas ?? 10
    const targetCPU = args.autoscaling?.targetCPUUtilizationPercentage ?? 70

    new k8s.autoscaling.v2.HorizontalPodAutoscaler(
      name,
      {
        metadata: {
          namespace: ns,
          labels
        },
        spec: {
          scaleTargetRef: {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            name: deployment.metadata.name
          },
          minReplicas,
          maxReplicas,
          metrics: [
            {
              type: 'Resource',
              resource: {
                name: 'cpu',
                target: {
                  type: 'Utilization',
                  averageUtilization: targetCPU
                }
              }
            }
          ]
        }
      },
      { parent: this }
    )

    // PodDisruptionBudget
    new k8s.policy.v1.PodDisruptionBudget(
      name,
      {
        metadata: {
          namespace: ns,
          labels
        },
        spec: {
          minAvailable: 1,
          selector: { matchLabels: labels }
        }
      },
      { parent: this }
    )

    const scheme = args.tlsIssuer ? 'https' : 'http'
    this.url = pulumi.output(`${scheme}://${args.domain}${pathPrefix}`)
    this.serviceName = svc.metadata.name
    this.namespace = deployment.metadata.namespace
    this.deploymentName = deployment.metadata.name

    this.registerOutputs({
      url: this.url,
      serviceName: this.serviceName,
      namespace: this.namespace,
      deploymentName: this.deploymentName
    })
  }
}
