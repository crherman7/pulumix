/**
 * Local runner for Pulumix dev mode
 *
 * Runs local dev servers with HMR/fast refresh support.
 */

import { spawn } from 'child_process'
import path from 'path'
import { DevServerHandle, LocalDevService } from './types'

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
  const { cmd, args } = parseDevCommand(devConfig.command)

  // Build the working directory
  const cwd = devConfig.cwd
    ? path.resolve(service.path, devConfig.cwd)
    : service.path

  // Merge environment variables
  // Priority: devConfig.env > passed env > process.env
  const processEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...env,
    ...devConfig.env,
    PORT: String(localPort),
  }

  const proc = spawn(cmd, args, {
    cwd,
    env: processEnv,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true, // Use shell to handle npm/pnpm scripts properly
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
      // Try graceful shutdown first
      proc.kill('SIGTERM')

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL')
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
