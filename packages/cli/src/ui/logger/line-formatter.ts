/**
 * Line Formatter - Based on Rocketyard's proven approach
 *
 * Parses Pulumi text output line by line.
 */

import chalk from 'chalk'
import cliSpinners from 'cli-spinners'

import {
  Change,
  Status,
  TaskUpdate,
  clearTaskLines,
  printRunningTasks,
  processProgress,
  resetTasks,
} from './task-formatter'

// ============================================================================
// Types
// ============================================================================

export enum Block {
  Progress = 'Progress',
  Resources = 'Resources',
  Duration = 'Duration',
  Diagnostics = 'Diagnostics',
  Outputs = 'Outputs',
}

export interface LineProcessor {
  appendLine: (message: string) => void
  resetLine: () => void
  processLine: () => void
}

// ============================================================================
// Line Processor Factory
// ============================================================================

const ICON_REGEX = /^[+~\-\s*@]/

export const createLineProcessor = (type: 'dynamic' | 'static'): LineProcessor => {
  const isDynamic = type === 'dynamic'

  let block: Block | null = null
  let lastLine = ''
  let line = ''
  let color = chalk.bold.gray
  let interval: NodeJS.Timeout | null = null

  const parseLine = (): TaskUpdate => {
    let workingLine = line
    let change = workingLine.split(' ')[0] as Change | string
    workingLine = workingLine.replace(change, '').trimStart()

    const [resourceType, resourceName] = workingLine.split(' ') as [string, string]
    workingLine = workingLine.replace(`${resourceType} ${resourceName}`, '').trimStart()

    let status: Status | undefined
    if (workingLine.startsWith('**')) {
      const parts = workingLine.split('**')
      status = parts[1] as Status | undefined
      workingLine = workingLine.replace(`**${status}**`, '').trimStart()
    } else if (workingLine.includes('(')) {
      const parts = workingLine.split('(')
      status = parts[0]?.trimEnd() as Status | undefined
      workingLine = workingLine.replace(`${status}(`, '(').trimStart()
    } else if (workingLine.includes(':')) {
      const parts = workingLine.split(':')
      status = parts[0]?.trimEnd() as Status | undefined
      workingLine = workingLine.replace(`${status}:`, '').trimStart()
    }

    let time = ''
    let message: string[] = []
    if (workingLine.startsWith('(')) {
      const parts = workingLine.split(' ')
      time = parts[0] || ''
      message = parts.slice(1)
    } else {
      message = workingLine.split(' ')
    }

    // Normalize change symbols
    switch (change) {
      case '++':
      case '+-':
        change = Change.Replace
        break
      case '--':
        change = Change.Delete
        break
      default:
    }

    return {
      change: change as Change,
      resourceType: resourceType || '',
      resourceName: resourceName || '',
      status,
      time,
      message: message.join(' '),
    }
  }

  const processHeader = (): boolean => {
    if (
      line.startsWith('Creating') ||
      line.startsWith('Updating') ||
      line.startsWith('Destroying') ||
      line.startsWith('Refreshing') ||
      line.startsWith('Building')
    ) {
      block = Block.Progress
      color = (() => {
        switch (line.split(' ')[0]) {
          case 'Creating':
          case 'Updating':
          case 'Building':
            return chalk.bold.green
          case 'Destroying':
            return chalk.bold.red
          default:
            return chalk.bold.grey
        }
      })()

      if (isDynamic) {
        interval = setInterval(() => {
          printRunningTasks()
        }, cliSpinners.dots.interval)
      }

      line = line.replace(/.*:/g, (title) => color(title))
      console.log(`  ${line}`)
      return true
    }

    if (
      line.startsWith('Resources:') ||
      line.startsWith('Diagnostics:') ||
      line.startsWith('Outputs:')
    ) {
      if (block === Block.Progress) {
        if (interval) {
          clearInterval(interval)
          interval = null
        }

        clearTaskLines()
        if (isDynamic) {
          printRunningTasks(false)
          resetTasks()
        }

        console.log('')
      }
    }

    if (line.startsWith('Outputs:')) {
      block = Block.Outputs
      return true
    }

    if (line.startsWith('Resources:')) {
      line = line.replace(/.*:/g, (title) => color(title))
      console.log(`  ${line}`)
      block = Block.Resources
      return true
    }

    if (line.startsWith('Diagnostics:')) {
      line = line.replace(/.*:/g, (title) => color(title))
      console.log(`  ${line}`)
      block = Block.Diagnostics
      return true
    }

    if (line.startsWith('Duration:')) {
      line = line.replace(/.*:/g, (title) => color(title))
      console.log(`  ${line}`)
      block = Block.Duration
      return true
    }

    return false
  }

  const appendLine = (message: string): void => {
    line += message
  }

  const resetLine = (): void => {
    lastLine = line
    line = ''
  }

  const processLine = (): void => {
    line = line.replace(/^\s\s?/g, '').trimEnd()

    if (line === '' && lastLine === '') {
      // Prevent double empty lines
      resetLine()
      return
    }

    const isHeader = processHeader()
    if (isHeader) {
      resetLine()
      return
    }

    switch (block) {
      case Block.Progress: {
        // Skip @ lines (refreshing)
        if (line.startsWith('@')) {
          resetLine()
          return
        }

        if (!ICON_REGEX.test(line)) {
          resetLine()
          return
        }

        processProgress(parseLine(), isDynamic)
        break
      }

      case Block.Diagnostics:
        if (line.trimStart().startsWith('warning:')) {
          line = line.replace('warning:', chalk.yellow('warning:'))
          console.log(`    ${line}`)
        } else if (line.trimStart().startsWith('error:')) {
          line = line.replace('error:', chalk.red('error:'))
          console.log(`    ${line}`)
        } else if (line.trimStart().startsWith('debug:')) {
          line = line.replace('debug:', chalk.gray('debug:'))
          console.log(`    ${line}`)
        } else {
          console.log(`    ${line}`)
        }
        break

      case Block.Outputs:
        // Hide outputs
        break

      case Block.Resources:
        // Show resources summary
        if (line.length > 0) {
          console.log(`    ${line}`)
        }
        break

      default:
        // Filter out informational messages
        const skipPatterns = [
          /k3d cluster.*already exists/i,
          /skipping.*installation/i,
          /using built-in/i,
          /already running/i,
          /waiting for/i,
        ]
        const shouldSkip = skipPatterns.some(pattern => pattern.test(line))

        if (line.length > 0 && !shouldSkip) {
          console.log(`  ${line}`)
        }
    }

    resetLine()
  }

  return { appendLine, resetLine, processLine }
}
