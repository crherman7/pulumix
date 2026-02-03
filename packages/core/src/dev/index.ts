/**
 * DevOrchestrator - Local development with HMR
 *
 * Runs specified services locally while port-forwarding dependencies
 * from the cluster. Auto-discovers dependency ports and auto-computes
 * environment variables from the deployment spec.
 */

import { EitherAsync } from 'purify-ts/EitherAsync'
import * as fs from 'fs'
import * as yaml from 'yaml'
import {
  createConfigError,
  createDiscoveryError,
  DeployError
} from '../types/errors'
import { DiscoveredService } from '../types/service'
import { discoverServices } from '../orchestrator'
import { createK8sClients, listNamespaceServices, resolveDeploymentEnv } from '../k8s'
import type { ClusterServiceInfo } from '../k8s'
import { computeDevEnvVars, buildDependencyLookups } from './env-compute'
import {
  DevConfig,
  DevOrchestratorConfig,
  DevOrchestratorResult,
  LocalDevService,
  PortForwardMapping,
  PortForwardHandle,
  DevServerHandle,
  DEV_SERVER_PORT_BASE,
} from './types'
import { checkKubectl, startPortForwards, stopPortForwards, findAvailablePort } from './port-forward'
import { runDevServers, stopDevServers } from './local-runner'

export * from './types'
export * from './port-forward'
export * from './local-runner'
export * from './env-compute'

/**
 * Extract and validate dev config from service's raw config
 */
function getDevConfig(service: DiscoveredService): DevConfig | undefined {
  const dev = service.rawConfig.dev as Record<string, unknown> | undefined
  if (!dev) return undefined

  if (dev.command === undefined || typeof dev.command !== 'string' || dev.command.trim() === '') {
    return undefined
  }

  // Validate port if provided
  if (dev.port !== undefined) {
    if (typeof dev.port !== 'number' || !Number.isInteger(dev.port) || dev.port < 1 || dev.port > 65535) {
      throw new Error(`Invalid dev config for '${service.name}': port must be an integer between 1 and 65535`)
    }
  }

  // Validate env if provided
  if (dev.env !== undefined) {
    if (typeof dev.env !== 'object' || dev.env === null || Array.isArray(dev.env)) {
      throw new Error(`Invalid dev config for '${service.name}': env must be an object`)
    }
  }

  // Validate cwd if provided
  if (dev.cwd !== undefined && typeof dev.cwd !== 'string') {
    throw new Error(`Invalid dev config for '${service.name}': cwd must be a string`)
  }

  return {
    command: dev.command,
    port: dev.port as number | undefined,
    env: dev.env as Record<string, string> | undefined,
    cwd: dev.cwd as string | undefined,
  }
}

/**
 * Compute all transitive dependencies of given services
 */
function computeTransitiveDependencies(
  services: readonly DiscoveredService[],
  targetNames: string[]
): Set<string> {
  const serviceMap = new Map(services.map(s => [s.name, s]))
  const deps = new Set<string>()

  const visit = (name: string): void => {
    const service = serviceMap.get(name)
    if (!service) return

    for (const dep of service.dependencies) {
      if (!deps.has(dep)) {
        deps.add(dep)
        visit(dep)
      }
    }
  }

  for (const name of targetNames) {
    visit(name)
  }

  return deps
}

/**
 * Read namespace and kubeContext from root config
 */
function readRootConfig(rootPath: string, stackName: string): { namespace: string; kubeContext?: string } {
  try {
    const rootConfigPath = `${rootPath}/pulumix.yaml`
    const content = fs.readFileSync(rootConfigPath, 'utf-8')
    const config = yaml.parse(content) as Record<string, unknown>
    const stacks = config.stacks as Record<string, Record<string, unknown>> | undefined
    const stackConfig = stacks?.[stackName]

    return {
      namespace: (stackConfig?.namespace as string) ?? stackName,
      kubeContext: stackConfig?.kubeContext as string | undefined,
    }
  } catch {
    return { namespace: stackName }
  }
}

/**
 * Build port-forward mappings from cluster service info.
 * Uses real ports from the cluster instead of inference.
 */
async function buildPortForwardMappings(
  clusterServices: ClusterServiceInfo[],
  dependencyNames: string[],
  namespace: string
): Promise<PortForwardMapping[]> {
  const mappings: PortForwardMapping[] = []
  const clusterMap = new Map(clusterServices.map(s => [s.name, s]))

  for (const depName of dependencyNames) {
    const svc = clusterMap.get(depName)
    if (!svc || svc.ports.length === 0) continue

    // Use the first port of the service
    const port = svc.ports[0]
    const localPort = await findAvailablePort(port.port)

    mappings.push({
      serviceName: depName,
      namespace,
      remotePort: port.port,
      localPort,
    })
  }

  return mappings
}

/**
 * DevOrchestrator class
 */
export class DevOrchestrator {
  private portForwardHandles: PortForwardHandle[] = []
  private devServerHandles: DevServerHandle[] = []
  private stopped = false

