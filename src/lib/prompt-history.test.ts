import test from 'node:test'
import assert from 'node:assert/strict'
import {
  commitPromptHistoryEntry,
  navigatePromptHistory,
  setPromptHistoryEditingState,
  type PromptHistoryState,
} from './prompt-history.ts'

function createState(partial: Partial<PromptHistoryState> = {}): PromptHistoryState {
  return {
    items: [],
    browseIndex: -1,
    browsingValue: '',
    editLocked: false,
    ...partial,
  }
}

test('navigatePromptHistory loads the latest entry when the input is empty', () => {
  const next = navigatePromptHistory(createState({ items: ['latest', 'older'] }), 'up', '')
  assert.equal(next.nextValue, 'latest')
  assert.equal(next.state.browseIndex, 0)
})

test('navigatePromptHistory switches through history entries while browsing', () => {
  const first = navigatePromptHistory(createState({ items: ['latest', 'middle', 'older'] }), 'up', '')
  const second = navigatePromptHistory(first.state, 'up', first.nextValue)
  const third = navigatePromptHistory(second.state, 'down', second.nextValue)
  assert.equal(second.nextValue, 'middle')
  assert.equal(third.nextValue, 'latest')
})

test('setPromptHistoryEditingState locks navigation after the user edits a recalled prompt', () => {
  const recalled = navigatePromptHistory(createState({ items: ['latest', 'older'] }), 'up', '')
  const edited = setPromptHistoryEditingState(recalled.state, `${recalled.nextValue}!`)
  const blocked = navigatePromptHistory(edited, 'up', `${recalled.nextValue}!`)
  assert.equal(edited.editLocked, true)
  assert.equal(blocked.nextValue, `${recalled.nextValue}!`)
  assert.equal(blocked.state.browseIndex, edited.browseIndex)
})

test('setPromptHistoryEditingState unlocks navigation after the input is cleared', () => {
  const recalled = navigatePromptHistory(createState({ items: ['latest', 'older'] }), 'up', '')
  const edited = setPromptHistoryEditingState(recalled.state, `${recalled.nextValue}!`)
  const reset = setPromptHistoryEditingState(edited, '')
  const next = navigatePromptHistory(reset, 'up', '')
  assert.equal(reset.editLocked, false)
  assert.equal(next.nextValue, 'latest')
})

test('commitPromptHistoryEntry keeps the latest prompt first and removes duplicates', () => {
  const next = commitPromptHistoryEntry(['older', 'repeat', 'tail'], 'repeat')
  assert.deepEqual(next, ['repeat', 'older', 'tail'])
})
