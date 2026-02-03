# @pulumix/cli

## 0.10.0

### Minor Changes

- feat: add k8s inspection, new CLI commands, and k8s-platform primitives

  **@pulumix/core**

  - Add `k8s` module for read-only cluster inspection (list services, resolve env vars from ConfigMaps/Secrets)
  - Replace `env-builder` with `env-compute` for environment variable resolution
  - Refactor dev mode service swap and orchestrator internals
  - Add `contentHash` to `TaskStartEvent` for build tasks

  **@pulumix/cli**

  - Add `preview` command to preview changes without deploying
  - Add `refresh` command to reconcile stack state with cloud resources
  - Add `status` command to show current stack outputs
  - Display content hash next to service names during build

  **@pulumix/k8s-platform**

  - New package providing opinionated Kubernetes workload primitives
  - `PublicApi` — Deployment + Service + Ingress + HPA + PDB with production defaults
  - `PrivateService` — internal service with NetworkPolicy and optional autoscaling
  - `WorkerService` — headless deployment for background workers
  - `CronJob` — scheduled job with configurable concurrency and retention

### Patch Changes

- Updated dependencies
  - @pulumix/core@0.10.0

## 0.9.0

### Minor Changes

- feat(build): display content hash next to service names during build

  - Add `contentHash` to `TaskStartEvent` for build tasks
  - Show content hash in build output with aligned columns
  - Dynamically calculate column widths based on service names and hash lengths

### Patch Changes

- Updated dependencies
  - @pulumix/core@0.9.0

## 0.8.0

### Minor Changes

- Add platform support for docker buildx bake and improve dev mode

  **Platform support:**

  - Added `platform` config option per stack in root `pulumix.yaml` (e.g., `linux/amd64`, `linux/arm64`)
  - Platforms are passed to `docker buildx bake` for cross-platform image builds
  - Supports both single platform string and array of platforms for multi-arch builds

  **Dev mode improvements:**

  - Added `dev.expose` config for services to declare how they should be exposed (port, protocol, envVar)
  - Added command validation for suspicious patterns in dev commands
  - Added working directory (`cwd`) validation
  - Added port conflict detection between dev services
  - Fixed orphaned child processes with process group management (`detached: true`, negative PID kill)
  - Added JSON schema for dev configuration

### Patch Changes

- Updated dependencies
  - @pulumix/core@0.8.0

## 0.7.0

### Minor Changes

- Add project configuration validation and improve infrastructure-agnostic types

  **New features:**

  - JSON Schema validation for root `pulumix.yaml` project configuration
  - New `validateProjectConfig` and `validateProjectConfigOrThrow` exports from core
  - Added `project-config.schema.json` with backend and hooks validation

  **Breaking changes:**

  - Renamed `rbac` to `accessControl` in security configuration
  - Renamed `RBACConfig` type to `AccessControlConfig`
  - Removed `namespace` from `ServiceContext` - access via `ctx.globalConfig.namespace` instead
  - `accessControl.identity` replaces `rbac.serviceAccount` for infrastructure-agnostic naming

### Patch Changes

- Updated dependencies
  - @pulumix/core@0.7.0

## 0.6.0

### Minor Changes

- Update UI to display "Hooks" phase instead of "Cluster" for lifecycle hooks

### Patch Changes

- Updated dependencies
  - @pulumix/core@0.6.0

## 0.5.3

### Patch Changes

- Fix build spinner rendering issues: memory leak from resize listener, race condition on completion, empty output flickering, incorrect failure status text, and undefined terminal dimensions

## 0.5.2

### Patch Changes

- Fix build spinner output interleaving - clear spinner before printing completion lines to prevent garbled output

## 0.5.1

### Patch Changes

- Updated dependencies
  - @pulumix/core@0.5.1

## 0.5.0

### Patch Changes

- Updated dependencies
  - @pulumix/core@0.5.0

## 0.4.1

### Patch Changes

- Updated dependencies
  - @pulumix/core@0.4.1

## 0.4.0

### Minor Changes

- Switch Docker builds from dockerode to docker buildx bake

  - Parallel image builds with shared layer cache
  - Removed dockerode, tar-fs dependencies
  - Uses `docker buildx bake --push --progress=plain` for native BuildKit support
  - Streaming progress parsing for real-time UI updates
  - Cache check runs in parallel before building

### Patch Changes

- Updated dependencies
  - @pulumix/core@0.4.0

## 0.3.1

### Patch Changes

- fix: BuildKit support and improved error handling

  **@pulumix/core:**

  - Enable BuildKit (version 2) for Docker builds, enabling `--mount=type=cache` for pnpm store caching
  - Add proper error handling for Pulumi `stack.up()` failures
  - `emitPhaseComplete` now accepts success parameter to report failures

  **@pulumix/cli:**

  - Failed tasks now show `✗` icon instead of the original change symbol (`~`)
  - Timer stops correctly when a task fails

- Updated dependencies
  - @pulumix/core@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies
  - @pulumix/core@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies
  - @pulumix/core@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies
  - @pulumix/core@0.2.0

## 0.1.0

### Minor Changes

- Initial release of Pulumix - a federated service orchestration framework for Kubernetes built on Pulumi.

  **Core features:**

  - Service discovery across monorepos and npm packages
  - Docker image building with content-based caching
  - Dependency-ordered deployments with type-safe contracts
  - Service-scoped Pulumi state management
  - JSON Schema validation for service manifests
  - Functional error handling with categorized error codes

  **CLI features:**

  - `pulumix up` - Deploy services with dependency resolution
  - `pulumix destroy` - Tear down deployments
  - `pulumix dev` - Development mode with service swapping
  - Real-time build and deployment progress output

### Patch Changes

- Updated dependencies
  - @pulumix/core@0.1.0
