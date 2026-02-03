import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'
import { type ServiceContext, getStandardLabels } from '@pulumix/core'

import type { ProbeConfig, WorkerServiceArgs, WorkerServiceOutputs } from './types'

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

export class WorkerService
  extends pulumi.ComponentResource
  implements WorkerServiceOutputs
{
  public readonly deploymentName: pulumi.Output<string>
  public readonly namespace: pulumi.Output<string>

  constructor(
    ctx: ServiceContext,
    args: WorkerServiceArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    const name = ctx.serviceName
    super('pulumix:k8s:WorkerService', name, {}, opts)

    const image = args.image ?? ctx.image
    if (!image) {
      throw new Error(
        `[${name}] No container image provided. Set 'image' in args or ensure ctx.image is available.`
      )
    }

    const ns = args.namespace ?? ctx.stackName
    const port = args.port ?? 3000
    const replicas = args.replicas ?? 1
    const terminationGracePeriod = args.terminationGracePeriodSeconds ?? 60
    const labels = getStandardLabels(ctx, { component: 'worker' })

    const env = args.env
      ? Object.entries(args.env).map(([k, v]) => ({ name: k, value: v }))
      : undefined

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
              terminationGracePeriodSeconds: terminationGracePeriod,
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
                  livenessProbe: args.enableLivenessProbe
                    ? resolveProbe(ctx, args.livenessProbe, port)
                    : undefined
                }
              ]
            }
          }
        }
      },
      { parent: this }
    )

    // HPA (opt-in for workers)
    if (args.autoscaling) {
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
            minReplicas: args.autoscaling.minReplicas ?? 1,
            maxReplicas: args.autoscaling.maxReplicas ?? 10,
            metrics: [
              {
                type: 'Resource',
                resource: {
                  name: 'cpu',
                  target: {
                    type: 'Utilization',
                    averageUtilization:
                      args.autoscaling.targetCPUUtilizationPercentage ?? 70
                  }
                }
              }
            ]
          }
        },
        { parent: this }
      )
    }

    this.deploymentName = deployment.metadata.name
    this.namespace = deployment.metadata.namespace

    this.registerOutputs({
      deploymentName: this.deploymentName,
      namespace: this.namespace
    })
  }
}
