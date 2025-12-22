# Pulumix

**Build and deploy federated services on Kubernetes with TypeScript**

Pulumix is a service orchestration framework built on Pulumi. It discovers services across your monorepo and node_modules, builds Docker images, and deploys them in dependency order—letting teams share and compose infrastructure like npm packages.

```bash
npm install -g @pulumix/cli
```

---

## Why Pulumix?

**Service-based infrastructure.** Each service owns its deployment logic in a `pulumix.ts` file. No centralized orchestration, no sprawling IaC monoliths.

**Federated by design.** Publish services to npm. Import and compose them across teams and repos. Local services override published ones during development.

**Type-safe dependencies.** Services export TypeScript interfaces for their outputs. Consumers get full IntelliSense when wiring services together.

**Built on Pulumi.** Use the full Pulumi SDK—any cloud, any resource. Pulumix adds discovery, dependency resolution, and build orchestration on top.

---

## Quick Start

### Install

**CLI (for deployment):**

```bash
npm install -g @pulumix/cli
```

**Core library (for service development):**

```bash
npm install @pulumix/core
```

Or use the CLI directly with `npx`:

```bash
npx @pulumix/cli deploy local
```

### Create a Service

```bash
mkdir -p services/my-api
cd services/my-api
```

Create `pulumix.yaml`:

```yaml
metadata:
  name: my-api
  version: 1.0.0
  description: My API service

observability:
  health:
    endpoint: /health
    port: 3000

stacks:
  local:
    replicas: 2
    baseDomain: '127.0.0.1.sslip.io'
```

Create `pulumix.ts`:

```typescript
import * as k8s from '@pulumi/kubernetes'
import { ServiceContext, ServiceResult } from '@pulumix/core'

export default async (ctx: ServiceContext): Promise<ServiceResult> => {
  const { serviceName, namespace, config, image } = ctx

  const deployment = new k8s.apps.v1.Deployment(serviceName, {
    metadata: { name: serviceName, namespace },
    spec: {
      replicas: config.replicas || 1,
      selector: { matchLabels: { app: serviceName } },
      template: {
        metadata: { labels: { app: serviceName } },
        spec: {
          containers: [{
            name: serviceName,
            image: image || `${serviceName}:latest`,
            ports: [{ containerPort: 3000 }]
          }]
        }
      }
    }
  })

  return {
    outputs: {
      url: `http://${serviceName}.${config.baseDomain}/`
    },
    resources: [deployment]
  }
}
```

### Deploy

```bash
pulumix deploy local
```

```
Configuration
  • Project: my-project
  • Stack: local

Discovery
  • Found 1 local service(s)
  • Found 0 published service(s)

Deploy
  ✓ my-api deployed (5.2s)

Summary
  • Services: 1 deployed
  • Duration: 8.4s
```

---

## How It Works

### 1. Auto-Discovery

Pulumix finds services anywhere in your project using glob patterns:

```
my-monorepo/
├── services/api/
│   ├── pulumix.ts      ✅ Found
│   └── pulumix.yaml
├── infra/postgres/
│   ├── pulumix.ts      ✅ Found
│   └── pulumix.yaml
└── node_modules/
    └── @platform/redis/
        ├── pulumix.ts  ✅ Found (if allowlisted)
        └── pulumix.yaml
```

No hardcoded paths. Services can live anywhere.

### 2. Dependency Resolution

Services declare dependencies in `package.json`:

```json
{
  "name": "@my-app/api",
  "dependencies": {
    "@pulumix/core": "workspace:*",
    "@platform/postgres": "^1.0.0",
    "@platform/redis": "^2.1.0"
  }
}
```

Pulumix builds a dependency graph and deploys in topological order.

### 3. Type-Safe Contracts

Services export TypeScript interfaces for their outputs:

```typescript
// @platform/postgres/pulumix.ts
export interface PostgresOutputs {
  host: string
  port: number
  connectionString: string
}

