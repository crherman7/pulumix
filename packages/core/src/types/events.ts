/**
 * Event types for Observable-based UI
 *
 * These events are emitted during deployment and consumed by the UI layer
 * to provide real-time feedback with progress bars and collapsible groups.
 */

import { DeployError } from './errors'

/**
 * Phase names for deployment phases
 */
export type PhaseName =
  | 'Discovery'
  | 'Configuration'
  | 'DependencyGraph'
  | 'Bootstrap'
  | 'Secrets'
  | 'Build'
  | 'Deploy'
  | 'Outputs'

/**
 * Status of a phase or task
 */
export type Status = 'pending' | 'running' | 'success' | 'error' | 'warning'

/**
 * Phase start event - emitted when a deployment phase begins
 */
export interface PhaseStartEvent {
  readonly type: 'PhaseStart'
  readonly phaseNumber: number
  readonly phase: PhaseName
  readonly timestamp: number
}

/**
 * Phase complete event - emitted when a deployment phase completes
 */
export interface PhaseCompleteEvent {
  readonly type: 'PhaseComplete'
  readonly phaseNumber: number
  readonly phase: PhaseName
  readonly status: Exclude<Status, 'pending' | 'running'>
  readonly timestamp: number
  readonly duration?: number
  readonly error?: DeployError
}

/**
 * Phase progress event - emitted during a phase to show progress
 */
export interface PhaseProgressEvent {
  readonly type: 'PhaseProgress'
  readonly phaseNumber: number
  readonly phase: PhaseName
  readonly current: number
  readonly total: number
  readonly label?: string
  readonly timestamp: number
}

/**
 * Task start event - emitted when a specific task begins
 */
export interface TaskStartEvent {
  readonly type: 'TaskStart'
  readonly taskId: string
  readonly taskName: string
  readonly phase: PhaseName
  readonly timestamp: number
  readonly contentHash?: string
}

/**
 * Task update event - emitted during a task for progress updates
 */
export interface TaskUpdateEvent {
  readonly type: 'TaskUpdate'
  readonly taskId: string
  readonly progress?: number
  readonly message?: string
  readonly timestamp: number
}

/**
 * Task complete event - emitted when a task completes
 */
export interface TaskCompleteEvent {
  readonly type: 'TaskComplete'
  readonly taskId: string
  readonly taskName: string
  readonly status: Exclude<Status, 'pending' | 'running'>
  readonly timestamp: number
  readonly duration?: number
  readonly error?: DeployError
  /** Whether the task was skipped (e.g., build cache hit) */
  readonly skipped?: boolean
  /** Content hash for build tasks */
  readonly contentHash?: string
}

/**
 * Resource event - emitted when a Pulumi resource is created/updated/deleted
 */
export interface ResourceEvent {
  readonly type: 'Resource'
  readonly action: 'create' | 'update' | 'delete' | 'same'
  readonly resourceType: string
  readonly resourceName: string
  readonly urn: string
  readonly timestamp: number
}

/**
 * Diagnostic event - emitted for logs, warnings, and debug info
 */
export interface DiagnosticEvent {
  readonly type: 'Diagnostic'
  readonly severity: 'debug' | 'info' | 'warning' | 'error'
  readonly message: string
  readonly phase?: PhaseName
  readonly timestamp: number
  readonly context?: Record<string, unknown>
}

/**
 * Deployment start event - emitted at the beginning of deployment
 */
export interface DeploymentStartEvent {
  readonly type: 'DeploymentStart'
  readonly stackName: string
  readonly environment: string
  readonly timestamp: number
}

/**
 * Deployment complete event - emitted at the end of deployment
 */
export interface DeploymentCompleteEvent {
  readonly type: 'DeploymentComplete'
  readonly stackName: string
  readonly status: 'success' | 'error'
  readonly timestamp: number
  readonly duration: number
  readonly error?: DeployError
  readonly summary?: {
    readonly resourceChanges?: {
      readonly create?: number
      readonly update?: number
      readonly delete?: number
      readonly same?: number
    }
  }
}

/**
 * Union of all deployment event types
 */
export type DeploymentEvent =
  | PhaseStartEvent
  | PhaseCompleteEvent
  | PhaseProgressEvent
  | TaskStartEvent
  | TaskUpdateEvent
  | TaskCompleteEvent
  | ResourceEvent
  | DiagnosticEvent
  | DeploymentStartEvent
  | DeploymentCompleteEvent

/**
 * Event emitter/bus interface
 */
export interface EventEmitter {
  emit(event: DeploymentEvent): void
  subscribe(handler: (event: DeploymentEvent) => void): () => void
}

/**
 * Helper functions to create events
 */
export const createPhaseStartEvent = (
  phaseNumber: number,
  phase: PhaseName
): PhaseStartEvent => ({
  type: 'PhaseStart',
  phaseNumber,
  phase,
  timestamp: Date.now()
})

export const createPhaseCompleteEvent = (
  phaseNumber: number,
  phase: PhaseName,
  status: Exclude<Status, 'pending' | 'running'>,
  duration?: number,
  error?: DeployError
): PhaseCompleteEvent => ({
  type: 'PhaseComplete',
  phaseNumber,
  phase,
  status,
  timestamp: Date.now(),
  duration,
  error
})

export const createPhaseProgressEvent = (
  phaseNumber: number,
  phase: PhaseName,
  current: number,
  total: number,
  label?: string
): PhaseProgressEvent => ({
  type: 'PhaseProgress',
  phaseNumber,
  phase,
  current,
  total,
  label,
  timestamp: Date.now()
})

export const createDiagnosticEvent = (
  severity: DiagnosticEvent['severity'],
  message: string,
  phase?: PhaseName,
  context?: Record<string, unknown>
): DiagnosticEvent => ({
  type: 'Diagnostic',
  severity,
  message,
  phase,
  timestamp: Date.now(),
  context
})
