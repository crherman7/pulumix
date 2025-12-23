/**
 * Docker utilities using dockerode SDK
 *
 * Provides typed, promise-based Docker operations with progress streaming.
 */

import Docker from 'dockerode'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import * as tar from 'tar-fs'
import { Either, Left, Right } from 'purify-ts/Either'
import { DeployError, createBuildError } from './types/errors'

// ============================================================================
// Types
// ============================================================================

export interface BuildProgress {
  /** Current build step (e.g., "Step 1/5") */
  step?: string
  /** Current step number */
  current?: number
  /** Total steps */
  total?: number
  /** Progress message */
  message: string
  /** Stream type (stdout/stderr) */
  stream?: 'stdout' | 'stderr'
}

export interface PushProgress {
  /** Layer ID being pushed */
  id?: string
  /** Status message */
  status: string
  /** Progress percentage (0-100) */
  progress?: number
  /** Progress bar string */
  progressDetail?: {
    current?: number
    total?: number
  }
}

export interface BuildOptions {
  /** Path to the build context (directory containing Dockerfile) */
  contextPath: string
  /** Image tag (e.g., "registry/image:tag") */
  tag: string
  /** Optional Dockerfile path relative to context */
  dockerfile?: string
  /** Build arguments */
  buildArgs?: Record<string, string>
  /** Progress callback */
  onProgress?: (progress: BuildProgress) => void
}

export interface PushOptions {
  /** Image tag to push */
  tag: string
  /** Registry auth config (optional for local registries) */
  auth?: {
    username: string
    password: string
    serveraddress: string
  }
  /** Progress callback */
  onProgress?: (progress: PushProgress) => void
}

export interface BuildResult {
  /** The image tag that was built */
  tag: string
  /** Image ID */
  imageId?: string
}

export interface PushResult {
  /** The image tag that was pushed */
  tag: string
  /** Digest of the pushed image */
  digest?: string
}

// ============================================================================
// Docker Client Singleton
// ============================================================================

let dockerClient: Docker | null = null

/**
 * Get or create Docker client
 */
export const getDockerClient = (): Docker => {
  if (!dockerClient) {
    dockerClient = new Docker()
  }
  return dockerClient
}

// ============================================================================
// Build Image
// ============================================================================

/**
 * Build a Docker image with progress streaming
 */
export const buildImage = async (
  options: BuildOptions
): Promise<Either<DeployError, BuildResult>> => {
  const docker = getDockerClient()
  const { contextPath, tag, dockerfile, buildArgs, onProgress } = options

  // Validate context path
  if (!fs.existsSync(contextPath)) {
    return Left(
      createBuildError(
        'DockerBuildFailed',
        `Build context not found: ${contextPath}`,
        tag
      )
    )
  }

  // Check for Dockerfile with path traversal protection
  const dockerfilePath = dockerfile || 'Dockerfile'
  const normalizedContext = path.resolve(contextPath)
  const fullDockerfilePath = path.resolve(path.join(normalizedContext, dockerfilePath))

  // Prevent path traversal attacks
  if (!fullDockerfilePath.startsWith(normalizedContext)) {
    return Left(
      createBuildError(
        'DockerBuildFailed',
        `Dockerfile path escapes build context: ${dockerfilePath}`,
        tag
      )
    )
  }

  if (!fs.existsSync(fullDockerfilePath)) {
    return Left(
      createBuildError(
        'DockerBuildFailed',
        `Dockerfile not found: ${fullDockerfilePath}`,
        tag
      )
    )
  }

  try {
    // Create tar stream from context
    const tarStream = tar.pack(contextPath)

    // Build options
    const buildOptions: Docker.ImageBuildOptions = {
      t: tag,
      dockerfile: dockerfilePath,
      buildargs: buildArgs,
    }

    // Start build
    const stream = await docker.buildImage(tarStream, buildOptions)

    // Process build output
    let imageId: string | undefined

    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(
        stream,
        // On finished
        (err: Error | null, output: Array<{ stream?: string; error?: string; aux?: { ID?: string } }>) => {
          if (err) {
            reject(err)
            return
          }

          // Check for errors in output
          const errorOutput = output.find(o => o.error)
          if (errorOutput) {
            reject(new Error(errorOutput.error))
            return
          }

          // Extract image ID from aux data
          const auxOutput = output.find(o => o.aux?.ID)
          if (auxOutput?.aux?.ID) {
            imageId = auxOutput.aux.ID
          }

          resolve()
        },
        // On progress
        (event: { stream?: string; status?: string; error?: string; aux?: { ID?: string } }) => {
          if (event.error) {
            // Error will be handled in onFinished
            return
          }

          if (event.aux?.ID) {
            imageId = event.aux.ID
          }

          if (event.stream && onProgress) {
            const line = event.stream.trim()
            if (!line) return

            // Parse step progress
            const stepMatch = line.match(/^Step (\d+)\/(\d+)\s*:\s*(.*)/)
            if (stepMatch) {
              onProgress({
                step: `Step ${stepMatch[1]}/${stepMatch[2]}`,
                current: parseInt(stepMatch[1] || '0'),
                total: parseInt(stepMatch[2] || '1'),
                message: stepMatch[3] || line,
                stream: 'stdout'
              })
            } else if (line.includes('Successfully built') || line.includes('Successfully tagged')) {
              onProgress({
                message: line,
                stream: 'stdout'
              })
            } else if (line.startsWith('---> ') || line.includes('Removing intermediate')) {
              // Skip intermediate output
            } else {
              onProgress({
                message: line,
                stream: 'stdout'
              })
            }
          }
        }
      )
    })

    return Right({ tag, imageId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Left(
      createBuildError(
        'DockerBuildFailed',
        message,
        tag
      )
    )
  }
}

