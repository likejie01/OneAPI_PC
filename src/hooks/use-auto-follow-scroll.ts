import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

export function useAutoFollowScroll(
  containerRef: React.RefObject<HTMLDivElement | null>,
  dependencies: readonly unknown[]
) {
  const shouldFollowRef = useRef(true)

  const scrollToLatest = useCallback(() => {
    const node = containerRef.current
    if (!node) {
      return
    }
    shouldFollowRef.current = true
    window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight
    })
  }, [containerRef])

  useEffect(() => {
    const node = containerRef.current
    if (!node) {
      return
    }

    let followFrame = 0
    const handleScroll = () => {
      const remaining = node.scrollHeight - node.scrollTop - node.clientHeight
      shouldFollowRef.current = remaining <= 48
    }
    const scheduleFollowToLatest = () => {
      if (!shouldFollowRef.current || followFrame) {
        return
      }
      followFrame = window.requestAnimationFrame(() => {
        followFrame = 0
        if (shouldFollowRef.current) {
          node.scrollTop = node.scrollHeight
        }
      })
    }

    handleScroll()
    node.addEventListener('scroll', handleScroll, { passive: true })
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(scheduleFollowToLatest)

    resizeObserver?.observe(node)
    if (node.firstElementChild) {
      resizeObserver?.observe(node.firstElementChild)
    }

    return () => {
      node.removeEventListener('scroll', handleScroll)
      if (followFrame) {
        window.cancelAnimationFrame(followFrame)
      }
      resizeObserver?.disconnect()
    }
  }, [containerRef])

  useLayoutEffect(() => {
    const node = containerRef.current
    if (!node || !shouldFollowRef.current) {
      return
    }
    node.scrollTop = node.scrollHeight
  }, [containerRef, ...dependencies])

  return scrollToLatest
}
