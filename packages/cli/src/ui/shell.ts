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
import cliSpinners from 'cli-spinners'
import logUpdate from 'ansi-diff'
import { DeploymentEventBus } from './streams/event-bus'
import { PhaseName } from '@pulumix/core'
import {
  DeploymentConfig,
  PhaseMetric,
  DeploymentResult,
  formatDeploymentConfig,
  formatFinalSummary
} from './formatters'

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
  'Bootstrap': 'Cluster',
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

// ============================================================================
// Build Task Spinner (inline, simple approach)
// ============================================================================

interface BuildTask {
  id: string
  label: string       // Original task name (e.g., "hello-world")
  status: string      // Current status message (e.g., "Step 1/5: FROM node")
  phase: string
  startTime: number
  spinnerFrame: number
}

const createBuildTaskSpinner = () => {
  const tasks = new Map<string, BuildTask>()
  let interval: NodeJS.Timeout | null = null

  const updater = logUpdate({
    height: process.stdout.rows,
    width: process.stdout.columns,
  })

  process.stdout.on('resize', () => {
    updater.resize({ width: process.stdout.columns, height: process.stdout.rows })
  })

  const getSpinnerFrame = (frame: number): string =>
    cliSpinners.dots.frames[frame % cliSpinners.dots.frames.length] ?? ''

  // Truncate long strings (like SHA hashes)
  const truncate = (str: string, maxLen: number = 40): string => {
    if (str.length <= maxLen) return str
    // For SHA hashes, show first 12 chars
    if (str.includes('sha256:')) {
      return str.replace(/sha256:[a-f0-9]+/g, (match) => match.slice(0, 19) + '...')
    }
    return str.slice(0, maxLen - 3) + '...'
  }

  const render = (): void => {
    const lines: string[] = []
    for (const task of tasks.values()) {
      const frame = getSpinnerFrame(task.spinnerFrame)
      const elapsed = ((Date.now() - task.startTime) / 1000).toFixed(1)
      const statusText = task.status ? ` ${chalk.dim(truncate(task.status))}` : ''
      lines.push(`  ${chalk.green(frame)} ${task.label}${statusText} ${chalk.dim(`(${elapsed}s)`)}`)
      task.spinnerFrame++
    }

    if (lines.length > 0) {
      if (process.stdout.isTTY) {
        process.stdout.write('\u001B[?25l') // hide cursor
      }
      process.stdout.write(updater.update(lines.join('\n')))
    }
  }

  const clear = (): void => {
    process.stdout.write(updater.update(''))
  }

  const showCursor = (): void => {
    if (process.stdout.isTTY) {
      process.stdout.write('\u001B[?25h')
    }
  }

  return {
    start: (id: string, label: string, phase: string): void => {
      tasks.set(id, { id, label, status: '', phase, startTime: Date.now(), spinnerFrame: 0 })

      if (!interval) {
        interval = setInterval(render, cliSpinners.dots.interval)
      }
    },

    update: (id: string, status: string): void => {
      const task = tasks.get(id)
      if (task) {
        task.status = status
      }
    },

    complete: (id: string, success: boolean, skipped?: boolean, contentHash?: string): { duration: number } | null => {
      const task = tasks.get(id)
      if (!task) return null

      const duration = Date.now() - task.startTime
      tasks.delete(id)

      // If no more tasks, stop interval and clear
      if (tasks.size === 0 && interval) {
        clearInterval(interval)
        interval = null
        clear()
      }

      // Print completion line with label and hash
      const icon = success ? chalk.green('+') : chalk.red('-')
      const statusText = skipped ? chalk.bold.dim('unchanged') : chalk.bold.green('created')
      const hashText = contentHash ? ` ${chalk.dim(`(${contentHash})`)}` : ''
      console.log(`  ${icon} ${task.label}${hashText} ${statusText} ${chalk.dim(`(${(duration / 1000).toFixed(1)}s)`)}`)

      return { duration }
    },

    cleanup: (): void => {
      if (interval) {
        clearInterval(interval)
        interval = null
      }
      clear()
      showCursor()
    }
  }
}

// ============================================================================
// UIShell
// ============================================================================

export class UIShell {
  private readonly eventBus: DeploymentEventBus
  private readonly config: UIShellConfig
  private readonly buildSpinner: ReturnType<typeof createBuildTaskSpinner>
  private unsubscribers: Array<() => void> = []
  private phaseStartTimes: Map<PhaseName, number> = new Map()
  private sectionPrinted: Set<PhaseName> = new Set()
  private resourceCounts: Map<string, number> = new Map()
  private seenResources: Set<string> = new Set()
  private taskPhases: Map<string, PhaseName> = new Map()
  private deploymentConfig?: DeploymentConfig
  private phaseMetrics: Map<PhaseName, PhaseMetric> = new Map()

