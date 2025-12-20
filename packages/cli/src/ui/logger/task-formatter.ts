/**
 * Task Formatter
 *
 * Pure functional task tracking with spinners for CLI output.
 * Uses discriminated unions, immutable state, and purify-ts for FP patterns.
 */

import chalk from 'chalk'
import cliSpinners from 'cli-spinners'
import logUpdate from 'ansi-diff'
import { Maybe } from 'purify-ts/Maybe'
import { formatResourceType } from './name-formatter'

// ============================================================================
// Discriminated Unions
// ============================================================================

/**
 * Change type - discriminated union for resource changes
 */
export type Change =
  | { readonly _tag: 'Create'; readonly symbol: '+' }
  | { readonly _tag: 'Update'; readonly symbol: '~' }
  | { readonly _tag: 'Delete'; readonly symbol: '-' }
  | { readonly _tag: 'Replace'; readonly symbol: '!' }
  | { readonly _tag: 'Running'; readonly symbol: '*' }
  | { readonly _tag: 'Unchanged'; readonly symbol: ' ' }

export const Change = {
  Create: { _tag: 'Create', symbol: '+' } as const,
  Update: { _tag: 'Update', symbol: '~' } as const,
  Delete: { _tag: 'Delete', symbol: '-' } as const,
  Replace: { _tag: 'Replace', symbol: '!' } as const,
  Running: { _tag: 'Running', symbol: '*' } as const,
  Unchanged: { _tag: 'Unchanged', symbol: ' ' } as const,
}

/**
 * Status type - discriminated union for task status
 */
export type Status =
  | { readonly _tag: 'Creating' }
  | { readonly _tag: 'Created' }
  | { readonly _tag: 'Updating' }
  | { readonly _tag: 'Updated' }
  | { readonly _tag: 'Deleting' }
  | { readonly _tag: 'Deleted' }
  | { readonly _tag: 'Replacing' }
  | { readonly _tag: 'Replaced' }
  | { readonly _tag: 'Failed' }
  | { readonly _tag: 'Running' }
  | { readonly _tag: 'Refreshing' }
  | { readonly _tag: 'Refresh' }

export const Status = {
  Creating: { _tag: 'Creating' } as const,
  Created: { _tag: 'Created' } as const,
  Updating: { _tag: 'Updating' } as const,
  Updated: { _tag: 'Updated' } as const,
  Deleting: { _tag: 'Deleting' } as const,
  Deleted: { _tag: 'Deleted' } as const,
  Replacing: { _tag: 'Replacing' } as const,
  Replaced: { _tag: 'Replaced' } as const,
  Failed: { _tag: 'Failed' } as const,
  Running: { _tag: 'Running' } as const,
  Refreshing: { _tag: 'Refreshing' } as const,
  Refresh: { _tag: 'Refresh' } as const,
}

// ============================================================================
// Immutable Data Types
// ============================================================================

/**
 * Immutable Task interface
 */
export interface Task {
  readonly id: string
  readonly name: string
  readonly resourceType: string
  readonly change: Change
  readonly status: Status
  readonly startTime: Date
  readonly completedTime: Maybe<Date>
  readonly message: Maybe<string>
  readonly spinnerFrame: number
}

/**
 * Immutable TaskState
 */
export interface TaskState {
  readonly tasks: ReadonlyMap<string, Task>
  readonly orderedIds: ReadonlyArray<string>
}

/**
 * Task update input
 */
export interface TaskUpdate {
  readonly id: string
  readonly name?: string
  readonly resourceType?: string
  readonly change?: Change
  readonly status?: Status
  readonly message?: string
}

// ============================================================================
// Pure Functions - State Management
// ============================================================================

/**
 * Create initial task state
 */
export const createInitialState = (): TaskState => ({
  tasks: new Map(),
  orderedIds: [],
})

/**
 * Get spinner frame at index
 */
export const getSpinnerFrame = (frameIndex: number): string =>
  cliSpinners.dots.frames[frameIndex % cliSpinners.dots.frames.length] ?? ''

/**
 * Advance task spinner frame (pure - returns new task)
 */
export const advanceSpinner = (task: Task): Task => ({
  ...task,
  spinnerFrame: (task.spinnerFrame + 1) % cliSpinners.dots.frames.length,
})

/**
 * Advance all spinners in state (pure - returns new state)
 */
export const advanceAllSpinners = (state: TaskState): TaskState => {
  const newTasks = new Map<string, Task>()
  for (const [id, task] of state.tasks) {
    newTasks.set(id, advanceSpinner(task))
  }
  return { ...state, tasks: newTasks }
}

/**
 * Check if a status indicates the task is complete
 */
export const isCompleteStatus = (status: Status): boolean => {
  switch (status._tag) {
    case 'Created':
    case 'Updated':
    case 'Deleted':
    case 'Replaced':
    case 'Failed':
    case 'Refresh':
      return true
    default:
      return false
  }
}

/**
 * Update task in state (pure - returns new state)
 */
