/**
 * Status command - Show current stack outputs
 */

import chalk from 'chalk'
import * as path from 'path'
import { Orchestrator, formatError } from '@pulumix/core'

export interface StatusCommandOptions {
  readonly path?: string
  readonly json?: boolean
}

/**
 * Execute status command
 */
export async function statusCommand(
  stackName: string,
  options: StatusCommandOptions
): Promise<void> {
  const rootPath = path.resolve(options.path || process.cwd())

  try {
    console.log('')
    console.log(chalk.bold(`pulumix status ${chalk.cyan(stackName)}`))
    console.log(chalk.dim(rootPath))

    const orchestrator = new Orchestrator()

    const result = await orchestrator
      .status({ rootPath, stackName })
      .run()

    if (result.isLeft()) {
      const error = result.extract()
      const formatted = formatError(error)
      console.error('')
      console.error(chalk.red(formatted))
      process.exit(1)
    }

    const statusResult = result.unsafeCoerce()

    if (options.json) {
      console.log(JSON.stringify(statusResult.outputs, null, 2))
      return
    }

    const entries = Object.entries(statusResult.outputs)

    if (entries.length === 0) {
      console.log('')
      console.log(chalk.dim('  No outputs found'))
      console.log('')
      return
    }

    console.log('')
    console.log(chalk.bold('Outputs'))
    for (const [key, value] of entries) {
      if (typeof value === 'object' && value !== null) {
        console.log(`  ${chalk.cyan(key)}:`)
        for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
          console.log(`    ${subKey}: ${chalk.dim(String(subValue))}`)
        }
      } else {
        console.log(`  ${chalk.cyan(key)}: ${chalk.dim(String(value))}`)
      }
    }
    console.log('')
  } catch (err: any) {
    console.error(chalk.red(`Unexpected error: ${err.message}`))
    process.exit(1)
  }
}
