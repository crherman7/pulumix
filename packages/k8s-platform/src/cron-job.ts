import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'
import { type ServiceContext, getStandardLabels } from '@pulumix/core'

import type { CronJobArgs, CronJobOutputs } from './types'

export class CronJob extends pulumi.ComponentResource implements CronJobOutputs {
  public readonly cronJobName: pulumi.Output<string>
  public readonly namespace: pulumi.Output<string>
  public readonly schedule: pulumi.Output<string>

  constructor(
    ctx: ServiceContext,
    args: CronJobArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    const name = ctx.serviceName
    super('pulumix:k8s:CronJob', name, {}, opts)

    const image = args.image ?? ctx.image
    if (!image) {
      throw new Error(
        `[${name}] No container image provided. Set 'image' in args or ensure ctx.image is available.`
      )
    }

    const ns = args.namespace ?? ctx.stackName
    const port = args.port ?? 3000
    const labels = getStandardLabels(ctx, { component: 'cronjob' })

    const env = args.env
      ? Object.entries(args.env).map(([k, v]) => ({ name: k, value: v }))
      : undefined

    const cronJob = new k8s.batch.v1.CronJob(
      name,
      {
        metadata: {
          namespace: ns,
          labels
        },
        spec: {
          schedule: args.schedule,
          concurrencyPolicy: args.concurrencyPolicy ?? 'Forbid',
          successfulJobsHistoryLimit: args.successfulJobsHistoryLimit ?? 3,
          failedJobsHistoryLimit: args.failedJobsHistoryLimit ?? 1,
          startingDeadlineSeconds: args.startingDeadlineSeconds,
          jobTemplate: {
            metadata: { labels },
            spec: {
              backoffLimit: args.backoffLimit ?? 3,
              activeDeadlineSeconds: args.activeDeadlineSeconds,
              template: {
                metadata: {
                  labels,
                  annotations: args.podAnnotations
                },
                spec: {
                  serviceAccountName: args.serviceAccountName,
                  nodeSelector: args.nodeSelector,
                  tolerations: args.tolerations?.map((t) => ({
                    key: t.key,
                    operator: t.operator,
                    value: t.value,
                    effect: t.effect,
                    tolerationSeconds: t.tolerationSeconds
                  })),
                  restartPolicy: args.restartPolicy ?? 'Never',
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
                        : undefined
                    }
                  ]
                }
              }
            }
          }
        }
      },
      { parent: this }
    )

    this.cronJobName = cronJob.metadata.name
    this.namespace = cronJob.metadata.namespace
    this.schedule = pulumi.output(args.schedule)

    this.registerOutputs({
      cronJobName: this.cronJobName,
      namespace: this.namespace,
      schedule: this.schedule
    })
  }
}
