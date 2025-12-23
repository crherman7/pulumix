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
            image,  // Digest-based: registry/name@sha256:...
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
  • Stack: local
  • Services: 1 service

Discovery
  + Found 1 service

Dependencies
  └─ my-api

Build
  + my-api (a1b2c3d4e5f6) created (3.2s)

Deploy
  + Namespace my-api created (0.5s)
  + Deployment my-api created (1.8s)
  + Service my-api created (0.3s)

Summary

  Resources:
    3 created

  Duration:
    Configuration   0.1s
    Discovery       0.2s
    Dependencies    0.0s
    Build           3.2s
    Deploy          2.6s
    ─────────────────────
    Total           6.1s

  + Deployment completed
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

### 4. Smart Build Caching

Pulumix uses content-based hashing to avoid unnecessary rebuilds:

```
Build
  + my-api (a1b2c3d4e5f6) created (3.2s)    # First deploy - builds image
  + my-api (a1b2c3d4e5f6) unchanged (0.1s)  # Second deploy - skips build
  + my-api (b7c8d9e0f1a2) created (2.8s)    # After code change - rebuilds
```

**How it works:**
1. Hashes all source files in the service directory (ignores node_modules, .git, etc.)
2. Tags images with the content hash: `registry/my-api:a1b2c3d4e5f6`
3. Checks if that image already exists in the registry
4. Skips build if unchanged, or builds and pushes if new

**Guaranteed deployments:** Images are referenced by digest (`@sha256:...`) rather than tag, ensuring Kubernetes always uses the exact image that was just built—eliminating stale cache issues.

### 5. Federated Services

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

### 🐳 **Smart Docker Builds**
Content-based build caching skips unchanged services. Images are tagged with content hashes and referenced by digest for guaranteed deployments.

### 🔐 **Security Allowlist**
Control which published services can execute. Glob pattern matching (`@platform/*`).

### 🏷️ **Standard Metadata**
Service manifests include team ownership, SLAs, observability config, and more.

### ⚡ **Local Development with HMR**
Run services locally with hot module replacement while dependencies run in the cluster. The ingress URL routes to your local machine for full-stack development with instant feedback.

### 🎛️ **Stack Configuration**
Per-environment config (dev, staging, prod) in `pulumix.yaml`.

### 🚀 **Built on Pulumi**
Full access to Pulumi SDK. Any cloud, any resource.

---

## Example: Hello World

See the [hello-world example](./examples/hello-world) for a complete multi-service deployment:

- **provider** - Creates k3d cluster with local registry
- **ingress** - Configures ingress (uses k3d's built-in Traefik)
- **hello-world** - Builds and deploys HTTP service with Ingress

```bash
cd examples/hello-world
pnpm install
pnpm run deploy local
```

```
Configuration
  • Stack: local
  • Services: 3 services
    • provider v1.0.0
    • ingress v1.0.0
    • hello-world v1.0.0

Cluster
  + hello-world created (2.1s)

Build
  + hello-world (a1b2c3d4e5f6) created (4.2s)

Deploy
  + Namespace hello-world created (0.5s)
  + Deployment hello-world created (1.8s)
  + Service hello-world created (0.3s)
  + Ingress hello-world created (0.2s)

  + Deployment completed
```

Visit: http://hello-world.127.0.0.1.sslip.io/

### Local Development

Run hello-world locally with HMR while the ingress routes to your machine:

```bash
cd examples/hello-world
pnpm run dev local hello-world
```

```
pulumix dev
/path/to/examples/hello-world

Configuration
  Stack:        local
  Dev Services: hello-world

Discovery
  └─ hello-world (local)

Dev Mode Active

  Dev Servers:
    + hello-world -> http://localhost:3000

  Ingress URLs (routed to local):
    + http://hello-world.127.0.0.1.sslip.io

Press Ctrl+C to stop

  [hello-world] Server running on port 3000
```

Edit files and see changes instantly at http://hello-world.127.0.0.1.sslip.io/

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

# Local development configuration
dev:
  command: npm run dev    # Command to run locally
  port: 3000              # Dev server port
  cwd: src                # Working directory (optional)
  env:                    # Additional env vars (optional)
    NODE_ENV: development

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

### Dev

```bash
pulumix dev <stack> <services> [options]
```

Run services locally with hot module replacement while dependencies run in the cluster. The cluster's ingress URL routes to your local machine for full-stack development.

**Arguments:**
- `<stack>` - Stack name (e.g., `local`)
- `<services>` - Comma-separated list of services to run locally

**Options:**
- `-p, --path <path>` - Project root (default: cwd)
- `-v, --verbose` - Verbose output

**Examples:**

```bash
# Single service dev
pulumix dev local web-app

# Multiple services (full-stack dev)
pulumix dev local web-app,api

# From different directory
pulumix dev local hello-world -p ./examples/hello-world
```

**How it works:**

1. Discovers all services and their dependencies
2. Computes which services run locally vs in cluster
3. Sets up port-forwards to cluster services (databases, etc.)
4. Scales down cluster deployments for dev services
5. Patches Kubernetes Services to route to your local machine
6. Starts local dev servers with injected environment variables
7. Traffic to ingress URLs now hits your local dev server

**Example output:**

```
pulumix dev
/path/to/project

Configuration
  Stack:        local
  Dev Services: hello-world

Discovery
  └─ hello-world (local)

Dev Mode Active

  Port Forwards:
    + postgres:5432 -> localhost:5432

  Dev Servers:
    + hello-world -> http://localhost:3000

  Ingress URLs (routed to local):
    + http://hello-world.127.0.0.1.sslip.io

Press Ctrl+C to stop
```

**Requirements:**

Services must have a `dev` section in their `pulumix.yaml`:

```yaml
dev:
  command: npm run dev    # Command to run locally
  port: 3000              # Dev server port
  cwd: src                # Working directory (optional)
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
  image?: string                       // "registry:5000/my-api@sha256:abc123..."
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

- **Docker** (for building images)
- **mise** (for tool management) - [install mise](https://mise.jdx.dev)

All other tools (Node.js, pnpm, kubectl, k3d, Pulumi) are managed via mise.

---

## Contributing

Contributions welcome! Please open an issue or PR.

### Development Setup

```bash
# Clone the repo
git clone https://github.com/yourorg/pulumix.git
cd pulumix

# Install tools via mise
mise trust
mise install

# Setup project (installs deps + builds)
mise run setup
```

### Available Tasks

```bash
mise run setup    # Initial project setup
mise run build    # Build all packages
mise run test     # Run tests
mise run dev      # Watch mode
mise run deploy   # Deploy hello-world to local
mise run destroy  # Destroy local stack
mise run clean    # Clean build artifacts
mise run lint     # Type checking
mise run knip     # Check for unused code
```

### Tools Managed by mise

| Tool | Version | Purpose |
|------|---------|---------|
| node | 22 | JavaScript runtime |
| pnpm | (via corepack) | Package manager |
| kubectl | latest | Kubernetes CLI |
| k3d | latest | Local Kubernetes |
| pulumi | latest | Infrastructure as code |

---

## License

MIT

---

## Community

- [GitHub Issues](https://github.com/yourorg/pulumix/issues)
- [Discussions](https://github.com/yourorg/pulumix/discussions)

Built with ❤️ by developers who believe infrastructure should be composable.
