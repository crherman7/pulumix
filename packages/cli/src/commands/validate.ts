/**
 * Validate command - Validate all service configurations
 */

import chalk from 'chalk'
import { discoverServices, discoverPublishedServices, validateServiceManifest, formatError } from '@pulumix/core'
import * as path from 'path'
import * as fs from 'fs'
import * as yaml from 'yaml'

export interface ValidateCommandOptions {
  readonly path?: string
  readonly verbose?: boolean
}

/**
 * Execute validate command
 */
export async function validateCommand(options: ValidateCommandOptions): Promise<void> {
  const rootPath = path.resolve(options.path || process.cwd())

  console.log('')
  console.log(chalk.bold('pulumix validate'))
  console.log(chalk.dim(rootPath))
  console.log('')

  // Load root config
  const rootConfigPath = path.join(rootPath, 'pulumix.yaml')
  let allowlist: string[] = []
  let hasErrors = false

  // Validate root config
  console.log(chalk.bold('Root Configuration'))
  if (!fs.existsSync(rootConfigPath)) {
    console.log(`  ${chalk.red('✗')} pulumix.yaml not found`)
    hasErrors = true
  } else {
    try {
      const rootConfig = yaml.parse(fs.readFileSync(rootConfigPath, 'utf-8'))
      allowlist = rootConfig?.services?.allowed ?? []
      console.log(`  ${chalk.green('✓')} pulumix.yaml is valid`)
    } catch (err: any) {
      console.log(`  ${chalk.red('✗')} pulumix.yaml has errors`)
      console.log(`     ${chalk.dim(err.message)}`)
      hasErrors = true
    }
  }
  console.log('')

  // Discover and validate services
  const localResult = await discoverServices(rootPath)
  const publishedResult = await discoverPublishedServices(rootPath, allowlist)

  if (localResult.isLeft() || publishedResult.isLeft()) {
    console.error(chalk.red('Failed to discover services'))
    process.exit(1)
  }

  const localServices = localResult.unsafeCoerce()
  const publishedServices = publishedResult.unsafeCoerce()
  const allServices = [...localServices, ...publishedServices]

  console.log(chalk.bold('Service Configurations'))

  for (const service of allServices) {
    // Re-validate manifest (discovery already validates, but let's be explicit)
    const manifest = yaml.parse(fs.readFileSync(service.configPath, 'utf-8'))
    const result = validateServiceManifest(manifest, service.configPath)

    if (result.isLeft()) {
      const error = result.extract()
      console.log(`  ${chalk.red('✗')} ${service.name}`)
      if (options.verbose) {
        console.log(chalk.dim(formatError(error)))
      } else {
        console.log(`     ${chalk.dim(error.message.split('\n')[0])}`)
      }
      hasErrors = true
    } else {
      console.log(`  ${chalk.green('✓')} ${service.name}`)

      // Additional checks
      if (!service.hasDockerfile && service.metadata.version) {
        console.log(`     ${chalk.yellow('⚠')} ${chalk.dim('No Dockerfile found')}`)
      }

      // Check for missing dependencies
      const packageJsonPath = path.join(service.path, 'package.json')
      if (!fs.existsSync(packageJsonPath)) {
        console.log(`     ${chalk.yellow('⚠')} ${chalk.dim('No package.json found')}`)
      }
    }
  }

  console.log('')

  // Summary
  if (hasErrors) {
    console.log(chalk.red('✗ Validation failed'))
    console.log('')
    process.exit(1)
  } else {
    console.log(chalk.green('✓ All configurations are valid'))
    console.log('')
  }
}
