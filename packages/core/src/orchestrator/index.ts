/**
 * Orchestrator
 *
 * Discovers services, builds dependency graph, builds images, runs pulumix.ts files.
 * Services are fully responsible for their own resources.
 *
 * Uses functional programming patterns with purify-ts for type-safe error handling.
 */

import * as path from 'path'
import * as fs from 'fs'
import { spawnSync } from 'child_process'
import glob from 'fast-glob'
import { EitherAsync } from 'purify-ts/EitherAsync'
import { Either, Left, Right } from 'purify-ts/Either'
import { Maybe, Just, Nothing } from 'purify-ts/Maybe'
import { createJiti } from 'jiti'
import * as yaml from 'yaml'
import { createDeploymentError, createBuildError, DeployError } from '../types/errors'
import { OrchestratorEventEmitter, createEventEmitter } from './events'
import {
  DiscoveredService,
  ResolvedService,
  ServiceContext,
  ServiceDeployFn
} from '../types/service'
import type { ServiceMetadata, ObservabilityConfig, SecurityConfig } from '../types/manifest'
import { LocalWorkspace } from '@pulumi/pulumi/automation'

// Create jiti instance for loading TypeScript files at runtime
const jiti = createJiti(__filename, {
  interopDefault: true
})

// ============================================================================
// Types
// ============================================================================

/**
 * Orchestrator config
 */
export interface OrchestratorConfig {
  readonly rootPath: string
  readonly stackName: string
  readonly servicesToDeploy?: readonly string[]
}

/**
 * Orchestrator result
 */
export interface OrchestratorResult {
  readonly success: boolean
  readonly stack: string
  readonly servicesDeployed: number
  readonly duration: number
  readonly outputs: Record<string, Record<string, unknown>>
}

/**
 * K3d configuration from pulumix.yaml
 */
interface K3dConfig {
  readonly enabled?: boolean
  readonly clusterName?: string
  readonly registryPort?: number
  readonly port?: number
  readonly hostRegistry?: string
  readonly clusterRegistry?: string
}

/**
 * Root configuration from pulumix.yaml
 */
interface RootConfig {
  readonly name?: string
  readonly stacks?: Record<string, Record<string, unknown>>
  readonly services?: {
    readonly allowed?: string[]
  }
}

// ============================================================================
// Pure Functions - YAML Parsing
// ============================================================================

/**
 * Validate that a value is a safe shell argument (no injection)
 */
const isValidShellArg = (value: string): boolean =>
  /^[a-zA-Z0-9_\-.:]+$/.test(value)

/**
 * Parse YAML file safely with Either
 */
const parseYamlFile = (filePath: string): Either<DeployError, Record<string, unknown>> => {
  try {
    if (!fs.existsSync(filePath)) {
      return Right({})
    }
    const content = fs.readFileSync(filePath, 'utf-8')
    const parsed = yaml.parse(content)
    return Right(parsed ?? {})
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Left(
      createDeploymentError(
        'ValidationFailed',
        `Failed to parse YAML file ${filePath}: ${message}`,
        undefined,
        { filePath }
      )
    )
  }
}

/**
 * Get value from config with Maybe
 */
const getConfigValue = <T>(
  config: Record<string, unknown>,
  key: string
): Maybe<T> =>
  config[key] !== undefined ? Just(config[key] as T) : Nothing

// ============================================================================
// Pure Functions - Service Discovery
// ============================================================================

/**
 * Parse service metadata from pulumix.yaml
 */
const parseServiceMetadata = (rawConfig: Record<string, unknown>, serviceName: string): ServiceMetadata => {
  const metadata = (rawConfig.metadata as Record<string, unknown>) ?? {}

  return {
    name: (metadata.name as string) ?? serviceName,
    version: (metadata.version as string) ?? '0.0.0',
    description: metadata.description as string | undefined,
    team: metadata.team as string | undefined,
    owner: metadata.owner as string | undefined,
    repository: metadata.repository as string | undefined,
    documentation: metadata.documentation as string | undefined,
    tags: metadata.tags as Record<string, string> | undefined,
    sla: metadata.sla as any,
    support: metadata.support as any,
    contract: metadata.contract as any
  }
}

