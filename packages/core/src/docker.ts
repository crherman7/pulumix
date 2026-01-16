/**
 * Docker utilities for buildx bake
 *
 * Provides content hashing, registry operations, and docker buildx bake integration.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { Either, Left, Right } from 'purify-ts/Either'
import { DeployError, createBuildError } from './types/errors'
import { DockerfileParser } from 'dockerfile-ast'
import dockerignore, { Ignore } from '@balena/dockerignore'

// ============================================================================
// Dockerfile Parsing
// ============================================================================

/**
 * Extract source paths from COPY and ADD instructions in a Dockerfile
 *
 * Parses the Dockerfile and returns all source paths that would be copied
 * into the image. These are the paths that should be included in the hash.
 *
 * @param dockerfilePath - Absolute path to the Dockerfile
 * @returns Array of source paths (relative to build context)
 */
export const extractDockerfilePaths = async (
  dockerfilePath: string
): Promise<string[]> => {
  const content = await fs.promises.readFile(dockerfilePath, 'utf-8')
  const dockerfile = DockerfileParser.parse(content)

  const paths: string[] = []

  // Extract COPY source paths
  for (const copy of dockerfile.getCOPYs()) {
    const args = copy.getArguments()
    // Last argument is destination, all others are sources
    for (let i = 0; i < args.length - 1; i++) {
      const source = args[i]?.getValue()
      if (source && !source.startsWith('--')) {
        // Skip flags like --from=builder
        paths.push(source)
      }
    }
  }

  // Extract ADD source paths
  for (const instruction of dockerfile.getInstructions()) {
    if (instruction.getKeyword() === 'ADD') {
      const args = instruction.getArguments()
      // Last argument is destination, all others are sources
      for (let i = 0; i < args.length - 1; i++) {
        const source = args[i]?.getValue()
        if (source && !source.startsWith('--') && !source.startsWith('http')) {
          // Skip flags and URLs
          paths.push(source)
        }
      }
    }
  }

  return paths
}

// ============================================================================
// Dockerignore Support
// ============================================================================

/**
 * Default patterns to ignore when no .dockerignore exists
 */
const DEFAULT_IGNORE_PATTERNS = [
  '.git',
  '.gitignore',
  '.dockerignore',
  '.DS_Store',
  '*.log',
  '.env',
  '.env.*',
  'node_modules',
  'dist',
  'build',
  '.turbo',
  '.next',
]

/**
 * Parse .dockerignore file and return an Ignore instance
 *
 * @param contextPath - Build context directory
 * @returns Ignore instance configured with patterns
 */
const parseDockerignore = async (contextPath: string): Promise<Ignore> => {
  const ig = dockerignore()

  const dockerignorePath = path.join(contextPath, '.dockerignore')

  try {
    const content = await fs.promises.readFile(dockerignorePath, 'utf-8')
    // Split by newlines and add each non-empty line
    const patterns = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
    ig.add(patterns)
  } catch {
    // No .dockerignore - use defaults
    ig.add(DEFAULT_IGNORE_PATTERNS)
  }

  return ig
}

// ============================================================================
// Content Hashing
// ============================================================================

/**
 * Recursively collect all files in a directory, respecting .dockerignore
 */
