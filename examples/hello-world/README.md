# Gateway API Example

This example demonstrates using Gateway API with Pulumix.

## Example Structure

This example demonstrates the federated monorepo pattern:

```
examples/gateway-api-k8s/
├── deploy.yaml                    # Root config: provider, stacks, defaults
├── README.md
├── scripts/
│   └── setup-gateway.sh          # Gateway API CRD installation
└── services/                      # Example directory (NOT required)
    └── hello-gateway/             # Service (auto-discovered)
        ├── deploy.ts              # Service config - this is what's discovered
        ├── Dockerfile
        ├── package.json
        └── src/
            └── index.js
```

**Key Pattern**:
- Root `deploy.yaml` provides provider config and defaults
- Services **auto-discovered** via glob patterns (e.g., `*/*/deploy.ts`)
- Directory names like `services/`, `apps/`, `infrastructure/` are NOT special - they're just examples
- Any directory with a `deploy.ts` matching a discovery pattern is found
- Each service has its own config, code, and dependencies

**Discovery Patterns** (from `/packages/core/src/managers/discovery.ts`):
- `services/*/deploy.ts` ← We use this in the example
- `apps/*/deploy.ts`
- `infrastructure/*/deploy.ts`
- And more... (services can be anywhere!)

## Prerequisites

- k3d installed
- kubectl installed
- Pulumix CLI built

## Setup

1. **Install Gateway API CRDs (one-time cluster setup):**
   ```bash
   cd examples/gateway-api-k8s
   ./scripts/setup-gateway.sh
   ```

2. **Deploy infrastructure and services:**
   ```bash
   pulumix deploy local
   ```

   This will deploy:
   - Infrastructure: Gateway resource (discovered from `infrastructure/shared-gateway/deploy.ts`)
   - Application: hello-gateway service (discovered from `services/hello-gateway/deploy.ts`)

3. **Verify deployment:**
   ```bash
   # Check Gateway resource
   kubectl get gateway shared-gateway -n default

   # Check HTTPRoute attachment
   kubectl get httproute -n gateway-demo
   kubectl describe httproute hello-gateway-route -n gateway-demo

   # Check application pods
   kubectl get pods -n gateway-demo
   ```

## Configuration

### Simple Setup (Recommended)

Configure Gateway API mode at **provider level** in `deploy.yaml`:

```yaml
kubernetes:
  routing:
    mode: gateway           # All services use Gateway API
    gateway:
      name: shared-gateway  # Gateway resource name
      namespace: default    # Optional, defaults to service namespace
```

Then services just enable ingress in `deploy.ts`:

```typescript
ingress: {
  enabled: true,
  host: 'app.example.com'
  // That's it! Mode inherited from provider
}
```

### Service-Level Overrides

**Override to use Ingress instead:**

```typescript
ingress: {
  enabled: true,
  host: 'app.example.com',
  mode: 'ingress'  // Override provider's gateway mode
}
```

**Override to use different Gateway:**

```typescript
ingress: {
  enabled: true,
  host: 'app.example.com',
  // mode: 'gateway' is inherited, but override gateway name
  gateway: {
    name: 'custom-gateway',
    namespace: 'custom-ns'
  }
}
```

### Mixed Environments

You can mix Ingress and Gateway API in the same cluster:

```yaml
# deploy.yaml
kubernetes:
  routing:
    mode: ingress  # Default to Ingress for backward compat

stacks:
  prod:
    # Production uses Gateway API
    routing:
      mode: gateway
      gateway:
        name: prod-gateway

  dev:
    # Dev uses Ingress
    routing:
      mode: ingress
```

## Troubleshooting

**HTTPRoute not attaching to Gateway:**
- Verify Gateway exists: `kubectl get gateway shared-gateway`
- Check Gateway listeners accept routes from your namespace
- Verify Gateway status is Programmed

**CRDs not found:**
- Run setup script: `./scripts/setup-gateway.sh`
- Verify CRDs: `kubectl get crd | grep gateway`

## Notes

- Gateway API v1 is stable and production-ready (GA since Oct 2023)
- Traefik (k3d default) supports Gateway API in v3.x
- k3d ships with Traefik v2.x by default (Ingress only)
- You may need to upgrade Traefik or use a different controller (Envoy Gateway, NGINX Gateway Fabric)
- HTTPRoute is the most common Gateway API resource
- Gateway resources are typically created separately from apps (infrastructure-level)
