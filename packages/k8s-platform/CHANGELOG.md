# @pulumix/k8s-platform

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
