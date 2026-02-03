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
import glob from 'fast-glob'
import { EitherAsync } from 'purify-ts/EitherAsync'
import { Either, Left, Right } from 'purify-ts/Either'
import { Maybe, Just, Nothing } from 'purify-ts/Maybe'
import { createJiti } from 'jiti'
import * as yaml from 'yaml'
import {
  createDiscoveryError,
  createConfigError,
  DeployError
} from '../types/errors'
import { validateServiceManifest } from '../validation/manifest'
import { validateProjectConfig } from '../validation/project'
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
  BuildConfig,
  BackendConfig,
  ProjectConfig
} from '../types/manifest'
import { executeHooksForStage, getHooksForStack } from './hooks'
import { LocalWorkspace } from '@pulumi/pulumi/automation'
import {
  hashBuildContext,
  imageExistsInRegistry,
  getImageDigestFromRegistry,
  generateBakeConfig,
  runBake,
  BakeServiceConfig
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
 * Preview result
 */
export interface PreviewResult {
  readonly success: boolean
  readonly stack: string
  readonly changeSummary: Record<string, number>
  readonly duration: number
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
      const base = path.isAbsolute(backendPath)
        ? backendPath
        : path.join(rootPath, backendPath)
      const absolutePath = path.join(base, stackName)
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
      // Fallback to file backend (stack-scoped)
      const defaultPath = path.join(rootPath, 'dist/', stackName)
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
    const base = path.isAbsolute(backendPath)
      ? backendPath
      : path.join(rootPath, backendPath)
    return path.join(base, stackName)
  }

  return path.join(rootPath, 'dist/', stackName)
}

// ============================================================================
// Pure Functions - YAML Parsing
// ============================================================================

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
 * Extract service name from a package dependency name.
 * Strips scope and checks if any known service name is contained in the package name.
 * e.g., "@noctemhealth/infrastructure-mongodb" -> "mongodb"
 */
const matchServiceName = (depName: string, allServiceNames: Set<string>): string | null => {
  // Strip scope: "@noctemhealth/infrastructure-mongodb" -> "infrastructure-mongodb"
  const packagePart = depName.includes('/') ? depName.split('/').pop()! : depName

  // Check if any service name is contained in the package name
  for (const serviceName of allServiceNames) {
    if (packagePart.includes(serviceName)) {
      return serviceName
    }
  }

  return null
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

    const matched: string[] = []
    for (const dep of Object.keys(deps)) {
      const serviceName = matchServiceName(dep, allServiceNames)
      if (serviceName && !matched.includes(serviceName)) {
        matched.push(serviceName)
      }
    }
    return matched
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
      const build = rawConfig.build as BuildConfig | undefined
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
        build,
        observability,
        security
      })
    }

    // Deduplicate services by name (first occurrence wins)
    const uniqueServices = Array.from(
      new Map(services.map(s => [s.name, s])).values()
    )

    return Right(uniqueServices)
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
      const build = rawConfig.build as BuildConfig | undefined
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
        build,
        observability,
        security
      })
    }

    // Deduplicate services by name (first occurrence wins)
    const uniqueServices = Array.from(
      new Map(services.map(s => [s.name, s])).values()
    )

    return Right(uniqueServices)
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
// Effects - Docker Build
// ============================================================================

/**
 * Resolve build context path based on service build configuration
 *
 * @param service - The discovered service
 * @param rootPath - The project root path
 * @returns Resolved context path and dockerfile path
 */
const resolveBuildContext = (
  service: DiscoveredService,
  rootPath: string
): { contextPath: string; dockerfile: string } => {
  const buildConfig = service.build
  const context = buildConfig?.context ?? '.'

  let contextPath: string
  let dockerfile: string

  if (context === 'root') {
    // Use project root as context
    contextPath = rootPath
    // Default dockerfile path is relative from root to service's Dockerfile
    dockerfile = buildConfig?.dockerfile ?? path.relative(rootPath, path.join(service.path, 'Dockerfile'))
  } else if (context === '.') {
    // Use service directory (default)
    contextPath = service.path
    dockerfile = buildConfig?.dockerfile ?? 'Dockerfile'
  } else {
    // Relative path from service directory
    contextPath = path.resolve(service.path, context)
    dockerfile = buildConfig?.dockerfile ?? 'Dockerfile'
  }

  return { contextPath, dockerfile }
}

