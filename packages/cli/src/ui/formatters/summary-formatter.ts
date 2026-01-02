/**
 * Summary Formatter
 *
 * Professional final summary with ASCII tables
 */

import chalk from 'chalk'
import { DeploymentResult, PhaseMetric, ResourceSummary } from './types'

/**
 * Format duration from milliseconds to human readable
 */
function formatDuration(ms: number): string {
  const seconds = ms / 1000
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds.toFixed(0)}s`
}

/**
 * Format resource summary
 */
function formatResourceSummary(summary: ResourceSummary): string[] {
  const lines: string[] = []
  const parts: string[] = []

  if (summary.created > 0) {
    parts.push(chalk.green(`${summary.created} created`))
  }
  if (summary.updated > 0) {
    parts.push(chalk.yellow(`${summary.updated} updated`))
  }
  if (summary.deleted > 0) {
    parts.push(chalk.red(`${summary.deleted} deleted`))
  }
  if (summary.replaced > 0) {
    parts.push(chalk.red(`${summary.replaced} replaced`))
  }
  if (summary.unchanged > 0) {
    parts.push(chalk.dim(`${summary.unchanged} unchanged`))
  }

  if (parts.length > 0) {
    lines.push(`  Resources:`)
    lines.push(`    ${parts.join(', ')}`)
  }

  return lines
}

/**
 * Map phase names to display names
 */
const PHASE_DISPLAY_NAMES: Record<string, string> = {
  'Configuration': 'Configuration',
  'Discovery': 'Discovery',
  'DependencyGraph': 'Dependencies',
  'Bootstrap': 'Hooks',
  'Build': 'Build',
  'Deploy': 'Deploy',
  'Secrets': 'Secrets',
  'Outputs': 'Outputs'
}

/**
 * Format phase timing breakdown
 */
function formatPhaseTiming(phases: PhaseMetric[]): string[] {
  if (phases.length === 0) {
    return []
  }

  const lines: string[] = []
  lines.push(`  Duration:`)

  // Calculate total
  const totalDuration = phases.reduce((sum, p) => sum + p.duration, 0)

  // Show each phase with display names
  for (const phase of phases) {
    const displayName = PHASE_DISPLAY_NAMES[phase.phase] || phase.phase
    const name = displayName.padEnd(14)
    const duration = formatDuration(phase.duration)
    lines.push(`    ${chalk.dim(name)} ${duration}`)
  }

  // Separator and total
  lines.push(`    ${chalk.dim('─'.repeat(20))}`)
  lines.push(`    ${chalk.dim('Total'.padEnd(14))} ${chalk.bold(formatDuration(totalDuration))}`)

  return lines
}

/**
 * Format final deployment summary
 */
export function formatFinalSummary(
  result: DeploymentResult,
  phases: PhaseMetric[]
): string {
  const lines: string[] = []

  lines.push('')
  lines.push(chalk.bold('Summary'))
  lines.push('')

  // Resource summary
  if (result.resourceSummary) {
    lines.push(...formatResourceSummary(result.resourceSummary))
    lines.push('')
  }

  // Phase timing
  if (phases.length > 0) {
    lines.push(...formatPhaseTiming(phases))
    lines.push('')
  }

  // Final status
  if (result.success) {
    lines.push(`  ${chalk.green('+')} Deployment completed`)
  } else {
    lines.push(`  ${chalk.red('-')} Deployment failed`)
  }

  lines.push('')

  return lines.join('\n')
}
