import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'App.tsx'), 'utf8')
const cliStylesSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'cli.css'), 'utf8')
const modalsStylesSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'modals.css'), 'utf8')
const polishStylesSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'polish.css'), 'utf8')

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

test('cli log tools are rendered in the log header without the old tool-call label', () => {
  assert.doesNotMatch(appSource, /实际工具调用/)
  assert.match(appSource, /<div className='cli-log-card-head'>[\s\S]*?<strong>\{`已执行 \$\{item\.events\.length\} 步`\}<\/strong>[\s\S]*?executedToolNames\.length > 0/)
  assert.match(appSource, /<div className='cli-log-header-tools'>[\s\S]*?executedToolNames\.map/)
})

test('cli log entries remove the outer bubble surface and spacing authority', () => {
  assert.doesNotMatch(appSource, /className='cli-log-bubble'/)
  assert.match(modalsStylesSource, /\/\* Final Codex\/Claude execution log layout authority\. \*\//)
  assert.match(modalsStylesSource, /\.cli-page \.cli-log-entry,[\s\S]*?border:\s*0 !important[\s\S]*?background:\s*transparent !important[\s\S]*?box-shadow:\s*none !important/)
  assert.match(modalsStylesSource, /\.cli-page \.cli-log-entry \+ \.message-bubble\.assistant,[\s\S]*?margin-top:\s*0 !important/)
})

test('cli user bubbles inherit the chat user bubble style instead of redefining their own surface', () => {
  assert.doesNotMatch(polishStylesSource, /\.cli-page \.message-bubble\.user\s*\{[\s\S]*?background:/)
  assert.match(modalsStylesSource, /\.cli-page \.message-bubble\.user\s*\{[\s\S]*?background:\s*var\(--bubble-user\) !important/)
})

test('cli extension chips have no selected-strip backplate above the input', () => {
  assert.match(modalsStylesSource, /\.composer-input-zone \.message-extension-strip,[\s\S]*?background:\s*transparent !important[\s\S]*?border:\s*0 !important[\s\S]*?box-shadow:\s*none !important/)
})

test('toast notifications are anchored above the composer at the right edge', () => {
  assert.match(modalsStylesSource, /\.toast-bar\s*\{[\s\S]*?position:\s*fixed !important[\s\S]*?right:\s*20px !important[\s\S]*?bottom:\s*72px !important/)
  assert.doesNotMatch(modalsStylesSource, /\.toast-bar\s*\{[\s\S]*?left:\s*50%/)
})

test('context menus and side navigation use restrained radius', () => {
  assert.match(modalsStylesSource, /\.session-context-menu,[\s\S]*?\.markdown-code-action-menu\s*\{[\s\S]*?border-radius:\s*8px !important/)
  assert.match(modalsStylesSource, /\.side-nav-item\.active,[\s\S]*?\.sidebar\.collapsed \.side-nav-item\.active\s*\{[\s\S]*?border-radius:\s*8px !important/)
})
