/**
 * Hooks Runner
 *
 * Executes lifecycle hooks defined in pulumix.yaml.
 * Hooks are shell scripts/commands run at specific stages of the deployment lifecycle.
 */

import * as path from 'path'
import { spawn } from 'child_process'
import { Either, Left, Right } from 'purify-ts/Either'
import { createDeploymentError, DeployError } from '../types/errors'
import type { HookDefinition, HookStage } from '../types/manifest'
import type { OrchestratorEventEmitter } from './events'

// ============================================================================
// Types
// ============================================================================

/**
 * Result of executing a single hook
 */
export interface HookExecutionResult {
  readonly hook: HookDefinition
  readonly success: boolean
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly duration: number
}

// ============================================================================
// Constants
// ============================================================================

/** Default timeout for hooks: 5 minutes */
const DEFAULT_TIMEOUT = 300000

// ============================================================================
// Hook Execution
// ============================================================================

/**
 * Execute a single hook script
 *
 * Spawns a child process with the specified command, environment variables,
 * and working directory. Streams output to the event emitter.
 */
export const executeHook = async (
  hook: HookDefinition,
  rootPath: string,
  eventEmitter: OrchestratorEventEmitter
): Promise<Either<DeployError, HookExecutionResult>> => {
  const startTime = Date.now()
  const cwd = hook.cwd ? path.resolve(rootPath, hook.cwd) : rootPath
  const timeout = hook.timeout ?? DEFAULT_TIMEOUT
  const taskName = hook.description ?? hook.run

  // Emit task start
  eventEmitter.emitTaskStart(taskName, taskName, 'bootstrap')

  return new Promise((resolve) => {
    // Parse the command - support both "./script.sh" and "command arg1 arg2"
    const [command, ...args] = hook.run.split(' ')

    // Merge process env with hook-specific env
    const env = {
      ...process.env,
      ...hook.env
    }

    const proc = spawn(command, args, {
      cwd,
      env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    // Set up timeout
    const timeoutId = setTimeout(() => {
      timedOut = true
      proc.kill('SIGTERM')
    }, timeout)

    // Stream stdout
    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString()
      stdout += text

      // Emit progress for each line
      const lines = text.split('\n')
      for (const line of lines) {
        if (line.trim()) {
          eventEmitter.emitTaskUpdate(taskName, line.trim())
        }
      }
    })

    // Capture stderr
    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString()
      stderr += text

      // Also emit stderr lines as updates
      const lines = text.split('\n')
      for (const line of lines) {
        if (line.trim()) {
          eventEmitter.emitTaskUpdate(taskName, line.trim())
        }
      }
    })

    proc.on('close', (code: number | null) => {
      clearTimeout(timeoutId)
      const duration = Date.now() - startTime
      const exitCode = code ?? 1

      if (timedOut) {
        eventEmitter.emitTaskComplete(taskName, false)
        resolve(Left(
          createDeploymentError(
            'HookFailed',
            `Hook timed out after ${timeout}ms: ${hook.run}`,
            `Increase the timeout value or optimize the script`,
            { hook: hook.run, timeout, cwd }
          )
        ))
        return
      }

      if (exitCode !== 0) {
        eventEmitter.emitTaskComplete(taskName, false)

        // If continueOnFailure is set, return success but log the error
        if (hook.continueOnFailure) {
          eventEmitter.emitLog('warn', `Hook failed but continuing: ${hook.run}`, { exitCode, stderr })
          resolve(Right({
            hook,
            success: false,
            exitCode,
            stdout,
            stderr,
            duration
          }))
          return
        }

        resolve(Left(
          createDeploymentError(
            'HookFailed',
            `Hook failed with exit code ${exitCode}: ${hook.run}\n${stderr || stdout}`,
            `Check the script output above for errors`,
            { hook: hook.run, exitCode, cwd }
          )
        ))
        return
      }

      eventEmitter.emitTaskComplete(taskName, true)
      resolve(Right({
        hook,
        success: true,
        exitCode: 0,
        stdout,
        stderr,
        duration
      }))
    })

    proc.on('error', (err: Error) => {
      clearTimeout(timeoutId)

      eventEmitter.emitTaskComplete(taskName, false)
      resolve(Left(
        createDeploymentError(
          'HookFailed',
          `Hook error: ${hook.run}\n${err.message}`,
          `Check that the script exists and is executable`,
          { hook: hook.run, error: err.message, cwd }
        )
      ))
    })
  })
}

/**
 * Execute all hooks for a given stage
 *
 * Filters hooks by stage and executes them sequentially.
 * Stops on first failure unless continueOnFailure is set.
 */
export const executeHooksForStage = async (
  stage: HookStage,
  hooks: HookDefinition[],
  rootPath: string,
  eventEmitter: OrchestratorEventEmitter
): Promise<Either<DeployError, void>> => {
  // Filter hooks for this stage
  const stageHooks = hooks.filter(h => h.stage === stage)

  if (stageHooks.length === 0) {
    return Right(undefined)
  }

  // Execute sequentially
  for (const hook of stageHooks) {
    const result = await executeHook(hook, rootPath, eventEmitter)

    // If hook failed and we shouldn't continue, return the error
    if (result.isLeft()) {
      return result.map(() => undefined)
    }
  }

  return Right(undefined)
}

/**
 * Get hooks for a specific stack
 *
 * Utility to extract hooks from project config for a given stack name.
 */
export const getHooksForStack = (
  hooks: Record<string, HookDefinition[]> | undefined,
  stackName: string
): HookDefinition[] => {
  return hooks?.[stackName] ?? []
}
