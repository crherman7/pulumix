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
import {
  createDeploymentError,
  createDiscoveryError,
  createConfigError,
  DeployError
} from '../types/errors'
import { validateServiceManifest } from '../validation/manifest'
import { OrchestratorEventEmitter, createEventEmitter } from './events'
import {
  DiscoveredService,
  ResolvedService,
  ServiceContext,
  ServiceDeployFn
} from '../types/service'
import type {
  ServiceMetadata,
  ObservabilityConfig,
  SecurityConfig,
  BackendConfig,
  ProjectConfig
} from '../types/manifest'
import { LocalWorkspace } from '@pulumi/pulumi/automation'
import {
  buildImage,
  pushImage,
  hashBuildContext,
  imageExistsInRegistry,
  getImageDigestFromRegistry
} from '../docker'

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
  /** Optional callback for Pulumi output - pass your logger function here */
  readonly onOutput?: (message: string) => void
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
 * Default backend configuration - local file-based in dist/
 */
const DEFAULT_BACKEND: BackendConfig = {
  type: 'file',
  path: 'dist/'
}

/**
 * Resolve the backend URL for Pulumi from the configuration.
 *
 * Priority: stack-level backend > project-level backend > default (file://dist/)
 */
const resolveBackendUrl = (
  rootPath: string,
  projectConfig: ProjectConfig,
  stackName: string
): string => {
  // Get stack-specific config
  const stackConfig = projectConfig.stacks?.[stackName]

  // Resolve backend: stack override > project default > hardcoded default
  const backend: BackendConfig =
    stackConfig?.backend ?? projectConfig.backend ?? DEFAULT_BACKEND

  switch (backend.type) {
    case 'file': {
      const backendPath = backend.path ?? 'dist/'
      const absolutePath = path.isAbsolute(backendPath)
        ? backendPath
        : path.join(rootPath, backendPath)
      return `file://${absolutePath}`
    }

    case 's3': {
      const prefix = backend.prefix ? `/${backend.prefix.replace(/^\//, '')}` : ''
      const region = backend.region ? `?region=${backend.region}` : ''
      return `s3://${backend.bucket}${prefix}${region}`
    }

    case 'gcs': {
      const prefix = backend.prefix ? `/${backend.prefix.replace(/^\//, '')}` : ''
      return `gs://${backend.bucket}${prefix}`
    }

    case 'azblob': {
      const prefix = backend.prefix ? `/${backend.prefix.replace(/^\//, '')}` : ''
      return `azblob://${backend.container}${prefix}`
    }

    case 'pulumi': {
      // Pulumi Cloud backend
      if (backend.org) {
        return `https://app.pulumi.com/${backend.org}`
      }
      // Default Pulumi Cloud (uses PULUMI_ACCESS_TOKEN org)
      return 'https://app.pulumi.com'
    }

    default: {
      // Fallback to file backend
      const defaultPath = path.join(rootPath, 'dist/')
      return `file://${defaultPath}`
    }
  }
}

/**
 * Get the working directory for Pulumi based on backend type.
 *
 * For file backends, this is the backend path itself.
 * For cloud backends, we use a local .pulumi directory for workspace files.
 */
