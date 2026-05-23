export type PromptHistoryDirection = 'up' | 'down'

export type PromptHistoryState = {
  items: string[]
  browseIndex: number
  browsingValue: string
  editLocked: boolean
}

const DEFAULT_HISTORY_LIMIT = 20

export function createPromptHistoryState(items: string[] = []): PromptHistoryState {
  return {
    items,
    browseIndex: -1,
    browsingValue: '',
    editLocked: false,
  }
}

export function navigatePromptHistory(
  state: PromptHistoryState,
  direction: PromptHistoryDirection,
  currentValue: string
) {
  if (!state.items.length || state.editLocked) {
    return {
      state,
      nextValue: currentValue,
    }
  }

  const browsing = state.browseIndex >= 0
  if (!browsing && currentValue.trim().length > 0) {
    return {
      state,
      nextValue: currentValue,
    }
  }

  let nextIndex = state.browseIndex
  if (!browsing) {
    if (direction !== 'up') {
      return {
        state,
        nextValue: currentValue,
      }
    }
    nextIndex = 0
  } else if (direction === 'up') {
    nextIndex = Math.min(state.items.length - 1, state.browseIndex + 1)
  } else {
    nextIndex = Math.max(0, state.browseIndex - 1)
  }

  const nextValue = state.items[nextIndex] || currentValue
  return {
    state: {
      ...state,
      browseIndex: nextIndex,
      browsingValue: nextValue,
      editLocked: false,
    },
    nextValue,
  }
}

export function setPromptHistoryEditingState(state: PromptHistoryState, nextValue: string): PromptHistoryState {
  if (!nextValue.length) {
    return {
      ...state,
      browseIndex: -1,
      browsingValue: '',
      editLocked: false,
    }
  }

  if (state.browseIndex < 0) {
    return state
  }

  if (nextValue === state.browsingValue) {
    return state
  }

  return {
    ...state,
    editLocked: true,
  }
}

export function commitPromptHistoryEntry(items: string[], value: string, limit = DEFAULT_HISTORY_LIMIT) {
  const normalized = value.trim()
  if (!normalized) {
    return items
  }

  const deduped = items.filter((item) => item !== normalized)
  return [normalized, ...deduped].slice(0, Math.max(1, limit))
}
