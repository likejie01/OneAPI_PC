import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Copy, Download } from 'lucide-react'
import { copyImageToClipboard, saveImageToDisk } from '../domains/chat'
import { exportTextFile } from '../domains/cli'

interface MermaidDiagramProps {
  chart: string
}

const mermaidSvgCache = new Map<string, string>()

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
  const svgUrl = svgMarkupToDataUrl(svg)
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const nextImage = new Image()
    nextImage.onload = () => resolve(nextImage)
    nextImage.onerror = () => reject(new Error('Mermaid 图片渲染失败'))
    nextImage.src = svgUrl
  })

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, image.naturalWidth || image.width || 1200)
  canvas.height = Math.max(1, image.naturalHeight || image.height || 800)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('当前环境不支持 Canvas 导出')
  }
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

export function MermaidDiagram(props: MermaidDiagramProps) {
  const { chart } = props
  const [svg, setSvg] = useState(() => mermaidSvgCache.get(chart) || '')
  const [errorMessage, setErrorMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [busyAction, setBusyAction] = useState<'copy-image' | 'download-png' | 'download-svg' | null>(null)
  const actionsRef = useRef<HTMLDivElement | null>(null)
  const reactId = useId()
  const renderId = useMemo(() => `oneapi-mermaid-${reactId.replace(/:/g, '-')}`, [reactId])

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
        <span className='mermaid-diagram-canvas' dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <span className='mermaid-diagram-loading'>Mermaid 图表渲染中...</span>
      )}
    </span>
  )
}
