import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const stylesPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'styles.css')
const appPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'App.tsx')
const styles = readFileSync(stylesPath, 'utf8')
const appSource = readFileSync(appPath, 'utf8')

function readRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))
  return match?.[1] ?? ''
}

test('conversation scroll dock renders in a fixed top-level layer', () => {
  const rule = readRule('.conversation-scroll-dock')

  assert.match(rule, /position:\s*fixed;/)
  assert.match(rule, /z-index:\s*120;/)
  assert.doesNotMatch(rule, /right:\s*-/)
})

test('conversation scroll dock is pinned to the client right edge', () => {
  assert.match(appSource, /CONVERSATION_SCROLL_DOCK_VIEWPORT_INSET\s*=\s*8/)
  assert.doesNotMatch(appSource, /viewportWidth\s*-\s*rect\.right\s*\+\s*CONVERSATION_SCROLL_DOCK_CONTENT_GAP/)
})

test('conversation scroll dock only renders for the active workspace', () => {
  assert.match(appSource, /active\?:\s*boolean/)
  assert.match(appSource, /if \(!active \|\| !node\)/)
  assert.match(appSource, /return portalRoot && active && dockStyle\.visibility !== 'hidden'/)
  assert.match(appSource, /<DrawWorkspace toast=\{toast\} active=\{visible && mode === 'draw'\} \/>/)
  assert.equal((appSource.match(/<ConversationScrollDock[\s\S]*?active=\{active\}/g) || []).length, 3)
})

test('conversation scroll buttons remain icon-only with no visual surface', () => {
  const rule = readRule('.conversation-scroll-button')

  assert.match(rule, /background:\s*transparent;/)
  assert.match(rule, /border:\s*0;/)
  assert.match(rule, /box-shadow:\s*none;/)
  assert.match(rule, /backdrop-filter:\s*none;/)
  assert.match(rule, /-webkit-backdrop-filter:\s*none;/)
})
