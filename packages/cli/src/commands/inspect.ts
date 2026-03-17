/**
 * Inspect command - Show detailed information about a service
 */

import chalk from 'chalk'
import * as path from 'path'
import { DiscoveredService } from '@pulumix/core'
import { discoverAllServices } from '../utils/discover'

export interface InspectCommandOptions {
  readonly path?: string
  readonly json?: boolean
}

/**
 * Execute inspect command
 */
export async function inspectCommand(
  serviceName: string,
  options: InspectCommandOptions
): Promise<void> {
  const rootPath = path.resolve(options.path || process.cwd())

  const result = await discoverAllServices(rootPath).run()

  if (result.isLeft()) {
    console.error(chalk.red('Failed to discover services'))
    process.exit(1)
  }

  const { allServices } = result.unsafeCoerce()

  // Find service
  const service = allServices.find((s: DiscoveredService) => s.name === serviceName)

  if (!service) {
    console.error('')
    console.error(chalk.red(`Service '${serviceName}' not found`))
    console.error('')
    console.error(chalk.dim('Available services:'))
    for (const s of allServices) {
      console.error(chalk.dim(`  - ${s.name}`))
    }
    console.error('')
    process.exit(1)
  }

  // JSON output
  if (options.json) {
    console.log(JSON.stringify(service, null, 2))
    return
  }

  // Human-readable output
  console.log('')
  console.log(chalk.bold(service.name))
  console.log('')

  // Metadata
  console.log(chalk.bold('Metadata'))
  console.log(`  Version:     ${service.metadata.version}`)
  console.log('')

  // Dependencies
  console.log(chalk.bold('Dependencies'))
  if (service.dependencies.length > 0) {
    for (const dep of service.dependencies) {
      console.log(`  - ${dep}`)
    }
  } else {
    console.log(`  ${chalk.dim('None')}`)
  }
  console.log('')

  // Files
  console.log(chalk.bold('Files'))
  console.log(`  Path:        ${service.path}`)
  console.log(`  Deploy:      ✓ pulumix.ts`)
  console.log(`  Config:      ✓ pulumix.yaml`)
  console.log(`  Dockerfile:  ${service.hasDockerfile ? '✓' : '✗'}`)
  console.log('')

  // Stacks
  const stacks = service.rawConfig.stacks as Record<string, unknown> | undefined
  if (stacks && Object.keys(stacks).length > 0) {
    console.log(chalk.bold('Stacks'))
    for (const stackName of Object.keys(stacks)) {
      console.log(`  - ${stackName}`)
    }
    console.log('')
  }
}