/**
 * Prepared build info for a service
 */
interface PreparedBuild {
  service: DiscoveredService
  contextPath: string
  dockerfile: string
  contentHash: string
  imageTag: string
  cached: boolean
  imageRef?: string
}

/**
 * Prepare build info for a service and check cache
 *
 * Resolves build context, computes content hash, and checks if image
 * already exists in registry.
 */
const prepareBuild = async (
  service: DiscoveredService,
  registry: string,
  rootPath: string
): Promise<PreparedBuild> => {
  // Resolve build context and dockerfile paths
  const { contextPath, dockerfile } = resolveBuildContext(service, rootPath)

  // Compute content hash based on Dockerfile COPY/ADD paths
  const contentHash = await hashBuildContext(contextPath, dockerfile)
  const imageTag = `${registry}/${service.name}:${contentHash}`

  // Check if image with this hash already exists in registry
  const exists = await imageExistsInRegistry(registry, service.name, contentHash)

  if (exists) {
    // Image exists - get its digest
    const digest = await getImageDigestFromRegistry(registry, service.name, contentHash)
    const imageRef = digest
      ? `${registry}/${service.name}@${digest}`
      : imageTag

    return {
      service,
      contextPath,
      dockerfile,
      contentHash,
      imageTag,
      cached: true,
      imageRef
    }
  }

  return {
    service,
    contextPath,
    dockerfile,
    contentHash,
    imageTag,
    cached: false
  }
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
   * Shared setup for deploy and preview: config, discovery, deps, hooks, builds
   */
  private async prepareDeployment(
    config: OrchestratorConfig,
    liftEither: <R>(val: Either<DeployError, R>) => PromiseLike<R>,
    throwE: (error: DeployError) => never
  ): Promise<{
    sorted: readonly DiscoveredService[]
    builtImages: Record<string, string>
    globalConfig: Record<string, unknown>
    rootConfig: ProjectConfig
    hooks: ReturnType<typeof getHooksForStack>
    backendUrl: string
    workDir: string
    projectName: string
    program: () => Promise<Record<string, unknown>>
    outputs: Record<string, Record<string, unknown>>
  }> {
    // Phase 1: Load and validate root config
    this.eventEmitter.emitPhaseStart('configuration')
    const rootConfigPath = path.join(config.rootPath, 'pulumix.yaml')
    const rawConfig = await liftEither(parseYamlFile(rootConfigPath))
    const rootConfig = await liftEither(validateProjectConfig(rawConfig, rootConfigPath))
    const stacks = rootConfig.stacks ?? {}
    const globalConfig = (stacks[config.stackName] as Record<string, unknown>) ?? {}
    this.eventEmitter.emitPhaseComplete('configuration')

    // Phase 2: Discover services
    this.eventEmitter.emitPhaseStart('discovery')

    const localServices = await liftEither(await discoverServices(config.rootPath))

    const allowlist = rootConfig.services?.allowed ?? []
    const publishedServices = await liftEither(await discoverPublishedServices(config.rootPath, allowlist))

    const localServiceNames = new Set(localServices.map(s => s.name))
    const mergedServices = [
      ...localServices,
      ...publishedServices.filter(s => !localServiceNames.has(s.name))
    ]

    const services = filterServices(mergedServices, config.servicesToDeploy)

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

    // Get registry config
    const hostRegistry = getConfigValue<string>(globalConfig, 'hostRegistry').orDefault('localhost:5001')
    const clusterRegistry = getConfigValue<string>(globalConfig, 'clusterRegistry').orDefault(hostRegistry)

    const platformConfig = getConfigValue<string | string[]>(globalConfig, 'platform').extract()
    const platforms = platformConfig
      ? (Array.isArray(platformConfig) ? platformConfig : [platformConfig])
      : undefined

    // Get hooks for this stack
    const hooks = getHooksForStack(rootConfig.hooks, config.stackName)

    // Phase 4: Bootstrap - run pre-build hooks
    const servicesToBuild = sorted.filter(s => s.hasDockerfile)
    const preBuildHooks = hooks.filter(h => h.stage === 'pre-build')

    if (preBuildHooks.length > 0) {
      this.eventEmitter.emitPhaseStart('bootstrap')

      const hookResult = await executeHooksForStage('pre-build', hooks, config.rootPath, this.eventEmitter)

      if (hookResult.isLeft()) {
        this.eventEmitter.emitPhaseComplete('bootstrap', false)
        throw throwE(hookResult.extract() as DeployError)
      }

      this.eventEmitter.emitPhaseComplete('bootstrap')
    }

    // Phase 5: Build Docker images using docker buildx bake
    const builtImages: Record<string, string> = {}

    if (servicesToBuild.length > 0) {
      this.eventEmitter.emitPhaseStart('image-build')

      const preparedBuilds = await Promise.all(
        servicesToBuild.map(service => prepareBuild(service, hostRegistry, config.rootPath))
      )

      const cachedBuilds = preparedBuilds.filter(b => b.cached)
      const uncachedBuilds = preparedBuilds.filter(b => !b.cached)

      for (const build of cachedBuilds) {
        this.eventEmitter.emitTaskStart(build.service.name, build.service.name, 'image-build', build.contentHash)
        this.eventEmitter.emitTaskUpdate(build.service.name, `unchanged (${build.contentHash})`)

        const imageWithoutRegistry = (build.imageRef || build.imageTag).replace(`${hostRegistry}/`, '')
        builtImages[build.service.name] = `${clusterRegistry}/${imageWithoutRegistry}`

        this.eventEmitter.emitTaskComplete(build.service.name, true, true, build.contentHash)
      }

      if (uncachedBuilds.length > 0) {
        for (const build of uncachedBuilds) {
          this.eventEmitter.emitTaskStart(build.service.name, build.service.name, 'image-build', build.contentHash)
          this.eventEmitter.emitTaskUpdate(build.service.name, 'building')
        }

        const bakeServices: BakeServiceConfig[] = uncachedBuilds.map(build => ({
          name: build.service.name,
          contextPath: build.contextPath,
          dockerfile: build.dockerfile,
          tag: build.imageTag,
          contentHash: build.contentHash,
          platforms,
        }))

        const bakeConfig = generateBakeConfig(bakeServices)
        const bakeFilePath = path.join(config.rootPath, 'dist', 'docker-bake.json')

        if (!fs.existsSync(path.dirname(bakeFilePath))) {
          fs.mkdirSync(path.dirname(bakeFilePath), { recursive: true })
        }

        fs.writeFileSync(bakeFilePath, JSON.stringify(bakeConfig, null, 2))

        const lastStepShown = new Map<string, string>()
        const completedTargets = new Set<string>()
        const buildHashMap = new Map(uncachedBuilds.map(b => [b.service.name, b.contentHash]))

        const bakeResult = await runBake(
          bakeFilePath,
          bakeServices,
          (progress) => {
            if (!progress.target || progress.target.startsWith('_')) return

            const isExportStep = progress.message.includes('exporting')

            if (progress.done && isExportStep) {
              completedTargets.add(progress.target)
              const contentHash = buildHashMap.get(progress.target)
              this.eventEmitter.emitTaskComplete(progress.target, !progress.error, false, contentHash)
              return
            }

            let message = progress.message
            if (progress.step) {
              message = `[${progress.step.current}/${progress.step.total}] ${progress.message}`
            }

            const lastShown = lastStepShown.get(progress.target)
            if (lastShown === message) return
            lastStepShown.set(progress.target, message)

            this.eventEmitter.emitTaskUpdate(progress.target, message)
          }
        )

        if (bakeResult.isLeft()) {
          const error = bakeResult.extract() as DeployError
          for (const build of uncachedBuilds) {
            if (!completedTargets.has(build.service.name)) {
              this.eventEmitter.emitTaskComplete(build.service.name, false, false, build.contentHash)
            }
          }
          this.eventEmitter.emitLog('error', error.message, undefined, 'Build')
          this.eventEmitter.emitPhaseComplete('image-build', false)
          throw error
        }

        const imageRefs = bakeResult.unsafeCoerce()
        for (const build of uncachedBuilds) {
          const imageRef = imageRefs.get(build.service.name) || build.imageTag

          const imageWithoutRegistry = imageRef.replace(`${hostRegistry}/`, '')
          builtImages[build.service.name] = `${clusterRegistry}/${imageWithoutRegistry}`

          if (!completedTargets.has(build.service.name)) {
            this.eventEmitter.emitTaskComplete(build.service.name, true, false, build.contentHash)
          }
        }
      }

      this.eventEmitter.emitPhaseComplete('image-build')
    }

    // Run post-build hooks
    const postBuildHooks = hooks.filter(h => h.stage === 'post-build')
    if (postBuildHooks.length > 0) {
      const hookResult = await executeHooksForStage('post-build', hooks, config.rootPath, this.eventEmitter)
      if (hookResult.isLeft()) {
        throw throwE(hookResult.extract() as DeployError)
      }
    }

    // Build Pulumi program function and workspace config
    const backendUrl = resolveBackendUrl(config.rootPath, rootConfig, config.stackName)
    const workDir = resolveWorkDir(config.rootPath, rootConfig, config.stackName)

    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true })
    }

    const projectName = rootConfig.name ?? 'pulumix-project'

    const outputs: Record<string, Record<string, unknown>> = {}

    const program = async (): Promise<Record<string, unknown>> => {
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
          dependencies: outputs,
          image: builtImages[service.name]
        }

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

      return outputs
    }

    return { sorted, builtImages, globalConfig, rootConfig, hooks, backendUrl, workDir, projectName, program, outputs }
  }

  /**
   * Deploy all services
   */
  deploy(config: OrchestratorConfig): EitherAsync<DeployError, OrchestratorResult> {
    const startTime = Date.now()

    return EitherAsync(async ({ liftEither, throwE }) => {
      // Validate environment
      await liftEither(this.validateEnvironment(config.stackName))

      // Phases 1-5: shared preparation
      const { sorted, hooks, backendUrl, workDir, projectName, program, outputs } =
        await this.prepareDeployment(config, liftEither, throwE)

      // Run pre-deploy hooks
      const preDeployHooks = hooks.filter(h => h.stage === 'pre-deploy')
      if (preDeployHooks.length > 0) {
        const hookResult = await executeHooksForStage('pre-deploy', hooks, config.rootPath, this.eventEmitter)
        if (hookResult.isLeft()) {
          throw throwE(hookResult.extract() as DeployError)
        }
      }

      // Phase 6: Run Pulumi deployment
      this.eventEmitter.emitPhaseStart('deployment')

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
      try {
        await stack.up({
          onOutput: config.onOutput || ((msg) => this.eventEmitter.emitLog('info', msg, undefined, 'Deploy')),
        })
        this.eventEmitter.emitPhaseComplete('deployment')
      } catch (err) {
        this.eventEmitter.emitPhaseComplete('deployment', false)
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(`Pulumi update failed: ${message}`)
      }

      // Run post-deploy hooks
      const postDeployHooks = hooks.filter(h => h.stage === 'post-deploy')
      if (postDeployHooks.length > 0) {
        const hookResult = await executeHooksForStage('post-deploy', hooks, config.rootPath, this.eventEmitter)
        if (hookResult.isLeft()) {
          throw throwE(hookResult.extract() as DeployError)
        }
      }

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
   * Preview changes without deploying
   */
  preview(config: OrchestratorConfig): EitherAsync<DeployError, PreviewResult> {
    const startTime = Date.now()

    return EitherAsync(async ({ liftEither, throwE }) => {
      await liftEither(this.validateEnvironment(config.stackName))

      // Phases 1-5: shared preparation
      const { backendUrl, workDir, projectName, program } =
        await this.prepareDeployment(config, liftEither, throwE)

      // Phase 6: Run Pulumi preview
      this.eventEmitter.emitPhaseStart('deployment')

      const stack = await LocalWorkspace.createOrSelectStack(
        { stackName: config.stackName, projectName, program },
        { workDir, projectSettings: { name: projectName, runtime: 'nodejs' as const, backend: { url: backendUrl } } }
      )

      try {
        const previewResult = await stack.preview({
          onOutput: config.onOutput || ((msg) => this.eventEmitter.emitLog('info', msg, undefined, 'Deploy')),
        })
        this.eventEmitter.emitPhaseComplete('deployment')

        return {
          success: true,
          stack: config.stackName,
          changeSummary: previewResult.changeSummary ?? {},
          duration: Date.now() - startTime
        }
      } catch (err) {
        this.eventEmitter.emitPhaseComplete('deployment', false)
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(`Pulumi preview failed: ${message}`)
      }
    })
  }

  /**
   * Show current stack outputs without deploying
   */
  status(config: OrchestratorConfig): EitherAsync<DeployError, OrchestratorResult> {
    return EitherAsync(async ({ liftEither }) => {
      await liftEither(this.validateEnvironment(config.stackName))

      const rootConfigPath = path.join(config.rootPath, 'pulumix.yaml')
      const rawConfig = await liftEither(parseYamlFile(rootConfigPath))
      const rootConfig = await liftEither(validateProjectConfig(rawConfig, rootConfigPath))

      const backendUrl = resolveBackendUrl(config.rootPath, rootConfig, config.stackName)
      const workDir = resolveWorkDir(config.rootPath, rootConfig, config.stackName)

      if (!fs.existsSync(workDir)) {
        fs.mkdirSync(workDir, { recursive: true })
      }

      const projectName = rootConfig.name ?? 'pulumix-project'

      const stack = await LocalWorkspace.createOrSelectStack(
        { stackName: config.stackName, projectName, program: async () => {} },
        { workDir, projectSettings: { name: projectName, runtime: 'nodejs' as const, backend: { url: backendUrl } } }
      )

      const stackOutputs = await stack.outputs()
      const outputs = Object.fromEntries(
        Object.entries(stackOutputs).map(([k, v]) => [k, v.value])
      ) as Record<string, Record<string, unknown>>

      return { success: true, stack: config.stackName, servicesDeployed: 0, duration: 0, outputs }
    })
  }

  /**
   * Refresh stack state from cloud resources
   */
  refresh(config: OrchestratorConfig): EitherAsync<DeployError, OrchestratorResult> {
    const startTime = Date.now()

    return EitherAsync(async ({ liftEither }) => {
      await liftEither(this.validateEnvironment(config.stackName))

      const rootConfigPath = path.join(config.rootPath, 'pulumix.yaml')
      const rawConfig = await liftEither(parseYamlFile(rootConfigPath))
      const rootConfig = await liftEither(validateProjectConfig(rawConfig, rootConfigPath))

      const backendUrl = resolveBackendUrl(config.rootPath, rootConfig, config.stackName)
      const workDir = resolveWorkDir(config.rootPath, rootConfig, config.stackName)

      if (!fs.existsSync(workDir)) {
        fs.mkdirSync(workDir, { recursive: true })
      }

      const projectName = rootConfig.name ?? 'pulumix-project'

      const program = async (): Promise<void> => {}

      const stack = await LocalWorkspace.createOrSelectStack(
        { stackName: config.stackName, projectName, program },
        { workDir, projectSettings: { name: projectName, runtime: 'nodejs' as const, backend: { url: backendUrl } } }
      )

      await stack.refresh({
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

  /**
   * Destroy all services
   */
  destroy(config: OrchestratorConfig): EitherAsync<DeployError, OrchestratorResult> {
    const startTime = Date.now()

    return EitherAsync(async ({ liftEither }) => {
      // Validate environment
      await liftEither(this.validateEnvironment(config.stackName))

      // Load and validate root config
      const rootConfigPath = path.join(config.rootPath, 'pulumix.yaml')
      const rawConfig = await liftEither(parseYamlFile(rootConfigPath))
      const rootConfig = await liftEither(validateProjectConfig(rawConfig, rootConfigPath))

      // Resolve backend configuration
      const backendUrl = resolveBackendUrl(config.rootPath, rootConfig, config.stackName)
      const workDir = resolveWorkDir(config.rootPath, rootConfig, config.stackName)

      if (!fs.existsSync(workDir)) {
        fs.mkdirSync(workDir, { recursive: true })
      }

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
