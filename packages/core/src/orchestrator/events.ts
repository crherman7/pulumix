/**
 * Orchestrator Event Emitter
 *
 * Event emitter for deployment events using functional patterns.
 * Used to notify UI layer of progress.
 */

import { DeploymentEvent, PhaseName, createDiagnosticEvent } from '../types/events'

// ============================================================================
// Types
// ============================================================================

/**
 * Deployment phase (internal)
 */
export type DeploymentPhase =
  | 'initialization'
  | 'configuration'
  | 'discovery'
  | 'dependency-analysis'
  | 'bootstrap'
  | 'image-build'
  | 'deployment'
  | 'complete'

/**
 * Phase progress information
 */
export interface PhaseProgress {
  readonly phase: DeploymentPhase
  readonly current: number
  readonly total: number
  readonly message?: string
}

/**
 * Event listener function
 */
export type EventListener = (event: DeploymentEvent) => void

// ============================================================================
// Pure Functions
// ============================================================================

/**
 * Phase number mapping (determines display order)
 */
const PHASE_NUMBERS: Record<DeploymentPhase, number> = {
  'initialization': 0,
  'configuration': 1,
  'discovery': 2,
  'dependency-analysis': 3,
  'bootstrap': 4,
  'image-build': 5,
  'deployment': 6,
  'complete': 7
}

/**
 * Map deployment phase to event phase name (pure function)
 */
const mapPhaseToEventPhase = (phase: DeploymentPhase): PhaseName => {
  const mapping: Record<DeploymentPhase, PhaseName> = {
    'initialization': 'Discovery',
    'configuration': 'Configuration',
    'discovery': 'Discovery',
    'dependency-analysis': 'DependencyGraph',
    'bootstrap': 'Bootstrap',
    'image-build': 'Build',
    'deployment': 'Deploy',
    'complete': 'Outputs'
  }
  return mapping[phase]
}

/**
 * Get phase number (pure function)
 */
const getPhaseNumber = (phase: DeploymentPhase): number =>
  PHASE_NUMBERS[phase]

// ============================================================================
// Event Emitter Class
// ============================================================================

/**
 * Simple event emitter for orchestrator
 */
export class OrchestratorEventEmitter {
  private listeners: EventListener[] = []
  private currentPhase: DeploymentPhase = 'initialization'
  private taskStartTimes: Map<string, number> = new Map()

  /**
   * Subscribe to events
   */
  on(listener: EventListener): () => void {
    this.listeners.push(listener)

    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index > -1) {
        this.listeners.splice(index, 1)
      }
    }
  }

  /**
   * Emit an event to all listeners
   */
  emit(event: DeploymentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (err) {
        // Don't let listener errors break the deployment
        console.error('Event listener error:', err)
      }
    }
  }

  /**
   * Emit phase start event
   */
  emitPhaseStart(phase: DeploymentPhase): void {
    this.currentPhase = phase
    const eventPhase = mapPhaseToEventPhase(phase)
    const phaseNumber = getPhaseNumber(phase)

    this.emit({
      type: 'PhaseStart',
      phaseNumber,
      phase: eventPhase,
      timestamp: Date.now()
    })
  }

  /**
   * Emit phase progress event
   */
  emitPhaseProgress(progress: PhaseProgress): void {
    const eventPhase = mapPhaseToEventPhase(progress.phase)
    const phaseNumber = getPhaseNumber(progress.phase)

    this.emit({
      type: 'PhaseProgress',
      phaseNumber,
      phase: eventPhase,
      current: progress.current,
      total: progress.total,
      label: progress.message,
      timestamp: Date.now()
    })
  }

  /**
   * Emit phase complete event
   */
  emitPhaseComplete(phase: DeploymentPhase, success: boolean = true): void {
    const eventPhase = mapPhaseToEventPhase(phase)
    const phaseNumber = getPhaseNumber(phase)

    this.emit({
      type: 'PhaseComplete',
      phaseNumber,
      phase: eventPhase,
      status: success ? 'success' : 'error',
      timestamp: Date.now()
    })
  }

  /**
   * Emit task start event
   */
  emitTaskStart(taskIdOrName: string, taskName?: string, phase?: string, contentHash?: string): void {
    // Support both old signature (taskName only) and new (taskId, taskName)
    const taskId = taskIdOrName
    const displayName = taskName || taskIdOrName
    const eventPhase = phase ? mapPhaseToEventPhase(phase as any) : mapPhaseToEventPhase(this.currentPhase)
    const now = Date.now()

    // Record start time for duration calculation (use taskId for tracking)
    this.taskStartTimes.set(taskId, now)

    this.emit({
      type: 'TaskStart',
      taskId,
      taskName: displayName,
      phase: eventPhase,
      timestamp: now,
      contentHash
    })
  }

  /**
   * Emit task update event (for progress)
   */
  emitTaskUpdate(taskName: string, message: string, progress?: number): void {
    this.emit({
      type: 'TaskUpdate',
      taskId: taskName,
      progress,
      message,
      timestamp: Date.now()
    })
  }

  /**
   * Emit task complete event
   */
  emitTaskComplete(taskName: string, success: boolean, skipped?: boolean, contentHash?: string): void {
    const now = Date.now()
    const startTime = this.taskStartTimes.get(taskName)
    const duration = startTime ? now - startTime : undefined

    // Clean up start time
    this.taskStartTimes.delete(taskName)

    this.emit({
      type: 'TaskComplete',
      taskId: taskName,
      taskName,
      status: success ? 'success' : 'error',
      timestamp: now,
      duration,
      skipped,
      contentHash
    })
  }

  /**
   * Emit diagnostic event
   */
  emitDiagnostic(message: string, phase?: PhaseName): void {
    this.emit(createDiagnosticEvent('info', message, phase))
  }

  /**
   * Emit log event (using DiagnosticEvent)
   */
  emitLog(
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
    context?: Record<string, unknown>,
    phase?: PhaseName
  ): void {
    this.emit(createDiagnosticEvent(
      level === 'warn' ? 'warning' : level,
      message,
      phase,
      context
    ))
  }

  /**
   * Get current phase
   */
  getCurrentPhase(): DeploymentPhase {
    return this.currentPhase
  }

  /**
   * Clear all listeners
   */
  clear(): void {
    this.listeners = []
  }
}

/**
 * Create a new event emitter
 */
export const createEventEmitter = (): OrchestratorEventEmitter =>
  new OrchestratorEventEmitter()
