/**
 * List command - Display all discovered services
 */

import chalk from 'chalk'
import * as path from 'path'
import { discoverAllServices } from '../utils/discover'

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

  const result = await discoverAllServices(rootPath).run()

  if (result.isLeft()) {
    console.error(chalk.red(`Error: ${result.extract().message}`))
    process.exit(1)
  }

  const { localServices, publishedServices } = result.unsafeCoerce()

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
    }
    console.log('')
  }

  // Summary
  const total = localServices.length + publishedServices.length
  console.log(chalk.dim(`Total: ${total} service(s)`))
  console.log('')
}
