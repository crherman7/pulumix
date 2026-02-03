/**
 * Refresh command - Reconcile stack state with cloud resources
 */

import chalk from 'chalk'
import * as path from 'path'
import { Orchestrator, createEventEmitter, formatError } from '@pulumix/core'
import { createEventBus, createUIShell } from '../ui'
import { pulumiLogger } from '../ui/logger'

export interface RefreshCommandOptions {
  readonly path?: string
  readonly verbose?: boolean
}

/**
 * Execute refresh command
 */
export async function refreshCommand(
  stackName: string,
  options: RefreshCommandOptions
): Promise<void> {
  const rootPath = path.resolve(options.path || process.cwd())

  const orchestratorEvents = createEventEmitter()

  const uiEventBus = createEventBus()
  const ui = createUIShell(uiEventBus, {
    verbose: options.verbose,
    interactive: process.stdout.isTTY
  })

  orchestratorEvents.on((event) => {
    uiEventBus.emit(event)
  })

  try {
    console.log('')
    console.log(chalk.bold(`pulumix refresh ${chalk.cyan(stackName)}`))
    console.log(chalk.dim(rootPath))

    const orchestrator = new Orchestrator(orchestratorEvents)

    const result = await orchestrator
      .refresh({
        rootPath,
        stackName,
        onOutput: pulumiLogger
      })
      .run()

    if (result.isLeft()) {
      const error = result.extract()
      const formatted = formatError(error)
      console.error('')
      console.error(chalk.red(formatted))

      if (options.verbose && error.cause) {
        console.error('')
        console.error(chalk.dim('Caused by:'))
        console.error(chalk.dim(error.cause.stack || error.cause.message))
      }

      process.exit(1)
    }

    const refreshResult = result.unsafeCoerce()

    if (refreshResult.success) {
      console.log('')
      console.log(chalk.bold('Summary'))
      console.log(`  ${chalk.green('✓')} Stack refreshed`)
      console.log(`  ${chalk.dim('•')} Stack: ${chalk.cyan(refreshResult.stack)}`)
      console.log(`  ${chalk.dim('•')} Duration: ${(refreshResult.duration / 1000).toFixed(1)}s`)
      console.log('')
    } else {
      ui.error('Refresh completed with errors')
      process.exit(1)
    }
  } catch (err: any) {
    ui.error(`Unexpected error: ${err.message}`)
    if (options.verbose) {
      console.error(err)
    }
    process.exit(1)
  } finally {
    ui.cleanup()
    uiEventBus.close()
  }
}
