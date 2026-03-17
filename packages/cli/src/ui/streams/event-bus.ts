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
   * Higher-order function that creates a typed event subscriber.
   * Encapsulates the RxJS filter and subscription pattern.
   */
  private createTypedSubscriber<T extends DeploymentEvent['type']>(
    eventType: T
  ): (handler: (event: Extract<DeploymentEvent, { type: T }>) => void) => () => void {
    return (handler) => {
      const subscription = this.subject
        .pipe(filter((e): e is Extract<DeploymentEvent, { type: T }> => e.type === eventType))
        .subscribe(handler)
      return () => subscription.unsubscribe()
    }
  }

  /**
   * Subscribe to phase start events
   */
  onPhaseStart = this.createTypedSubscriber('PhaseStart')

  /**
   * Subscribe to phase complete events
   */
  onPhaseComplete = this.createTypedSubscriber('PhaseComplete')

  /**
   * Subscribe to phase progress events
   */
  onPhaseProgress = this.createTypedSubscriber('PhaseProgress')

  /**
   * Subscribe to task start events
   */
  onTaskStart = this.createTypedSubscriber('TaskStart')

  /**
   * Subscribe to task update events
   */
  onTaskUpdate = this.createTypedSubscriber('TaskUpdate')

  /**
   * Subscribe to task complete events
   */
  onTaskComplete = this.createTypedSubscriber('TaskComplete')

  /**
   * Subscribe to diagnostic events (logs)
   */
  onDiagnostic = this.createTypedSubscriber('Diagnostic')

  /**
   * Subscribe to resource events
   */
  onResource = this.createTypedSubscriber('Resource')

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
