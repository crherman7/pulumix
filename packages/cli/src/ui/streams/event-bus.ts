/**
 * Event Bus for Deployment Events
 *
 * RxJS-based event streaming for UI components.
 * Allows filtering and subscribing to specific event types.
 */

import { Subject, Observable } from 'rxjs'
import { filter } from 'rxjs/operators'
import { DeploymentEvent } from '@pulumix/core'

/**
 * Deployment Event Bus
 *
 * Central event bus for all deployment events.
 * UI components can subscribe to specific event types.
 */
export class DeploymentEventBus {
  private subject: Subject<DeploymentEvent>

  constructor() {
    this.subject = new Subject<DeploymentEvent>()
  }

  /**
   * Emit an event to all subscribers
   */
  emit(event: DeploymentEvent): void {
    this.subject.next(event)
  }

  /**
   * Get observable stream of all events
   */
  getStream(): Observable<DeploymentEvent> {
    return this.subject.asObservable()
  }

  /**
   * Subscribe to all events
   */
  subscribe(handler: (event: DeploymentEvent) => void): () => void {
    const subscription = this.subject.subscribe(handler)
    return () => subscription.unsubscribe()
  }

  /**
   * Subscribe to phase start events
   */
  onPhaseStart(handler: (event: Extract<DeploymentEvent, { type: 'PhaseStart' }>) => void): () => void {
    const subscription = this.subject
      .pipe(filter((e): e is Extract<DeploymentEvent, { type: 'PhaseStart' }> => e.type === 'PhaseStart'))
      .subscribe(handler)
    return () => subscription.unsubscribe()
  }

  /**
   * Subscribe to phase complete events
   */
  onPhaseComplete(handler: (event: Extract<DeploymentEvent, { type: 'PhaseComplete' }>) => void): () => void {
    const subscription = this.subject
      .pipe(filter((e): e is Extract<DeploymentEvent, { type: 'PhaseComplete' }> => e.type === 'PhaseComplete'))
      .subscribe(handler)
    return () => subscription.unsubscribe()
  }

  /**
   * Subscribe to phase progress events
   */
  onPhaseProgress(handler: (event: Extract<DeploymentEvent, { type: 'PhaseProgress' }>) => void): () => void {
    const subscription = this.subject
      .pipe(filter((e): e is Extract<DeploymentEvent, { type: 'PhaseProgress' }> => e.type === 'PhaseProgress'))
      .subscribe(handler)
    return () => subscription.unsubscribe()
  }

  /**
   * Subscribe to task start events
   */
  onTaskStart(handler: (event: Extract<DeploymentEvent, { type: 'TaskStart' }>) => void): () => void {
    const subscription = this.subject
      .pipe(filter((e): e is Extract<DeploymentEvent, { type: 'TaskStart' }> => e.type === 'TaskStart'))
      .subscribe(handler)
    return () => subscription.unsubscribe()
  }

  /**
   * Subscribe to task update events
   */
  onTaskUpdate(handler: (event: Extract<DeploymentEvent, { type: 'TaskUpdate' }>) => void): () => void {
    const subscription = this.subject
      .pipe(filter((e): e is Extract<DeploymentEvent, { type: 'TaskUpdate' }> => e.type === 'TaskUpdate'))
      .subscribe(handler)
    return () => subscription.unsubscribe()
  }

  /**
   * Subscribe to task complete events
   */
  onTaskComplete(handler: (event: Extract<DeploymentEvent, { type: 'TaskComplete' }>) => void): () => void {
    const subscription = this.subject
      .pipe(filter((e): e is Extract<DeploymentEvent, { type: 'TaskComplete' }> => e.type === 'TaskComplete'))
      .subscribe(handler)
    return () => subscription.unsubscribe()
  }

  /**
   * Subscribe to diagnostic events (logs)
   */
  onDiagnostic(handler: (event: Extract<DeploymentEvent, { type: 'Diagnostic' }>) => void): () => void {
    const subscription = this.subject
      .pipe(filter((e): e is Extract<DeploymentEvent, { type: 'Diagnostic' }> => e.type === 'Diagnostic'))
      .subscribe(handler)
    return () => subscription.unsubscribe()
  }

  /**
   * Subscribe to resource events
   */
  onResource(handler: (event: Extract<DeploymentEvent, { type: 'Resource' }>) => void): () => void {
    const subscription = this.subject
      .pipe(filter((e): e is Extract<DeploymentEvent, { type: 'Resource' }> => e.type === 'Resource'))
      .subscribe(handler)
    return () => subscription.unsubscribe()
  }

  /**
   * Close the event bus
   */
  close(): void {
    this.subject.complete()
  }
}

/**
 * Create a new event bus
 */
export const createEventBus = (): DeploymentEventBus => {
  return new DeploymentEventBus()
}
