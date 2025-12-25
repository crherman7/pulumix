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
  return `  Stack: ${chalk.cyan(config.stackName)}`
}
