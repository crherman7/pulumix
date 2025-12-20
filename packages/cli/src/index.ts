#!/usr/bin/env node
/**
 * Pulumix CLI
 *
 * Simple service-based deployment orchestration.
 */

import { Command } from 'commander'
import * as path from 'path'
import { Orchestrator, createEventEmitter } from '@pulumix/core'
import { createEventBus, createUIShell } from './ui'
import chalk from 'chalk'

/**
 * Deploy command
 */
async function deployCommand(
  stackName: string,
  options: {
    path?: string
    services?: string
    verbose?: boolean
  }
): Promise<void> {
  const rootPath = path.resolve(options.path || process.cwd())

  // Create orchestrator event emitter
  const orchestratorEvents = createEventEmitter()

  // Create UI event bus and shell
  const uiEventBus = createEventBus()
  const ui = createUIShell(uiEventBus, {
    verbose: options.verbose,
    interactive: process.stdout.isTTY
  })

  // Bridge orchestrator events to UI event bus
  orchestratorEvents.on((event) => {
    uiEventBus.emit(event)
  })

  try {
    console.log('')
    console.log(chalk.bold(`pulumix deploy ${chalk.cyan(stackName)}`))
    console.log(chalk.dim(rootPath))

    // Create orchestrator
    const orchestrator = new Orchestrator(orchestratorEvents)

    // Parse services filter
    const servicesToDeploy = options.services
      ? options.services.split(',').map(s => s.trim())
      : undefined

    if (servicesToDeploy) {
      ui.info(`Deploying services: ${chalk.cyan(servicesToDeploy.join(', '))}`)
    }

    // Run deployment
    const result = await orchestrator
      .deploy({
        rootPath,
        stackName,
        servicesToDeploy
      })
      .run()

    if (result.isLeft()) {
      const error = result.extract()
      ui.error(`Deployment failed: ${error.message}`)
      if (options.verbose && error.context) {
        console.error(chalk.dim(JSON.stringify(error.context, null, 2)))
      }
      process.exit(1)
    }

    const deployResult = result.unsafeCoerce()

    if (deployResult.success) {
      console.log('')
      console.log(chalk.bold('Summary'))
      console.log(`  ${chalk.green('✓')} Deployment completed`)
      console.log(`  ${chalk.dim('•')} Stack: ${chalk.cyan(deployResult.stack)}`)
      console.log(`  ${chalk.dim('•')} Services: ${chalk.green(deployResult.servicesDeployed)} deployed`)
      console.log(`  ${chalk.dim('•')} Duration: ${(deployResult.duration / 1000).toFixed(1)}s`)
      console.log('')
    } else {
      ui.error('Deployment completed with errors')
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

/**
 * Destroy command
 */
async function destroyCommand(
  stackName: string,
  options: {
    path?: string
    yes?: boolean
    verbose?: boolean
  }
): Promise<void> {
  const rootPath = path.resolve(options.path || process.cwd())

  // Create orchestrator event emitter
  const orchestratorEvents = createEventEmitter()

  // Create UI event bus and shell
  const uiEventBus = createEventBus()
  const ui = createUIShell(uiEventBus, {
    verbose: options.verbose,
    interactive: process.stdout.isTTY
  })

  // Bridge orchestrator events to UI event bus
  orchestratorEvents.on((event) => {
    uiEventBus.emit(event)
  })

  try {
    console.log('')
    console.log(chalk.bold(`pulumix destroy ${chalk.red(stackName)}`))
    console.log(chalk.dim(rootPath))

    if (!options.yes) {
      ui.warn('This will destroy all resources in the stack!')
      ui.warn('Use --yes to confirm destruction')
      process.exit(1)
    }

    // Create orchestrator
    const orchestrator = new Orchestrator(orchestratorEvents)

    // Run destruction
    const result = await orchestrator
      .destroy({
        rootPath,
        stackName
      })
      .run()

    if (result.isLeft()) {
      const error = result.extract()
      ui.error(`Destroy failed: ${error.message}`)
      if (options.verbose && error.context) {
        console.error(chalk.dim(JSON.stringify(error.context, null, 2)))
      }
      process.exit(1)
    }

    const destroyResult = result.unsafeCoerce()

    if (destroyResult.success) {
      console.log('')
      console.log(chalk.bold('Summary'))
      console.log(`  ${chalk.green('✓')} Stack destroyed`)
      console.log(`  ${chalk.dim('•')} Stack: ${chalk.cyan(destroyResult.stack)}`)
      console.log(`  ${chalk.dim('•')} Duration: ${(destroyResult.duration / 1000).toFixed(1)}s`)
      console.log('')
    } else {
      ui.error('Destroy completed with errors')
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

/**
 * Main CLI
 */
function main(): void {
  const program = new Command()

  program
    .name('pulumix')
    .description('Simple service-based deployment orchestration')
    .version('0.0.0')

  // Deploy command
  program
    .command('deploy')
    .description('Deploy services')
    .argument('<stack>', 'Stack name to deploy (local, staging, production)')
    .option('-p, --path <path>', 'Root path for deployment files', process.cwd())
    .option('-s, --services <services>', 'Comma-separated list of services to deploy')
    .option('-v, --verbose', 'Enable verbose logging', false)
    .action(deployCommand)

  // Destroy command
  program
    .command('destroy')
    .description('Destroy a deployed stack')
    .argument('<stack>', 'Stack name to destroy')
    .option('-p, --path <path>', 'Root path for deployment files', process.cwd())
    .option('-y, --yes', 'Skip confirmation prompt', false)
    .option('-v, --verbose', 'Enable verbose logging', false)
    .action(destroyCommand)

  // Parse arguments
  program.parse()
}

// Run CLI
main()
