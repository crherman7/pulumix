/**
 * UI Shell - Professional rocketyard-style CLI output
 *
 * Clean, sectioned output with:
 * - Bold section headers
 * - Indented content (2 spaces)
 * - Aligned timing information
 * - Color-coded status indicators
 */

import chalk from 'chalk'
import { DeploymentEventBus } from './streams/event-bus'
import { PhaseName } from '@pulumix/core'
import { createLogger, Logger } from './logger'

export interface UIShellConfig {
  readonly verbose?: boolean
  readonly colors?: boolean
  readonly interactive?: boolean
}

/**
 * Section display names
 */
const SECTION_NAMES: Record<PhaseName, string> = {
  'Discovery': 'Discovery',
  'Configuration': 'Configuration',
  'DependencyGraph': 'Dependencies',
  'Bootstrap': 'Bootstrap',
  'Secrets': 'Secrets',
  'Build': 'Build',
  'Deploy': 'Deploy',
  'Outputs': 'Outputs'
}

/**
 * Parse Pulumi resource line
 */
const parseResourceLine = (line: string): { symbol: string; type: string; name: string; status: string } | null => {
  const trimmed = line.trim()

  // Match: +  kubernetes:core/v1:Namespace local-hello creating
  // Or: @  kubernetes:core/v1:Namespace local-hello refreshing
  const match = trimmed.match(/^([+~\-!@*])\s+(\S+)\s+(\S+)\s+(\S+)/)
  if (!match) return null

  return {
    symbol: match[1] ?? '+',
    type: match[2] ?? 'unknown',
    name: match[3] ?? 'unknown',
    status: (match[4] ?? 'unknown').replace(/\*\*/g, '')
  }
}

/**
 * Check if status indicates completion
 */
const isCompleteStatus = (status: string): boolean => {
  const complete = ['created', 'updated', 'deleted', 'replaced', 'same', 'read', 'unchanged']
  return complete.includes(status.toLowerCase())
}

export class UIShell {
  private readonly eventBus: DeploymentEventBus
  private readonly config: UIShellConfig
  private readonly logger: Logger
  private unsubscribers: Array<() => void> = []
  private phaseStartTimes: Map<PhaseName, number> = new Map()
  private sectionPrinted: Set<PhaseName> = new Set()
  private resourceCounts: Map<string, number> = new Map()
  private seenResources: Set<string> = new Set()
  private taskPhases: Map<string, PhaseName> = new Map()

  constructor(eventBus: DeploymentEventBus, config?: UIShellConfig) {
    this.eventBus = eventBus
    this.config = {
      verbose: false,
      colors: true,
      interactive: process.stdout.isTTY,
      ...config
    }

    // Create logger with dynamic/static mode based on TTY
    this.logger = createLogger({
      isTTY: this.config.interactive ?? process.stdout.isTTY ?? false,
      isCI: process.env.CI === 'true',
      isInteractive: process.env.IS_INTERACTIVE !== 'false'
    })

    this.setupEventListeners()
  }

  /**
   * Print section header
   */
  private printSection(phase: PhaseName): void {
    if (this.sectionPrinted.has(phase)) return

    const name = SECTION_NAMES[phase] || phase
    console.log('')
    console.log(chalk.bold(name))
    this.sectionPrinted.add(phase)
  }

  /**
   * Print indented line with icon
   */
  private printItem(icon: string, text: string, suffix?: string): void {
    const line = suffix
      ? `  ${icon} ${text}${chalk.dim('  ' + suffix)}`
      : `  ${icon} ${text}`
    console.log(line)
  }

  /**
   * Print indented sub-item
   */
  private printSubItem(text: string): void {
    console.log(`    ${chalk.dim('•')} ${chalk.dim(text)}`)
  }

  /**
   * Format duration
   */
  private formatDuration(ms: number): string {
    const seconds = ms / 1000
    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`
    }
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds.toFixed(0)}s`
  }

