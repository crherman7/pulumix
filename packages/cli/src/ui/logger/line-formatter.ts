/**
 * Line Formatter
 *
 * Parses and formats output lines with block detection and colorization.
 * Uses purify-ts Maybe/Either for pure functional parsing.
 */

import chalk from 'chalk'
import cliSpinners from 'cli-spinners'
import { Maybe } from 'purify-ts/Maybe'
import { Either, Left, Right } from 'purify-ts/Either'
import {
  TaskState,
  TaskUpdate,
  createInitialState,
  updateTaskInState,
  advanceAllSpinners,
  renderTaskLines,
  formatTask,
  getCompletedTasks,
  isCompleteStatus,
  Change,
  Status,
  TaskPrinter,
} from './task-formatter'

// ============================================================================
// Discriminated Unions
// ============================================================================

/**
 * Block type - discriminated union for output blocks
 */
export type Block =
  | { readonly _tag: 'Progress'; readonly color: chalk.Chalk }
  | { readonly _tag: 'Resources' }
  | { readonly _tag: 'Duration' }
  | { readonly _tag: 'Diagnostics' }
  | { readonly _tag: 'Outputs' }
  | { readonly _tag: 'None' }

export const Block = {
  Progress: (color: chalk.Chalk): Block => ({ _tag: 'Progress', color }),
  Resources: { _tag: 'Resources' } as const,
  Duration: { _tag: 'Duration' } as const,
  Diagnostics: { _tag: 'Diagnostics' } as const,
  Outputs: { _tag: 'Outputs' } as const,
  None: { _tag: 'None' } as const,
}

// ============================================================================
// Immutable State
// ============================================================================

/**
 * Immutable processor state
 */
export interface ProcessorState {
  readonly block: Block
  readonly taskState: TaskState
  readonly lastLine: string
}

/**
 * Create initial processor state
 */
export const createInitialProcessorState = (): ProcessorState => ({
  block: Block.None,
  taskState: createInitialState(),
  lastLine: '',
})

// ============================================================================
// Pure Functions - Block Detection
// ============================================================================

/**
 * Detect block header from line (pure)
 */
export const detectBlockHeader = (line: string): Maybe<Block> => {
  if (line.startsWith('Creating') || line.startsWith('Updating') || line.startsWith('Building')) {
    return Maybe.of(Block.Progress(chalk.bold.green))
  }
  if (line.startsWith('Destroying')) {
    return Maybe.of(Block.Progress(chalk.bold.red))
  }
  if (line.startsWith('Refreshing')) {
    return Maybe.of(Block.Progress(chalk.bold.grey))
  }
  if (line.startsWith('Resources:')) {
    return Maybe.of(Block.Resources)
  }
  if (line.startsWith('Duration:')) {
    return Maybe.of(Block.Duration)
  }
  if (line.startsWith('Diagnostics:')) {
    return Maybe.of(Block.Diagnostics)
  }
  if (line.startsWith('Outputs:')) {
    return Maybe.of(Block.Outputs)
  }
  return Maybe.empty()
}

// ============================================================================
// Pure Functions - Line Parsing
// ============================================================================

/**
 * Parse change symbol to Change type
 */
export const parseChangeSymbol = (symbol: string): Change => {
  switch (symbol) {
    case '+':
      return Change.Create
    case '~':
      return Change.Update
    case '-':
      return Change.Delete
    case '!':
    case '++':
      return Change.Replace
    case '*':
      return Change.Running
    default:
      return Change.Unchanged
  }
}

/**
 * Parse status string to Status type
 */
export const parseStatus = (status: string): Status => {
  const normalized = status.toLowerCase().trim()
  switch (normalized) {
    case 'creating':
      return Status.Creating
    case 'created':
      return Status.Created
    case 'updating':
      return Status.Updating
    case 'updated':
      return Status.Updated
    case 'deleting':
      return Status.Deleting
    case 'deleted':
      return Status.Deleted
    case 'replacing':
      return Status.Replacing
    case 'replaced':
      return Status.Replaced
    case 'failed':
      return Status.Failed
    case 'running':
      return Status.Running
    case 'refreshing':
      return Status.Refreshing
    case 'refresh':
      return Status.Refresh
    default:
      return Status.Creating
  }
}

/**
 * Parse a progress line into TaskUpdate (pure)
 */
export const parseProgressLine = (line: string): Either<string, TaskUpdate> => {
  const trimmed = line.trim()

  // Must start with a change symbol
  if (!/^[+~\-!\s*]/.test(trimmed)) {
    return Left('Not a progress line')
  }

  const changeSymbol = trimmed[0] ?? ''
  const change = parseChangeSymbol(changeSymbol)

  // Parse: resourceType resourceName status (time) message
  const rest = trimmed.slice(1).trim()
  const parts = rest.split(/\s+/)

  if (parts.length < 2) {
    return Left('Invalid progress line format')
  }

  const resourceType = parts[0] ?? 'unknown'
  const name = parts[1] ?? 'unknown'

  // Find status (could be with ** markers or plain)
  let status: Status = Status.Creating
  let message: string | undefined

  if (parts.length > 2) {
    const statusPart = parts[2] ?? ''
    if (statusPart.startsWith('**')) {
      status = parseStatus(statusPart.replace(/\*\*/g, ''))
    } else if (statusPart.startsWith('(')) {
      // This is time, not status
    } else {
      status = parseStatus(statusPart)
    }

    // Rest could be message
    if (parts.length > 4) {
      message = parts.slice(4).join(' ')
    }
  }

  return Right({
    id: `${resourceType}:${name}`,
    resourceType,
    name,
    change,
    status,
    message,
  })
}