const collectFilesAsync = async (
  dir: string,
  basePath: string,
  ig: Ignore
): Promise<string[]> => {
  const files: string[] = []

  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const relativePath = path.relative(basePath, fullPath)

      // Check if this path should be ignored
      // Add trailing slash for directories as per dockerignore spec
      const pathToCheck = entry.isDirectory() ? `${relativePath}/` : relativePath
      if (ig.ignores(pathToCheck)) {
        continue
      }

      if (entry.isDirectory()) {
        const subFiles = await collectFilesAsync(fullPath, basePath, ig)
        files.push(...subFiles)
      } else if (entry.isFile()) {
        files.push(fullPath)
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return files
}

/**
 * Hash a single file or directory, respecting .dockerignore patterns
 */
const hashPath = async (
  fullPath: string,
  basePath: string,
  hash: crypto.Hash,
  ig: Ignore
): Promise<void> => {
  try {
    const stat = await fs.promises.stat(fullPath)
    const relativePath = path.relative(basePath, fullPath)

    // Check if this path should be ignored
    const pathToCheck = stat.isDirectory() ? `${relativePath}/` : relativePath
    if (relativePath && ig.ignores(pathToCheck)) {
      return
    }

    if (stat.isDirectory()) {
      const files = (await collectFilesAsync(fullPath, basePath, ig)).sort()
      for (const file of files) {
        const fileRelativePath = path.relative(basePath, file)
        hash.update(fileRelativePath)
        const content = await fs.promises.readFile(file)
        hash.update(content)
      }
    } else if (stat.isFile()) {
      hash.update(relativePath)
      const content = await fs.promises.readFile(fullPath)
      hash.update(content)
    }
  } catch {
    // Path doesn't exist - skip
  }
}

/**
 * Compute content hash based on Dockerfile COPY/ADD paths
 *
 * Parses the Dockerfile to extract COPY and ADD source paths, then hashes
 * only those paths while respecting .dockerignore patterns. This ensures
 * the hash changes when any file that would be copied into the Docker
 * image changes.
 *
 * @param contextPath - Build context directory (where Docker build runs from)
 * @param dockerfilePath - Path to Dockerfile (relative to context or absolute)
 * @returns Short hash (first 12 characters of SHA256)
 */
export const hashBuildContext = async (
  contextPath: string,
  dockerfilePath: string = 'Dockerfile'
): Promise<string> => {
  const hash = crypto.createHash('sha256')

  // Resolve dockerfile path
  const absoluteDockerfilePath = path.isAbsolute(dockerfilePath)
    ? dockerfilePath
    : path.join(contextPath, dockerfilePath)

  // Always include the Dockerfile itself in the hash
  try {
    const dockerfileContent = await fs.promises.readFile(absoluteDockerfilePath)
    hash.update('Dockerfile')
    hash.update(dockerfileContent)
  } catch {
    // Dockerfile doesn't exist - return empty hash
    return hash.digest('hex').slice(0, 12)
  }

  // Parse .dockerignore
  const ig = await parseDockerignore(contextPath)

  // Extract paths from COPY/ADD instructions
  const copyPaths = await extractDockerfilePaths(absoluteDockerfilePath)

  // Hash each path mentioned in COPY/ADD (respecting .dockerignore)
  for (const copyPath of copyPaths) {
    // Resolve path relative to context
    const fullPath = path.join(contextPath, copyPath)
    await hashPath(fullPath, contextPath, hash, ig)
  }

  // Return short hash (12 chars like git short SHA)
  return hash.digest('hex').slice(0, 12)
}

// ============================================================================
// Registry Operations
// ============================================================================

/**
 * Determine protocol for registry (HTTPS for remote, HTTP for localhost)
 */
const getRegistryProtocol = (registry: string): 'http' | 'https' => {
  // Use HTTP only for localhost/local registries
  if (
    registry.startsWith('localhost') ||
    registry.startsWith('127.0.0.1') ||
    registry.startsWith('0.0.0.0') ||
    registry.includes('.localhost')
  ) {
    return 'http'
  }
  return 'https'
}

/**
 * Build registry URL for API calls
 */
const getRegistryUrl = (registry: string, imageName: string, tag: string): string => {
  const protocol = getRegistryProtocol(registry)
  return `${protocol}://${registry}/v2/${imageName}/manifests/${tag}`
}

/**
 * Check if an image exists in a registry
 *
 * Uses Docker registry API v2 to check for image manifest.
 * Works with local registries (HTTP) and remote registries (HTTPS).
 */
export const imageExistsInRegistry = async (
  registry: string,
  imageName: string,
  tag: string
): Promise<boolean> => {
  try {
    const url = getRegistryUrl(registry, imageName, tag)

    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        'Accept': 'application/vnd.docker.distribution.manifest.v2+json'
      }
    })

    return response.ok
  } catch {
    // Network error or registry not available
    return false
  }
}

/**
 * Get image digest from registry without pulling
 */
export const getImageDigestFromRegistry = async (
  registry: string,
  imageName: string,
  tag: string
): Promise<string | null> => {
  try {
    const url = getRegistryUrl(registry, imageName, tag)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.docker.distribution.manifest.v2+json'
      }
    })

    if (!response.ok) {
      return null
    }

    // Docker-Content-Digest header contains the digest
    return response.headers.get('Docker-Content-Digest')
  } catch {
    return null
  }
}

// ============================================================================
// Docker Buildx Bake
// ============================================================================

/**
 * Bake target configuration for a single service
 */
export interface BakeTarget {
  context: string
  dockerfile: string
  tags: string[]
  args?: Record<string, string>
  platforms?: string[]
}

/**
 * Bake configuration file structure (HCL-compatible JSON)
 */
export interface BakeConfig {
  group: { default: { targets: string[] } }
  target: Record<string, BakeTarget>
}

/**
 * Progress event from bake output parsing
 */
