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
