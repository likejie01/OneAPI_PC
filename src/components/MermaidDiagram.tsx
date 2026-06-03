import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Copy, Download } from 'lucide-react'
import { copyImageToClipboard, saveImageToDisk } from '../domains/chat'
import { exportTextFile } from '../domains/cli'

interface MermaidDiagramProps {
  chart: string
}

const mermaidSvgCache = new Map<string, string>()
const MIN_EXPORT_WIDTH = 3200
const MIN_EXPORT_HEIGHT = 1800
const MAX_EXPORT_DIMENSION = 12000
const EXPORT_PADDING = 72

function svgMarkupToDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function extractBase64FromDataUrl(value: string) {
  const match = value.match(/^data:[^;]+;base64,(.+)$/)
  if (!match) {
    throw new Error('图片数据格式无效')
  }
  return match[1]
}

async function renderSvgToPngDataUrl(svg: string) {
  const dimensions = resolveSvgDimensions(svg)
  const svgUrl = svgMarkupToDataUrl(svg)
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const nextImage = new Image()
    nextImage.onload = () => resolve(nextImage)
    nextImage.onerror = () => reject(new Error('Mermaid 图片渲染失败'))
    nextImage.src = svgUrl
  })

  const baseWidth = Math.max(1, dimensions.width || image.naturalWidth || image.width || 1200)
  const baseHeight = Math.max(1, dimensions.height || image.naturalHeight || image.height || 800)
  const requestedScale = Math.max(
    2,
    MIN_EXPORT_WIDTH / baseWidth,
    MIN_EXPORT_HEIGHT / baseHeight
  )
  const maxScale = Math.max(
    1,
    Math.min(
      (MAX_EXPORT_DIMENSION - EXPORT_PADDING * 2) / baseWidth,
      (MAX_EXPORT_DIMENSION - EXPORT_PADDING * 2) / baseHeight
    )
  )
  const scale = Math.max(1, Math.min(requestedScale, maxScale))
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(baseWidth * scale + EXPORT_PADDING * 2)
  canvas.height = Math.ceil(baseHeight * scale + EXPORT_PADDING * 2)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('当前环境不支持 Canvas 导出')
  }
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, EXPORT_PADDING, EXPORT_PADDING, baseWidth * scale, baseHeight * scale)
  return canvas.toDataURL('image/png')
}

function resolveSvgDimensions(svg: string) {
  const fallback = { width: 0, height: 0 }
  try {
    const documentElement = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
    const viewBox = documentElement.getAttribute('viewBox') || ''
    const viewBoxParts = viewBox.split(/[,\s]+/).map((item) => Number(item)).filter((item) => Number.isFinite(item))
    if (viewBoxParts.length === 4 && viewBoxParts[2] > 0 && viewBoxParts[3] > 0) {
      return { width: viewBoxParts[2], height: viewBoxParts[3] }
    }
    const width = Number.parseFloat(documentElement.getAttribute('width') || '')
    const height = Number.parseFloat(documentElement.getAttribute('height') || '')
    return {
      width: Number.isFinite(width) && width > 0 ? width : 0,
      height: Number.isFinite(height) && height > 0 ? height : 0,
    }
  } catch {
    return fallback
  }
}

function clampDiagramScale(value: number) {
  return Math.max(0.25, Math.min(6, value))
}

