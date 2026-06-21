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
  assert.match(modalsStylesSource, /\.cli-page \.cli-log-phase-section,[\s\S]*?\.cli-page \.cli-log-output-card,[\s\S]*?\.cli-page \.cli-log-diagnostic-group,[\s\S]*?padding:\s*0 !important[\s\S]*?border:\s*0 !important[\s\S]*?background:\s*transparent !important/)
  assert.match(modalsStylesSource, /\.cli-page \.cli-log-entry \+ \.message-bubble\.assistant,[\s\S]*?margin-top:\s*0 !important/)
  assert.match(polishStylesSource, /\/\* Final Aichat authority: execution logs are text rows, not nested surfaces\. \*\//)
  assert.match(polishStylesSource, /\.cli-page \.cli-log-entry,[\s\S]*?\.cli-page \.cli-log-event-intent-text,[\s\S]*?background:\s*transparent !important[\s\S]*?background-image:\s*none !important[\s\S]*?box-shadow:\s*none !important/)
  assert.match(polishStylesSource, /\.cli-page \.cli-log-detail-window,[\s\S]*?\.cli-page \.inline-file-preview-content\s*\{[\s\S]*?background:\s*rgba\(255, 255, 255, 0\.4\) !important[\s\S]*?background-image:\s*none !important/)
  assert.match(polishStylesSource, /:root\[data-theme='dark'\] \.cli-page \.cli-log-detail-window,[\s\S]*?:root\[data-theme='dark'\] \.cli-page \.inline-file-preview-content\s*\{[\s\S]*?background:\s*rgba\(0, 0, 0, 0\.3\) !important/)
})

test('cli log completion footer is attached only after the final assistant message for the request', () => {
  assert.match(appSource, /const cliLogCompletionPlacement = useMemo/)
  assert.match(appSource, /lastAssistantMessageIds\.set\(item\.requestId, item\.id\)/)
  assert.match(appSource, /logByAssistantMessageId\.set\(item\.id, pendingLog\)/)
  assert.match(appSource, /messageIdByLogId\.set\(pendingLog\.id, item\.id\)/)
  assert.match(appSource, /messageIdByLogId\.set\(logItem\.id, messageId\)/)
  assert.match(appSource, /className='cli-turn-group'/)
  assert.match(appSource, /renderCliTimelineMessage\(groupedAssistantMessage\)/)
  assert.match(appSource, /cliLogCompletionPlacement\.logByAssistantMessageId\.has\(item\.id\)[\s\S]*?return null/)
  assert.match(appSource, /cliLogCompletionPlacement\.lastAssistantMessageIds\.get\(item\.requestId\) === item\.id/)
  assert.match(appSource, /cliLogCompletionPlacement\.logByAssistantMessageId\.get\(item\.id\)/)
  assert.doesNotMatch(appSource, /slice\(activeTimeline\.indexOf\(item\) \+ 1\)[\s\S]*?hasFollowingAssistantReply/)
  assert.match(polishStylesSource, /\.cli-page \.cli-log-status-bar\s*\{[\s\S]*?display:\s*inline-flex !important[\s\S]*?max-width:\s*min\(50%, 560px\) !important/)
  assert.match(polishStylesSource, /\.cli-page \.cli-turn-group\s*\{[\s\S]*?border-radius:\s*8px !important[\s\S]*?background:\s*rgba\(255, 255, 255, 0\.6\) !important/)
  assert.match(polishStylesSource, /:root\[data-theme='dark'\] \.cli-page \.cli-turn-group\s*\{[\s\S]*?background:\s*rgba\(0, 0, 0, 0\.5\) !important/)
  assert.match(polishStylesSource, /\.cli-page \.cli-turn-group \.cli-log-status-bar\s*\{[\s\S]*?max-width:\s*min\(50%, 560px\) !important[\s\S]*?border-top:\s*1px solid/)
})

test('cli bridge notice is hidden under native codex openai and claude anthropic filters', () => {
  assert.match(appSource, /const showCliBridgeServiceNotice =/)
  assert.match(appSource, /client === 'codex' && effectiveCliModelVendorFilter === 'openai'/)
  assert.match(appSource, /client === 'claude' && effectiveCliModelVendorFilter === 'anthropic'/)
  assert.match(appSource, /\{showCliBridgeServiceNotice \? \(/)
})

test('cli user bubbles inherit the chat user bubble style instead of redefining their own surface', () => {
  assert.doesNotMatch(modalsStylesSource, /\.cli-page \.message-bubble\.user\s*\{[\s\S]*?color-mix\(in srgb, var\(--accent\)/)
  assert.match(modalsStylesSource, /\.chat-page \.message-bubble\.user,[\s\S]*?\.cli-page \.message-bubble\.user\s*\{[\s\S]*?background:\s*var\(--bubble-user\) !important/)
  assert.match(modalsStylesSource, /:root\[data-theme='dark'\] \.chat-page \.message-bubble\.user,[\s\S]*?:root\[data-theme='dark'\] \.cli-page \.message-bubble\.user\s*\{[\s\S]*?background:\s*var\(--bubble-user\) !important/)
  assert.match(polishStylesSource, /\.chat-page \.message-bubble\.user,[\s\S]*?\.cli-page \.message-bubble\.user\s*\{[\s\S]*?background:\s*rgba\(255, 255, 255, 0\.6\) !important/)
  assert.match(polishStylesSource, /:root\[data-theme='dark'\] \.chat-page \.message-bubble\.user,[\s\S]*?:root\[data-theme='dark'\] \.cli-page \.message-bubble\.user\s*\{[\s\S]*?background:\s*rgba\(0, 0, 0, 0\.18\) !important/)
})

test('aichat conversation scrollbars are owned by the edge-aligned scroll containers', () => {
  assert.match(polishStylesSource, /\/\* Final pass: conversation edge controls, completion footer, composer clipping, and markdown code surfaces\. \*\//)
  assert.match(polishStylesSource, /\.workspace-page\.chat-page,[\s\S]*?\.workspace-page\.cli-page\s*\{[\s\S]*?margin-right:\s*0 !important/)
  assert.match(polishStylesSource, /\.chat-page \.conversation-scroll-region,[\s\S]*?\.cli-page \.conversation-scroll-region\s*\{[\s\S]*?width:\s*100% !important[\s\S]*?overflow:\s*hidden !important/)
  assert.match(polishStylesSource, /\.chat-page \.message-stream,[\s\S]*?\.cli-page \.cli-thread\s*\{[\s\S]*?scrollbar-gutter:\s*stable !important[\s\S]*?overflow-y:\s*scroll !important/)
  assert.match(polishStylesSource, /\.conversation-scroll-dock\s*\{[\s\S]*?right:\s*22px !important[\s\S]*?opacity:\s*0\.5 !important/)
  assert.match(polishStylesSource, /\.conversation-scroll-dock:hover,[\s\S]*?\.conversation-scroll-dock:focus-within\s*\{[\s\S]*?opacity:\s*1 !important/)
})

test('composer focus rings and assistant code blocks keep only the intended surface', () => {
  assert.match(polishStylesSource, /\.shell-composer,[\s\S]*?\.composer-input-zone\s*\{[\s\S]*?overflow:\s*visible !important/)
  assert.match(polishStylesSource, /\.shell-composer textarea,[\s\S]*?\.cli-composer textarea\s*\{[\s\S]*?outline-offset:\s*-1px !important/)
  assert.match(polishStylesSource, /\.chat-page \.message-bubble\.assistant \.markdown-body pre:has\(\.markdown-code-block\),[\s\S]*?\.cli-page \.message-bubble\.assistant \.markdown-body pre\s*\{[\s\S]*?padding:\s*0 !important/)
  assert.match(polishStylesSource, /\.chat-page \.message-bubble\.assistant \.markdown-body pre:has\(\.markdown-code-block\),[\s\S]*?\.cli-page \.message-bubble\.assistant \.markdown-body pre\s*\{[\s\S]*?background:\s*transparent !important/)
  assert.match(polishStylesSource, /\.chat-page \.message-bubble\.assistant \.markdown-code-block,[\s\S]*?\.cli-page \.message-bubble\.assistant \.markdown-code-block\s*\{[\s\S]*?background:\s*rgba\(255, 255, 255, 0\.16\) !important[\s\S]*?background-image:\s*none !important/)
  assert.match(polishStylesSource, /:root\[data-theme='dark'\] \.sidebar-account,[\s\S]*?:root\[data-theme='dark'\] \.sidebar-user-row\s*\{[\s\S]*?background:\s*rgba\(0, 0, 0, 0\.5\) !important/)
})

test('cli log labels use theme foreground colors and readable header sizing', () => {
  assert.match(polishStylesSource, /\.cli-page \.message-role,[\s\S]*?\.cli-page \.cli-log-detail-label\s*\{[\s\S]*?color:\s*#000 !important[\s\S]*?opacity:\s*1 !important/)
  assert.match(polishStylesSource, /:root\[data-theme='dark'\] \.cli-page \.message-role,[\s\S]*?:root\[data-theme='dark'\] \.cli-page \.cli-log-detail-label\s*\{[\s\S]*?color:\s*#fff !important[\s\S]*?opacity:\s*1 !important/)
  assert.match(polishStylesSource, /\.cli-page \.cli-log-card-title strong,[\s\S]*?\.cli-page \.cli-log-phase-headline strong,[\s\S]*?color:\s*#000 !important/)
  assert.match(polishStylesSource, /:root\[data-theme='dark'\] \.cli-page \.cli-log-card-title strong,[\s\S]*?:root\[data-theme='dark'\] \.cli-page \.cli-log-phase-headline strong,[\s\S]*?color:\s*#fff !important/)
  assert.match(polishStylesSource, /\.cli-page \.cli-log-card-title \.message-role\s*\{[\s\S]*?font-size:\s*13px !important/)
})

test('aichat history panels and ready environment notices use final transparent surfaces', () => {
  assert.match(polishStylesSource, /\.chat-history-panel,[\s\S]*?\.cli-history-panel\s*\{[\s\S]*?background:\s*rgba\(255, 255, 255, 0\.35\) !important/)
  assert.match(polishStylesSource, /:root\[data-theme='dark'\] \.chat-history-panel,[\s\S]*?:root\[data-theme='dark'\] \.cli-history-panel\s*\{[\s\S]*?background:\s*rgba\(0, 0, 0, 0\.35\) !important/)
  assert.match(polishStylesSource, /\.inline-settings-card \.inline-notice\.success\s*\{[\s\S]*?padding:\s*0 !important[\s\S]*?background:\s*transparent !important/)
})

test('client background images use the packaged light and dark jpg assets with cache busting', () => {
  assert.match(polishStylesSource, /--client-bg-image:\s*url\('\/light\.jpg\?v=20260619-192334'\) !important/)
  assert.match(polishStylesSource, /--client-bg-image:\s*url\('\/dark\.jpg\?v=20260619-192401'\) !important/)
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

test('anonymous deploy note has no outer panel frame and dark deploy outlines are subdued', () => {
  assert.match(appSource, /<div className='anonymous-mode-note'>/)
  assert.doesNotMatch(appSource, /className='panel-block anonymous-mode-note'/)
  assert.match(modalsStylesSource, /\.anonymous-mode-note\s*\{[\s\S]*?padding:\s*0 !important[\s\S]*?border:\s*0 !important/)
  assert.match(modalsStylesSource, /:root\[data-theme='dark'\] \.me-column \.panel-block:not\(\.page-surface\),[\s\S]*?border-color:\s*rgba\(151, 164, 172, 0\.028\) !important/)
})
