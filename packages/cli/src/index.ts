#!/usr/bin/env node
/**
 * Pulumix CLI
 *
 * Simple service-based deployment orchestration.
 */

import { Command } from 'commander'
import * as path from 'path'
import { Orchestrator, createEventEmitter, formatError } from '@pulumix/core'
import { createEventBus, createUIShell, DeploymentConfig } from './ui'
import { pulumiLogger } from './ui/logger'
import { listCommand } from './commands/list'
import { validateCommand } from './commands/validate'
import { inspectCommand } from './commands/inspect'
import { graphCommand } from './commands/graph'
import { statusCommand } from './commands/status'
import { refreshCommand } from './commands/refresh'
import { previewCommand } from './commands/preview'
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

    // Set deployment config for pre-deployment summary
    const config: DeploymentConfig = {
      stackName,
      services: [], // Will be populated during discovery
      rootPath
    }
    ui.setDeploymentConfig(config)

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

    const deployResult = result.unsafeCoerce()

    // Print final summary
    ui.printFinalSummary({
      success: deployResult.success,
      stack: deployResult.stack,
      servicesDeployed: deployResult.servicesDeployed,
      duration: deployResult.duration
    })

    if (!deployResult.success) {
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

  // List command
  program
    .command('list')
    .description('List all discovered services')
    .option('-p, --path <path>', 'Root path for deployment files', process.cwd())
    .option('-v, --verbose', 'Show detailed information', false)
    .option('--json', 'Output as JSON', false)
    .action(listCommand)

  // Validate command
  program
    .command('validate')
    .description('Validate service configurations')
    .option('-p, --path <path>', 'Root path for deployment files', process.cwd())
    .option('-v, --verbose', 'Show detailed errors', false)
    .action(validateCommand)

  // Inspect command
  program
    .command('inspect')
    .description('Show detailed information about a service')
    .argument('<service>', 'Service name to inspect')
    .option('-p, --path <path>', 'Root path for deployment files', process.cwd())
    .option('--json', 'Output as JSON', false)
    .action(inspectCommand)

  // Status command
  program
    .command('status')
    .description('Show current stack outputs')
    .argument('<stack>', 'Stack name')
    .option('-p, --path <path>', 'Root path for deployment files', process.cwd())
    .option('--json', 'Output as JSON', false)
    .action(statusCommand)

  // Preview command
  program
    .command('preview')
    .description('Preview changes without deploying')
    .argument('<stack>', 'Stack name')
    .option('-p, --path <path>', 'Root path for deployment files', process.cwd())
    .option('-s, --services <services>', 'Comma-separated list of services to preview')
    .option('-v, --verbose', 'Enable verbose logging', false)
    .action(previewCommand)

  // Refresh command
  program
    .command('refresh')
    .description('Refresh stack state from cloud resources')
    .argument('<stack>', 'Stack name')
    .option('-p, --path <path>', 'Root path for deployment files', process.cwd())
    .option('-v, --verbose', 'Enable verbose logging', false)
    .action(refreshCommand)

  // Graph command
  program
    .command('graph')
    .description('Visualize service dependency graph')
    .option('-p, --path <path>', 'Root path for deployment files', process.cwd())
    .option('-f, --format <format>', 'Output format: tree, dot, mermaid', 'tree')
    .action(graphCommand)

  // Parse arguments
  program.parse()
}

// Run CLI
main()
