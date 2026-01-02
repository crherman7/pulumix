# @pulumix/core

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
