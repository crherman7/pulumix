import * as k8s from '@pulumi/kubernetes'
import { ServiceContext, ServiceResult, getStandardLabels } from '@pulumix/core'
import { PublicApi } from '@pulumix/k8s-platform'

export interface HelloWorldOutputs {
  namespace: string
  url: string
}

export default async (ctx: ServiceContext): Promise<ServiceResult<HelloWorldOutputs>> => {
  const namespace = (ctx.globalConfig.namespace as string) || ctx.stackName
  const baseDomain = (ctx.config.baseDomain as string) || '127.0.0.1.sslip.io'
  const hostname = `${ctx.serviceName}.${baseDomain}`
  const kubeContext = ctx.globalConfig.kubeContext as string | undefined

  const provider = new k8s.Provider('k8s', {
    context: kubeContext
  })

  const ns = new k8s.core.v1.Namespace(namespace, {
    metadata: {
      name: namespace,
      labels: getStandardLabels(ctx)
    }
  }, { provider })

  const tlsIssuer = (ctx.config.tlsIssuer as string) || undefined
  const scheme = tlsIssuer ? 'https' : 'http'

  new PublicApi(ctx, {
    domain: hostname,
    namespace,
    replicas: (ctx.config.replicas as number) || 2,
    ingressClassName: (ctx.config.ingressClassName as string) || undefined,
    tlsIssuer,
    env: (ctx.config.env as Record<string, string>) || {}
  }, { provider, dependsOn: [ns] })

  return {
    outputs: {
      namespace,
      url: `${scheme}://${hostname}/`
    }
  }
}
