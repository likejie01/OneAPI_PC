import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Minus, Square, X } from 'lucide-react'

export function DesktopWindowFrame({
  children,
  iconPath,
  productName,
}: {
  children: ReactNode
  iconPath: string
  productName: string
}) {
  const handleMinimize = useCallback(() => {
    void window.desktopBridge?.minimizeWindow?.()
  }, [])

  const handleToggleMaximize = useCallback(() => {
    void window.desktopBridge?.toggleMaximizeWindow?.()
  }, [])

  const handleClose = useCallback(() => {
    void window.desktopBridge?.closeWindow?.()
  }, [])

  const dragStateRef = useRef<{
    active: boolean
    pointerId: number | null
  }>({
    active: false,
    pointerId: null,
  })

  const stopWindowDrag = useCallback(() => {
    const state = dragStateRef.current
    state.active = false
    state.pointerId = null
    void window.desktopBridge?.endWindowDrag?.()
  }, [])

  useEffect(() => () => stopWindowDrag(), [stopWindowDrag])

  useEffect(() => {
    const handleBlur = () => {
      stopWindowDrag()
    }
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('blur', handleBlur)
    }
  }, [stopWindowDrag])

  const handleWindowPointerDown = useCallback(async (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    dragStateRef.current.active = true
    dragStateRef.current.pointerId = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    await window.desktopBridge?.startWindowDrag?.(event.screenX, event.screenY)
  }, [])

  const handleWindowPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current
    if (!state.active || state.pointerId !== event.pointerId) {
      return
    }
    event.preventDefault()
  }, [])

  const handleWindowPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
    stopWindowDrag()
  }, [stopWindowDrag])

  return (
    <div className='desktop-window-shell'>
      <div className='workspace-aurora app-aurora-shell' aria-hidden='true'>
        <span className='workspace-aurora-veil' />
        <span className='workspace-aurora-blob blob-a' />
        <span className='workspace-aurora-blob blob-b' />
        <span className='workspace-aurora-blob blob-c' />
        <span className='workspace-aurora-blob blob-d' />
      </div>
      <header className='window-chrome'>
        <div
          className='window-drag-region'
          onPointerDown={handleWindowPointerDown}
          onPointerMove={handleWindowPointerMove}
          onPointerUp={handleWindowPointerUp}
          onPointerCancel={handleWindowPointerUp}
          onDoubleClick={(event) => {
            event.preventDefault()
            stopWindowDrag()
            handleToggleMaximize()
          }}
          title='双击最大化或还原'
        >
          <div className='window-chrome-brand'>
            {iconPath ? (
              <img className='window-chrome-icon' src={iconPath} alt='' />
            ) : (
              <span className='window-chrome-icon window-chrome-icon-fallback' aria-hidden='true' />
            )}
            <span className='window-chrome-title'>{productName || 'OneAPI Center'}</span>
          </div>
        </div>
        <div className='window-chrome-controls'>
          <button
            className='window-chrome-button'
            type='button'
            onClick={handleMinimize}
            aria-label='最小化'
            title='最小化'
          >
            <Minus size={16} />
          </button>
          <button
            className='window-chrome-button'
            type='button'
            onClick={handleToggleMaximize}
            aria-label='最大化或还原'
            title='最大化或还原'
          >
            <Square size={14} />
          </button>
          <button
            className='window-chrome-button close'
            type='button'
            onClick={handleClose}
            aria-label='关闭'
            title='关闭'
          >
            <X size={16} />
          </button>
        </div>
      </header>
      <div className='desktop-window-content'>{children}</div>
    </div>
  )
}
