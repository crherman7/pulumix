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
  'Bootstrap': 'Hooks',
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
// Column Formatting Helpers
// ============================================================================

// Fit string to fixed column width (pad or truncate)
const fitToWidth = (str: string, width: number): string => {
  if (str.length <= width) return str.padEnd(width)
  return str.slice(0, width - 2) + '..'
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
  contentHash?: string
}

interface CompletedTask {
  label: string
  success: boolean
  skipped: boolean
  contentHash?: string
  duration: number
}

const createBuildTaskSpinner = () => {
  const tasks = new Map<string, BuildTask>()
  const completedTasks: CompletedTask[] = []
  let interval: NodeJS.Timeout | null = null
  let stopped = false

  // Track max column widths (grow only, never shrink)
  let maxNameWidth = 0
  let maxHashWidth = 0

  const updater = logUpdate({
    height: process.stdout.rows ?? 24,
    width: process.stdout.columns ?? 80,
  })

  const resizeHandler = (): void => {
    updater.resize({ width: process.stdout.columns ?? 80, height: process.stdout.rows ?? 24 })
  }
  process.stdout.on('resize', resizeHandler)

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

  const formatCompletedLine = (task: CompletedTask): string => {
    const icon = task.success ? chalk.green('+') : chalk.red('-')
    const name = fitToWidth(task.label, maxNameWidth)
    const hash = task.contentHash
      ? chalk.dim(task.contentHash.padEnd(maxHashWidth))
      : ''.padEnd(maxHashWidth)
    const statusText = task.skipped
      ? chalk.bold.dim('unchanged')
      : task.success
        ? chalk.bold.green('created')
        : chalk.bold.red('failed')
    const time = chalk.dim(`(${(task.duration / 1000).toFixed(1)}s)`)
    return `  ${icon} ${name} ${hash} ${statusText} ${time}`
  }

  const render = (): void => {
    // Guard against race condition after stop
    if (stopped) return

    const lines: string[] = []

    // Add completed tasks first (static lines)
    for (const completed of completedTasks) {
      lines.push(formatCompletedLine(completed))
    }

    // Add in-progress tasks with spinners
    for (const task of tasks.values()) {
      const frame = getSpinnerFrame(task.spinnerFrame)
      const elapsed = ((Date.now() - task.startTime) / 1000).toFixed(1)
      const name = fitToWidth(task.label, maxNameWidth)
      const hash = task.contentHash
        ? chalk.dim(task.contentHash.padEnd(maxHashWidth))
        : ''.padEnd(maxHashWidth)
      const status = task.status ? fitToWidth(truncate(task.status), 20) : ''.padEnd(20)
      lines.push(`  ${chalk.green(frame)} ${name} ${hash} ${chalk.dim(status)} ${chalk.dim(`(${elapsed}s)`)}`)
      task.spinnerFrame++
    }

    // Don't render if nothing to show
    if (lines.length === 0) return

    if (process.stdout.isTTY) {
      process.stdout.write('\u001B[?25l') // hide cursor
    }
    process.stdout.write(updater.update(lines.join('\n')))
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
    start: (id: string, label: string, phase: string, contentHash?: string): void => {
      // Update max column widths
      maxNameWidth = Math.max(maxNameWidth, label.length)
      if (contentHash) {
        maxHashWidth = Math.max(maxHashWidth, contentHash.length)
      }

      tasks.set(id, { id, label, status: '', phase, startTime: Date.now(), spinnerFrame: 0, contentHash })

      if (!interval) {
        stopped = false
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

      // Add to completed tasks for rendering
      completedTasks.push({
        label: task.label,
        success,
        skipped: skipped ?? false,
        contentHash,
        duration
      })

      // If no more active tasks, stop interval and print final output
      if (tasks.size === 0 && interval) {
        stopped = true
        clearInterval(interval)
        interval = null
        clear()
        // Print all completed tasks
        for (const completed of completedTasks) {
          process.stdout.write(formatCompletedLine(completed) + '\n')
        }
        completedTasks.length = 0
      }

      return { duration }
    },

    cleanup: (): void => {
      stopped = true
      if (interval) {
        clearInterval(interval)
        interval = null
      }
      process.stdout.off('resize', resizeHandler)
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
    if (!phase) return // Skip undefined phases
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
    if (!phase) return // Skip undefined phases

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
        } else if (event.phase === 'DependencyGraph' || event.phase === 'Discovery') {
          // Tree-style output - dimmed
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
          this.buildSpinner.start(event.taskId, event.taskName, event.phase, event.contentHash)
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
          // Static mode - simple output (no dynamic width calculation)
          const icon = event.status === 'success' ? chalk.green('+') : chalk.red('-')
          const hash = event.contentHash ? chalk.dim(event.contentHash) + ' ' : ''
          const statusText = skipped ? chalk.bold.dim('unchanged') : chalk.bold.green('created')
          const time = event.duration ? chalk.dim(`(${(event.duration / 1000).toFixed(1)}s)`) : ''
          console.log(`  ${icon} ${event.taskName} ${hash}${statusText} ${time}`)
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