/**
 * Extract service dependencies from package.json
 * Looks for local workspace dependencies (services in the same project)
 */
const extractDependenciesFromPackageJson = (
  packageJsonPath: string,
  allServiceNames: Set<string>
): string[] => {
  if (!fs.existsSync(packageJsonPath)) {
    return []
  }

  try {
    const content = fs.readFileSync(packageJsonPath, 'utf-8')
    const pkg = JSON.parse(content)
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }

    // Filter for local service dependencies
    // Match service names from the workspace
    return Object.keys(deps).filter(dep => {
      // Extract service name from package name (e.g., "@myapp/provider" -> "provider")
      const serviceName = dep.includes('/') ? dep.split('/').pop() : dep
      return serviceName && allServiceNames.has(serviceName)
    }).map(dep => {
      const serviceName = dep.includes('/') ? dep.split('/').pop() : dep
      return serviceName!
    })
  } catch {
    return []
  }
}

/**
 * Discover local services using glob auto-discovery
 * Finds all pulumix.ts + pulumix.yaml pairs anywhere in the project
 */
export const discoverServices = async (rootPath: string): Promise<Either<DeployError, readonly DiscoveredService[]>> => {
  try {
    // Find all pulumix.yaml files (exclude node_modules for local services)
    const yamlFiles = await glob('**/pulumix.yaml', {
      cwd: rootPath,
      ignore: ['node_modules/**', '.git/**', '**/dist/**', '**/build/**', '**/.pulumi/**'],
      absolute: false
    })

    const services: DiscoveredService[] = []
    const serviceNames = new Set<string>()

    // First pass: collect service names and validate pairs
    for (const yamlFile of yamlFiles) {
      const servicePath = path.join(rootPath, path.dirname(yamlFile))
      const deployPath = path.join(servicePath, 'pulumix.ts')

      // Both files must exist
      if (!fs.existsSync(deployPath)) {
        continue
      }

      const configPath = path.join(servicePath, 'pulumix.yaml')
      const configResult = parseYamlFile(configPath)
      if (configResult.isLeft()) {
        return configResult as Either<DeployError, never>
      }

      const rawConfig = configResult.unsafeCoerce()
      const metadata = parseServiceMetadata(rawConfig, path.basename(servicePath))

      serviceNames.add(metadata.name)
    }

    // Second pass: build full service info
    for (const yamlFile of yamlFiles) {
      const servicePath = path.join(rootPath, path.dirname(yamlFile))
      const deployPath = path.join(servicePath, 'pulumix.ts')

      if (!fs.existsSync(deployPath)) {
        continue
      }

      const configPath = path.join(servicePath, 'pulumix.yaml')
      const dockerPath = path.join(servicePath, 'Dockerfile')
      const packageJsonPath = path.join(servicePath, 'package.json')

      const configResult = parseYamlFile(configPath)
      if (configResult.isLeft()) {
        return configResult as Either<DeployError, never>
      }

      const rawConfig = configResult.unsafeCoerce()
      const metadata = parseServiceMetadata(rawConfig, path.basename(servicePath))
      const observability = rawConfig.observability as ObservabilityConfig | undefined
      const security = rawConfig.security as SecurityConfig | undefined

      // Read dependencies from package.json
      const dependencies = extractDependenciesFromPackageJson(packageJsonPath, serviceNames)

      services.push({
        name: metadata.name,
        path: servicePath,
        deployPath,
        configPath,
        dependencies,
        hasDockerfile: fs.existsSync(dockerPath),
        rawConfig,
        metadata,
        observability,
        security
      })
    }

    return Right(services)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Left(
      createDeploymentError(
        'ValidationFailed',
        `Failed to discover services: ${message}`,
        undefined,
        { rootPath }
      )
    )
  }
}

/**
 * Check if package name matches any allowlist pattern
 * Supports glob patterns like "@platform/*"
 */
