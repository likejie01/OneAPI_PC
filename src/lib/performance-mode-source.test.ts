import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const styleFiles = ['base.css', 'workspace.css', 'cli.css', 'markdown.css', 'modals.css', 'settings.css', 'polish.css']
const stylesSource = styleFiles.map((file) => readFileSync(resolve(sourceDir, 'styles', file), 'utf8')).join('\n')

test('efficiency mode disables aurora motion and glass effects', () => {
  assert.match(stylesSource, /:root\[data-performance-mode='efficiency'\]/)
  assert.match(stylesSource, /--aurora-opacity:\s*0/)
  assert.match(stylesSource, /\.workspace-aurora[\s\S]*?display:\s*none !important/)
  assert.match(stylesSource, /animation:\s*none !important/)
  assert.match(stylesSource, /backdrop-filter:\s*none !important/)
  assert.match(stylesSource, /-webkit-backdrop-filter:\s*none !important/)
})

test('efficiency mode uses opaque surfaces instead of translucent glass', () => {
  assert.match(stylesSource, /--panel:\s*rgb\(var\(--panel-rgb\)\)/)
  assert.match(stylesSource, /--surface-strong:\s*rgb\(var\(--surface-strong-rgb\)\)/)
  assert.match(stylesSource, /--bubble-ai:\s*rgb\(var\(--panel-rgb\)\)/)
  assert.match(stylesSource, /\.message-bubble\.assistant[\s\S]*?background:\s*var\(--panel-strong\) !important/)
  assert.match(stylesSource, /\.sidebar[\s\S]*?background:\s*var\(--panel-strong\) !important/)
})

test('opaque popup polish keeps efficiency mode as the final override', () => {
  const themeIndex = stylesSource.indexOf('/* Final theme consolidation */')
  const popupIndex = stylesSource.indexOf('/* Final AIChat opaque popup surfaces */')
  const settingsGlassIndex = stylesSource.lastIndexOf("backdrop-filter: blur(26px) saturate(165%) !important")
  const efficiencyIndex = stylesSource.lastIndexOf('/* Final performance pass: keep efficiency mode above later glass refinements. */')

  assert.ok(themeIndex >= 0)
  assert.ok(popupIndex >= 0)
  assert.ok(popupIndex > themeIndex)
  assert.ok(settingsGlassIndex > popupIndex)
  assert.ok(efficiencyIndex > settingsGlassIndex)
  assert.match(stylesSource, /--bg:\s*#f3f5f6/)
  assert.match(stylesSource, /--accent:\s*#68727a/)
  assert.match(stylesSource, /--danger:\s*#766c69/)
  assert.match(stylesSource, /:root\[data-theme='dark'\]\s*{[\s\S]*?--bg:\s*#11171b/)
  assert.match(stylesSource, /\.primary-button,\s*[\s\S]*?\.send-button\s*{[\s\S]*?linear-gradient\(135deg, var\(--accent-strong\), var\(--accent\)\)/)
  assert.match(stylesSource, /\.picker-menu,\s*[\s\S]*?\.markdown-code-action-menu\s*{[\s\S]*?background:\s*rgb\(var\(--panel-strong-rgb\)\) !important[\s\S]*?backdrop-filter:\s*none !important/)
  assert.match(stylesSource, /\.picker-menu \.picker-option,[\s\S]*?\.markdown-code-action-menu button\s*{[\s\S]*?background:\s*rgb\(var\(--surface-strong-rgb\)\) !important/)
  assert.match(stylesSource, /\.picker-menu \.picker-option:hover[\s\S]*?color-mix\(in srgb, var\(--accent\) 10%, rgb\(var\(--surface-strong-rgb\)\)\) !important/)
})

test('final performance pass removes glass blur and background motion globally', () => {
  const performancePassIndex = stylesSource.lastIndexOf(
    '/* Final performance pass: keep efficiency mode above later glass refinements. */',
  )
  const settingsGlassIndex = stylesSource.lastIndexOf("backdrop-filter: blur(26px) saturate(165%) !important")

  assert.ok(performancePassIndex > settingsGlassIndex)
  assert.match(
    stylesSource.slice(performancePassIndex),
    /:root\[data-performance-mode='efficiency'\] \*,[\s\S]*?:root\[data-performance-mode='efficiency'\] \*::after\s*{[\s\S]*?backdrop-filter:\s*none !important/,
  )
  assert.match(
    stylesSource.slice(performancePassIndex),
    /\.workspace-aurora,[\s\S]*?\.workspace-aurora-blob\s*{[\s\S]*?display:\s*none !important/,
  )
  assert.match(stylesSource.slice(performancePassIndex), /\.desktop-window-shell,[\s\S]*?\.main-panel\s*{[\s\S]*?box-shadow:\s*none !important/)
  assert.match(stylesSource.slice(performancePassIndex), /\.modal-mask,[\s\S]*?\.image-preview-modal-mask\s*{[\s\S]*?filter:\s*none !important/)
  assert.match(stylesSource.slice(performancePassIndex), /\.desktop-window-shell::before\s*{[\s\S]*?background-image:\s*none !important/)
})
