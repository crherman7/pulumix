/**
 * List command - Display all discovered services
 */

import chalk from 'chalk'
import { discoverServices, discoverPublishedServices } from '@pulumix/core'
import * as path from 'path'
import * as fs from 'fs'
import * as yaml from 'yaml'

export interface ListCommandOptions {
  readonly path?: string
  readonly verbose?: boolean
  readonly json?: boolean
}

/**
 * Execute list command
 */
export async function listCommand(options: ListCommandOptions): Promise<void> {
  const rootPath = path.resolve(options.path || process.cwd())

  console.log('')
  console.log(chalk.bold('pulumix list'))
  console.log(chalk.dim(rootPath))
  console.log('')

  // Load root config for allowlist
  const rootConfigPath = path.join(rootPath, 'pulumix.yaml')
  let allowlist: string[] = []

  if (fs.existsSync(rootConfigPath)) {
    const rootConfig = yaml.parse(fs.readFileSync(rootConfigPath, 'utf-8'))
    allowlist = rootConfig?.services?.allowed ?? []
  }

  // Discover services
  const localResult = await discoverServices(rootPath)
  const publishedResult = await discoverPublishedServices(rootPath, allowlist)

  if (localResult.isLeft()) {
    console.error(chalk.red(`Error discovering services: ${localResult.extract().message}`))
    process.exit(1)
  }

  if (publishedResult.isLeft()) {
    console.error(chalk.red(`Error discovering published services: ${publishedResult.extract().message}`))
    process.exit(1)
  }

  const localServices = localResult.unsafeCoerce()
  const publishedServices = publishedResult.unsafeCoerce()

  // JSON output
  if (options.json) {
    console.log(JSON.stringify({
      local: localServices,
      published: publishedServices
    }, null, 2))
    return
  }

  // Human-readable output
  if (localServices.length > 0) {
    console.log(chalk.bold('Local Services'))
    for (const service of localServices) {
      const version = chalk.dim(`v${service.metadata.version}`)
      const deps = service.dependencies.length > 0
        ? chalk.dim(` (deps: ${service.dependencies.join(', ')})`)
        : ''

      console.log(`  ${chalk.cyan(service.name)} ${version}${deps}`)

      if (options.verbose && service.metadata.description) {
        console.log(`     ${chalk.dim(service.metadata.description)}`)
      }
    }
    console.log('')
  }

  if (publishedServices.length > 0) {
    console.log(chalk.bold('Published Services'))
    for (const service of publishedServices) {
      const version = chalk.dim(`v${service.metadata.version}`)
      const deps = service.dependencies.length > 0
        ? chalk.dim(` (deps: ${service.dependencies.join(', ')})`)
        : ''

      console.log(`  ${chalk.cyan(service.name)} ${version}${deps}`)

      if (options.verbose && service.metadata.description) {
        console.log(`     ${chalk.dim(service.metadata.description)}`)
      }
    }
    console.log('')
  }

  // Summary
  const total = localServices.length + publishedServices.length
  console.log(chalk.dim(`Total: ${total} service(s)`))
  console.log('')
}