export function MermaidDiagram(props: MermaidDiagramProps) {
  const { chart } = props
  const [svg, setSvg] = useState(() => mermaidSvgCache.get(chart) || '')
  const [errorMessage, setErrorMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [busyAction, setBusyAction] = useState<'copy-image' | 'download-png' | 'download-svg' | null>(null)
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const actionsRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLSpanElement | null>(null)
  const viewRef = useRef(view)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const reactId = useId()
  const renderId = useMemo(() => `oneapi-mermaid-${reactId.replace(/:/g, '-')}`, [reactId])
  const canvasStyle = useMemo<CSSProperties>(() => ({
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
  }), [view])

  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    let active = true
    void (async () => {
      const cachedSvg = mermaidSvgCache.get(chart)
      if (cachedSvg) {
        if (active) {
          setErrorMessage('')
          setSvg(cachedSvg)
        }
        return
      }

      if (active) {
        setErrorMessage('')
        setSvg('')
      }

      try {
        const module = await import('mermaid')
        const mermaid = module.default
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'neutral',
        })
        const rendered = await mermaid.render(renderId, chart)
        if (!active) {
          return
        }
        mermaidSvgCache.set(chart, rendered.svg)
        setSvg(rendered.svg)
        setView({ scale: 1, x: 0, y: 0 })
      } catch (error) {
        if (!active) {
          return
        }
        setErrorMessage(error instanceof Error ? error.message : 'Mermaid 渲染失败')
      }
    })()

    return () => {
      active = false
    }
  }, [chart, renderId])

  useEffect(() => {
    if (!copied) {
      return
    }
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (!menuOpen) {
      return
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (target && actionsRef.current && !actionsRef.current.contains(target)) {
        setMenuOpen(false)
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [menuOpen])

  useEffect(() => {
    const node = viewportRef.current
    if (!node || !svg) {
      return
    }
    node.addEventListener('wheel', handleWheel, { passive: false })
    return () => node.removeEventListener('wheel', handleWheel)
  }, [svg])

  function handleWheel(event: WheelEvent) {
    if (!svg) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const rect = viewportRef.current?.getBoundingClientRect()
    const current = viewRef.current
    const nextScale = clampDiagramScale(current.scale * (event.deltaY > 0 ? 0.88 : 1.12))
    if (!rect || nextScale === current.scale) {
      setView((item) => ({ ...item, scale: nextScale }))
      return
    }
    const originX = event.clientX - rect.left - current.x
    const originY = event.clientY - rect.top - current.y
    const ratio = nextScale / current.scale
    setView({
      scale: nextScale,
      x: event.clientX - rect.left - originX * ratio,
      y: event.clientY - rect.top - originY * ratio,
    })
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLSpanElement>) {
    if (event.button !== 0 || !svg) {
      return
    }
    event.preventDefault()
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewRef.current.x,
      originY: viewRef.current.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLSpanElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    event.preventDefault()
    setView((current) => ({
      ...current,
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    }))
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLSpanElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
    dragRef.current = null
  }

  async function handleCopyImage() {
    if (!svg) {
      return
    }
    setBusyAction('copy-image')
    try {
      const pngUrl = await renderSvgToPngDataUrl(svg)
      await copyImageToClipboard({
        dataBase64: extractBase64FromDataUrl(pngUrl),
      })
    } finally {
      setBusyAction(null)
      setMenuOpen(false)
    }
  }

  async function handleDownloadPng() {
    if (!svg) {
      return
    }
    setBusyAction('download-png')
    try {
      const pngUrl = await renderSvgToPngDataUrl(svg)
      await saveImageToDisk({
        suggestedName: 'mermaid-diagram.png',
        dataBase64: extractBase64FromDataUrl(pngUrl),
      })
    } finally {
      setBusyAction(null)
      setMenuOpen(false)
    }
  }

  async function handleDownloadSvg() {
    if (!svg) {
      return
    }
    setBusyAction('download-svg')
    try {
      await exportTextFile('mermaid-diagram.svg', svg, '保存 Mermaid SVG')
    } finally {
      setBusyAction(null)
      setMenuOpen(false)
    }
  }

  return (
    <span
      className='mermaid-diagram-block'
      onContextMenu={(event) => {
        event.preventDefault()
        void handleCopyImage()
      }}
    >
      <div className='mermaid-diagram-actions' ref={actionsRef}>
        <button
          type='button'
          className='markdown-code-copy'
          aria-label='下载 Mermaid'
          title='下载 Mermaid'
          onClick={() => setMenuOpen((current) => !current)}
        >
          <Download size={13} />
        </button>
        {menuOpen ? (
          <div className='markdown-code-action-menu'>
            <button type='button' onClick={() => void handleDownloadPng()} disabled={busyAction !== null}>
              下载图片
            </button>
            <button type='button' onClick={() => void handleDownloadSvg()} disabled={busyAction !== null}>
              下载 SVG
            </button>
            <button type='button' onClick={() => void handleCopyImage()} disabled={busyAction !== null}>
              复制图片
            </button>
          </div>
        ) : null}
        <button
          type='button'
          className='markdown-code-copy secondary'
          aria-label='复制 Mermaid'
          title={copied ? '已复制' : '复制 Mermaid'}
          onClick={() => {
            void navigator.clipboard.writeText(chart)
            setCopied(true)
          }}
        >
          <Copy size={13} />
        </button>
      </div>
      {errorMessage ? (
        <span className='mermaid-diagram-fallback'>
          <small>Mermaid 渲染失败，已显示原始内容。</small>
          <code>{chart}</code>
        </span>
      ) : svg ? (
        <span
          ref={viewportRef}
          className='mermaid-diagram-viewport'
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={() => setView({ scale: 1, x: 0, y: 0 })}
          title='滚轮缩放，拖拽移动，双击复位'
        >
          <span className='mermaid-diagram-canvas' style={canvasStyle} dangerouslySetInnerHTML={{ __html: svg }} />
        </span>
      ) : (
        <span className='mermaid-diagram-loading'>Mermaid 图表渲染中...</span>
      )}
    </span>
  )
}
