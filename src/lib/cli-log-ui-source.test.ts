import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'App.tsx'), 'utf8')

test('cli log bubbles render expanded by default without a collapse header action', () => {
  assert.match(appSource, /<CliLogBubble[\s\S]*?expanded=\{true\}/)
  assert.doesNotMatch(appSource, /点击收起/)
})
