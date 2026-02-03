import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'
import { type ServiceContext, getStandardLabels } from '@pulumix/core'

import type { ProbeConfig, PrivateServiceArgs, PrivateServiceOutputs } from './types'

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

export class PrivateService
  extends pulumi.ComponentResource
  implements PrivateServiceOutputs
{
  public readonly internalDnsName: pulumi.Output<string>
  public readonly servicePort: pulumi.Output<number>
  public readonly namespace: pulumi.Output<string>
  public readonly deploymentName: pulumi.Output<string>
  public readonly serviceAccountName: pulumi.Output<string>

  constructor(
    ctx: ServiceContext,
    args: PrivateServiceArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    const name = ctx.serviceName
    super('pulumix:k8s:PrivateService', name, {}, opts)

    const image = args.image ?? ctx.image
    if (!image) {
      throw new Error(
        `[${name}] No container image provided. Set 'image' in args or ensure ctx.image is available.`
      )
    }

    const ns = args.namespace ?? ctx.stackName
    const port = args.port ?? 3000
    const replicas = args.replicas ?? 1
    const labels = getStandardLabels(ctx, { component: 'service' })

    const env = args.env
      ? Object.entries(args.env).map(([k, v]) => ({ name: k, value: v }))
      : undefined

    // ServiceAccount (auto-created unless opted out)
    let saName: pulumi.Output<string>
    if (args.createServiceAccount !== false && !args.serviceAccountName) {
      const sa = new k8s.core.v1.ServiceAccount(
        name,
        {
          metadata: {
            namespace: ns,
            labels
          }
        },
        { parent: this }
      )
      saName = sa.metadata.name
    } else {
      saName = pulumi.output(args.serviceAccountName ?? 'default')
    }

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
              serviceAccountName: saName,
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

    // NetworkPolicy (deny-all ingress by default, with allowFrom rules)
    const ingressRules = args.allowFrom?.map((peer) => ({
      from: [
        {
          namespaceSelector: peer.namespaceSelector
            ? { matchLabels: peer.namespaceSelector }
            : undefined,
          podSelector: peer.podSelector
            ? { matchLabels: peer.podSelector }
            : undefined
        }
      ],
      ports: [{ port, protocol: 'TCP' }]
    }))

    new k8s.networking.v1.NetworkPolicy(
      name,
      {
        metadata: {
          namespace: ns,
          labels
        },
        spec: {
          podSelector: { matchLabels: labels },
          policyTypes: ['Ingress'],
          ingress: ingressRules ?? []
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

    // HPA (opt-in)
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

    this.internalDnsName = pulumi.interpolate`${svc.metadata.name}.${svc.metadata.namespace}.svc.cluster.local`
    this.servicePort = pulumi.output(port)
    this.namespace = deployment.metadata.namespace
    this.deploymentName = deployment.metadata.name
    this.serviceAccountName = saName

    this.registerOutputs({
      internalDnsName: this.internalDnsName,
      servicePort: this.servicePort,
      namespace: this.namespace,
      deploymentName: this.deploymentName,
      serviceAccountName: this.serviceAccountName
    })
  }
}
