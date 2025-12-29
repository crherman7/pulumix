# @pulumix/core

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
