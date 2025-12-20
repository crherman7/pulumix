# Pulumix

**Simple service-based deployment orchestration built on Pulumi**

Pulumix discovers services, builds Docker images, and deploys them using Pulumi. Each service owns its own infrastructure via a `deploy.ts` file.

## Features

- **Service-Based Architecture**: Each service has a `deploy.ts` that defines its own resources
- **Automatic Discovery**: Finds services in `services/` directory
- **Dependency Management**: Topological sort ensures correct deployment order
- **Docker Builds**: Builds and pushes images before deployment
- **Stack Configuration**: Per-environment config via `deploy.yaml`
- **k3d Support**: Auto-creates local Kubernetes clusters with registry

## Architecture

```
packages/
  core/     # Orchestrator, service types, event system
  cli/      # Command-line interface

examples/hello-world/
  deploy.yaml                    # Root config (project name, stack settings)
  services/
    provider/
      deploy.ts                  # Sets up k3d cluster
      deploy.yaml                # Stack-specific config
    ingress/
      deploy.ts                  # Ingress controller (skipped for k3d)
      deploy.yaml
    hello-world/
      deploy.ts                  # Deploys Deployment, Service, Ingress
      deploy.yaml
      Dockerfile
      src/index.js
```

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm
- Docker
- Pulumi CLI
- k3d (for local Kubernetes)

### Install

```bash
git clone https://github.com/yourusername/pulumix.git
cd pulumix
pnpm install
pnpm build
```

### Deploy

```bash
cd examples/hello-world
../../packages/cli/dist/index.js deploy local
```

Output:
```
pulumix deploy local

Configuration
  * Project: hello-world
  * Stack: local

Discovery
  * hello-world
  * ingress
  * provider

Dependencies
  +-- provider
  +-- ingress (requires: provider)
  +-- hello-world (requires: ingress)

Bootstrap
  * Creating cluster 'hello-world'...
  * Cluster 'hello-world' created

Build
  * Building hello-world...
  * Pushing hello-world...
  * hello-world -> localhost:5001/hello-world:latest

Deploy
  + Namespace hello-world created
  + Deployment hello-world created
  + Service hello-world created
  + Ingress hello-world-ingress created

Summary
  Deployment completed
  * Stack: local
  * Services: 3 deployed
  * Duration: 45.8s
```

### Test

```bash
curl http://hello-world.127.0.0.1.sslip.io/
# {"message":"Hello from Pulumix!","hostname":"hello-world-xxx","version":"1.0.0"}
```

### Destroy

```bash
../../packages/cli/dist/index.js destroy local --yes
```

## How It Works

### 1. Service Discovery

Pulumix scans `services/` for directories containing `deploy.ts`:

```
services/
  provider/deploy.ts    -> discovered
  ingress/deploy.ts     -> discovered
  hello-world/deploy.ts -> discovered
```

### 2. Dependency Resolution

Each service's `deploy.yaml` can declare dependencies:

```yaml
# services/hello-world/deploy.yaml
name: hello-world
dependencies:
  - ingress

stacks:
  local:
    replicas: 2
```

Services are deployed in topological order: provider -> ingress -> hello-world

### 3. Bootstrap Phase

For k3d, the orchestrator creates the cluster before building images:

```yaml
# services/provider/deploy.yaml
stacks:
  local:
    k3d:
      enabled: true
      clusterName: hello-world
      registryPort: 5001
```

### 4. Build Phase

Services with a `Dockerfile` get built and pushed:

- Build: `docker build -t localhost:5001/hello-world .`
- Push: `docker push localhost:5001/hello-world:latest`

### 5. Deploy Phase

Each service's `deploy.ts` receives a context and creates Pulumi resources:

```typescript
// services/hello-world/deploy.ts
import * as k8s from '@pulumi/kubernetes'
import type { ServiceContext, ServiceResult } from '@pulumix/core'

export default async (ctx: ServiceContext): Promise<ServiceResult> => {
  const { serviceName, namespace, config, image } = ctx

  const deployment = new k8s.apps.v1.Deployment(serviceName, {
    metadata: { name: serviceName, namespace },
    spec: {
      replicas: config.replicas || 1,
      // ...
    }
  })

  return {
    outputs: { url: `http://${serviceName}.127.0.0.1.sslip.io/` },
    resources: [deployment]
  }
}
```

## ServiceContext

Every `deploy.ts` receives:

```typescript
interface ServiceContext {
  stackName: string                              // "local", "production"
  serviceName: string                            // "hello-world"
  namespace: string                              // From global config
  config: Record<string, unknown>                // Stack-specific config
  globalConfig: Record<string, unknown>          // Root deploy.yaml config
  dependencies: Record<string, Record<string, unknown>>  // Outputs from deps
  image?: string                                 // Built image URL
}
```

## Configuration

### Root deploy.yaml

```yaml
name: hello-world

stacks:
  local:
    namespace: hello-world
  production:
    namespace: hello-world-prod
```

### Service deploy.yaml

```yaml
name: hello-world
dependencies:
  - ingress

stacks:
  local:
    replicas: 2
    port: 3000
  production:
    replicas: 5
    port: 3000
```

## CLI Commands

```bash
# Deploy
pulumix deploy <stack> [options]
  -p, --path <path>         Root path (default: cwd)
  -s, --services <list>     Deploy specific services only
  -v, --verbose             Verbose output

# Destroy
pulumix destroy <stack> [options]
  -y, --yes                 Skip confirmation
```

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Build specific package
pnpm --filter @pulumix/core build
```

## License

MIT
