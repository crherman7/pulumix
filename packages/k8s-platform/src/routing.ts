import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'

interface CreateRouteOptions {
  namespace: pulumi.Input<string>
  domain: string
  serviceName: pulumi.Input<string>
  servicePort: number
  pathPrefix: string
  ingressClassName?: string
  tlsIssuer?: string
  annotations?: Record<string, string>
  labels: Record<string, string>
  parent: pulumi.Resource
}

/**
 * Internal route abstraction.
 *
 * Today: creates a k8s.networking.v1.Ingress with optional cert-manager TLS.
 * Tomorrow: swap to Gateway API HTTPRoute — zero changes to primitives.
 */
export function createRoute(
  name: string,
  opts: CreateRouteOptions
): k8s.networking.v1.Ingress {
  const annotations: Record<string, string> = { ...opts.annotations }
  if (opts.tlsIssuer) {
    annotations['cert-manager.io/cluster-issuer'] = opts.tlsIssuer
  }

  return new k8s.networking.v1.Ingress(
    name,
    {
      metadata: {
        namespace: opts.namespace,
        labels: opts.labels,
        annotations: Object.keys(annotations).length > 0 ? annotations : undefined
      },
      spec: {
        ingressClassName: opts.ingressClassName,
        tls: opts.tlsIssuer
          ? [
              {
                hosts: [opts.domain],
                secretName: `${name}-tls`
              }
            ]
          : undefined,
        rules: [
          {
            host: opts.domain,
            http: {
              paths: [
                {
                  path: opts.pathPrefix,
                  pathType: 'Prefix',
                  backend: {
                    service: {
                      name: opts.serviceName,
                      port: { number: opts.servicePort }
                    }
                  }
                }
              ]
            }
          }
        ]
      }
    },
    { parent: opts.parent }
  )
}