/**
 * Format diagnostic line with colors (pure)
 */
export const formatDiagnosticLine = (line: string): string => {
  if (line.includes('error:')) {
    return line.replace('error:', chalk.red('error:'))
  }
  if (line.includes('warning:')) {
    return line.replace('warning:', chalk.yellow('warning:'))
  }
  if (line.includes('debug:')) {
    return line.replace('debug:', chalk.gray('debug:'))
  }
  return line
}

// ============================================================================
// Line Processor (with dependency injection)
// ============================================================================

/**
 * Dependencies for line processor
 */
export interface LineProcessorDeps {
  readonly print: (msg: string) => void
  readonly taskPrinter: TaskPrinter
}

/**
 * Line processor interface
 */
export interface LineProcessor {
  readonly processLine: (line: string) => void
  readonly cleanup: () => void
}

/**
 * Create line processor with injected dependencies
 */
export const createLineProcessor = (
  mode: 'dynamic' | 'static',
  deps: LineProcessorDeps
): LineProcessor => {
  const isDynamic = mode === 'dynamic'

  // Mutable state (encapsulated, not exposed)
  let state = createInitialProcessorState()
  let spinnerInterval: NodeJS.Timeout | null = null

  const processLine = (line: string): void => {
    const trimmedLine = line.replace(/^\s{1,2}/, '').trimEnd()

    // Skip empty duplicate lines
    if (trimmedLine === '' && state.lastLine === '') {
      return
    }

    // Check for block header
    const blockHeader = detectBlockHeader(trimmedLine)

    if (blockHeader.isJust()) {
      const newBlock = blockHeader.extract()

      // Transition from Progress block - print completed tasks
      if (state.block._tag === 'Progress' && newBlock._tag !== 'Progress') {
        if (spinnerInterval) {
          clearInterval(spinnerInterval)
          spinnerInterval = null
        }
        if (isDynamic) {
          deps.taskPrinter.clear()
          // Print completed tasks
          const completed = getCompletedTasks(state.taskState)
          for (const task of completed) {
            deps.print(formatTask(task))
          }
        }
        deps.print('') // Empty line before next block
      }

      state = { ...state, block: newBlock, taskState: createInitialState() }

      // Start spinner interval for Progress block
      if (newBlock._tag === 'Progress' && isDynamic) {
        spinnerInterval = setInterval(() => {
          state = {
            ...state,
            taskState: advanceAllSpinners(state.taskState),
          }
          deps.taskPrinter.print(renderTaskLines(state.taskState))
        }, cliSpinners.dots.interval)
      }

      // Print header with color (hide some headers)
      if (newBlock._tag === 'Progress') {
        deps.print(newBlock.color(trimmedLine))
      }
      // Skip Outputs, Resources, Duration headers - content is formatted inline
      state = { ...state, lastLine: trimmedLine }
      return
    }

    // Process line based on current block
    switch (state.block._tag) {
      case 'Progress':
        parseProgressLine(trimmedLine).ifRight((update) => {
          const prevTask = state.taskState.tasks.get(update.id)
          const isNewTask = !prevTask
          const isComplete = update.status && isCompleteStatus(update.status)

          state = {
            ...state,
            taskState: updateTaskInState(state.taskState, update),
          }

          // In static mode, only print when task is created or completed (not intermediate progress)
          if (!isDynamic && (isNewTask || isComplete)) {
            const task = state.taskState.tasks.get(update.id)
            if (task) {
              deps.print(formatTask(task))
            }
          }
        })
        break

      case 'Diagnostics':
        deps.print(formatDiagnosticLine(trimmedLine))
        break

      case 'Outputs':
        // Hide internal outputs (they're displayed in final summary)
        break

      case 'Resources':
        // Format resources summary - show count line
        if (trimmedLine.includes('created') || trimmedLine.includes('updated') ||
            trimmedLine.includes('deleted') || trimmedLine.includes('unchanged')) {
          // Color-code based on type
          let formatted = trimmedLine
          if (trimmedLine.includes('created')) {
            formatted = chalk.green(trimmedLine)
          } else if (trimmedLine.includes('updated')) {
            formatted = chalk.yellow(trimmedLine)
          } else if (trimmedLine.includes('deleted')) {
            formatted = chalk.red(trimmedLine)
          } else {
            formatted = chalk.dim(trimmedLine)
          }
          deps.print(`  ${formatted}`)
        }
        break

      case 'Duration':
        // Show duration on same line
        if (trimmedLine.match(/^\d+/)) {
          deps.print(`  ${chalk.dim(`Duration: ${trimmedLine}`)}`)
        }
        break

      default:
        if (trimmedLine.length > 0) {
          deps.print(trimmedLine)
        }
    }

    state = { ...state, lastLine: trimmedLine }
  }

  const cleanup = (): void => {
    if (spinnerInterval) {
      clearInterval(spinnerInterval)
      spinnerInterval = null
    }
    deps.taskPrinter.showCursor()
  }

  return { processLine, cleanup }
}