const matchesAllowlist = (packageName: string, allowlist: string[]): boolean => {
  return allowlist.some(pattern => {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
      .replace(/\//g, '\\/')
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(packageName)
  })
}

/**
 * Discover published services from node_modules with allowlist filtering
 */
export const discoverPublishedServices = async (
  rootPath: string,
  allowlist: string[]
): Promise<Either<DeployError, readonly DiscoveredService[]>> => {
  try {
    const nodeModulesPath = path.join(rootPath, 'node_modules')

    if (!fs.existsSync(nodeModulesPath)) {
      return Right([])
    }

    // Find all pulumix.yaml files in node_modules
    const yamlFiles = await glob('**/pulumix.yaml', {
      cwd: nodeModulesPath,
      ignore: ['**/node_modules/**'],
      absolute: false
    })

    const services: DiscoveredService[] = []
    const serviceNames = new Set<string>()

    // First pass: collect service names and validate
    for (const yamlFile of yamlFiles) {
      const servicePath = path.join(nodeModulesPath, path.dirname(yamlFile))
      const deployPath = path.join(servicePath, 'pulumix.ts')

      // Both files must exist
      if (!fs.existsSync(deployPath)) {
        continue
      }

      // Get package name from path (e.g., @platform/postgres-service)
      const packageName = path.dirname(yamlFile).replace(/\\/g, '/')

      // Check allowlist
      if (!matchesAllowlist(packageName, allowlist)) {
        continue
      }

      const configPath = path.join(servicePath, 'pulumix.yaml')
      const configResult = parseYamlFile(configPath)
      if (configResult.isLeft()) {
        return configResult as Either<DeployError, never>
      }

      const rawConfig = configResult.unsafeCoerce()
      const metadata = parseServiceMetadata(rawConfig, path.basename(servicePath))

      serviceNames.add(metadata.name)
    }

    // Second pass: build full service info
    for (const yamlFile of yamlFiles) {
      const servicePath = path.join(nodeModulesPath, path.dirname(yamlFile))
      const deployPath = path.join(servicePath, 'pulumix.ts')

      if (!fs.existsSync(deployPath)) {
        continue
      }

      const packageName = path.dirname(yamlFile).replace(/\\/g, '/')

      if (!matchesAllowlist(packageName, allowlist)) {
        continue
      }

      const configPath = path.join(servicePath, 'pulumix.yaml')
      const dockerPath = path.join(servicePath, 'Dockerfile')
      const packageJsonPath = path.join(servicePath, 'package.json')

      const configResult = parseYamlFile(configPath)
      if (configResult.isLeft()) {
        return configResult as Either<DeployError, never>
      }

      const rawConfig = configResult.unsafeCoerce()
      const metadata = parseServiceMetadata(rawConfig, path.basename(servicePath))
      const observability = rawConfig.observability as ObservabilityConfig | undefined
      const security = rawConfig.security as SecurityConfig | undefined

      const dependencies = extractDependenciesFromPackageJson(packageJsonPath, serviceNames)

      services.push({
        name: metadata.name,
        path: servicePath,
        deployPath,
        configPath,
        dependencies,
        hasDockerfile: fs.existsSync(dockerPath),
        rawConfig,
        metadata,
        observability,
        security
      })
    }

    return Right(services)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Left(
      createDeploymentError(
        'ValidationFailed',
        `Failed to discover published services: ${message}`,
        undefined,
        { rootPath }
      )
    )
  }
}

/**
 * Topological sort for dependency order (pure function)
 */
export const sortByDependencies = (
  services: readonly DiscoveredService[]
): readonly DiscoveredService[] => {
  const sorted: DiscoveredService[] = []
  const visited = new Set<string>()
  const serviceMap = new Map(services.map(s => [s.name, s]))

  const visit = (name: string): void => {
    if (visited.has(name)) return
    visited.add(name)

    const service = serviceMap.get(name)
    if (!service) return

    for (const dep of service.dependencies) {
      visit(dep)
    }

    sorted.push(service)
  }

  for (const service of services) {
    visit(service.name)
  }

  return sorted
}

/**
 * Resolve stack-specific config for a service (pure function)
 */
export const resolveStackConfig = (
  service: DiscoveredService,
  stackName: string
): ResolvedService => {
  const stacks = getConfigValue<Record<string, unknown>>(service.rawConfig, 'stacks')
  const stackConfig = stacks
    .chain(s => getConfigValue<Record<string, unknown>>(s, stackName))
    .orDefault({})

  return {
    ...service,
    stackConfig
  }
}

/**
 * Filter services by names (pure function)
 */
const filterServices = (
  services: readonly DiscoveredService[],
  names?: readonly string[]
): readonly DiscoveredService[] =>
  names?.length
    ? services.filter(s => names.includes(s.name))
    : services

// ============================================================================
// Effects - Shell Commands (with validation)
// ============================================================================

/**
 * Run a shell command safely with spawn
 */
const runCommand = (
  command: string,
  args: readonly string[],
  options?: { stdio?: 'pipe' | 'inherit'; cwd?: string }
): Either<DeployError, string> => {
  const result = spawnSync(command, args as string[], {
    stdio: options?.stdio ?? 'pipe',
    cwd: options?.cwd,
    encoding: 'utf-8'
  })

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? ''
    const stdout = result.stdout?.toString() ?? ''
    return Left(
      createDeploymentError(
        'PulumiFailed',
        `Command failed: ${command} ${args.join(' ')}\n${stderr || stdout}`,
        undefined,
        { exitCode: result.status }
      )
    )
  }

  return Right(result.stdout?.toString() ?? '')
}

