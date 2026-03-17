/**
 * Validate command - Validate all service configurations
 */

import chalk from 'chalk'
import { validateServiceManifest, formatError } from '@pulumix/core'
import * as path from 'path'
import * as fs from 'fs'
import * as yaml from 'yaml'
import { discoverAllServices } from '../utils/discover'

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

  let hasErrors = false

  // Validate root config
  console.log(chalk.bold('Root Configuration'))
  const rootConfigPath = path.join(rootPath, 'pulumix.yaml')
  if (!fs.existsSync(rootConfigPath)) {
    console.log(`  ${chalk.red('✗')} pulumix.yaml not found`)
    hasErrors = true
  } else {
    try {
      yaml.parse(fs.readFileSync(rootConfigPath, 'utf-8'))
      console.log(`  ${chalk.green('✓')} pulumix.yaml is valid`)
    } catch (err: any) {
      console.log(`  ${chalk.red('✗')} pulumix.yaml has errors`)
      console.log(`     ${chalk.dim(err.message)}`)
      hasErrors = true
    }
  }
  console.log('')

  // Discover and validate services
  const result = await discoverAllServices(rootPath).run()

  if (result.isLeft()) {
    console.error(chalk.red('Failed to discover services'))
    process.exit(1)
  }

  const { allServices } = result.unsafeCoerce()

  console.log(chalk.bold('Service Configurations'))

  for (const service of allServices) {
    // Re-validate manifest (discovery already validates, but let's be explicit)
    const manifest = yaml.parse(fs.readFileSync(service.configPath, 'utf-8'))
    const validationResult = validateServiceManifest(manifest, service.configPath)

    if (validationResult.isLeft()) {
      const error = validationResult.extract()
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
