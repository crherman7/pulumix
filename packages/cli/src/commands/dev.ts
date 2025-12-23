/**
 * Dev command - Run services locally with HMR
 *
 * Deploys dependencies to cluster, sets up port-forwards,
 * and runs specified services locally with hot module replacement.
 */

import chalk from 'chalk'
import * as path from 'path'
import { DevOrchestrator, DevOrchestratorResult, formatError } from '@pulumix/core'
import { createEventBus, createUIShell } from '../ui'

export interface DevCommandOptions {
  readonly path?: string
  readonly verbose?: boolean
}

/**
 * Execute dev command
 */
export async function devCommand(
  stackName: string,
  services: string,
  options: DevCommandOptions
): Promise<void> {
  const rootPath = path.resolve(options.path || process.cwd())
  const devServices = services.split(',').map(s => s.trim()).filter(s => s.length > 0)

  if (devServices.length === 0) {
    console.error(chalk.red('Error: No services specified'))
    console.error(chalk.dim('Usage: pulumix dev <stack> <services>'))
    console.error(chalk.dim('Example: pulumix dev local web-app,api'))
    process.exit(1)
  }

  console.log('')
  console.log(chalk.bold('pulumix dev'))
  console.log(chalk.dim(rootPath))
  console.log('')

  // Create event bus and UI shell
  const uiEventBus = createEventBus()
  const ui = createUIShell(uiEventBus, { verbose: options.verbose })

  // Create dev orchestrator with event bridging
  const { createEventEmitter } = await import('@pulumix/core')
  const orchestratorEvents = createEventEmitter()

  // Bridge orchestrator events to UI
  orchestratorEvents.on((event) => {
    uiEventBus.emit(event)
  })

  const devOrchestrator = new DevOrchestrator(orchestratorEvents)

  // Setup graceful shutdown
  const cleanup = async () => {
    console.log('')
    console.log(chalk.dim('Shutting down...'))
    await devOrchestrator.stop()
    ui.cleanup()
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  // Print configuration
  console.log(chalk.bold('Configuration'))
  console.log(`  Stack:        ${chalk.cyan(stackName)}`)
  console.log(`  Dev Services: ${chalk.cyan(devServices.join(', '))}`)
  console.log('')

  // Start dev mode
  const result = await devOrchestrator.dev({
    rootPath,
    stackName,
    devServices,
    onOutput: (message) => {
      // Print dev server output
      console.log(message)
    },
  }).run()

  if (result.isLeft()) {
    const error = result.extract()
    console.error('')
    console.error(chalk.red('Dev mode failed:'))
    console.error(formatError(error))
    ui.cleanup()
    process.exit(1)
  }

  const devResult = result.unsafeCoerce() as DevOrchestratorResult

  // Print summary
  console.log('')
  console.log(chalk.bold('Dev Mode Active'))
  console.log('')

  if (devResult.portForwards.length > 0) {
    console.log(chalk.dim('  Port Forwards:'))
    for (const pf of devResult.portForwards) {
      console.log(`    ${chalk.green('+')} ${pf.serviceName}:${pf.remotePort} -> localhost:${pf.localPort}`)
    }
    console.log('')
  }

  console.log(chalk.dim('  Dev Servers:'))
  for (const ds of devResult.devServices) {
    console.log(`    ${chalk.green('+')} ${ds.service.name} -> http://localhost:${ds.localPort}`)
  }
  console.log('')

  if (devResult.ingressUrls && devResult.ingressUrls.length > 0) {
    console.log(chalk.dim('  Ingress URLs (routed to local):'))
    for (const url of devResult.ingressUrls) {
      console.log(`    ${chalk.green('+')} ${chalk.cyan(url)}`)
    }
    console.log('')
  }

  console.log(chalk.dim('Press Ctrl+C to stop'))
  console.log('')

  // Wait for dev servers to exit
  await Promise.race(
    devResult.devServerHandles.map(h => h.exited)
  )

  // If a dev server exits unexpectedly, clean up
  console.log('')
  console.log(chalk.yellow('Dev server exited'))
  await cleanup()
}