/**
 * Check if k3d cluster exists
 */
const clusterExists = (clusterName: string): boolean => {
  if (!isValidShellArg(clusterName)) {
    return false
  }

  const result = spawnSync('k3d', ['cluster', 'list', '-o', 'json'], {
    encoding: 'utf-8',
    stdio: 'pipe'
  })

  if (result.status !== 0) {
    return false
  }

  try {
    const clusters = JSON.parse(result.stdout)
    return clusters.some((c: { name: string }) => c.name === clusterName)
  } catch {
    return false
  }
}

/**
 * Create k3d cluster with registry
 */
const createK3dCluster = (
  clusterName: string,
  registryPort: number,
  port: number
): Either<DeployError, void> => {
  // Validate inputs to prevent command injection
  if (!isValidShellArg(clusterName)) {
    return Left(
      createDeploymentError(
        'ValidationFailed',
        `Invalid cluster name: ${clusterName}. Must contain only alphanumeric characters, hyphens, underscores, and periods.`
      )
    )
  }

  if (registryPort < 1 || registryPort > 65535) {
    return Left(
      createDeploymentError(
        'ValidationFailed',
        `Invalid registry port: ${registryPort}`
      )
    )
  }

  const args = [
    'cluster', 'create', clusterName,
    '--registry-create', `${clusterName}-registry:0.0.0.0:${registryPort}`,
    '--port', `${port}:80@loadbalancer`,
    '--agents', '2',
    '--wait'
  ]

  return runCommand('k3d', args, { stdio: 'inherit' }).map(() => undefined)
}

// ============================================================================
// Effects - Docker Build
// ============================================================================

/**
 * Build and push Docker image for a service
 */
const buildAndPushImage = (
  service: DiscoveredService,
  registry: string,
  eventEmitter: OrchestratorEventEmitter
): Either<DeployError, string | undefined> => {
  if (!service.hasDockerfile) {
    return Right(undefined)
  }

  // Validate registry to prevent injection
  if (!isValidShellArg(registry)) {
    return Left(
      createBuildError(
        'DockerBuildFailed',
        `Invalid registry name: ${registry}`,
        service.name
      )
    )
  }

  if (!isValidShellArg(service.name)) {
    return Left(
      createBuildError(
        'DockerBuildFailed',
        `Invalid service name: ${service.name}`,
        service.name
      )
    )
  }

  const imageTag = `${registry}/${service.name}:latest`

  eventEmitter.emitLog('info', `Building ${service.name}...`, undefined, 'Build')

  // Build the image
  const buildResult = runCommand('docker', ['build', '-t', imageTag, service.path])
  if (buildResult.isLeft()) {
    const error = buildResult.extract() as DeployError
    eventEmitter.emitLog('warn', `Failed to build ${service.name}: ${error.message}`, undefined, 'Build')
    return Left(
      createBuildError(
        'DockerBuildFailed',
        error.message,
        service.name
      )
    )
  }

  eventEmitter.emitLog('info', `Pushing ${service.name}...`, undefined, 'Build')

  // Push to registry
  const pushResult = runCommand('docker', ['push', imageTag])
  if (pushResult.isLeft()) {
    const error = pushResult.extract() as DeployError
    eventEmitter.emitLog('warn', `Failed to push ${service.name}: ${error.message}`, undefined, 'Build')
    return Left(
      createBuildError(
        'DockerPushFailed',
        error.message,
        service.name
      )
    )
  }

  eventEmitter.emitLog('info', `✓ ${service.name} → ${imageTag}`, undefined, 'Build')

  return Right(imageTag)
}

