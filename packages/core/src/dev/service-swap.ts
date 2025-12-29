/**
 * Service Swap for Pulumix dev mode
 *
 * Routes cluster ingress traffic to local dev server by:
 * 1. Scaling down the deployment
 * 2. Patching the Service to point to host machine
 * 3. Restoring on cleanup
 */

import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { Either, Left, Right } from 'purify-ts/Either'
import { createDeploymentError, DeployError } from '../types/errors'
import { ServiceSwapHandle } from './types'

/**
 * State saved for crash recovery
 */
export interface DevSwapState {
  readonly namespace: string
  readonly services: ServiceSwapState[]
  readonly timestamp: string
}

export interface ServiceSwapState {
  readonly serviceName: string
  readonly originalReplicas: number
  readonly originalSelector: Record<string, string> | null
}

/**
 * Get the state file path for dev mode crash recovery
 */
function getStateFilePath(rootPath: string): string {
  const devStateDir = path.join(rootPath, 'dist', '.pulumix')
  if (!fs.existsSync(devStateDir)) {
    fs.mkdirSync(devStateDir, { recursive: true })
  }
  return path.join(devStateDir, 'dev-state.json')
}

/**
 * Save dev state for crash recovery
 */
export function saveDevState(rootPath: string, state: DevSwapState): void {
  const stateFile = getStateFilePath(rootPath)
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2))
}

/**
 * Load dev state if exists
 */
