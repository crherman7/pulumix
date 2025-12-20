/**
 * Logger Module
 *
 * Factory for creating loggers with rocketyard-style output.
 * Supports dynamic (interactive) and static (CI) modes.
 */

import chalk from 'chalk'
import { createLineProcessor, LineProcessorDeps } from './line-formatter'
import { createTaskPrinter, TaskPrinter } from './task-formatter'

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Logger configuration with dependency injection
 */
export interface LoggerConfig {
  readonly isTTY: boolean
  readonly isCI: boolean
  readonly isInteractive: boolean
}

/**
 * Logger mode
 */
export type LoggerMode = 'dynamic' | 'static'

// ============================================================================
// Pure Functions
// ============================================================================

/**
 * Determine logger mode from config (pure)
 */
export const getLoggerMode = (config: LoggerConfig): LoggerMode =>
  config.isTTY && !config.isCI && config.isInteractive ? 'dynamic' : 'static'

/**
 * Create default logger config from environment
 */
export const createDefaultConfig = (): LoggerConfig => ({
  isTTY: process.stdout.isTTY ?? false,
  isCI: process.env.CI === 'true',
  isInteractive: process.env.IS_INTERACTIVE !== 'false',
})

// ============================================================================
// Logger Interface
// ============================================================================

/**
 * Logger interface
 */
export interface Logger {
  readonly log: (message: string) => void
  readonly info: (message: string) => void
  readonly success: (message: string) => void
  readonly warn: (message: string) => void
  readonly error: (message: string) => void
  readonly debug: (message: string) => void
  readonly cleanup: () => void
}

// ============================================================================
// Process Signal Handling (singleton pattern to prevent memory leaks)
// ============================================================================

let exitHandlerRegistered = false
let activeTaskPrinter: TaskPrinter | null = null

/**
 * Register exit handlers once to prevent memory leaks
 */
const registerExitHandlers = (taskPrinter: TaskPrinter): void => {
  activeTaskPrinter = taskPrinter

  if (exitHandlerRegistered) {
    return
  }

  exitHandlerRegistered = true

  process.once('exit', () => {
    activeTaskPrinter?.showCursor()
  })

  process.once('SIGINT', () => {
    activeTaskPrinter?.showCursor()
    process.exit(0)
  })
}

// ============================================================================
// Logger Factory
// ============================================================================

/**
 * Create logger with injected dependencies
 */
export const createLogger = (config?: Partial<LoggerConfig>): Logger => {
  const fullConfig: LoggerConfig = {
    ...createDefaultConfig(),
    ...config,
  }

  const mode = getLoggerMode(fullConfig)
  const taskPrinter = createTaskPrinter()

  const deps: LineProcessorDeps = {
    print: (msg: string) => console.log(msg),
    taskPrinter,
  }

  const processor = createLineProcessor(mode, deps)

  // Register exit handlers (only once per process)
  registerExitHandlers(taskPrinter)

  return {
    log: (message: string): void => {
      for (const line of message.split('\n')) {
        processor.processLine(line)
      }
    },

    info: (message: string): void => {
      console.log(`${chalk.blue('ℹ')} ${message}`)
    },

    success: (message: string): void => {
      console.log(`${chalk.green('✓')} ${message}`)
    },

    warn: (message: string): void => {
      console.log(`${chalk.yellow('⚠')} ${message}`)
    },

    error: (message: string): void => {
      console.log(`${chalk.red('✗')} ${message}`)
    },

    debug: (message: string): void => {
      console.log(`${chalk.dim('•')} ${message}`)
    },

    cleanup: processor.cleanup,
  }
}

// ============================================================================
// Exports
// ============================================================================

export * from './task-formatter'
export * from './line-formatter'
export * from './name-formatter'