export default async (ctx: ServiceContext): Promise<ServiceResult<PostgresOutputs>> => {
  // ... deployment logic

  return {
    outputs: {
      host: 'postgres.default.svc.cluster.local',
      port: 5432,
      connectionString: 'postgresql://...'
    }
  }
}
```

Consumers import types for full IntelliSense:

```typescript
// @my-app/api/pulumix.ts
import type { PostgresOutputs } from '@platform/postgres'

interface ApiDependencies {
  postgres: PostgresOutputs
}

export default async (ctx: ServiceContext<ApiDependencies>): Promise<ServiceResult> => {
  const dbHost = ctx.dependencies.postgres.host  // ✨ Type-safe!
  // ...
}
```

### 4. Federated Services

**Publish services to npm:**

```bash
cd services/postgres
npm publish
```

**Consume from any repo:**

```json
{
  "dependencies": {
    "@platform/postgres": "^1.0.0"
  }
}
```

**Configure allowlist:**

```yaml
# pulumix.yaml
services:
  allowed:
    - "@platform/*"
    - "@my-company/*"
```

Pulumix scans `node_modules` and deploys published services alongside local ones.

---

## Features

### 🔍 **Auto-Discovery**
Glob-based discovery finds services anywhere in your monorepo. No configuration needed.

### 📦 **Federated Services**
Publish services to npm. Share infrastructure across teams and repos.

### 🔗 **Dependency Management**
Declare dependencies in `package.json`. Pulumix resolves and deploys in order.

### 🎯 **Type-Safe Contracts**
Export TypeScript interfaces. Get IntelliSense when wiring services together.

### 🐳 **Docker Builds**
Automatically builds and pushes images before deployment. Supports multi-stage builds.

### 🔐 **Security Allowlist**
Control which published services can execute. Glob pattern matching (`@platform/*`).

### 🏷️ **Standard Metadata**
Service manifests include team ownership, SLAs, observability config, and more.

### ⚡ **Local Development**
Local services override published ones. Develop and test without republishing.

### 🎛️ **Stack Configuration**
Per-environment config (dev, staging, prod) in `pulumix.yaml`.

### 🚀 **Built on Pulumi**
Full access to Pulumi SDK. Any cloud, any resource.

---

## Example: Hello World

See the [hello-world example](./examples/hello-world) for a complete multi-service deployment:

- **provider** - Creates k3d cluster with registry
- **ingress** - Installs Traefik (or skips for k3d)
- **hello-world** - Deploys HTTP service with Ingress

```bash
cd examples/hello-world
pnpm run deploy local
```

Visit: http://hello-world.127.0.0.1.sslip.io/

---

## Service Structure

### Minimal Service

```
services/my-service/
├── pulumix.ts       # Deployment logic
├── pulumix.yaml     # Service manifest
└── package.json     # Dependencies
```

### Service with Application

```
services/my-api/
├── pulumix.ts       # Deployment logic
├── pulumix.yaml     # Service manifest
├── package.json     # Deployment dependencies
├── Dockerfile       # Application image
└── src/
    ├── package.json # Runtime dependencies
    └── index.js     # Application code
```

**Key principle:** Separate deployment-time dependencies (in root `package.json`) from runtime dependencies (in `src/package.json`).

---

## Configuration

### Project Root (`pulumix.yaml`)

```yaml
name: my-project

# Security: allowlist for published services
services:
  allowed:
    - "@platform/*"
    - "@my-company/*"

# Stack configuration
stacks:
  local:
    namespace: dev

  production:
    namespace: prod
```

### Service Manifest (`services/my-api/pulumix.yaml`)

```yaml
metadata:
  name: my-api
  version: 1.0.0
  description: My API service
  team: backend
  owner: backend@company.com
  tags:
    tier: api
    criticality: high

observability:
  health:
    endpoint: /health
    port: 3000
  metrics:
    endpoint: /metrics
    format: prometheus
  logs:
    format: json
    level: info

stacks:
  local:
    replicas: 2
    baseDomain: '127.0.0.1.sslip.io'

  production:
    replicas: 10
    baseDomain: 'api.company.com'
```

---

## CLI Reference

### Deploy

```bash
pulumix deploy <stack> [options]
```

**Options:**
- `-p, --path <path>` - Project root (default: cwd)
- `-s, --services <list>` - Deploy specific services only
- `-v, --verbose` - Verbose output

**Examples:**

```bash
# Deploy all services to local stack
pulumix deploy local

# Deploy specific services
pulumix deploy local -s provider,api

# Deploy from different directory
pulumix deploy production -p ./infra
```

### Destroy

```bash
pulumix destroy <stack> [options]
```

**Options:**
- `-y, --yes` - Skip confirmation
- `-p, --path <path>` - Project root

---

## ServiceContext API

Every `pulumix.ts` receives a context object:

```typescript
interface ServiceContext<TDeps = any> {
  // Stack info
  stackName: string                    // "local" | "production"
  serviceName: string                  // "my-api"
  namespace: string                    // "default"

  // Service metadata
  metadata: ServiceMetadata            // From pulumix.yaml
  observability?: ObservabilityConfig  // Health, metrics, logs
  security?: SecurityConfig            // Security settings

  // Configuration
  config: Record<string, unknown>      // Stack-specific config
  globalConfig: Record<string, unknown> // Root pulumix.yaml config

  // Dependencies
  dependencies: TDeps                  // Typed outputs from dependencies

  // Docker image (if Dockerfile exists)
  image?: string                       // "registry:5000/my-api:latest"
}
```

### ServiceResult

Return value from `pulumix.ts`:

```typescript
interface ServiceResult<TOutputs = any> {
  // Outputs for dependent services
  outputs?: TOutputs

  // Pulumi resources (optional, for tracking)
  resources?: any[]
}
```

---

## Publishing Services

### 1. Create a Service

```bash
mkdir my-postgres-service
cd my-postgres-service
npm init -y
```

### 2. Add Pulumix Files

```bash
# Create pulumix.ts and pulumix.yaml
# Export output interface
```

### 3. Publish to npm

```json
{
  "name": "@my-company/postgres",
  "version": "1.0.0",
  "main": "pulumix.ts",
  "keywords": ["pulumix-service"],
  "dependencies": {
    "@pulumix/core": "^1.0.0"
  }
}
```

```bash
npm publish --access public
```

### 4. Consume from Other Projects

```bash
npm install @my-company/postgres
```

```yaml
# pulumix.yaml
services:
  allowed:
    - "@my-company/*"
```

---

## Development

### Install Dependencies

```bash
pnpm install
```

### Build

```bash
# Build all packages
pnpm build

# Build specific package
pnpm --filter @pulumix/core build
pnpm --filter @pulumix/cli build
```

### Run Example

```bash
cd examples/hello-world
pnpm run deploy local
```

### Project Structure

```
pulumix/
├── packages/
│   ├── core/          # Orchestrator, types, utilities
│   └── cli/           # Command-line interface
├── examples/
│   └── hello-world/   # Example multi-service app
└── package.json       # Workspace root
```

---

## Comparison

### vs Plain Pulumi

**Pulumi:**
- Centralized IaC in one program
- Manual dependency coordination
- Monolithic state files
- Single team ownership

**Pulumix:**
- Distributed service ownership
- Automatic dependency resolution
- Service-scoped deployments
- Multi-team collaboration

### vs Terraform Modules

**Terraform Modules:**
- Published to registries
- Called with module blocks
- No runtime dependency resolution

**Pulumix:**
- Published to npm
- Installed like packages
- Runtime dependency graph
- Type-safe contracts

---

## Requirements

- **Node.js** 18 or later
- **pnpm** (or npm/yarn)
- **Docker** (for building images)
- **Pulumi CLI** (automatically used)
- **kubectl** (for Kubernetes deployments)
- **k3d** (optional, for local Kubernetes)

---

## Contributing

Contributions welcome! Please open an issue or PR.

### Development Setup

```bash
git clone https://github.com/yourorg/pulumix.git
cd pulumix
pnpm install
pnpm build
```

---

## License

MIT

---

## Community

- [GitHub Issues](https://github.com/yourorg/pulumix/issues)
- [Discussions](https://github.com/yourorg/pulumix/discussions)

Built with ❤️ by developers who believe infrastructure should be composable.
