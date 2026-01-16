/**
 * DevOrchestrator - Local development with HMR
 *
 * Runs specified services locally with HMR while deploying
 * dependencies to the cluster.
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
import { OrchestratorEventEmitter, createEventEmitter } from '../orchestrator/events'
import {
  DevConfig,
  DevExposeConfig,
  DevOrchestratorConfig,
  DevOrchestratorResult,
  LocalDevService,
  PortForwardMapping,
  PortForwardHandle,
  DevServerHandle,
  ServiceSwapHandle,
  DEV_SERVER_PORT_BASE,
  HTTP_PORT_BASE,
  STANDARD_PORTS,
} from './types'
import { checkKubectl, startPortForwards, stopPortForwards } from './port-forward'
import { runDevServers, stopDevServers } from './local-runner'
import { buildAllDevEnvironments, getServiceProtocol, isDatabaseService, serviceToEnvVar } from './env-builder'
import {
  swapServiceToLocal,
  restoreFromStaleState,
  loadDevState,
} from './service-swap'

export * from './types'
export * from './port-forward'
export * from './local-runner'
export * from './env-builder'
export * from './service-swap'

/**
 * Validation error for dev config
 */
export class DevConfigValidationError extends Error {
  constructor(serviceName: string, field: string, message: string) {
    super(`Invalid dev config for '${serviceName}': ${field} ${message}`)
    this.name = 'DevConfigValidationError'
  }
}

/**
 * Extract and validate dev config from service's raw config
 */
