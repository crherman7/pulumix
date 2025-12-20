/**
 * Progress Bar Component
 *
 * Renders a visual progress bar with percentage and status.
 */

import chalk from 'chalk'

/**
 * Progress bar configuration
 */
export interface ProgressBarConfig {
  readonly width?: number
  readonly completeChar?: string
  readonly incompleteChar?: string
  readonly showPercentage?: boolean
}

/**
 * Default progress bar configuration
 */
const defaultConfig: Required<ProgressBarConfig> = {
  width: 40,
  completeChar: '█',
  incompleteChar: '░',
  showPercentage: true
}

/**
 * Progress bar component
 */
export class ProgressBar {
  private config: Required<ProgressBarConfig>
  private current: number = 0
  private total: number = 100
  private label: string = ''

  constructor(config?: ProgressBarConfig) {
    this.config = { ...defaultConfig, ...config }
  }

  /**
   * Update progress
   */
  update(current: number, total: number, label?: string): void {
    this.current = current
    this.total = total
    if (label) {
      this.label = label
    }
  }

  /**
   * Render the progress bar
   */
  render(): string {
    const percentage = this.total > 0 ? Math.round((this.current / this.total) * 100) : 0
    const completed = Math.floor((percentage / 100) * this.config.width)
    const remaining = this.config.width - completed

    const bar =
      chalk.green(this.config.completeChar.repeat(completed)) +
      chalk.gray(this.config.incompleteChar.repeat(remaining))

    const percentageText = this.config.showPercentage
      ? chalk.bold(` ${percentage}%`)
      : ''

    const label = this.label ? ` ${chalk.dim(this.label)}` : ''
    const counts = chalk.dim(`(${this.current}/${this.total})`)

    return `${bar}${percentageText} ${counts}${label}`
  }

  /**
   * Render completion message
   */
  renderComplete(message?: string): string {
    const bar = chalk.green(this.config.completeChar.repeat(this.config.width))
    const percentageText = this.config.showPercentage ? chalk.bold(' 100%') : ''
    const msg = message ? ` ${chalk.green(message)}` : ''
    return `${bar}${percentageText}${msg}`
  }

  /**
   * Render error message
   */
  renderError(message?: string): string {
    const bar = chalk.red(this.config.completeChar.repeat(this.config.width))
    const msg = message ? ` ${chalk.red(message)}` : ''
    return `${bar}${msg}`
  }

  /**
   * Get current percentage
   */
  getPercentage(): number {
    return this.total > 0 ? Math.round((this.current / this.total) * 100) : 0
  }

  /**
   * Check if complete
   */
  isComplete(): boolean {
    return this.current >= this.total
  }
}

/**
 * Create a progress bar
 */
export const createProgressBar = (config?: ProgressBarConfig): ProgressBar => {
  return new ProgressBar(config)
}
