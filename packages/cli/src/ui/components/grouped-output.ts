/**
 * Grouped Output Component
 *
 * Manages collapsible phase groups with status indicators.
 * Each phase can be expanded or collapsed to show/hide details.
 */

import chalk from 'chalk'
import { PhaseName, Status } from '@pulumix/core'

/**
 * Phase group state
 */
export interface PhaseGroup {
  readonly phaseNumber: number
  readonly phase: PhaseName
  readonly status: Status
  readonly startTime: number
  readonly endTime?: number
  readonly expanded: boolean
  readonly messages: string[]
  readonly progress?: {
    readonly current: number
    readonly total: number
    readonly label?: string
  }
}

/**
 * Grouped output component
 */
export class GroupedOutput {
  private phases: Map<PhaseName, PhaseGroup> = new Map()
  private phaseOrder: PhaseName[] = []

  /**
   * Start a new phase
   */
  startPhase(phaseNumber: number, phase: PhaseName): void {
    this.phases.set(phase, {
      phaseNumber,
      phase,
      status: 'running',
      startTime: Date.now(),
      expanded: true,
      messages: []
    })

    if (!this.phaseOrder.includes(phase)) {
      this.phaseOrder.push(phase)
    }
  }

  /**
   * Complete a phase
   */
  completePhase(phase: PhaseName, status: Exclude<Status, 'pending' | 'running'>, duration?: number): void {
    const existing = this.phases.get(phase)
    if (!existing) return

    this.phases.set(phase, {
      ...existing,
      status,
      endTime: existing.startTime + (duration || 0),
      expanded: status === 'error' // Keep errors expanded
    })
  }

  /**
   * Update phase progress
   */
  updateProgress(phase: PhaseName, current: number, total: number, label?: string): void {
    const existing = this.phases.get(phase)
    if (!existing) return

    this.phases.set(phase, {
      ...existing,
      progress: { current, total, label }
    })
  }

  /**
   * Add message to phase
   */
  addMessage(phase: PhaseName, message: string): void {
    const existing = this.phases.get(phase)
    if (!existing) return

    this.phases.set(phase, {
      ...existing,
      messages: [...existing.messages, message]
    })
  }

  /**
   * Toggle phase expansion
   */
  togglePhase(phase: PhaseName): void {
    const existing = this.phases.get(phase)
    if (!existing) return

    this.phases.set(phase, {
      ...existing,
      expanded: !existing.expanded
    })
  }

  /**
   * Render all phases
   */
  render(): string[] {
    const lines: string[] = []

    for (const phase of this.phaseOrder) {
      const group = this.phases.get(phase)
      if (!group) continue

      lines.push(this.renderPhaseHeader(group))

      if (group.expanded) {
        // Show progress if available
        if (group.progress && group.status === 'running') {
          const percentage = Math.round((group.progress.current / group.progress.total) * 100)
          const progressBar = this.renderProgressBar(percentage)
          const label = group.progress.label ? ` ${chalk.dim(group.progress.label)}` : ''
          lines.push(`  ${progressBar} ${percentage}%${label}`)
        }

        // Show messages
        for (const message of group.messages) {
          lines.push(`  ${chalk.dim('│')} ${message}`)
        }
      }
    }

    return lines
  }

  /**
   * Render phase header with status icon
   */
  private renderPhaseHeader(group: PhaseGroup): string {
    const icon = this.getStatusIcon(group.status)
    const phaseName = chalk.bold(group.phase)
    const duration = group.endTime
      ? chalk.dim(` (${Math.round((group.endTime - group.startTime) / 1000)}s)`)
      : ''
    const expandIcon = group.expanded ? chalk.dim('▼') : chalk.dim('▶')

    return `${expandIcon} ${icon} ${phaseName}${duration}`
  }

  /**
   * Get status icon
   */
  private getStatusIcon(status: Status): string {
    switch (status) {
      case 'pending':
        return chalk.gray('○')
      case 'running':
        return chalk.blue('◐')
      case 'success':
        return chalk.green('✓')
      case 'error':
        return chalk.red('✗')
      case 'warning':
        return chalk.yellow('⚠')
      default:
        return chalk.gray('○')
    }
  }

  /**
   * Render simple progress bar
   */
  private renderProgressBar(percentage: number): string {
    const width = 20
    const completed = Math.floor((percentage / 100) * width)
    const remaining = width - completed

    return (
      chalk.green('█'.repeat(completed)) +
      chalk.gray('░'.repeat(remaining))
    )
  }

  /**
   * Get phase count
   */
  getPhaseCount(): number {
    return this.phases.size
  }

  /**
   * Get completed phase count
   */
  getCompletedCount(): number {
    return Array.from(this.phases.values()).filter(
      p => p.status === 'success' || p.status === 'error' || p.status === 'warning'
    ).length
  }

  /**
   * Check if all phases complete
   */
  isComplete(): boolean {
    return Array.from(this.phases.values()).every(
      p => p.status !== 'pending' && p.status !== 'running'
    )
  }
}

/**
 * Create grouped output
 */
export const createGroupedOutput = (): GroupedOutput => {
  return new GroupedOutput()
}
