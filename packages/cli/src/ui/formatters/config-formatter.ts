/**
 * Config Formatter
 *
 * Formats deployment configuration for pre-deployment summary
 */

import chalk from 'chalk'
import { DeploymentConfig } from './types'

/**
 * Format deployment configuration summary
 */
export function formatDeploymentConfig(config: DeploymentConfig): string {
  const lines: string[] = []

  lines.push(`  Stack:        ${chalk.cyan(config.stackName)}`)
  lines.push(`  Environment:  ${chalk.cyan(config.environment)}`)

  return lines.join('\n')
}
