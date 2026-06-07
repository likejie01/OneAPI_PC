import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appSource = readFileSync(resolve(sourceDir, 'App.tsx'), 'utf8')
const markdownSource = readFileSync(resolve(sourceDir, 'components', 'MarkdownMessageContent.tsx'), 'utf8')
const mermaidSource = readFileSync(resolve(sourceDir, 'components', 'MermaidDiagram.tsx'), 'utf8')
const stylesSource = readFileSync(resolve(sourceDir, 'styles.css'), 'utf8')

test('mermaid png export renders a large white-background image', () => {
  assert.match(mermaidSource, /const MIN_EXPORT_WIDTH = 3200/)
  assert.match(mermaidSource, /const MIN_EXPORT_HEIGHT = 1800/)
  assert.match(mermaidSource, /const MAX_EXPORT_DIMENSION = 12000/)
  assert.match(mermaidSource, /resolveSvgDimensions\(svg\)/)
  assert.match(mermaidSource, /context\.fillStyle = '#ffffff'/)
  assert.match(mermaidSource, /context\.fillRect\(0, 0, canvas\.width, canvas\.height\)/)
})

test('mermaid chart view supports zoom and pan in a max-width bubble', () => {
  assert.match(mermaidSource, /const MERMAID_SVG_CACHE_LIMIT = 48/)
  assert.match(mermaidSource, /function readCachedMermaidSvg/)
  assert.match(mermaidSource, /function writeCachedMermaidSvg/)
  assert.match(mermaidSource, /while \(mermaidSvgCache\.size > MERMAID_SVG_CACHE_LIMIT\)/)
  assert.match(mermaidSource, /typeof oldestKey !== 'string'/)
  assert.match(mermaidSource, /className='mermaid-diagram-viewport'/)
  assert.match(mermaidSource, /addEventListener\('wheel', handleWheel, \{ passive: false \}\)/)
  assert.match(mermaidSource, /event\.stopPropagation\(\)/)
  assert.match(mermaidSource, /const handleWheel = useCallback/)
  assert.match(mermaidSource, /\}, \[handleWheel, svg\]\)/)
  assert.doesNotMatch(mermaidSource, /onWheel=\{handleWheel\}/)
  assert.match(mermaidSource, /onPointerDown=\{handlePointerDown\}/)
  assert.match(mermaidSource, /onDoubleClick=\{\(\) => setView\(\{ scale: 1, x: 0, y: 0 \}\)\}/)
  assert.match(stylesSource, /\.message-bubble:has\(\.mermaid-diagram-block\)/)
  assert.match(stylesSource, /width: var\(--conversation-bubble-max-width\);/)
  assert.match(stylesSource, /\.mermaid-diagram-viewport/)
  assert.match(stylesSource, /min-width: 960px;/)
})

test('streaming chat messages defer mermaid rendering until final content arrives', () => {
  assert.match(markdownSource, /renderMermaid\?: boolean/)
  assert.match(markdownSource, /if \(!renderMermaid\)/)
  assert.match(appSource, /renderMermaid=\{!item\.pending\}/)
})
