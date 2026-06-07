import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const stylesSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'styles.css'), 'utf8')

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
  const efficiencyIndex = stylesSource.indexOf("/* Efficiency mode: disable aurora motion, glass blur, and translucent surfaces. */")

  assert.ok(themeIndex >= 0)
  assert.ok(popupIndex >= 0)
  assert.ok(popupIndex > themeIndex)
  assert.ok(efficiencyIndex > popupIndex)
  assert.match(stylesSource, /--bg:\s*#f3f5f6/)
  assert.match(stylesSource, /--accent:\s*#68727a/)
  assert.match(stylesSource, /--danger:\s*#766c69/)
  assert.match(stylesSource, /:root\[data-theme='dark'\]\s*{[\s\S]*?--bg:\s*#11171b/)
  assert.match(stylesSource, /\.primary-button,\s*[\s\S]*?\.send-button\s*{[\s\S]*?linear-gradient\(135deg, var\(--accent-strong\), var\(--accent\)\)/)
  assert.match(stylesSource, /\.picker-menu,\s*[\s\S]*?\.markdown-code-action-menu\s*{[\s\S]*?background:\s*rgb\(var\(--panel-strong-rgb\)\) !important[\s\S]*?backdrop-filter:\s*none !important/)
  assert.match(stylesSource, /\.picker-menu \.picker-option,[\s\S]*?\.markdown-code-action-menu button\s*{[\s\S]*?background:\s*rgb\(var\(--surface-strong-rgb\)\) !important/)
  assert.match(stylesSource, /\.picker-menu \.picker-option:hover[\s\S]*?color-mix\(in srgb, var\(--accent\) 10%, rgb\(var\(--surface-strong-rgb\)\)\) !important/)
})

test('performance mode slows aurora and inactive windows pause aurora animation', () => {
  assert.match(stylesSource, /:root\[data-performance-mode='performance'\] \.workspace-aurora\s*{[\s\S]*?animation-duration:\s*64s/)
  assert.match(stylesSource, /:root\[data-performance-mode='performance'\] \.workspace-aurora::after\s*{[\s\S]*?animation-duration:\s*48s/)
  assert.match(stylesSource, /:root\[data-window-active='inactive'\] \.workspace-aurora,[\s\S]*?animation-play-state:\s*paused !important/)
})