const resolveWorkDir = (
  rootPath: string,
  projectConfig: ProjectConfig,
  stackName: string
): string => {
  const stackConfig = projectConfig.stacks?.[stackName]
  const backend: BackendConfig =
    stackConfig?.backend ?? projectConfig.backend ?? DEFAULT_BACKEND

  if (backend.type === 'file') {
    const backendPath = backend.path ?? 'dist/'
    return path.isAbsolute(backendPath)
      ? backendPath
      : path.join(rootPath, backendPath)
  }

  // For cloud backends, use dist/ for local workspace files
  return path.join(rootPath, 'dist/')
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
      createDiscoveryError(
        'InvalidYaml',
        `Failed to parse YAML file ${filePath}: ${message}`,
        filePath,
        { filePath, parseError: message },
        err instanceof Error ? err : undefined
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

      // Validate manifest against schema
      const validationResult = validateServiceManifest(rawConfig, configPath)
      if (validationResult.isLeft()) {
        return validationResult as Either<DeployError, never>
      }

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
      createDiscoveryError(
        'InvalidGlobPattern',
        `Failed to discover services: ${message}`,
        rootPath,
        { rootPath },
        err instanceof Error ? err : undefined
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

      // Validate manifest against schema
      const validationResult = validateServiceManifest(rawConfig, configPath)
      if (validationResult.isLeft()) {
        return validationResult as Either<DeployError, never>
      }

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
      createDiscoveryError(
        'InvalidGlobPattern',
        `Failed to discover published services: ${message}`,
        rootPath,
        { rootPath, allowlist },
        err instanceof Error ? err : undefined
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
 * Run command with streaming progress updates (async)
 */
const runCommandWithProgress = (
  command: string,
  args: readonly string[],
  onProgress: (line: string) => void,
  options?: { cwd?: string }
): Promise<Either<DeployError, string>> => {
  return new Promise((resolve) => {
    const { spawn } = require('child_process')
    const proc = spawn(command, args as string[], {
      cwd: options?.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    // Stream stdout line by line
    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString()
      stdout += text

      const lines = text.split('\n')
      for (const line of lines) {
        if (line.trim()) {
          onProgress(line.trim())
        }
      }
    })

    // Capture stderr
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('close', (code: number) => {
      if (code !== 0) {
        resolve(Left(
          createDeploymentError(
            'PulumiFailed',
            `Command failed: ${command} ${args.join(' ')}\n${stderr || stdout}`,
            undefined,
            { exitCode: code }
          )
        ))
      } else {
        resolve(Right(stdout))
      }
    })

    proc.on('error', (err: Error) => {
      resolve(Left(
        createDeploymentError(
          'PulumiFailed',
          `Command error: ${command} ${args.join(' ')}\n${err.message}`,
          undefined,
          { error: err }
        )
      ))
    })
  })
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
const createK3dCluster = async (
  clusterName: string,
  registryPort: number,
  port: number,
  eventEmitter: OrchestratorEventEmitter
): Promise<Either<DeployError, void>> => {
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

  // Create cluster with streaming progress
  const result = await runCommandWithProgress(
    'k3d',
    args,
    (line) => {
      // Emit k3d progress messages
      if (line.includes('Creating') || line.includes('Starting') || line.includes('Waiting') || line.includes('Successfully')) {
        eventEmitter.emitTaskUpdate(clusterName, line)
      }
    },
    { cwd: undefined }
  )

  return result.map(() => undefined)
}

// ============================================================================
// Effects - Docker Build
// ============================================================================

/**
 * Build result with skip information
 */
interface BuildImageResult {
  /** Image reference (registry/name@digest or registry/name:tag) */
  imageRef: string
  /** Whether the build was skipped (image already existed) */
  skipped: boolean
  /** Content hash used for caching */
  contentHash: string
}

/**
 * Build and push Docker image for a service with content-based caching
 *
 * Uses content hashing to skip builds when source files haven't changed.
 * The content hash is used as the image tag for cache lookup.
 */
const buildAndPushImage = async (
  service: DiscoveredService,
  registry: string,
  eventEmitter: OrchestratorEventEmitter
): Promise<Either<DeployError, BuildImageResult | undefined>> => {
  if (!service.hasDockerfile) {
    return Right(undefined)
  }

  // Compute content hash of build context
  const contentHash = await hashBuildContext(service.path)
  const imageTag = `${registry}/${service.name}:${contentHash}`

  // Check if image with this hash already exists in registry
  const exists = await imageExistsInRegistry(registry, service.name, contentHash)

  if (exists) {
    // Image exists - get its digest and skip build
    const digest = await getImageDigestFromRegistry(registry, service.name, contentHash)

    if (digest) {
      eventEmitter.emitTaskUpdate(service.name, `unchanged (${contentHash})`)
      return Right({
        imageRef: `${registry}/${service.name}@${digest}`,
        skipped: true,
        contentHash
      })
    }

    // Fallback to tag if digest not available
    eventEmitter.emitTaskUpdate(service.name, `unchanged (${contentHash})`)
    return Right({
      imageRef: imageTag,
      skipped: true,
      contentHash
    })
  }

  // Image doesn't exist - build and push
  eventEmitter.emitTaskUpdate(service.name, `building (${contentHash})`)

  // Build the image using Docker SDK
  const buildResult = await buildImage({
    contextPath: service.path,
    tag: imageTag,
    onProgress: (progress) => {
      if (progress.current && progress.total) {
        eventEmitter.emitTaskUpdate(
          service.name,
          progress.message,
          (progress.current / progress.total) * 100
        )
      } else {
        eventEmitter.emitTaskUpdate(service.name, progress.message)
      }
    }
  })

  if (buildResult.isLeft()) {
    return buildResult
  }

  // Push to registry using Docker SDK
  const pushResult = await pushImage({
    tag: imageTag,
    onProgress: (progress) => {
      const msg = progress.id
        ? `${progress.status} ${progress.id}${progress.progress ? ` (${progress.progress}%)` : ''}`
        : progress.status
      eventEmitter.emitTaskUpdate(service.name, msg)
    }
  })

  if (pushResult.isLeft()) {
    return pushResult
  }

  // Use digest-based reference for guaranteed image matching
  const push = pushResult.extract() as { tag: string; digest?: string }
  if (push.digest) {
    return Right({
      imageRef: `${registry}/${service.name}@${push.digest}`,
      skipped: false,
      contentHash
    })
  }

  // Fallback to tag if no digest available
  return Right({
    imageRef: imageTag,
    skipped: false,
    contentHash
  })
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
        createConfigError(
          'InvalidConfigFormat',
          `${service.deployPath} must export a default function`,
          undefined,
          'default',
          { serviceName: service.name, deployPath: service.deployPath }
        )
      )
    }

    return Right(deployFn as ServiceDeployFn)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Left(
      createConfigError(
        'InvalidConfigFormat',
        `Failed to load deploy function from ${service.name}: ${message}`,
        undefined,
        'deployPath',
        { serviceName: service.name, deployPath: service.deployPath },
        err instanceof Error ? err : undefined
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
        createConfigError(
          'MissingRequiredField',
          'PULUMI_CONFIG_PASSPHRASE environment variable is required for production deployments',
          stackName,
          'PULUMI_CONFIG_PASSPHRASE',
          { stackName, envVar: 'PULUMI_CONFIG_PASSPHRASE' }
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
      const rootConfig = await liftEither(parseYamlFile(rootConfigPath)) as ProjectConfig
      const stacks = rootConfig.stacks ?? {}
      const globalConfig = (stacks[config.stackName] as Record<string, unknown>) ?? {}
      this.eventEmitter.emitPhaseComplete('configuration')

      // Phase 2: Discover services
      this.eventEmitter.emitPhaseStart('discovery')

      // Discover local services
      const localServices = await liftEither(await discoverServices(config.rootPath))

      // Discover published services (from node_modules)
      const allowlist = rootConfig.services?.allowed ?? []
      const publishedServices = await liftEither(await discoverPublishedServices(config.rootPath, allowlist))

      // Merge services (local overrides published if name conflicts)
      const localServiceNames = new Set(localServices.map(s => s.name))
      const mergedServices = [
        ...localServices,
        ...publishedServices.filter(s => !localServiceNames.has(s.name))
      ]

      const services = filterServices(mergedServices, config.servicesToDeploy)

      // Show discovered services in tree format
      for (let i = 0; i < services.length; i++) {
        const service = services[i]
        const isLast = i === services.length - 1
        const prefix = isLast ? '└─' : '├─'
        const source = localServiceNames.has(service.name) ? 'local' : 'published'
        this.eventEmitter.emitLog('info', `${prefix} ${service.name} (${source})`, undefined, 'Discovery')
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
          // Cluster already exists - emit as skipped/unchanged
          this.eventEmitter.emitTaskStart(clusterName)
          this.eventEmitter.emitTaskComplete(clusterName, true, true)  // skipped=true
        } else {
          // Emit task start
          this.eventEmitter.emitTaskStart(clusterName)

          const createResult = await createK3dCluster(clusterName, registryPort, port, this.eventEmitter)

          // Emit task complete
          const success = createResult.isRight()
          this.eventEmitter.emitTaskComplete(clusterName, success)

          if (createResult.isLeft()) {
            throw throwE(createResult.extract() as DeployError)
          }
        }

        this.eventEmitter.emitPhaseComplete('bootstrap')
      }

      // Phase 5: Build Docker images
      const builtImages: Record<string, string> = {}

      if (servicesToBuild.length > 0) {
        this.eventEmitter.emitPhaseStart('image-build')

        for (const service of servicesToBuild) {
          // Emit task start for spinner
          this.eventEmitter.emitTaskStart(service.name)

          const buildResult = await buildAndPushImage(service, hostRegistry, this.eventEmitter)

          if (buildResult.isLeft()) {
            // Log warning but continue - some services might not need images
            const error = buildResult.extract() as DeployError
            this.eventEmitter.emitTaskComplete(service.name, false)
            this.eventEmitter.emitLog('warn', error.message, undefined, 'Build')
          } else {
            const result = buildResult.unsafeCoerce()
            if (result) {
              // Replace host registry with cluster registry, preserving digest if present
              // e.g., localhost:5001/service@sha256:abc -> k3d-registry:5001/service@sha256:abc
              const imageWithoutRegistry = result.imageRef.replace(`${hostRegistry}/`, '')
              builtImages[service.name] = `${clusterRegistry}/${imageWithoutRegistry}`

              // Emit task complete with content hash for display
              this.eventEmitter.emitTaskComplete(service.name, true, result.skipped, result.contentHash)
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

      // Resolve backend configuration
      const backendUrl = resolveBackendUrl(config.rootPath, rootConfig, config.stackName)
      const workDir = resolveWorkDir(config.rootPath, rootConfig, config.stackName)

      // Ensure working directory exists
      if (!fs.existsSync(workDir)) {
        fs.mkdirSync(workDir, { recursive: true })
      }

      const projectName = rootConfig.name ?? 'pulumix-project'

      const stack = await LocalWorkspace.createOrSelectStack(
        {
          stackName: config.stackName,
          projectName,
          program
        },
        {
          workDir,
          projectSettings: {
            name: projectName,
            runtime: 'nodejs' as const,
            backend: { url: backendUrl }
          }
        }
      )

      // Simple approach: just use onOutput with the provided logger
      // The logger (from CLI) handles all parsing and display
      await stack.up({
        onOutput: config.onOutput || ((msg) => this.eventEmitter.emitLog('info', msg, undefined, 'Deploy')),
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
      const rootConfig = await liftEither(parseYamlFile(rootConfigPath)) as ProjectConfig

      // Resolve backend configuration
      const backendUrl = resolveBackendUrl(config.rootPath, rootConfig, config.stackName)
      const workDir = resolveWorkDir(config.rootPath, rootConfig, config.stackName)

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
          workDir,
          projectSettings: {
            name: projectName,
            runtime: 'nodejs' as const,
            backend: { url: backendUrl }
          }
        }
      )

      // Simple approach: just use onOutput with the provided logger
      await stack.destroy({
        onOutput: config.onOutput || ((msg) => this.eventEmitter.emitLog('info', msg, undefined, 'Deploy')),
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
