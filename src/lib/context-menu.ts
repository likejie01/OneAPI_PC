type ContainsTarget = {
  contains: (target: Node | null) => boolean
}

export function shouldDismissContextMenu(root: ContainsTarget | null | undefined, target: EventTarget | null) {
  if (!root) {
    return true
  }
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
    return true
  }
  return !root.contains(target as Node | null)
}

type SelectionLike = {
  toString: () => string
  anchorNode: Node | null
  focusNode: Node | null
}

export function resolveSelectionContextMenuText(
  root: ContainsTarget | null | undefined,
  selection: SelectionLike | null | undefined
) {
  if (!root || !selection) {
    return ''
  }
  const text = selection.toString().trim()
  if (!text) {
    return ''
  }
  const anchorInside = root.contains(selection.anchorNode)
  const focusInside = root.contains(selection.focusNode)
  if (!anchorInside && !focusInside) {
    return ''
  }
  return text
}