export const updateTaskInState = (
  state: TaskState,
  update: TaskUpdate
): TaskState => {
  const existingTask = Maybe.fromNullable(state.tasks.get(update.id))

  const isComplete = update.status ? isCompleteStatus(update.status) : false

  const updatedTask: Task = existingTask
    .map((existing): Task => ({
      ...existing,
      name: update.name ?? existing.name,
      resourceType: update.resourceType ?? existing.resourceType,
      change: update.change ?? existing.change,
      status: update.status ?? existing.status,
      message: update.message ? Maybe.of(update.message) : existing.message,
      completedTime: isComplete ? Maybe.of(new Date()) : existing.completedTime,
    }))
    .orDefaultLazy((): Task => ({
      id: update.id,
      name: update.name ?? update.id,
      resourceType: update.resourceType ?? 'unknown',
      change: update.change ?? Change.Create,
      status: update.status ?? Status.Creating,
      startTime: new Date(),
      completedTime: isComplete ? Maybe.of(new Date()) : Maybe.empty(),
      message: update.message ? Maybe.of(update.message) : Maybe.empty(),
      spinnerFrame: 0,
    }))

  const newTasks = new Map(state.tasks)
  newTasks.set(update.id, updatedTask)

  const orderedIds = state.orderedIds.includes(update.id)
    ? state.orderedIds
    : [...state.orderedIds, update.id]

  return { tasks: newTasks, orderedIds }
}

/**
 * Reset task state (pure - returns new empty state)
 */
export const resetTasks = (): TaskState => createInitialState()

// ============================================================================
// Pure Functions - Formatting
// ============================================================================

/**
 * Get color for a task based on status and change
 */
export const getTaskColor = (task: Task): chalk.Chalk => {
  if (task.status._tag === 'Failed') return chalk.bold.red

  switch (task.change._tag) {
    case 'Create':
    case 'Replace':
      return chalk.bold.green
    case 'Update':
      return chalk.bold.yellow
    case 'Delete':
      return chalk.bold.red
    default:
      return chalk.grey
  }
}

/**
 * Check if task is currently running
 */
export const isTaskRunning = (task: Task): boolean =>
  task.completedTime.isNothing()

/**
 * Format a single task for display
 */
export const formatTask = (task: Task): string => {
  const color = getTaskColor(task)
  const running = isTaskRunning(task)

  const icon = running
    ? color(getSpinnerFrame(task.spinnerFrame))
    : color(task.change.symbol)

  const endTime = task.completedTime.orDefault(new Date())
  const delta = (endTime.getTime() - task.startTime.getTime()) / 1000
  const timeStr = `(${delta.toFixed(1)}s)`

  const type = formatResourceType(task.resourceType)
  const statusLabel = task.status._tag.toLowerCase()

  const message = task.message
    .map((m) => ` ${chalk.gray(m)}`)
    .orDefault('')

  return `  ${icon} ${type} ${task.name} ${color(statusLabel)} ${chalk.dim(timeStr)}${message}`
}

/**
 * Get running tasks from state
 */
export const getRunningTasks = (state: TaskState): ReadonlyArray<Task> =>
  state.orderedIds
    .map((id) => state.tasks.get(id))
    .filter((task): task is Task => task !== undefined)
    .filter(isTaskRunning)

/**
 * Get completed tasks from state
 */
export const getCompletedTasks = (state: TaskState): ReadonlyArray<Task> =>
  state.orderedIds
    .map((id) => state.tasks.get(id))
    .filter((task): task is Task => task !== undefined)
    .filter((task) => !isTaskRunning(task))

/**
 * Render all running task lines
 */
export const renderTaskLines = (state: TaskState): string =>
  getRunningTasks(state).map(formatTask).join('\n')

// ============================================================================
// Effects - Terminal I/O (side effects isolated here)
// ============================================================================

/**
 * Task printer interface
 */
export interface TaskPrinter {
  readonly print: (lines: string) => void
  readonly clear: () => void
  readonly showCursor: () => void
  readonly hideCursor: () => void
}

/**
 * Create task printer (encapsulates terminal side effects)
 */
export const createTaskPrinter = (): TaskPrinter => {
  const updater = logUpdate({
    height: process.stdout.rows,
    width: process.stdout.columns,
  })

  // Handle terminal resize
  process.stdout.on('resize', () => {
    updater.resize({
      width: process.stdout.columns,
      height: process.stdout.rows,
    })
  })

  return {
    print: (lines: string): void => {
      if (process.stdout.isTTY) {
        process.stdout.write('\u001B[?25l') // hide cursor
      }
      process.stdout.write(updater.update(lines))
    },

    clear: (): void => {
      process.stdout.write(updater.update(''))
    },

    showCursor: (): void => {
      if (process.stdout.isTTY) {
        process.stdout.write('\u001B[?25h')
      }
    },

    hideCursor: (): void => {
      if (process.stdout.isTTY) {
        process.stdout.write('\u001B[?25l')
      }
    },
  }
}