  /**
   * Print phase completion
   */
  private printPhaseComplete(phase: PhaseName, status: string): void {
    const startTime = this.phaseStartTimes.get(phase) || Date.now()
    const duration = this.formatDuration(Date.now() - startTime)

    if (phase === 'Outputs') return

    // For Deploy phase, print resource summary
    if (phase === 'Deploy') {
      const created = this.resourceCounts.get('created') || 0
      const updated = this.resourceCounts.get('updated') || 0
      const deleted = this.resourceCounts.get('deleted') || 0
      const same = this.resourceCounts.get('same') || 0

      const parts: string[] = []
      if (created > 0) parts.push(chalk.green(`${created} created`))
      if (updated > 0) parts.push(chalk.yellow(`${updated} updated`))
      if (deleted > 0) parts.push(chalk.red(`${deleted} deleted`))
      if (same > 0) parts.push(chalk.dim(`${same} unchanged`))

      console.log('')
      const icon = status === 'success' ? chalk.green('✓') : chalk.red('✗')
      if (parts.length > 0) {
        this.printItem(icon, parts.join(', '), duration)
      } else {
        this.printItem(icon, 'No changes', duration)
      }
      return
    }

    // Don't print "Done" for most phases - they show their own output
    // Only show completion icon for phases that have detailed output
    if (['Build', 'Configuration', 'Discovery', 'DependencyGraph', 'Bootstrap'].includes(phase)) {
      return
    }

    // For other phases, print simple completion
    const icon = status === 'success' ? chalk.green('✓') : chalk.red('✗')
    this.printItem(icon, 'Done', duration)
  }

  private setupEventListeners(): void {
    // Phase start
    this.unsubscribers.push(
      this.eventBus.onPhaseStart((event) => {
        this.phaseStartTimes.set(event.phase, Date.now())

        // Reset deploy state
        if (event.phase === 'Deploy') {
          this.resourceCounts.clear()
          this.seenResources.clear()
        }

        // Print section header for most phases
        if (event.phase !== 'Outputs') {
          this.printSection(event.phase)
        }
      })
    )

    // Phase complete
    this.unsubscribers.push(
      this.eventBus.onPhaseComplete((event) => {
        this.printPhaseComplete(event.phase, event.status)
      })
    )

    // Diagnostic events
    this.unsubscribers.push(
      this.eventBus.onDiagnostic((event) => {
        if (event.phase === 'Deploy') {
          this.processDeployOutput(event.message)
        } else if (event.phase === 'DependencyGraph') {
          // Tree-style output - no bullet needed
          console.log(`  ${chalk.dim(event.message)}`)
        } else if (event.phase) {
          // Show diagnostic under its section
          this.printItem(chalk.dim('•'), event.message)
        } else if (this.config.verbose) {
          this.printSubItem(event.message)
        }
      })
    )

    // Task events
    this.unsubscribers.push(
      this.eventBus.onTaskStart((event) => {
        this.taskPhases.set(event.taskId, event.phase)
        if (event.phase === 'Build') {
          this.printItem(chalk.blue('○'), `Building ${event.taskName}...`)
        }
      })
    )

    this.unsubscribers.push(
      this.eventBus.onTaskComplete((event) => {
        const phase = this.taskPhases.get(event.taskId)
        if (phase === 'Build') {
          const icon = event.status === 'success' ? chalk.green('✓') : chalk.red('✗')
          const duration = event.duration ? this.formatDuration(event.duration) : ''
          this.printItem(icon, event.taskName, duration)
        }
        this.taskPhases.delete(event.taskId)
      })
    )
  }

  /**
   * Process Pulumi deploy output line
   * Routes through logger for dynamic spinner support
   */
  private processDeployOutput(message: string): void {
    // Track resources for summary counts (still needed for printPhaseComplete)
    const lines = message.split('\n')
    for (const line of lines) {
      const resource = parseResourceLine(line.trim())
      if (resource && isCompleteStatus(resource.status)) {
        const resourceKey = `${resource.type}:${resource.name}`
        if (!this.seenResources.has(resourceKey)) {
          this.seenResources.add(resourceKey)
          const statusKey = resource.status.toLowerCase()
          this.resourceCounts.set(statusKey, (this.resourceCounts.get(statusKey) || 0) + 1)
        }
      }
    }

    // Route through logger for spinner support
    this.logger.log(message)
  }

  log(message: string): void {
    console.log(message)
  }

  info(message: string): void {
    this.printItem(chalk.blue('ℹ'), message)
  }

  success(message: string): void {
    this.printItem(chalk.green('✓'), message)
  }

  warn(message: string): void {
    this.printItem(chalk.yellow('⚠'), message)
  }

  error(message: string): void {
    this.printItem(chalk.red('✗'), message)
  }

  cleanup(): void {
    // Clean up logger (shows cursor, clears spinner interval)
    this.logger.cleanup()

    for (const unsubscribe of this.unsubscribers) {
      unsubscribe()
    }
    this.unsubscribers = []
  }
}

export const createUIShell = (eventBus: DeploymentEventBus, config?: UIShellConfig): UIShell => {
  return new UIShell(eventBus, config)
}
