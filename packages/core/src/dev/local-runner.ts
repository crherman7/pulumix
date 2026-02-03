/**
 * Local runner for Pulumix dev mode
 *
 * Runs local dev servers with HMR/fast refresh support.
 */

import { spawn } from 'child_process'
import * as fs from 'fs'
import path from 'path'
import { DevServerHandle, LocalDevService } from './types'

/**
 * Patterns that may indicate shell injection attempts.
 * These are logged as warnings but don't block execution since
 * commands come from trusted pulumix.yaml files.
 */
const SUSPICIOUS_PATTERNS = [
  /\$\(/,           // Command substitution $(...)
  /`[^`]+`/,        // Backtick command substitution
  /;\s*rm\s/,       // rm after semicolon
  /&&\s*rm\s/,      // rm after &&
  /\|\s*rm\s/,      // rm after pipe
  />\s*\/dev\/sd/,  // Writing to block devices
  /;\s*curl\s/,     // curl after semicolon (potential exfil)
  /;\s*wget\s/,     // wget after semicolon
]

/**
 * Validate a dev command for potentially dangerous patterns.
 * Returns warnings for suspicious patterns found.
 */
export function validateDevCommand(command: string): string[] {
  const warnings: string[] = []

  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(command)) {
      warnings.push(`Command contains suspicious pattern: ${pattern.source}`)
    }
  }

  return warnings
}

/**
 * Parse a dev command string into command and arguments
 *
 * Handles common patterns like:
 * - "npm run dev"
 * - "pnpm dev"
 * - "node server.js"
 */
export function parseDevCommand(command: string): { cmd: string; args: string[] } {
  const parts = command.trim().split(/\s+/)
  const cmd = parts[0] ?? 'npm'
  const args = parts.slice(1)

  return { cmd, args }
}

/**
 * Run a local dev server for a service
 */
export function runDevServer(
  localService: LocalDevService,
  env: Record<string, string>,
  onOutput: (serviceName: string, line: string) => void
): DevServerHandle {
  const { service, devConfig, localPort } = localService

  // Command should always be defined for local dev services (validated upstream)
  if (!devConfig.command) {
    throw new Error(`Service '${service.name}' has no dev command configured`)
  }

  const { cmd, args } = parseDevCommand(devConfig.command)

  // Validate command for suspicious patterns
  const warnings = validateDevCommand(devConfig.command)
  for (const warning of warnings) {
    console.warn(`[${service.name}] Warning: ${warning}`)
  }

  // Build and validate the working directory
  const cwd = devConfig.cwd
    ? path.resolve(service.path, devConfig.cwd)
    : service.path

  if (!fs.existsSync(cwd)) {
    throw new Error(
      `Dev working directory does not exist: ${cwd}` +
      (devConfig.cwd ? ` (configured as '${devConfig.cwd}' relative to ${service.path})` : '')
    )
  }

  // Merge environment variables
  // Priority: passed env (already includes dev.env overrides) > process.env
  const processEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...env,
    PORT: String(localPort),
  }

  const proc = spawn(cmd, args, {
    cwd,
    env: processEnv,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true, // Use shell to handle npm/pnpm scripts properly
    detached: true, // Create process group for clean shutdown
  })

  // Handle stdout
  proc.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n')
    for (const line of lines) {
      if (line.trim()) {
        onOutput(service.name, line)
      }
    }
  })

  // Handle stderr (also output, not necessarily errors)
  proc.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n')
    for (const line of lines) {
      if (line.trim()) {
        onOutput(service.name, line)
      }
    }
  })

  // Create the promise that resolves when process exits
  const exited = new Promise<number>((resolve) => {
    proc.on('close', (code) => {
      resolve(code ?? 1)
    })

    proc.on('error', () => {
      resolve(1)
    })
  })

  return {
    kill: () => {
      // Kill entire process group (negative PID) to ensure child processes are terminated
      try {
        if (proc.pid) {
          process.kill(-proc.pid, 'SIGTERM')
        }
      } catch {
        // Process may already be dead
      }

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        try {
          if (proc.pid && !proc.killed) {
            process.kill(-proc.pid, 'SIGKILL')
          }
        } catch {
          // Process may already be dead
        }
      }, 5000)
    },
    exited,
    serviceName: service.name,
    port: localPort,
  }
}

/**
 * Run multiple dev servers in parallel
 */
export function runDevServers(
  localServices: LocalDevService[],
  envs: Map<string, Record<string, string>>,
  onOutput: (serviceName: string, line: string) => void
): DevServerHandle[] {
  const handles: DevServerHandle[] = []

  for (const localService of localServices) {
    const env = envs.get(localService.service.name) ?? {}
    const handle = runDevServer(localService, env, onOutput)
    handles.push(handle)
  }

  return handles
}

/**
 * Stop all dev servers gracefully
 */
export function stopDevServers(handles: DevServerHandle[]): void {
  for (const handle of handles) {
    try {
      handle.kill()
    } catch {
      // Ignore errors when killing processes
    }
  }
}

/**
 * Wait for any dev server to exit
 * Returns the first one that exits
 */
export async function waitForAnyExit(
  handles: DevServerHandle[]
): Promise<{ handle: DevServerHandle; exitCode: number }> {
  const results = handles.map(async (handle) => ({
    handle,
    exitCode: await handle.exited
  }))

  return Promise.race(results)
}
