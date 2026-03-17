/**
 * Shared service discovery utilities.
 *
 * Uses EitherAsync for composable async error handling.
 */

import * as path from 'path'
import * as fs from 'fs'
import * as yaml from 'yaml'
import { EitherAsync } from 'purify-ts'
import { discoverServices, discoverPublishedServices, DeployError, DiscoveredService } from '@pulumix/core'

export interface DiscoveryResult {
  readonly localServices: readonly DiscoveredService[]
  readonly publishedServices: readonly DiscoveredService[]
  readonly allServices: readonly DiscoveredService[]
  readonly allowlist: readonly string[]
}

/**
 * Load allowlist from root config.
 * Pure function that reads config and extracts allowlist.
 */
const loadAllowlist = (rootPath: string): string[] => {
  const rootConfigPath = path.join(rootPath, 'pulumix.yaml')
  if (!fs.existsSync(rootConfigPath)) {
    return []
  }
  try {
    const rootConfig = yaml.parse(fs.readFileSync(rootConfigPath, 'utf-8'))
    return rootConfig?.services?.allowed ?? []
  } catch {
    return []
  }
}

/**
 * Discover all services using EitherAsync for composable error handling.
 * Combines local and published service discovery.
 *
 * @param rootPath - The project root path
 * @returns EitherAsync containing either an error or the discovery result
 *
 * @example
 * ```typescript
 * const result = await discoverAllServices(rootPath).run()
 *
 * if (result.isLeft()) {
 *   console.error(result.extract().message)
 *   return
 * }
 *
 * const { localServices, publishedServices, allServices } = result.unsafeCoerce()
 * ```
 */
export const discoverAllServices = (rootPath: string): EitherAsync<DeployError, DiscoveryResult> =>
  EitherAsync(async ({ liftEither }) => {
    const allowlist = loadAllowlist(rootPath)

    const localServices = await liftEither(await discoverServices(rootPath))
    const publishedServices = await liftEither(await discoverPublishedServices(rootPath, allowlist))

    const allServices = [...localServices, ...publishedServices]

    return { localServices, publishedServices, allServices, allowlist }
  })
