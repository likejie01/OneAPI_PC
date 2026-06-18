import { useCallback, useLayoutEffect, useRef } from 'react'

export const AUTO_TEXTAREA_MAX_HEIGHT = 260
export const AUTO_TEXTAREA_MIN_ROWS = 3
export const AUTO_TEXTAREA_MAX_ROWS = 8

export function syncTextareaHeight(node: HTMLTextAreaElement | null) {
  if (!node) {
    return
  }

  node.style.height = 'auto'
  const computed = window.getComputedStyle(node)
  const lineHeight = Number.parseFloat(computed.lineHeight) || 24
  const paddingTop = Number.parseFloat(computed.paddingTop) || 0
  const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0
  const minHeight = lineHeight * AUTO_TEXTAREA_MIN_ROWS + paddingTop + paddingBottom
  const maxHeight = lineHeight * AUTO_TEXTAREA_MAX_ROWS + paddingTop + paddingBottom
  const nextHeight = Math.min(Math.max(node.scrollHeight, minHeight), Math.min(maxHeight, AUTO_TEXTAREA_MAX_HEIGHT))
  node.style.height = `${nextHeight}px`
  node.style.overflowY = node.scrollHeight > maxHeight ? 'auto' : 'hidden'
}

export function useAutosizeTextarea(value: string) {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  const resize = useCallback(() => {
    syncTextareaHeight(ref.current)
  }, [])

  useLayoutEffect(() => {
    resize()
  }, [resize, value])

  return { ref, resize }
}