// ============================================================================
// Effects - Dynamic Import
// ============================================================================

/**
 * Load and validate deploy function from a service
 */
const loadDeployFunction = async (
  service: DiscoveredService
): Promise<Either<DeployError, ServiceDeployFn>> => {
  try {
    const deployModule = await jiti.import(service.deployPath)
    const deployFn = (deployModule as { default?: unknown }).default ?? deployModule

    if (typeof deployFn !== 'function') {
      return Left(
        createDeploymentError(
          'ValidationFailed',
          `${service.deployPath} must export a default function`,
          undefined,
          { serviceName: service.name }
        )
      )
    }

    return Right(deployFn as ServiceDeployFn)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Left(
      createDeploymentError(
        'ValidationFailed',
        `Failed to load deploy function from ${service.name}: ${message}`,
        undefined,
        { serviceName: service.name, deployPath: service.deployPath }
      )
    )
  }
}

// ============================================================================
// Orchestrator Class
// ============================================================================

/**
 * Orchestrator class
 */
export class Orchestrator {
  private readonly eventEmitter: OrchestratorEventEmitter

  constructor(eventEmitter?: OrchestratorEventEmitter) {
    this.eventEmitter = eventEmitter ?? createEventEmitter()
  }

  getEventEmitter(): OrchestratorEventEmitter {
    return this.eventEmitter
  }

  /**
   * Validate environment for deployment
   */
  private validateEnvironment(stackName: string): Either<DeployError, void> {
    // Check passphrase for production
    if (stackName === 'production' && !process.env.PULUMI_CONFIG_PASSPHRASE) {
      return Left(
        createDeploymentError(
          'ValidationFailed',
          'PULUMI_CONFIG_PASSPHRASE environment variable is required for production deployments'
        )
      )
    }

    // Set empty passphrase for local development
    if (!process.env.PULUMI_CONFIG_PASSPHRASE) {
      process.env.PULUMI_CONFIG_PASSPHRASE = ''
    }

    return Right(undefined)
  }