  /**
   * Start dev mode
   */
  dev(config: DevOrchestratorConfig): EitherAsync<DeployError, DevOrchestratorResult> {
    return EitherAsync(async ({ liftEither, throwE }) => {
      const { rootPath, stackName, devServices: devServiceNames, onLog, onOutput } = config
      const log = onLog ?? (() => {})

      // Check kubectl is available
      await liftEither(await checkKubectl())

      // Read root config for namespace and kubeContext
      const rootConfig = readRootConfig(rootPath, stackName)
      const namespace = rootConfig.namespace
      const kubeContext = config.kubeContext ?? rootConfig.kubeContext

      // Discover services
      log('Discovering services...')
      const allServices = await liftEither(await discoverServices(rootPath))

      // Validate target services exist and have dev.command
      const serviceMap = new Map(allServices.map(s => [s.name, s]))
      const localServices: LocalDevService[] = []
      let devPortCounter = DEV_SERVER_PORT_BASE

      for (const name of devServiceNames) {
        const service = serviceMap.get(name)
        if (!service) {
          return throwE(createDiscoveryError(
            'RootConfigNotFound',
            `Service '${name}' not found. Available: ${allServices.map(s => s.name).join(', ')}`,
            rootPath
          ))
        }

        const devConfig = getDevConfig(service)
        if (!devConfig) {
          return throwE(createConfigError(
            'MissingRequiredField',
            `Service '${name}' missing 'dev.command' in pulumix.yaml. Add:\n\ndev:\n  command: npm run dev`,
            stackName,
            'dev.command'
          ))
        }

        localServices.push({
          service,
          devConfig,
          localPort: devConfig.port ?? devPortCounter++,
        })
      }

      // Compute transitive dependencies (minus dev services themselves)
      const devServiceNamesSet = new Set(devServiceNames)
      const transitiveDeps = computeTransitiveDependencies(allServices, devServiceNames)
      const dependencyNames = [...transitiveDeps].filter(name => !devServiceNamesSet.has(name))

      // Create k8s clients and inspect cluster
      log('Inspecting cluster...')
      let clusterServices: ClusterServiceInfo[] = []
      try {
        const k8s = createK8sClients(kubeContext)
        clusterServices = await listNamespaceServices(k8s, namespace)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        log(`Warning: Could not inspect cluster: ${message}`)
      }

      // Port-forward dependencies
      const portForwardMappings = await buildPortForwardMappings(
        clusterServices,
        dependencyNames,
        namespace
      )

      if (portForwardMappings.length > 0) {
        log(`Setting up port-forwards for: ${portForwardMappings.map(m => m.serviceName).join(', ')}`)

        const pfResult = await startPortForwards(portForwardMappings, kubeContext)
        if (pfResult.isLeft()) {
          return throwE(pfResult.extract() as DeployError)
        }
        this.portForwardHandles = pfResult.extract() as PortForwardHandle[]

        for (const handle of this.portForwardHandles) {
          log(`  ${handle.mapping.serviceName}:${handle.mapping.remotePort} -> localhost:${handle.mapping.localPort}`)
        }
      }

      // Read deployment env vars from cluster and compute dev env for each target
      const envs = new Map<string, Record<string, string>>()
      const lookups = buildDependencyLookups(clusterServices, portForwardMappings)

      let envK8s: ReturnType<typeof createK8sClients> | undefined
      try {
        envK8s = createK8sClients(kubeContext)
      } catch {
        log('Warning: Could not create k8s clients for env resolution')
      }

      for (const ls of localServices) {
        let deploymentEnv: Record<string, string> = {}

        if (envK8s) {
          try {
            deploymentEnv = await resolveDeploymentEnv(
              envK8s,
              namespace,
              ls.service.name,
              (msg) => log(`Warning: ${msg}`)
            )
          } catch {
            log(`Warning: Could not read deployment env for '${ls.service.name}', using overrides only`)
          }
        }

        const computed = computeDevEnvVars(deploymentEnv, lookups, ls.devConfig.env)

        // Always set NODE_ENV
        computed.NODE_ENV = computed.NODE_ENV ?? 'development'

        envs.set(ls.service.name, computed)
      }

      // Start local dev servers
      const devServerNames = localServices.map(s => s.service.name).join(', ')
      log(`Starting dev servers: ${devServerNames}`)

      this.devServerHandles = runDevServers(
        localServices,
        envs,
        (serviceName, line) => {
          if (onOutput) {
            onOutput(`[${serviceName}] ${line}`)
          }
        }
      )

      return {
        success: true,
        stack: stackName,
        namespace,
        devServices: localServices,
        portForwards: portForwardMappings,
        devServerHandles: this.devServerHandles,
        portForwardHandles: this.portForwardHandles,
      }
    })
  }

  /**
   * Stop dev mode gracefully
   */
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true

    // Stop dev servers first
    stopDevServers(this.devServerHandles)

    // Then stop port-forwards
    stopPortForwards(this.portForwardHandles)

    // Wait a bit for graceful shutdown
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}
