/**
 * Port-forward manager for Pulumix dev mode
 *
 * Manages kubectl port-forward processes to bridge local dev
 * environment to cluster services.
 */

import { spawn } from 'child_process'
import * as net from 'net'
import { createDeploymentError, DeployError } from '../types/errors'
import { Either, Left, Right } from 'purify-ts/Either'
import { PortForwardMapping, PortForwardHandle } from './types'

/**
 * Check if kubectl is available
 */
export async function checkKubectl(): Promise<Either<DeployError, true>> {
  return new Promise((resolve) => {
    const proc = spawn('kubectl', ['version', '--client'], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    proc.on('error', () => {
      resolve(Left(createDeploymentError(
        'PulumiFailed',
        'kubectl not found. Install kubectl to use dev mode.',
        undefined,
        { docs: 'https://kubernetes.io/docs/tasks/tools/' }
      )))
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(Right(true))
      } else {
        resolve(Left(createDeploymentError(
          'PulumiFailed',
          'kubectl not working correctly',
          undefined,
          { exitCode: code }
        )))
      }
    })
  })
}

/**
 * Check if a local port is available
 */
export function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()

    server.once('error', () => {
      resolve(false)
    })

    server.once('listening', () => {
      server.close()
      resolve(true)
    })

    server.listen(port, '127.0.0.1')
  })
}

/**
 * Find an available local port starting from the given port.
 * Auto-increments if the port is in use.
 */
export async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort
  const maxAttempts = 100

  for (let i = 0; i < maxAttempts; i++) {
    if (await checkPortAvailable(port)) {
      return port
    }
    port++
  }

  // Fall back to the original port and let the caller handle the error
  return startPort
}

/**
 * Start a single kubectl port-forward process
 */
export async function startPortForward(
  mapping: PortForwardMapping,
  kubeContext?: string
): Promise<Either<DeployError, PortForwardHandle>> {
  // Check if local port is available
  const portAvailable = await checkPortAvailable(mapping.localPort)
  if (!portAvailable) {
    return Left(createDeploymentError(
      'ResourceFailed',
      `Port ${mapping.localPort} is already in use`,
      undefined,
      { port: mapping.localPort, service: mapping.serviceName }
    ))
  }

  const args = [
    'port-forward',
    '-n', mapping.namespace,
    `svc/${mapping.serviceName}`,
    `${mapping.localPort}:${mapping.remotePort}`
  ]

  if (kubeContext) {
    args.unshift('--context', kubeContext)
  }

  return new Promise((resolve) => {
    const proc = spawn('kubectl', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let started = false
    let stderr = ''

    // Create the promise that resolves when process exits
    const exited = new Promise<number>((resolveExit) => {
      proc.on('close', (code) => {
        resolveExit(code ?? 1)
      })
    })

    proc.on('error', (err) => {
      if (!started) {
        resolve(Left(createDeploymentError(
          'PulumiFailed',
          `Failed to start port-forward for ${mapping.serviceName}: ${err.message}`,
          undefined,
          { service: mapping.serviceName, port: mapping.localPort }
        )))
      }
    })

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.stdout?.on('data', (data: Buffer) => {
      const output = data.toString()
      // kubectl port-forward outputs "Forwarding from 127.0.0.1:PORT -> PORT" when ready
      if (output.includes('Forwarding from') && !started) {
        started = true
        resolve(Right({
          kill: () => proc.kill('SIGTERM'),
          exited,
          mapping
        }))
      }
    })

    // Timeout if port-forward doesn't start within 10 seconds
    setTimeout(() => {
      if (!started) {
        proc.kill('SIGTERM')
        resolve(Left(createDeploymentError(
          'PulumiFailed',
          `Timeout starting port-forward for ${mapping.serviceName}`,
          undefined,
          { service: mapping.serviceName, stderr }
        )))
      }
    }, 10000)
  })
}

/**
 * Start multiple port-forwards sequentially
 */
export async function startPortForwards(
  mappings: PortForwardMapping[],
  kubeContext?: string
): Promise<Either<DeployError, PortForwardHandle[]>> {
  const handles: PortForwardHandle[] = []

  for (const mapping of mappings) {
    const result = await startPortForward(mapping, kubeContext)

    if (result.isLeft()) {
      // Clean up any already-started port-forwards
      stopPortForwards(handles)
      return Left(result.extract() as DeployError)
    }

    handles.push(result.extract() as PortForwardHandle)
  }

  return Right(handles)
}

/**
 * Stop all port-forward processes
 */
export function stopPortForwards(handles: PortForwardHandle[]): void {
  for (const handle of handles) {
    try {
      handle.kill()
    } catch {
      // Ignore errors when killing processes
    }
  }
}