  /**
   * Deploy all services
   */
  deploy(config: OrchestratorConfig): EitherAsync<DeployError, OrchestratorResult> {
    const startTime = Date.now()

    return EitherAsync(async ({ liftEither, throwE }) => {
      // Validate environment
      await liftEither(this.validateEnvironment(config.stackName))

      // Phase 1: Load root config
      this.eventEmitter.emitPhaseStart('configuration')
      const rootConfigPath = path.join(config.rootPath, 'pulumix.yaml')
      const rootConfig = await liftEither(parseYamlFile(rootConfigPath)) as RootConfig
      const stacks = rootConfig.stacks ?? {}
      const globalConfig = (stacks[config.stackName] as Record<string, unknown>) ?? {}

      this.eventEmitter.emitLog('info', `Project: ${rootConfig.name ?? 'unnamed'}`, undefined, 'Configuration')
      this.eventEmitter.emitLog('info', `Stack: ${config.stackName}`, undefined, 'Configuration')
      this.eventEmitter.emitPhaseComplete('configuration')

      // Phase 2: Discover services
      this.eventEmitter.emitPhaseStart('discovery')

      // Discover local services
      const localServices = await liftEither(await discoverServices(config.rootPath))
      this.eventEmitter.emitLog('info', `Found ${localServices.length} local service(s)`, undefined, 'Discovery')

      // Discover published services (from node_modules)
      const allowlist = rootConfig.services?.allowed ?? []
      const publishedServices = await liftEither(await discoverPublishedServices(config.rootPath, allowlist))
      this.eventEmitter.emitLog('info', `Found ${publishedServices.length} published service(s)`, undefined, 'Discovery')

      // Merge services (local overrides published if name conflicts)
      const localServiceNames = new Set(localServices.map(s => s.name))
      const mergedServices = [
        ...localServices,
        ...publishedServices.filter(s => !localServiceNames.has(s.name))
      ]

      const services = filterServices(mergedServices, config.servicesToDeploy)

      for (const service of services) {
        const source = localServiceNames.has(service.name) ? 'local' : 'published'
        this.eventEmitter.emitLog('info', `${service.name} (${source})`, undefined, 'Discovery')
      }
      this.eventEmitter.emitPhaseComplete('discovery')

      // Phase 3: Sort by dependencies
      this.eventEmitter.emitPhaseStart('dependency-analysis')
      const sorted = sortByDependencies(services)

      for (let i = 0; i < sorted.length; i++) {
        const service = sorted[i]
        const isLast = i === sorted.length - 1
        const prefix = isLast ? '└─' : '├─'
        const deps = service.dependencies.length > 0
          ? ` (requires: ${service.dependencies.join(', ')})`
          : ''
        this.eventEmitter.emitLog('info', `${prefix} ${service.name}${deps}`, undefined, 'DependencyGraph')
      }
      this.eventEmitter.emitPhaseComplete('dependency-analysis')

      // Get registry config from provider service
      const providerService = sorted.find(s => s.name === 'provider')
      const providerConfig = providerService
        ? resolveStackConfig(providerService, config.stackName).stackConfig
        : {}
      const k3dConfig = getConfigValue<K3dConfig>(providerConfig, 'k3d').orDefault({})

      // Host registry for building/pushing (Docker on host)
      const hostRegistry =
        getConfigValue<string>(globalConfig, 'hostRegistry').orDefault('') ||
        k3dConfig.hostRegistry ||
        (k3dConfig.registryPort ? `localhost:${k3dConfig.registryPort}` : 'localhost:5001')

      // Cluster registry for k8s to pull from (internal network)
      const clusterRegistry =
        getConfigValue<string>(globalConfig, 'clusterRegistry').orDefault('') ||
        k3dConfig.clusterRegistry ||
        hostRegistry

      // Phase 4: Bootstrap - ensure cluster/registry exist before building
      const servicesToBuild = sorted.filter(s => s.hasDockerfile)

      if (servicesToBuild.length > 0 && k3dConfig.enabled) {
        this.eventEmitter.emitPhaseStart('bootstrap')

        const clusterName = k3dConfig.clusterName ?? 'pulumix-dev'
        const port = k3dConfig.port ?? 80
        const registryPort = k3dConfig.registryPort ?? 5001

        if (clusterExists(clusterName)) {
          this.eventEmitter.emitLog('info', `Cluster '${clusterName}' ready`, undefined, 'Bootstrap')
        } else {
          this.eventEmitter.emitLog('info', `Creating cluster '${clusterName}'...`, undefined, 'Bootstrap')
          const createResult = createK3dCluster(clusterName, registryPort, port)
          if (createResult.isLeft()) {
            throw throwE(createResult.extract() as DeployError)
          }
          this.eventEmitter.emitLog('info', `Cluster '${clusterName}' created`, undefined, 'Bootstrap')
        }

        this.eventEmitter.emitPhaseComplete('bootstrap')
      }

      // Phase 5: Build Docker images
      const builtImages: Record<string, string> = {}

      if (servicesToBuild.length > 0) {
        this.eventEmitter.emitPhaseStart('image-build')

        for (const service of servicesToBuild) {
          const buildResult = buildAndPushImage(service, hostRegistry, this.eventEmitter)

          if (buildResult.isLeft()) {
            // Log warning but continue - some services might not need images
            const error = buildResult.extract() as DeployError
            this.eventEmitter.emitLog('warn', error.message, undefined, 'Build')
          } else {
            const imageTag = buildResult.unsafeCoerce()
            if (imageTag) {
              // Store cluster registry URL for k8s deployment
              builtImages[service.name] = `${clusterRegistry}/${service.name}:latest`
            }
          }
        }

        this.eventEmitter.emitPhaseComplete('image-build')
      }

      // Phase 6: Run Pulumi deployment
      this.eventEmitter.emitPhaseStart('deployment')

      const namespace = getConfigValue<string>(globalConfig, 'namespace').orDefault(config.stackName)
      const outputs: Record<string, Record<string, unknown>> = {}

      // Create Pulumi program that runs all services
      const program = async (): Promise<void> => {
        for (const service of sorted) {
          const resolved = resolveStackConfig(service, config.stackName)

          const ctx: ServiceContext = {
            stackName: config.stackName,
            serviceName: service.name,
            metadata: service.metadata,
            observability: service.observability,
            security: service.security,
            config: resolved.stackConfig,
            globalConfig,
            namespace,
            dependencies: outputs,
            image: builtImages[service.name]
          }

          // Load and execute deploy function
          const deployFnResult = await loadDeployFunction(service)
          if (deployFnResult.isLeft()) {
            throw deployFnResult.extract()
          }

          const deployFn = deployFnResult.unsafeCoerce()
          const result = await deployFn(ctx)

          if (result?.outputs) {
            outputs[service.name] = result.outputs
          }
        }
      }

      // Use Pulumi Automation API
      const pulumiDir = path.join(config.rootPath, '.pulumi')
      if (!fs.existsSync(pulumiDir)) {
        fs.mkdirSync(pulumiDir, { recursive: true })
      }

      const projectName = rootConfig.name ?? 'pulumix-project'

      const stack = await LocalWorkspace.createOrSelectStack(
        {
          stackName: config.stackName,
          projectName,
          program
        },
        {
          workDir: pulumiDir,
          projectSettings: {
            name: projectName,
            runtime: 'nodejs' as const,
            backend: { url: `file://${pulumiDir}` }
          }
        }
      )

      await stack.up({
        onOutput: (output) => {
          this.eventEmitter.emitLog('info', output, undefined, 'Deploy')
        }
      })

      this.eventEmitter.emitPhaseComplete('deployment')

      // Retrieve Pulumi stack outputs (resource outputs)
      const stackOutputs = await stack.outputs()

      // Merge Pulumi resource outputs with our service outputs
      const allOutputs = {
        ...outputs, // Our custom service outputs
        _stack: Object.fromEntries(
          Object.entries(stackOutputs).map(([k, v]) => [k, v.value])
        )
      }

      return {
        success: true,
        stack: config.stackName,
        servicesDeployed: sorted.length,
        duration: Date.now() - startTime,
        outputs: allOutputs
      }
    })
  }

