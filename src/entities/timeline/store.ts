import type { TimelineEvent } from './model'

export interface TimelineStoreState {
  eventsBySession: Record<string, TimelineEvent[]>
}

export function appendTimelineEvent(state: TimelineStoreState, event: TimelineEvent): TimelineStoreState {
  const current = state.eventsBySession[event.sessionId] || []
  return {
    eventsBySession: {
      ...state.eventsBySession,
      [event.sessionId]: [...current, event],
    },
  }
}