export function loadDevState(rootPath: string): DevSwapState | null {
  const stateFile = getStateFilePath(rootPath)
  if (!fs.existsSync(stateFile)) {
    return null
  }
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * Clear dev state
 */
export function clearDevState(rootPath: string): void {
  const stateFile = getStateFilePath(rootPath)
  if (fs.existsSync(stateFile)) {
    fs.unlinkSync(stateFile)
  }
}

/**
 * Get the host IP that k3d can reach
 * This varies by OS and Docker setup
 */
export function getHostIP(): string {
  // Try to get the host IP that k3d/Docker can reach
  // On Docker Desktop (Mac/Windows): host.docker.internal resolves to host
  // On Linux with k3d: typically the docker0 bridge gateway

  try {
    // Try to resolve host.k3d.internal from inside a k3d node
    const result = execSync(
      'kubectl run --rm -i --restart=Never --image=alpine:latest host-lookup -- nslookup host.k3d.internal 2>/dev/null | grep "Address" | tail -1 | awk \'{print $2}\'',
      { encoding: 'utf-8', timeout: 10000 }
    ).trim()

    if (result && result.match(/^\d+\.\d+\.\d+\.\d+$/)) {
      return result
    }
  } catch {
    // Ignore errors, try fallback
  }

  try {
    // Fallback: get the docker bridge gateway
    const result = execSync(
      'docker network inspect k3d-hello-world -f "{{range .IPAM.Config}}{{.Gateway}}{{end}}" 2>/dev/null',
      { encoding: 'utf-8', timeout: 5000 }
    ).trim()

    if (result && result.match(/^\d+\.\d+\.\d+\.\d+$/)) {
      return result
    }
  } catch {
    // Ignore errors
  }

  try {
    // Another fallback: try host.docker.internal resolution
    const result = execSync(
      'getent hosts host.docker.internal 2>/dev/null | awk \'{print $1}\'',
      { encoding: 'utf-8', timeout: 5000 }
    ).trim()

    if (result && result.match(/^\d+\.\d+\.\d+\.\d+$/)) {
      return result
    }
  } catch {
    // Ignore errors
  }

  // Last resort fallback for Docker Desktop on Mac
  // This is the typical gateway IP
  return '192.168.65.254'
}

/**
 * Get current deployment replicas
 */
export function getDeploymentReplicas(
  serviceName: string,
  namespace: string
): number {
  try {
    const result = execSync(
      `kubectl get deployment ${serviceName} -n ${namespace} -o jsonpath='{.spec.replicas}' 2>/dev/null`,
      { encoding: 'utf-8', timeout: 10000 }
    ).trim()
    return parseInt(result, 10) || 1
  } catch {
    return 1
  }
}

/**
 * Get current service selector
 */
export function getServiceSelector(
  serviceName: string,
  namespace: string
): Record<string, string> | null {
  try {
    const result = execSync(
      `kubectl get svc ${serviceName} -n ${namespace} -o jsonpath='{.spec.selector}' 2>/dev/null`,
      { encoding: 'utf-8', timeout: 10000 }
    ).trim()

    if (!result || result === '{}') {
      return null
    }

    // Parse the selector (format: {"app":"hello-world"})
    return JSON.parse(result)
  } catch {
    return null
  }
}

/**
 * Scale a deployment
 */
export function scaleDeployment(
  serviceName: string,
  namespace: string,
  replicas: number
): Either<DeployError, true> {
  try {
    execSync(
      `kubectl scale deployment ${serviceName} -n ${namespace} --replicas=${replicas}`,
      { encoding: 'utf-8', timeout: 30000 }
    )
    return Right(true)
  } catch (err: any) {
    return Left(createDeploymentError(
      'ResourceFailed',
      `Failed to scale deployment ${serviceName}: ${err.message}`,
      undefined,
      { serviceName, namespace, replicas }
    ))
  }
}

/**
 * Patch service to remove selector (so we can use custom Endpoints)
 */
export function removeServiceSelector(
  serviceName: string,
  namespace: string
): Either<DeployError, true> {
  try {
    execSync(
      `kubectl patch svc ${serviceName} -n ${namespace} --type=json -p='[{"op":"remove","path":"/spec/selector"}]'`,
      { encoding: 'utf-8', timeout: 10000 }
    )
    return Right(true)
  } catch (err: any) {
    return Left(createDeploymentError(
      'ResourceFailed',
      `Failed to patch service ${serviceName}: ${err.message}`,
      undefined,
      { serviceName, namespace }
    ))
  }
}

/**
 * Restore service selector
 */
export function restoreServiceSelector(
  serviceName: string,
  namespace: string,
  selector: Record<string, string>
): Either<DeployError, true> {
  try {
    const selectorJson = JSON.stringify(selector)
    execSync(
      `kubectl patch svc ${serviceName} -n ${namespace} --type=merge -p='{"spec":{"selector":${selectorJson}}}'`,
      { encoding: 'utf-8', timeout: 10000 }
    )
    return Right(true)
  } catch (err: any) {
    return Left(createDeploymentError(
      'ResourceFailed',
      `Failed to restore service selector ${serviceName}: ${err.message}`,
      undefined,
      { serviceName, namespace }
    ))
  }
}

/**
 * Create Endpoints pointing to host machine
 */
export function createHostEndpoints(
  serviceName: string,
  namespace: string,
  hostIP: string,
  port: number
): Either<DeployError, true> {
  const endpointsYaml = `
apiVersion: v1
kind: Endpoints
metadata:
  name: ${serviceName}
  namespace: ${namespace}
subsets:
  - addresses:
      - ip: ${hostIP}
    ports:
      - port: ${port}
`

  try {
    execSync(`kubectl apply -f -`, {
      input: endpointsYaml,
      encoding: 'utf-8',
      timeout: 10000
    })
    return Right(true)
  } catch (err: any) {
    return Left(createDeploymentError(
      'ResourceFailed',
      `Failed to create endpoints for ${serviceName}: ${err.message}`,
      undefined,
      { serviceName, namespace, hostIP, port }
    ))
  }
}

/**
 * Delete custom Endpoints (let k8s recreate from selector)
 */
export function deleteEndpoints(
  serviceName: string,
  namespace: string
): Either<DeployError, true> {
  try {
    // Delete our custom endpoints - k8s will recreate from selector
    execSync(
      `kubectl delete endpoints ${serviceName} -n ${namespace} --ignore-not-found`,
      { encoding: 'utf-8', timeout: 10000 }
    )
    return Right(true)
  } catch (err: any) {
    return Left(createDeploymentError(
      'ResourceFailed',
      `Failed to delete endpoints ${serviceName}: ${err.message}`,
      undefined,
      { serviceName, namespace }
    ))
  }
}

/**
 * Swap a service to point to local dev server
 */
export async function swapServiceToLocal(
  serviceName: string,
  namespace: string,
  localPort: number,
  rootPath: string
): Promise<Either<DeployError, ServiceSwapHandle>> {
  // Get current state for restore
  const originalReplicas = getDeploymentReplicas(serviceName, namespace)
  const originalSelector = getServiceSelector(serviceName, namespace)

  if (!originalSelector) {
    return Left(createDeploymentError(
      'ResourceFailed',
      `Service ${serviceName} has no selector - cannot swap`,
      undefined,
      { serviceName, namespace }
    ))
  }

  // Get host IP
  const hostIP = getHostIP()

  // Save state for crash recovery
  const existingState = loadDevState(rootPath)
  const newServiceState: ServiceSwapState = {
    serviceName,
    originalReplicas,
    originalSelector
  }

  const newState: DevSwapState = {
    namespace,
    services: existingState?.services
      ? [...existingState.services.filter(s => s.serviceName !== serviceName), newServiceState]
      : [newServiceState],
    timestamp: new Date().toISOString()
  }
  saveDevState(rootPath, newState)

  // Scale down deployment
  const scaleResult = scaleDeployment(serviceName, namespace, 0)
  if (scaleResult.isLeft()) {
    return Left(scaleResult.extract() as DeployError)
  }

  // Remove selector from service
  const patchResult = removeServiceSelector(serviceName, namespace)
  if (patchResult.isLeft()) {
    // Try to restore replicas
    scaleDeployment(serviceName, namespace, originalReplicas)
    return Left(patchResult.extract() as DeployError)
  }

  // Create endpoints pointing to host
  const endpointsResult = createHostEndpoints(serviceName, namespace, hostIP, localPort)
  if (endpointsResult.isLeft()) {
    // Try to restore
    restoreServiceSelector(serviceName, namespace, originalSelector)
    scaleDeployment(serviceName, namespace, originalReplicas)
    return Left(endpointsResult.extract() as DeployError)
  }

  // Return handle with restore function
  const restore = async (): Promise<void> => {
    // Delete custom endpoints
    deleteEndpoints(serviceName, namespace)

    // Restore selector
    restoreServiceSelector(serviceName, namespace, originalSelector)

    // Scale back up
    scaleDeployment(serviceName, namespace, originalReplicas)

    // Update state
    const currentState = loadDevState(rootPath)
    if (currentState) {
      const remainingServices = currentState.services.filter(s => s.serviceName !== serviceName)
      if (remainingServices.length === 0) {
        clearDevState(rootPath)
      } else {
        saveDevState(rootPath, { ...currentState, services: remainingServices })
      }
    }
  }

  return Right({
    serviceName,
    namespace,
    localPort,
    restore
  })
}

/**
 * Restore all services from stale dev state (crash recovery)
 */
export async function restoreFromStaleState(rootPath: string): Promise<void> {
  const state = loadDevState(rootPath)
  if (!state) {
    return
  }

  console.log('Restoring from previous dev session...')

  for (const service of state.services) {
    try {
      // Delete custom endpoints
      deleteEndpoints(service.serviceName, state.namespace)

      // Restore selector if we have it
      if (service.originalSelector) {
        restoreServiceSelector(service.serviceName, state.namespace, service.originalSelector)
      }

      // Scale back up
      scaleDeployment(service.serviceName, state.namespace, service.originalReplicas)

      console.log(`  Restored ${service.serviceName}`)
    } catch (err) {
      console.error(`  Failed to restore ${service.serviceName}:`, err)
    }
  }

  clearDevState(rootPath)
}