  /**
   * Destroy all services
   */
  destroy(config: OrchestratorConfig): EitherAsync<DeployError, OrchestratorResult> {
    const startTime = Date.now()

    return EitherAsync(async ({ liftEither }) => {
      // Validate environment
      await liftEither(this.validateEnvironment(config.stackName))

      // Load root config
      const rootConfigPath = path.join(config.rootPath, 'pulumix.yaml')
      const rootConfig = await liftEither(parseYamlFile(rootConfigPath)) as RootConfig

      const pulumiDir = path.join(config.rootPath, '.pulumi')
      const projectName = rootConfig.name ?? 'pulumix-project'

      // Create empty program for destroy
      const program = async (): Promise<void> => {
        // Empty - Pulumi will destroy existing resources
      }

      const stack = await LocalWorkspace.createOrSelectStack(
        {
          stackName: config.stackName,
          projectName,
          program
        },
        {
          workDir: pulumiDir,
          projectSettings: {
            name: projectName,
            runtime: 'nodejs' as const,
            backend: { url: `file://${pulumiDir}` }
          }
        }
      )

      await stack.destroy({
        onOutput: (output) => {
          this.eventEmitter.emitLog('info', output, undefined, 'Deploy')
        }
      })

      return {
        success: true,
        stack: config.stackName,
        servicesDeployed: 0,
        duration: Date.now() - startTime,
        outputs: {}
      }
    })
  }
}

/**
 * Create a new orchestrator instance
 */
export const createOrchestrator = (eventEmitter?: OrchestratorEventEmitter): Orchestrator =>
  new Orchestrator(eventEmitter)
