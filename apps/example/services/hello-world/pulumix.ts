import * as k8s from "@pulumi/kubernetes";
import {
  ServiceContext,
  ServiceResult,
  getStandardLabels,
} from "@pulumix/core";

export interface HelloWorldOutputs {
  namespace: string;
  url: string;
}

export default async (
  ctx: ServiceContext
): Promise<ServiceResult<HelloWorldOutputs>> => {
  const namespace = (ctx.globalConfig.namespace as string) || ctx.stackName;
  const baseDomain = (ctx.config.baseDomain as string) || "127.0.0.1.sslip.io";
  const hostname = `${ctx.serviceName}.${baseDomain}`;
  const kubeContext = ctx.globalConfig.kubeContext as string | undefined;

  const provider = new k8s.Provider("k8s", { context: kubeContext });

  const ns = new k8s.core.v1.Namespace(
    namespace,
    { metadata: { name: namespace, labels: getStandardLabels(ctx) } },
    { provider }
  );

  const labels = getStandardLabels(ctx);
  const port = 3000;
  const ingressClassName = (ctx.config.ingressClassName as string) || undefined;
  const env = (ctx.config.env as Record<string, string>) || {};

  new k8s.apps.v1.Deployment(
    ctx.serviceName,
    {
      metadata: { name: ctx.serviceName, namespace, labels },
      spec: {
        replicas: 1,
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: {
            containers: [
              {
                name: ctx.serviceName,
                image: ctx.image,
                ports: [{ containerPort: port }],
                env: Object.entries(env).map(([name, value]) => ({
                  name,
                  value,
                })),
                readinessProbe: {
                  httpGet: { path: "/health", port },
                  initialDelaySeconds: 5,
                  periodSeconds: 10,
                },
                livenessProbe: {
                  httpGet: { path: "/health", port },
                  initialDelaySeconds: 10,
                  periodSeconds: 30,
                },
              },
            ],
          },
        },
      },
    },
    { provider, dependsOn: [ns] }
  );

  const svc = new k8s.core.v1.Service(
    ctx.serviceName,
    {
      metadata: { name: ctx.serviceName, namespace, labels },
      spec: {
        type: "ClusterIP",
        selector: labels,
        ports: [{ port, targetPort: port }],
      },
    },
    { provider, dependsOn: [ns] }
  );

  new k8s.networking.v1.Ingress(
    ctx.serviceName,
    {
      metadata: { name: ctx.serviceName, namespace, labels },
      spec: {
        ingressClassName,
        rules: [
          {
            host: hostname,
            http: {
              paths: [
                {
                  path: "/",
                  pathType: "Prefix",
                  backend: {
                    service: {
                      name: svc.metadata.name,
                      port: { number: port },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    },
    { provider, dependsOn: [ns] }
  );

  return {
    outputs: {
      namespace,
      url: `https://${hostname}/`,
    },
  };
};
