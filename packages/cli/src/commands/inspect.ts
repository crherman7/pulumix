/**
 * Inspect command - Show detailed information about a service
 */

import chalk from 'chalk'
import { discoverServices, discoverPublishedServices } from '@pulumix/core'
import * as path from 'path'
import * as fs from 'fs'
import * as yaml from 'yaml'

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

  // Discover services
  const rootConfigPath = path.join(rootPath, 'pulumix.yaml')
  let allowlist: string[] = []

  if (fs.existsSync(rootConfigPath)) {
    const rootConfig = yaml.parse(fs.readFileSync(rootConfigPath, 'utf-8'))
    allowlist = rootConfig?.services?.allowed ?? []
  }

  const localResult = await discoverServices(rootPath)
  const publishedResult = await discoverPublishedServices(rootPath, allowlist)

  if (localResult.isLeft() || publishedResult.isLeft()) {
    console.error(chalk.red('Failed to discover services'))
    process.exit(1)
  }

  const localServices = localResult.unsafeCoerce()
  const publishedServices = publishedResult.unsafeCoerce()
  const allServices = [...localServices, ...publishedServices]

  // Find service
  const service = allServices.find(s => s.name === serviceName)

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
  if (service.metadata.description) {
    console.log(`  Description: ${service.metadata.description}`)
  }
  if (service.metadata.team) {
    console.log(`  Team:        ${service.metadata.team}`)
  }
  if (service.metadata.owner) {
    console.log(`  Owner:       ${service.metadata.owner}`)
  }
  if (service.metadata.repository) {
    console.log(`  Repository:  ${service.metadata.repository}`)
  }
  if (service.metadata.documentation) {
    console.log(`  Docs:        ${service.metadata.documentation}`)
  }
  console.log('')

  // Tags
  if (service.metadata.tags && Object.keys(service.metadata.tags).length > 0) {
    console.log(chalk.bold('Tags'))
    for (const [key, value] of Object.entries(service.metadata.tags)) {
      console.log(`  ${key}: ${value}`)
    }
    console.log('')
  }

  // SLA
  if (service.metadata.sla) {
    console.log(chalk.bold('SLA'))
    if (service.metadata.sla.availability) {
      console.log(`  Availability:   ${service.metadata.sla.availability}`)
    }
    if (service.metadata.sla.responseTime) {
      console.log(`  Response Time:  ${service.metadata.sla.responseTime}`)
    }
    if (service.metadata.sla.errorRate) {
      console.log(`  Error Rate:     ${service.metadata.sla.errorRate}`)
    }
    console.log('')
  }

  // Support
  if (service.metadata.support) {
    console.log(chalk.bold('Support'))
    if (service.metadata.support.email) {
      console.log(`  Email:      ${service.metadata.support.email}`)
    }
    if (service.metadata.support.slack) {
      console.log(`  Slack:      ${service.metadata.support.slack}`)
    }
    if (service.metadata.support.pagerduty) {
      console.log(`  PagerDuty:  ${service.metadata.support.pagerduty}`)
    }
    if (service.metadata.support.oncall) {
      console.log(`  On-call:    ${service.metadata.support.oncall}`)
    }
    console.log('')
  }

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

  // Observability
  if (service.observability) {
    console.log(chalk.bold('Observability'))
    if (service.observability.health) {
      console.log(`  Health:   ${service.observability.health.endpoint || '/health'}`)
    }
    if (service.observability.metrics) {
      console.log(`  Metrics:  ${service.observability.metrics.endpoint || '/metrics'}`)
    }
    if (service.observability.logs) {
      console.log(`  Logs:     ${service.observability.logs.format || 'json'}`)
    }
    console.log('')
  }

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