// ============================================================================
// Push Image
// ============================================================================

/**
 * Push a Docker image to a registry with progress streaming
 */
export const pushImage = async (
  options: PushOptions
): Promise<Either<DeployError, PushResult>> => {
  const docker = getDockerClient()
  const { tag, auth, onProgress } = options

  try {
    const image = docker.getImage(tag)

    // Push options
    const pushOptions: Record<string, unknown> = {}
    if (auth) {
      pushOptions.authconfig = auth
    }

    // Start push
    const stream = await image.push(pushOptions)

    // Process push output
    let digest: string | undefined

    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(
        stream,
        // On finished
        (err: Error | null, output: Array<{ status?: string; error?: string; aux?: { Digest?: string } }>) => {
          if (err) {
            reject(err)
            return
          }

          // Check for errors in output
          const errorOutput = output.find(o => o.error)
          if (errorOutput) {
            reject(new Error(errorOutput.error))
            return
          }

          // Extract digest from aux data
          const auxOutput = output.find(o => o.aux?.Digest)
          if (auxOutput?.aux?.Digest) {
            digest = auxOutput.aux.Digest
          }

          resolve()
        },
        // On progress
        (event: { id?: string; status?: string; progress?: string; progressDetail?: { current?: number; total?: number }; error?: string; aux?: { Digest?: string } }) => {
          if (event.error) {
            return
          }

          if (event.aux?.Digest) {
            digest = event.aux.Digest
          }

          if (onProgress && event.status) {
            const progressPercent = event.progressDetail?.current && event.progressDetail?.total
              ? Math.round((event.progressDetail.current / event.progressDetail.total) * 100)
              : undefined

            onProgress({
              id: event.id,
              status: event.status,
              progress: progressPercent,
              progressDetail: event.progressDetail
            })
          }
        }
      )
    })

    return Right({ tag, digest })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Left(
      createBuildError(
        'DockerPushFailed',
        message,
        tag
      )
    )
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Build and push an image in one operation
 */
export const buildAndPushImage = async (
  buildOptions: BuildOptions,
  pushAuth?: PushOptions['auth']
): Promise<Either<DeployError, { build: BuildResult; push: PushResult }>> => {
  // Build
  const buildResult = await buildImage(buildOptions)
  if (buildResult.isLeft()) {
    return Left(buildResult.extract() as DeployError)
  }

  // Push
  const pushResult = await pushImage({
    tag: buildOptions.tag,
    auth: pushAuth,
    onProgress: buildOptions.onProgress ? (p) => {
      buildOptions.onProgress?.({
        message: `${p.status}${p.id ? ` ${p.id}` : ''}${p.progress ? ` (${p.progress}%)` : ''}`,
        stream: 'stdout'
      })
    } : undefined
  })

  if (pushResult.isLeft()) {
    return Left(pushResult.extract() as DeployError)
  }

  return Right({
    build: buildResult.extract() as BuildResult,
    push: pushResult.extract() as PushResult
  })
}

/**
 * Check if Docker is available
 */
export const isDockerAvailable = async (): Promise<boolean> => {
  try {
    const docker = getDockerClient()
    await docker.ping()
    return true
  } catch {
    return false
  }
}

// ============================================================================
// Content Hashing
// ============================================================================

/**
 * Default patterns to ignore when hashing build context
 */
const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  '.gitignore',
  '.DS_Store',
  '*.log',
  '.env',
  '.env.*',
  'dist',
  'build',
  'coverage',
  '.nyc_output',
  '.turbo',
]

/**
 * Check if a file/directory should be ignored
 */
const shouldIgnore = (name: string, ignorePatterns: string[]): boolean => {
  return ignorePatterns.some(pattern => {
    if (pattern.startsWith('*')) {
      // Wildcard pattern like *.log
      return name.endsWith(pattern.slice(1))
    }
    return name === pattern
  })
}

/**
 * Recursively collect all files in a directory (async)
 */
const collectFilesAsync = async (
  dir: string,
  baseDir: string,
  ignorePatterns: string[]
): Promise<string[]> => {
  const files: string[] = []
  const entries = await fs.promises.readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    if (shouldIgnore(entry.name, ignorePatterns)) {
      continue
    }

    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      const subFiles = await collectFilesAsync(fullPath, baseDir, ignorePatterns)
      files.push(...subFiles)
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }

  return files
}

/**
 * Compute SHA256 hash of a build context directory
 *
 * Hashes all files (sorted by path) to create a deterministic content hash.
 * This can be used as an image tag to enable build caching.
 *
 * @returns Short hash (first 12 characters of SHA256)
 */
export const hashBuildContext = async (
  contextPath: string,
  ignorePatterns: string[] = DEFAULT_IGNORE_PATTERNS
): Promise<string> => {
  const hash = crypto.createHash('sha256')

  // Collect and sort all files for deterministic hashing
  const files = (await collectFilesAsync(contextPath, contextPath, ignorePatterns)).sort()

  for (const file of files) {
    // Include relative path in hash (so moving files changes hash)
    const relativePath = path.relative(contextPath, file)
    hash.update(relativePath)

    // Include file contents (async)
    const content = await fs.promises.readFile(file)
    hash.update(content)
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
