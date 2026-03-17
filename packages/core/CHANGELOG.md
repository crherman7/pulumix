# @pulumix/core

## 0.13.0

### Minor Changes

- Refactor codebase with functional programming patterns

  **@pulumix/core:**

  - Add `createValidator` higher-order function factory for type-safe JSON schema validation
  - Add `createWorkspaceStack` pure function for EitherAsync composition in orchestrator
  - Refactor `status()`, `refresh()`, `destroy()` methods to use EitherAsync chain composition
  - Reduce code duplication in validation modules (manifest.ts, project.ts)

  **@pulumix/cli:**

  - Add shared `discoverAllServices` utility using EitherAsync for composable error handling
  - Refactor `list`, `inspect`, and `validate` commands to use shared discovery
  - Add `createTypedSubscriber` higher-order function in event-bus for DRY event subscriptions
  - Add `purify-ts` dependency for functional programming patterns

## 0.12.0

### Minor Changes

- Replace local dev runners with in-cluster dev pods:

  - Add `DevPodManager` that creates dev pods inheriting deployment env, labels, and service account for native cluster DNS access
  - Scale down target deployments and replace with dev pods running synced local code
  - Port-forward dev pod ports to localhost for local browser access
  - Remove `local-runner.ts` and `env-compute.ts` in favor of the dev-pod approach
  - Update CLI dev command output to show dev pod status and manual cleanup hints
  - Add k8s helpers for deployment discovery, pod creation, and scaling

## 0.11.0

### Minor Changes

- Add imagePullSecrets, initContainers, env valueFrom (secretKeyRef, configMapKeyRef, fieldRef), TLS without cert-manager (tlsSecretName), and pulumi.Input<string> support for command/args

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

## 0.9.0

### Minor Changes

- feat(build): display content hash next to service names during build

  - Add `contentHash` to `TaskStartEvent` for build tasks
  - Show content hash in build output with aligned columns
  - Dynamically calculate column widths based on service names and hash lengths

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

## 0.6.0

### Minor Changes

- Add generic lifecycle hooks system, removing k3d coupling from core

  **New features:**

  - Lifecycle hooks: Run scripts at `pre-build`, `post-build`, `pre-deploy`, `post-deploy` stages
  - Hook configuration in root `pulumix.yaml` with per-stack settings
  - Environment variables, timeouts, and `continueOnFailure` options for hooks
  - New `HookStage`, `HookDefinition`, and `HooksConfig` types exported from core

  **Breaking changes:**

  - Removed built-in k3d cluster management from orchestrator
  - Removed `K3dConfig` interface and related functions (`clusterExists`, `createK3dCluster`)
  - Bootstrap phase now runs `pre-build` hooks instead of k3d-specific logic
  - Registry configuration now comes from stack config (`hostRegistry`, `clusterRegistry`) instead of provider service

  **Migration:**

  To migrate existing projects using k3d:

  1. Create a `scripts/ensure-cluster.sh` script with your k3d setup logic
  2. Add hooks configuration to your root `pulumix.yaml`:
     ```yaml
     hooks:
       local:
         - stage: pre-build
           run: "./scripts/ensure-cluster.sh"
           env:
             CLUSTER_NAME: my-cluster
     ```
  3. Move registry config to your stack configuration
  4. Simplify your provider service to just return outputs

## 0.5.1

### Patch Changes

- Fix build status UI not showing completion - emit TaskComplete when export step finishes instead of waiting for entire bake process to exit

## 0.5.0

### Minor Changes

- Switch docker buildx bake to --progress=rawjson for accurate per-service build progress

  - Use rawjson output format instead of plain text for structured build events
  - Parse BuildKit vertex status events to track per-service progress
  - Show step-by-step progress like [2/5] COPY package.json for each service during builds
  - Emit real-time TaskUpdate events as each build step starts/completes
  - Handle single-target bakes where vertex names don't include target prefix

## 0.4.1

### Patch Changes

- Simplify docker buildx bake progress display

  - Show "building" for all services during bake
  - Mark all as complete when bake finishes
  - Removed unreliable per-service progress parsing (bake output is interleaved)

## 0.4.0

### Minor Changes

- Switch Docker builds from dockerode to docker buildx bake

  - Parallel image builds with shared layer cache
  - Removed dockerode, tar-fs dependencies
  - Uses `docker buildx bake --push --progress=plain` for native BuildKit support
  - Streaming progress parsing for real-time UI updates
  - Cache check runs in parallel before building

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

## 0.3.0

### Minor Changes

- feat(core): Dockerfile-aware content hashing for accurate build caching

  Completely redesigned Docker image caching to match exactly what Docker sees:

  - **Dockerfile parsing**: Uses `dockerfile-ast` to extract COPY/ADD source paths
  - **.dockerignore support**: Uses `@balena/dockerignore` to respect ignore patterns
  - **Accurate cache invalidation**: Only files that would be copied into the image affect the hash

  This fixes issues in monorepos where:

  - Shared workspace dependencies weren't triggering rebuilds
  - All services got the same hash when using `build.context: root`
  - Files excluded by `.dockerignore` were still included in the hash

  Example Dockerfile:

  ```dockerfile
  COPY pnpm-lock.yaml pnpm-workspace.yaml ./
  COPY packages/shared ./packages/shared
  COPY services/api ./services/api
  ```

  Now correctly hashes only those paths, filtered through `.dockerignore`.

## 0.2.1

### Patch Changes

- fix(core): use service directory for Docker cache hash instead of build context

  Fixed an issue where all services using `build.context: root` would get the same cache hash (because they all hashed the entire project root). Now the cache key is computed from the service directory while the build context is used for the actual Docker build.

  This ensures each service has a unique cache key based on its own files, even when using a shared build context for monorepo access.

## 0.2.0

### Minor Changes

- feat(core): add build.context config for monorepo Docker builds

  Added `build` configuration section to service manifests, allowing customization of Docker build context:

  - `context: root` - Use project root as build context (for accessing pnpm-lock.yaml, shared configs, etc.)
  - `context: .` - Use service directory (default behavior)
  - `context: ../..` - Use relative path from service directory
  - `dockerfile` - Optional path to Dockerfile relative to context

  Example usage in pulumix.yaml:

  ```yaml
  build:
    context: root
    dockerfile: services/api/Dockerfile
  ```

  Also fixed service discovery to deduplicate services by name.

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