function getDevConfig(service: DiscoveredService): DevConfig | undefined {
  const dev = service.rawConfig.dev as Record<string, unknown> | undefined
  if (!dev) return undefined

  // Validate command if provided (now optional)
  let command: string | undefined
  if (dev.command !== undefined) {
    if (typeof dev.command !== 'string' || dev.command.trim() === '') {
      throw new DevConfigValidationError(
        service.name,
        'command',
        'must be a non-empty string'
      )
    }
    command = dev.command
  }

  // Validate port if provided
  let port: number | undefined
  if (dev.port !== undefined) {
    if (typeof dev.port !== 'number' || !Number.isInteger(dev.port)) {
      throw new DevConfigValidationError(
        service.name,
        'port',
        'must be an integer'
      )
    }
    if (dev.port < 1 || dev.port > 65535) {
      throw new DevConfigValidationError(
        service.name,
        'port',
        'must be between 1 and 65535'
      )
    }
    port = dev.port
  }

  // Validate cwd if provided
  if (dev.cwd !== undefined && typeof dev.cwd !== 'string') {
    throw new DevConfigValidationError(
      service.name,
      'cwd',
      'must be a string'
    )
  }

  // Validate env if provided
  if (dev.env !== undefined) {
    if (typeof dev.env !== 'object' || dev.env === null || Array.isArray(dev.env)) {
      throw new DevConfigValidationError(
        service.name,
        'env',
        'must be an object'
      )
    }
    for (const [key, value] of Object.entries(dev.env)) {
      if (typeof value !== 'string') {
        throw new DevConfigValidationError(
          service.name,
          `env.${key}`,
          'must be a string'
        )
      }
    }
  }

  // Validate expose if provided
  let expose: DevExposeConfig | undefined
  if (dev.expose !== undefined) {
    const exp = dev.expose as Record<string, unknown>

    // Validate port (required for expose)
    if (typeof exp.port !== 'number' || !Number.isInteger(exp.port)) {
      throw new DevConfigValidationError(
        service.name,
        'expose.port',
        'must be an integer'
      )
    }
    if (exp.port < 1 || exp.port > 65535) {
      throw new DevConfigValidationError(
        service.name,
        'expose.port',
        'must be between 1 and 65535'
      )
    }

    // Validate protocol if provided
    if (exp.protocol !== undefined && typeof exp.protocol !== 'string') {
      throw new DevConfigValidationError(
        service.name,
        'expose.protocol',
        'must be a string'
      )
    }

    // Validate envVar if provided
    if (exp.envVar !== undefined) {
      if (typeof exp.envVar !== 'string') {
        throw new DevConfigValidationError(
          service.name,
          'expose.envVar',
          'must be a string'
        )
      }
      if (!/^[A-Z][A-Z0-9_]*$/.test(exp.envVar)) {
        throw new DevConfigValidationError(
          service.name,
          'expose.envVar',
          'must be uppercase with underscores (e.g., DATABASE_URL)'
        )
      }
    }

    expose = {
      port: exp.port,
      protocol: exp.protocol as string | undefined,
      envVar: exp.envVar as string | undefined,
    }
  }

  // Must have at least command or expose
  if (!command && !expose) {
    throw new DevConfigValidationError(
      service.name,
      'dev',
      'must have either command or expose'
    )
  }

  return {
    command,
    port,
    env: dev.env as Record<string, string> | undefined,
    cwd: dev.cwd as string | undefined,
    expose,
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
 * Check if a service has running pods (indicated by observability config)
 * Infrastructure-only services (like provider, ingress) don't have observability
 */
function hasRunningPods(service: DiscoveredService): boolean {
  const observability = service.rawConfig.observability as Record<string, unknown> | undefined
  return observability?.health !== undefined
}

/**
 * Compute port-forward mappings for cluster services
 * Only includes services that have running pods (not infrastructure-only)
 * Uses dev.expose config if available, otherwise falls back to inference
 */
function computePortForwardMappings(
  clusterServices: DiscoveredService[],
  namespace: string
): PortForwardMapping[] {
  const mappings: PortForwardMapping[] = []
  let httpPortCounter = HTTP_PORT_BASE

  for (const service of clusterServices) {
    // Skip infrastructure-only services (no running pods)
    if (!hasRunningPods(service)) {
      continue
    }

    // Try to get expose config from service's dev section
    const devConfig = getDevConfig(service)
    const expose = devConfig?.expose

    if (expose) {
      // Use explicit expose configuration
      mappings.push({
        serviceName: service.name,
        namespace,
        remotePort: expose.port,
        localPort: expose.port, // Use same port locally for simplicity
        envVar: expose.envVar || serviceToEnvVar(service.name),
        protocol: expose.protocol || 'http',
      })
    } else {
      // Fall back to inference based on service name
      const serviceName = service.name.toLowerCase()
      const protocol = getServiceProtocol(serviceName)

      if (isDatabaseService(serviceName)) {
        const standardPort = Object.entries(STANDARD_PORTS).find(
          ([key]) => serviceName.includes(key)
        )?.[1] ?? 80

        mappings.push({
          serviceName: service.name,
          namespace,
          remotePort: standardPort,
          localPort: standardPort,
          envVar: serviceToEnvVar(service.name),
          protocol,
        })
      } else {
        // HTTP services get auto-assigned ports starting at HTTP_PORT_BASE
        mappings.push({
          serviceName: service.name,
          namespace,
          remotePort: 80, // All HTTP services expose port 80
          localPort: httpPortCounter++,
          envVar: serviceToEnvVar(service.name),
          protocol: 'http',
        })
      }
    }
  }

  return mappings
}

/**
 * DevOrchestrator class
 */
export class DevOrchestrator {
  private readonly eventEmitter: OrchestratorEventEmitter
  private portForwardHandles: PortForwardHandle[] = []
  private devServerHandles: DevServerHandle[] = []
  private serviceSwapHandles: ServiceSwapHandle[] = []
  private stopped = false

  constructor(eventEmitter?: OrchestratorEventEmitter) {
    this.eventEmitter = eventEmitter ?? createEventEmitter()
  }

  /**
   * Start dev mode
   */
  dev(config: DevOrchestratorConfig): EitherAsync<DeployError, DevOrchestratorResult> {
    return EitherAsync(async ({ liftEither, throwE }) => {
      const { rootPath, stackName, devServices: devServiceNames, onOutput } = config

      // Check kubectl is available
      await liftEither(await checkKubectl())

      // Check for stale state from previous crash and restore
      const staleState = loadDevState(rootPath)
      if (staleState) {
        this.eventEmitter.emitLog('info', 'Cleaning up from previous dev session...')
        await restoreFromStaleState(rootPath)
      }

      // Phase 1: Discover services
      this.eventEmitter.emitPhaseStart('discovery')
      const allServices = await liftEither(await discoverServices(rootPath))
      this.eventEmitter.emitPhaseComplete('discovery')

      // Validate dev services exist
      const serviceMap = new Map(allServices.map(s => [s.name, s]))
      const devServices: DiscoveredService[] = []

      for (const name of devServiceNames) {
        const service = serviceMap.get(name)
        if (!service) {
          return throwE(createDiscoveryError(
            'RootConfigNotFound',
            `Service '${name}' not found. Available services: ${allServices.map(s => s.name).join(', ')}`,
            rootPath
          ))
        }
        devServices.push(service)
      }

      // Validate dev services have dev config
      const localServices: LocalDevService[] = []
      let devPortCounter = DEV_SERVER_PORT_BASE

      for (const service of devServices) {
        const devConfig = getDevConfig(service)
        if (!devConfig || !devConfig.command) {
          return throwE(createConfigError(
            'MissingRequiredField',
            `Service '${service.name}' cannot run locally - missing 'dev.command' in pulumix.yaml. Add:\n\ndev:\n  command: npm run dev\n  port: 3000`,
            stackName,
            'dev.command'
          ))
        }

        localServices.push({
          service,
          devConfig,
          localPort: devConfig.port || devPortCounter++,
        })
      }

      // Check for port conflicts among dev services
      const portToService = new Map<number, string>()
      for (const ls of localServices) {
        const existing = portToService.get(ls.localPort)
        if (existing) {
          return throwE(createConfigError(
            'InvalidConfigFormat',
            `Port conflict: '${ls.service.name}' and '${existing}' both use port ${ls.localPort}. ` +
            `Configure different ports in each service's dev.port setting.`,
            stackName,
            'dev.port'
          ))
        }
        portToService.set(ls.localPort, ls.service.name)
      }

      // Compute cluster services (transitive deps minus dev services)
      const devServiceNamesSet = new Set(devServiceNames)
      const transitiveDeps = computeTransitiveDependencies(allServices, devServiceNames)
      const clusterServiceNames = [...transitiveDeps].filter(name => !devServiceNamesSet.has(name))
      const clusterServices = clusterServiceNames
        .map(name => serviceMap.get(name))
        .filter((s): s is DiscoveredService => s !== undefined)

      // Read namespace and baseDomain from root config
      const rootConfigPath = `${rootPath}/pulumix.yaml`
      let namespace = stackName
      let baseDomain: string | undefined

      try {
        const rootConfigContent = fs.readFileSync(rootConfigPath, 'utf-8')
        const rootConfig = yaml.parse(rootConfigContent) as Record<string, unknown>
        const stacks = rootConfig.stacks as Record<string, Record<string, unknown>> | undefined
        if (stacks?.[stackName]?.namespace) {
          namespace = stacks[stackName].namespace as string
        }
        if (stacks?.[stackName]?.baseDomain) {
          baseDomain = stacks[stackName].baseDomain as string
        }
      } catch {
        // Fall back to stack name if root config can't be read
      }

      // Try to get baseDomain from dev service config if not in root
      if (!baseDomain && localServices.length > 0) {
        const firstService = localServices[0].service
        const stacks = firstService.rawConfig.stacks as Record<string, Record<string, unknown>> | undefined
        const stackConfig = stacks?.[stackName]
        if (stackConfig?.baseDomain) {
          baseDomain = stackConfig.baseDomain as string
        }
      }

      // Log cluster services that should be running
      if (clusterServices.length > 0) {
        this.eventEmitter.emitLog('info', `Cluster services (should already be deployed): ${clusterServiceNames.join(', ')}`)
        this.eventEmitter.emitLog('info', `Run 'pulumix deploy ${stackName}' first if not already deployed`)
      }

      // Port-forwards (if any cluster services need them)
      const portForwardMappings = computePortForwardMappings(clusterServices, namespace)

      if (portForwardMappings.length > 0) {
        this.eventEmitter.emitTaskStart('port-forward', 'Setting up port-forwards...')

        const pfResult = await startPortForwards(portForwardMappings)
        if (pfResult.isLeft()) {
          this.eventEmitter.emitTaskComplete('port-forward', false)
          return throwE(pfResult.extract() as DeployError)
        }
        this.portForwardHandles = pfResult.extract() as PortForwardHandle[]

        this.eventEmitter.emitTaskComplete('port-forward', true)
      }

      // Phase 4: Build environment variables
      const envs = buildAllDevEnvironments(localServices, portForwardMappings)

      // Start local dev servers
      const devServerNames = localServices.map(s => s.service.name).join(', ')
      this.eventEmitter.emitTaskStart('dev-server', `Starting ${devServerNames}...`)

      this.devServerHandles = runDevServers(
        localServices,
        envs,
        (serviceName, line) => {
          // Prefix output with service name
          if (onOutput) {
            onOutput(`[${serviceName}] ${line}`)
          }
        }
      )

      this.eventEmitter.emitTaskComplete('dev-server', true)

      // Swap cluster services to point to local dev servers
      const ingressUrls: string[] = []

      if (baseDomain) {
        for (const localService of localServices) {
          // Only swap services that have running pods (not infrastructure)
          if (!hasRunningPods(localService.service)) {
            continue
          }

          const taskId = `swap-${localService.service.name}`
          this.eventEmitter.emitTaskStart(taskId, `Swapping ${localService.service.name} to local...`)

          const swapResult = await swapServiceToLocal(
            localService.service.name,
            namespace,
            localService.localPort,
            rootPath
          )

          if (swapResult.isLeft()) {
            // Log warning but continue - swap is optional enhancement
            this.eventEmitter.emitTaskComplete(taskId, false, true) // skipped=true
          } else {
            this.serviceSwapHandles.push(swapResult.extract() as ServiceSwapHandle)
            const ingressUrl = `http://${localService.service.name}.${baseDomain}`
            ingressUrls.push(ingressUrl)
            this.eventEmitter.emitTaskComplete(taskId, true)
          }
        }
      }

      return {
        success: true,
        stack: stackName,
        namespace,
        baseDomain,
        devServices: localServices,
        portForwards: portForwardMappings,
        devServerHandles: this.devServerHandles,
        portForwardHandles: this.portForwardHandles,
        serviceSwapHandles: this.serviceSwapHandles,
        ingressUrls,
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

    // Restore service swaps (scale up, restore selector)
    for (const handle of this.serviceSwapHandles) {
      try {
        await handle.restore()
      } catch (err) {
        console.error(`Failed to restore ${handle.serviceName}:`, err)
      }
    }

    // Then stop port-forwards
    stopPortForwards(this.portForwardHandles)

    // Wait a bit for graceful shutdown
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}
