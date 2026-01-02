/**
 * Task Formatter - Based on Rocketyard's proven approach
 *
 * Uses text parsing (not events) for reliable terminal output.
 */

import chalk from 'chalk'
import cliSpinners from 'cli-spinners'
import logUpdate from 'ansi-diff'

// ============================================================================
// Types
// ============================================================================

export enum Change {
  Create = '+',
  Replace = '!',
  Delete = '-',
  Update = '~',
  Running = '*',
  Unchanged = '',
}

export enum Status {
  Creating = 'creating',
  Created = 'created',
  Deleting = 'deleting',
  Deleted = 'deleted',
  Updating = 'updating',
  Updated = 'updated',
  Replacing = 'replacing',
  Replaced = 'replaced',
  Running = 'running',
  Refreshing = 'refreshing',
  Refresh = 'refresh',
  Failed = 'failed',
  Unchanged = '',
}

export interface TaskUpdate {
  change: Change
  resourceType: string
  resourceName: string
  status?: Status
  time: string
  message?: string
}

export interface Task {
  change: Change
  order: number
  id: string
  name: string
  startTime: Date
  completedTime?: Date
  message?: string
  status: Status
  spinner: () => string
}

// ============================================================================
// State
// ============================================================================

const tasks = new Map<string, Task>()
let orderedTasks: Task[] = []

const updater = logUpdate({
  height: process.stdout.rows,
  width: process.stdout.columns,
})

// Handle resize
process.stdout.on('resize', () => {
  updater.resize({ width: process.stdout.columns, height: process.stdout.rows })
})

// Show cursor on exit
process.on('exit', () => {
  if (process.stdout.isTTY) {
    process.stdout.write('\u001B[?25h')
  }
})

// ============================================================================
// Helper Functions
// ============================================================================

const createSpinner = (): (() => string) => {
  let frameIndex = 0
  return (): string => {
    const frame = cliSpinners.dots.frames[frameIndex] as string
    frameIndex = (frameIndex + 1) % cliSpinners.dots.frames.length
    return frame
  }
}

const formatResourceType = (type: string): string => {
  // kubernetes:core/v1:Namespace -> Namespace
  // pulumi:providers:kubernetes -> Provider
  const parts = type.split(':')
  return parts[parts.length - 1] || type
}

const formatTask = (task: Task): string => {
  const color = (() => {
    switch (task.status) {
      case Status.Failed:
        return chalk.bold.red
      case Status.Running:
        return chalk.bold.green
      default:
    }

    switch (task.change) {
      case Change.Replace:
      case Change.Create:
        return chalk.bold.green
      case Change.Update:
        return chalk.bold.yellow
      case Change.Delete:
        return chalk.bold.red
      default:
        return chalk.grey
    }
  })()

  const isRunning =
    task.status === Status.Creating ||
    task.status === Status.Updating ||
    task.status === Status.Deleting ||
    task.status === Status.Replacing ||
    task.status === Status.Refreshing ||
    task.status === Status.Running

  const isFailed = task.status === Status.Failed

  const icon = isRunning
    ? color(task.spinner())
    : isFailed
      ? chalk.bold.red('✗')
      : color(task.change === Change.Unchanged ? ' ' : task.change)

  const completedTime = task.completedTime ?? new Date()
  const delta = (completedTime.getTime() - task.startTime.getTime()) / 1000
  const timeString = `(${delta.toFixed(1)}s)`

  const resourceType = task.name.split(' ')[0] ?? ''
  const resourceName = task.name.split(' ')[1] ?? ''

  // Format: + ResourceType ResourceName status (time)
  return `  ${icon} ${resourceType} ${resourceName} ${color(task.status)} ${chalk.dim(timeString)}`
}

// ============================================================================
// Public API
// ============================================================================

export const resetTasks = (): void => {
  tasks.clear()
  orderedTasks = []
}

export const printRunningTasks = (toUpdater = true): void => {
  const lines = orderedTasks.filter((task) => task.completedTime === undefined).map(formatTask)

  if (toUpdater) {
    const changes = updater.update(lines.join('\n'))
    if (process.stdout.isTTY) {
      process.stdout.write('\u001B[?25l') // hide cursor
    }
    process.stdout.write(changes)
  } else if (lines.length > 0) {
    console.log(lines.join('\n'))
  }
}

export const clearTaskLines = (): void => {
  const changes = updater.update('')
  process.stdout.write(changes)
}

const printUpdate = (
  isDynamic: boolean,
  isComplete: boolean,
  existingTask: Task | undefined,
  updatedTask: Task
): void => {
  const isNewlyCompleted = isComplete && existingTask?.completedTime === undefined

  if (isNewlyCompleted) {
    if (isDynamic) {
      clearTaskLines()
    }

    console.log(formatTask(updatedTask))

    if (isDynamic) {
      printRunningTasks()
    }
  }
}

export const processProgress = (update: TaskUpdate, isDynamic: boolean): void => {
  // Filter out wrapper resources completely - don't even track them
  const isWrapper =
    update.resourceType === 'pulumi:pulumi:Stack' ||
    update.resourceType.includes('pulumi:providers:') ||
    update.resourceType.includes('pulumi:pulumi:')

  if (isWrapper) {
    return  // Skip entirely
  }

  const id = `${update.resourceType}:${update.resourceName}`
  const prettyResourceType = formatResourceType(update.resourceType)
  const name = `${prettyResourceType} ${update.resourceName}`

  if (update.status === Status.Running || update.status === Status.Failed) {
    update.change = Change.Running
  }

  const isComplete =
    update.change === Change.Unchanged ||
    update.status === Status.Unchanged ||
    update.status === Status.Created ||
    update.status === Status.Updated ||
    update.status === Status.Replaced ||
    update.status === Status.Deleted ||
    update.status === Status.Failed ||
    update.status === Status.Refresh

  const existingTask = tasks.get(id)
  const updatedTask: Task = {
    id,
    name,
    change: update.change,
    order: existingTask?.order ?? tasks.size,
    startTime: existingTask?.startTime ?? new Date(),
    spinner: existingTask?.spinner ?? createSpinner(),
    message: update.message ?? existingTask?.message,
    completedTime: isComplete ? existingTask?.completedTime ?? new Date() : undefined,
    status: update.status ?? Status.Unchanged,
  }
  tasks.set(id, updatedTask)

  orderedTasks = [...tasks.values()].sort((a, b) => {
    const aUpdating =
      a.status === Status.Creating ||
      a.status === Status.Updating ||
      a.status === Status.Deleting ||
      a.status === Status.Replacing ||
      a.status === Status.Refreshing ||
      a.status === Status.Running

    const bUpdating =
      b.status === Status.Creating ||
      b.status === Status.Updating ||
      b.status === Status.Deleting ||
      b.status === Status.Replacing ||
      b.status === Status.Refreshing ||
      b.status === Status.Running

    if (aUpdating && !bUpdating) return 1
    if (bUpdating && !aUpdating) return -1
    return a.order - b.order
  })

  printUpdate(isDynamic, isComplete, existingTask, updatedTask)
}