export interface BakeProgress {
  /** Target name (service) this progress is for */
  target: string
  /** Step progress (current/total) */
  step?: { current: number; total: number }
  /** Progress message */
  message: string
  /** Whether this target completed */
  done?: boolean
  /** Whether this target had an error */
  error?: boolean
  /** Whether this step was cached */
  cached?: boolean
}

// ============================================================================
// BuildKit rawjson Types
// ============================================================================

/**
 * Vertex status from BuildKit rawjson output
 * Represents a single build step (Dockerfile instruction)
 */
interface BuildKitVertex {
  digest: string
  name: string
  started?: string
  completed?: string
  cached?: boolean
  error?: string
}

/**
 * Status update from BuildKit rawjson output
 * Represents progress within a vertex (like download progress)
 */
interface BuildKitStatus {
  id: string
  vertex: string
  name?: string
  current?: number
  total?: number
  timestamp?: string
  started?: string
  completed?: string
}

/**
 * Log output from BuildKit rawjson output
 */
interface BuildKitLog {
  vertex: string
  stream?: number
  msg?: string
  timestamp?: string
}

/**
 * Complete solve status event from BuildKit rawjson
 * Each line in rawjson output is one of these
 */
interface BuildKitSolveStatus {
  vertexes?: BuildKitVertex[]
  statuses?: BuildKitStatus[]
  logs?: BuildKitLog[]
}

/**
 * Service build configuration for bake
 */
export interface BakeServiceConfig {
  name: string
  contextPath: string
  dockerfile: string
  tag: string
  contentHash: string
  platforms?: string[]
}

/**
 * Generate a docker-bake.json configuration file
 *
 * Creates a bake config that builds all services in parallel with
 * shared layer caching. Uses JSON format for simplicity.
 *
 * @param services - Array of services to build
 * @returns Bake configuration object
 */
export const generateBakeConfig = (
  services: BakeServiceConfig[]
): BakeConfig => {
  const targets: Record<string, BakeTarget> = {}
  const targetNames: string[] = []

  for (const service of services) {
    // Use service name as target name (sanitized for HCL)
    const targetName = service.name.replace(/[^a-zA-Z0-9_-]/g, '_')
    targetNames.push(targetName)

    targets[targetName] = {
      context: service.contextPath,
      dockerfile: service.dockerfile,
      tags: [service.tag],
      ...(service.platforms && { platforms: service.platforms })
    }
  }

  return {
    group: {
      default: {
        targets: targetNames
      }
    },
    target: targets
  }
}

/**
 * Parse a vertex name to extract target and step info
 *
 * Vertex names from BuildKit look like:
 * Multi-target bake:
 * - "[api 1/5] FROM node:20-alpine" -> target: api, step: 1/5
 * - "[api builder 1/5] RUN npm ci" -> target: api, step: 1/5 (multi-stage)
 * - "[api internal] load build context" -> target: api, internal step
 * - "[api] exporting to image" -> target: api, exporting
 *
 * Single-target bake (no target prefix!):
 * - "[1/5] FROM node:20-alpine" -> step: 1/5, no target in name
 * - "[internal] load build context" -> internal step
 * - "exporting to image" -> export phase
 *
 * @param name - Vertex name from BuildKit
 * @param targetNames - Map of sanitized target names to service names
 * @param defaultTarget - Default target for single-target bakes
 * @returns Parsed target, step, and message info
 */
