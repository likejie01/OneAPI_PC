import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSelectionContextMenuText, shouldDismissContextMenu } from './context-menu.ts'

test('shouldDismissContextMenu keeps the menu open for focus or pointer events inside the menu', () => {
  const insideTarget = { id: 'inside' }
  const root = {
    contains(target: Node | null) {
      return target === (insideTarget as unknown as Node)
    },
  }

  assert.equal(shouldDismissContextMenu(root, insideTarget as EventTarget), false)
})

test('shouldDismissContextMenu closes the menu for events outside the menu', () => {
  const insideTarget = { id: 'inside' }
  const outsideTarget = { id: 'outside' }
  const root = {
    contains(target: Node | null) {
      return target === (insideTarget as unknown as Node)
    },
  }

  assert.equal(shouldDismissContextMenu(root, outsideTarget as EventTarget), true)
  assert.equal(shouldDismissContextMenu(root, null), true)
  assert.equal(shouldDismissContextMenu(null, outsideTarget as EventTarget), true)
})

test('resolveSelectionContextMenuText returns selected text only when selection belongs to the target root', () => {
  const insideTarget = { id: 'inside' }
  const outsideTarget = { id: 'outside' }
  const root = {
    contains(target: Node | null) {
      return target === (insideTarget as unknown as Node)
    },
  }

  assert.equal(
    resolveSelectionContextMenuText(root, {
      toString: () => '  需要翻译的文本  ',
      anchorNode: insideTarget as unknown as Node,
      focusNode: insideTarget as unknown as Node,
    }),
    '需要翻译的文本'
  )
  assert.equal(
    resolveSelectionContextMenuText(root, {
      toString: () => '外部文本',
      anchorNode: outsideTarget as unknown as Node,
      focusNode: outsideTarget as unknown as Node,
    }),
    ''
  )
})
