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

test('cli UI does not proactively submit compact commands', () => {
  assert.doesNotMatch(appSource, /autoCompactSessionStateRef/)
  assert.doesNotMatch(appSource, /submitCliPrompt\('\/compact'/)
  assert.doesNotMatch(appSource, /已自动执行 \/compact/)
})

test('cli progress logs are batched without stringify comparisons in the hot path', () => {
  assert.match(appSource, /pendingCliLogEntriesRef/)
  assert.match(appSource, /enqueueCliLogEntry\(targetSessionId, nextEntry, !!payload\.done\)/)
  assert.match(appSource, /pendingCliLogEntriesRef\.current\[sessionId\] = \[entry\]/)
  assert.match(appSource, /entries\.push\(entry\)/)
  assert.match(appSource, /startTransition\(\(\) => \{\s*setSessionLogsMap/)
  assert.doesNotMatch(appSource, /JSON\.stringify\(lastEntry/)
  assert.doesNotMatch(appSource, /pendingCliLogEntriesRef\.current = \{\s*\.\.\.pendingCliLogEntriesRef\.current/)
})

test('cli plan panel remains mounted and ignores undefined plan payloads', () => {
  assert.match(appSource, /<CliPlanFloatingPanel plan=\{activePlan\} client=\{client\} \/>/)
  assert.match(appSource, /if \(payload\.plan !== undefined\)/)
  assert.doesNotMatch(appSource, /shouldClearCliPlanOnDone/)
})

test('slash plan command enables plan mode instead of direct command passthrough', () => {
  assert.match(appSource, /const planMode = matchedBuiltinCommand\?\.id === 'plan'/)
  assert.match(appSource, /isDirectCliCommandPrompt\(cleanedPrompt\) && !planMode/)
  assert.match(appSource, /planMode,\s*[\r\n]+/)
})