  constructor(eventBus: DeploymentEventBus, config?: UIShellConfig) {
    this.eventBus = eventBus
    this.config = {
      verbose: false,
      colors: true,
      interactive: process.stdout.isTTY,
      ...config
    }

    // Create build spinner only in dynamic mode
    this.buildSpinner = createBuildTaskSpinner()

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

    // Deploy phase output is handled by pulumiLogger via onOutput, skip here
    if (phase === 'Deploy') {
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

  private isDynamic(): boolean {
    return (this.config.interactive ?? process.stdout.isTTY ?? false) &&
           process.env.IS_INTERACTIVE !== 'false' &&
           process.env.CI !== 'true'
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

        // Print config summary after Configuration section header
        if (event.phase === 'Configuration' && this.deploymentConfig) {
          this.printDeploymentStart(this.deploymentConfig)
        }
      })
    )

    // Phase complete
    this.unsubscribers.push(
      this.eventBus.onPhaseComplete((event) => {
        // Collect phase metric
        const startTime = this.phaseStartTimes.get(event.phase) || Date.now()
        const duration = Date.now() - startTime
        this.collectPhaseMetric(event.phase, duration, event.status as 'success' | 'error')

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

    // Task events for Build/Bootstrap phases (with spinners in dynamic mode)
    this.unsubscribers.push(
      this.eventBus.onTaskStart((event) => {
        this.taskPhases.set(event.taskId, event.phase)

        // Handle Build/Bootstrap with spinners
        if ((event.phase === 'Build' || event.phase === 'Bootstrap') && this.isDynamic()) {
          this.buildSpinner.start(event.taskId, event.taskName, event.phase)
        }
      })
    )

    this.unsubscribers.push(
      this.eventBus.onTaskUpdate((event) => {
        const phase = this.taskPhases.get(event.taskId)
        if ((phase === 'Build' || phase === 'Bootstrap') && this.isDynamic() && event.message) {
          this.buildSpinner.update(event.taskId, event.message)
        }
      })
    )

    this.unsubscribers.push(
      this.eventBus.onTaskComplete((event) => {
        const phase = this.taskPhases.get(event.taskId)
        const skipped = event.skipped ?? false

        if ((phase === 'Build' || phase === 'Bootstrap') && this.isDynamic()) {
          this.buildSpinner.complete(event.taskId, event.status === 'success', skipped, event.contentHash)
        } else if (phase === 'Build' || phase === 'Bootstrap') {
          // Static mode - just print completion (same format as Deploy)
          const icon = event.status === 'success' ? chalk.green('+') : chalk.red('-')
          const duration = event.duration ? ` ${chalk.dim(`(${(event.duration / 1000).toFixed(1)}s)`)}` : ''
          const statusText = skipped ? chalk.bold.dim('unchanged') : chalk.bold.green('created')
          const hashText = event.contentHash ? ` ${chalk.dim(`(${event.contentHash})`)}` : ''
          console.log(`  ${icon} ${event.taskName}${hashText} ${statusText}${duration}`)
        }

        this.taskPhases.delete(event.taskId)
      })
    )
  }

  /**
   * Process Pulumi deploy output line
   * Just tracks resources for summary counts - actual output goes to pulumiLogger via onOutput
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

  /**
   * Set deployment configuration for pre-deployment summary
   */
  setDeploymentConfig(config: DeploymentConfig): void {
    this.deploymentConfig = config
  }

  /**
   * Get collected phase metrics
   */
  getPhaseMetrics(): PhaseMetric[] {
    return Array.from(this.phaseMetrics.values())
  }

  /**
   * Print pre-deployment configuration summary
   */
  printDeploymentStart(config: DeploymentConfig): void {
    console.log(formatDeploymentConfig(config))
  }

  /**
   * Print final deployment summary
   */
  printFinalSummary(result: DeploymentResult): void {
    const phases = this.getPhaseMetrics()
    console.log(formatFinalSummary(result, phases))
  }

  /**
   * Collect phase metric for final summary
   */
  private collectPhaseMetric(phase: PhaseName, duration: number, status: 'success' | 'error'): void {
    this.phaseMetrics.set(phase, { phase, duration, status })
  }

  cleanup(): void {
    // Clean up build spinner
    this.buildSpinner.cleanup()

    for (const unsubscribe of this.unsubscribers) {
      unsubscribe()
    }
    this.unsubscribers = []
  }
}

export const createUIShell = (eventBus: DeploymentEventBus, config?: UIShellConfig): UIShell => {
  return new UIShell(eventBus, config)
}