const parseVertexName = (
  name: string,
  targetNames: Map<string, string>,
  defaultTarget: string | null = null
): { target: string | null; step?: { current: number; total: number }; message: string } => {
  // Match step progress with target: [target M/T] description
  // Example: [api 1/5] FROM node:20-alpine
  const stepWithTargetMatch = name.match(/^\[([a-zA-Z][^\s\]]*)\s+(\d+)\/(\d+)\]\s+(.*)/)
  if (stepWithTargetMatch) {
    const [, targetPart, current, total, message] = stepWithTargetMatch
    const serviceName = resolveTargetName(targetPart || '', targetNames)
    return {
      target: serviceName,
      step: { current: parseInt(current || '0'), total: parseInt(total || '1') },
      message: message || ''
    }
  }

  // Match step progress WITHOUT target (single-target bake): [M/T] description
  // Example: [1/5] FROM node:20-alpine
  const stepNoTargetMatch = name.match(/^\[(\d+)\/(\d+)\]\s+(.*)/)
  if (stepNoTargetMatch) {
    const [, current, total, message] = stepNoTargetMatch
    return {
      target: defaultTarget,
      step: { current: parseInt(current || '0'), total: parseInt(total || '1') },
      message: message || ''
    }
  }

  // Match stage steps with target: [target stage M/T] description
  // Example: [api builder 1/5] FROM node:20-alpine
  const stageMatch = name.match(/^\[([a-zA-Z][^\s\]]*)\s+\w+\s+(\d+)\/(\d+)\]\s+(.*)/)
  if (stageMatch) {
    const [, targetPart, current, total, message] = stageMatch
    const serviceName = resolveTargetName(targetPart || '', targetNames)
    return {
      target: serviceName,
      step: { current: parseInt(current || '0'), total: parseInt(total || '1') },
      message: message || ''
    }
  }

  // Match stage steps WITHOUT target (single-target bake): [stage M/T] description
  // Example: [builder 1/5] RUN npm ci
  const stageNoTargetMatch = name.match(/^\[(\w+)\s+(\d+)\/(\d+)\]\s+(.*)/)
  if (stageNoTargetMatch) {
    const [, , current, total, message] = stageNoTargetMatch
    return {
      target: defaultTarget,
      step: { current: parseInt(current || '0'), total: parseInt(total || '1') },
      message: message || ''
    }
  }

  // Match internal steps with target: [target internal] description
  // Example: [api internal] load build context
  const internalWithTargetMatch = name.match(/^\[([a-zA-Z][^\s\]]*)\s+internal\]\s+(.*)/)
  if (internalWithTargetMatch) {
    const [, targetPart, message] = internalWithTargetMatch
    const serviceName = resolveTargetName(targetPart || '', targetNames)
    return { target: serviceName, message: message || 'loading' }
  }

  // Match global internal steps: [internal] description
  if (name.match(/^\[internal\]/)) {
    return { target: null, message: name }
  }

  // Match target-only format: [target] description
  // Example: [api] exporting to image
  const targetOnlyMatch = name.match(/^\[([a-zA-Z][^\s\]]*)\]\s+(.*)/)
  if (targetOnlyMatch) {
    const [, targetPart, message] = targetOnlyMatch
    const serviceName = resolveTargetName(targetPart || '', targetNames)
    return { target: serviceName, message: message || '' }
  }

  // Match pushing manifest: pushing manifest for registry/service:tag
  const pushMatch = name.match(/^pushing manifest for ([^\s]+)/)
  if (pushMatch) {
    const [, tag] = pushMatch
    const parts = tag?.split('/') || []
    const lastPart = parts[parts.length - 1] || ''
    const serviceName = lastPart.split(':')[0] || ''
    return { target: serviceName || defaultTarget, message: 'pushing' }
  }

  // Export phases without target - use default for single-target bakes
  if (name.includes('exporting')) {
    return { target: defaultTarget, message: name }
  }

  // Default: no target attribution
  return { target: null, message: name }
}

/**
 * Parse a JSON line from BuildKit rawjson output
 *
 * Each line is a BuildKitSolveStatus object containing vertexes, statuses, and logs.
 * We extract progress events from vertex updates.
 *
 * @param line - A single JSON line from rawjson output
 * @param targetNames - Map of sanitized target names to service names
 * @param vertexState - Map tracking vertex completion state
 * @param defaultTarget - Default target for single-service bakes (vertex names won't have target prefix)
 * @returns Array of parsed progress events
 */
export const parseRawJsonLine = (
  line: string,
  targetNames: Map<string, string>,
  vertexState: Map<string, { target: string | null; completed: boolean; error: boolean }>,
  defaultTarget: string | null = null
): BakeProgress[] => {
  const trimmed = line.trim()
  if (!trimmed) return []

  let event: BuildKitSolveStatus
  try {
    event = JSON.parse(trimmed) as BuildKitSolveStatus
  } catch {
    // Not valid JSON - skip
    return []
  }

  const progress: BakeProgress[] = []

  // Process vertex updates
  if (event.vertexes) {
    for (const vertex of event.vertexes) {
      const parsed = parseVertexName(vertex.name, targetNames, defaultTarget)

      // Skip global/internal vertices with no target
      if (!parsed.target) continue

      // Track vertex state
      const prevState = vertexState.get(vertex.digest)
      const isNewlyCompleted = vertex.completed && !prevState?.completed
      const isNewlyErrored = vertex.error && !prevState?.error
      const isNewlyStarted = vertex.started && !prevState

      vertexState.set(vertex.digest, {
        target: parsed.target,
        completed: !!vertex.completed,
        error: !!vertex.error
      })

      // Emit progress for newly started vertices
      if (isNewlyStarted && !vertex.cached) {
        progress.push({
          target: parsed.target,
          step: parsed.step,
          message: parsed.message,
          cached: false
        })
      }

      // Emit progress for completed vertices (including cached)
      if (isNewlyCompleted) {
        progress.push({
          target: parsed.target,
          step: parsed.step,
          message: parsed.message,
          done: true,
          cached: vertex.cached
        })
      }

      // Emit error events
      if (isNewlyErrored) {
        progress.push({
          target: parsed.target,
          message: vertex.error || 'Build failed',
          error: true
        })
      }
    }
  }

  return progress
}

