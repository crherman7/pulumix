/**
 * Preview command - Preview changes without deploying
 */

import chalk from 'chalk'
import * as path from 'path'
import { Orchestrator, createEventEmitter, formatError } from '@pulumix/core'
import { createEventBus, createUIShell, DeploymentConfig } from '../ui'
import { pulumiLogger } from '../ui/logger'

export interface PreviewCommandOptions {
  readonly path?: string
  readonly services?: string
  readonly verbose?: boolean
}

/**
 * Execute preview command
 */
export async function previewCommand(
  stackName: string,
  options: PreviewCommandOptions
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
    console.log(chalk.bold(`pulumix preview ${chalk.cyan(stackName)}`))
    console.log(chalk.dim(rootPath))

    const config: DeploymentConfig = {
      stackName,
      services: [],
      rootPath
    }
    ui.setDeploymentConfig(config)

    const orchestrator = new Orchestrator(orchestratorEvents)

    const servicesToDeploy = options.services
      ? options.services.split(',').map(s => s.trim())
      : undefined

    if (servicesToDeploy) {
      ui.info(`Previewing services: ${chalk.cyan(servicesToDeploy.join(', '))}`)
    }

    const result = await orchestrator
      .preview({
        rootPath,
        stackName,
        servicesToDeploy,
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

    const previewResult = result.unsafeCoerce()

    // Print change summary
    console.log('')
    console.log(chalk.bold('Summary'))

    const summary = previewResult.changeSummary
    const parts: string[] = []

    if (summary.create) parts.push(chalk.green(`+${summary.create} to create`))
    if (summary.update) parts.push(chalk.yellow(`~${summary.update} to update`))
    if (summary['delete']) parts.push(chalk.red(`-${summary['delete']} to delete`))
    if (summary.same) parts.push(chalk.dim(`${summary.same} unchanged`))

    if (parts.length > 0) {
      console.log(`  ${parts.join(', ')}`)
    } else {
      console.log(`  ${chalk.dim('No changes')}`)
    }

    console.log(`  ${chalk.dim('•')} Stack: ${chalk.cyan(previewResult.stack)}`)
    console.log(`  ${chalk.dim('•')} Duration: ${(previewResult.duration / 1000).toFixed(1)}s`)
    console.log('')
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