/**
 * Resolve a target name from bake output to the original service name
 *
 * Handles formats like:
 * - "api" -> looks up in targetNames map
 * - "api_1" -> strips suffix, looks up "api"
 * - Unknown -> returns as-is
 */
const resolveTargetName = (targetPart: string, targetNames: Map<string, string>): string => {
  // Direct match
  if (targetNames.has(targetPart)) {
    return targetNames.get(targetPart) || targetPart
  }

  // Try stripping numeric suffix (api_1 -> api)
  const withoutSuffix = targetPart.replace(/_\d+$/, '')
  if (targetNames.has(withoutSuffix)) {
    return targetNames.get(withoutSuffix) || withoutSuffix
  }

  // Try first part before underscore
  const firstPart = targetPart.split('_')[0] || ''
  if (firstPart && targetNames.has(firstPart)) {
    return targetNames.get(firstPart) || firstPart
  }

  // Return original
  return targetPart
}

/**
 * Run docker buildx bake with streaming progress
 *
 * Spawns `docker buildx bake` with the generated config file and
 * parses the rawjson output to emit progress events per service.
 *
 * @param bakeFilePath - Path to the docker-bake.json file
 * @param services - Services being built (for name mapping)
 * @param onProgress - Callback for progress updates
 * @returns Either error or map of service name to image reference
 */
export const runBake = async (
  bakeFilePath: string,
  services: BakeServiceConfig[],
  onProgress: (progress: BakeProgress) => void
): Promise<Either<DeployError, Map<string, string>>> => {
  const { spawn } = await import('child_process')

  // Build target name mapping (sanitized -> original)
  const targetNames = new Map<string, string>()
  for (const service of services) {
    const sanitized = service.name.replace(/[^a-zA-Z0-9_-]/g, '_')
    targetNames.set(sanitized, service.name)
  }

  // Track vertex state across events
  const vertexState = new Map<string, { target: string | null; completed: boolean; error: boolean }>()

  // For single-service bakes, vertex names don't include target prefix
  // Use the service name as default target
  const defaultTarget = services.length === 1 ? services[0]?.name ?? null : null

  return new Promise((resolve) => {
    const args = [
      'buildx', 'bake',
      '-f', bakeFilePath,
      '--push',
      '--progress=rawjson'
    ]

    const proc = spawn('docker', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stderr = ''
    let hasError = false

    // Parse stderr line by line (rawjson outputs to stderr)
    let stderrBuffer = ''
    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString()
      stderrBuffer += text

      const lines = stderrBuffer.split('\n')
      // Keep the last incomplete line in buffer
      stderrBuffer = lines.pop() || ''

      for (const line of lines) {
        const progressEvents = parseRawJsonLine(line, targetNames, vertexState, defaultTarget)
        for (const progress of progressEvents) {
          if (progress.error) {
            hasError = true
          }
          onProgress(progress)
        }

        // Also capture non-JSON lines as potential error output
        if (line.trim() && !line.trim().startsWith('{')) {
          stderr += line + '\n'
        }
      }
    })

    // Stdout may contain warnings or other output
    proc.stdout.on('data', (data: Buffer) => {
      // rawjson primarily uses stderr, but capture stdout for debugging
      const text = data.toString()
      if (text.trim()) {
        stderr += text
      }
    })

    proc.on('close', (code: number) => {
      // Process any remaining buffer
      if (stderrBuffer) {
        const progressEvents = parseRawJsonLine(stderrBuffer, targetNames, vertexState, defaultTarget)
        for (const progress of progressEvents) {
          onProgress(progress)
        }
      }

      if (code !== 0 || hasError) {
        resolve(Left(
          createBuildError(
            'DockerBuildFailed',
            `docker buildx bake failed with exit code ${code}${stderr ? `\n${stderr}` : ''}`,
            'bake'
          )
        ))
        return
      }

      // Build succeeded - create image reference map
      const imageRefs = new Map<string, string>()
      for (const service of services) {
        // The image was pushed with the tag we specified
        imageRefs.set(service.name, service.tag)
      }

      resolve(Right(imageRefs))
    })

    proc.on('error', (err: Error) => {
      resolve(Left(
        createBuildError(
          'DockerBuildFailed',
          `Failed to start docker buildx bake: ${err.message}`,
          'bake'
        )
      ))
    })
  })
}
