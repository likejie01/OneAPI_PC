import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  shouldRenderCliLogCommandBlock,
  shouldRenderCliLogEventRow,
  shouldRenderCliLogOutputEntry,
} from './cli-log-rendering.ts'

test('shouldRenderCliLogEventRow hides duplicated status rows with no visible content', () => {
  assert.equal(
    shouldRenderCliLogEventRow({
      duplicatedPrimary: true,
      hasExpandableContent: false,
      hasInteraction: false,
    }),
    false
  )
})

test('shouldRenderCliLogEventRow keeps rows that still expose details or interactions', () => {
  assert.equal(
    shouldRenderCliLogEventRow({
      duplicatedPrimary: true,
      hasExpandableContent: true,
      hasInteraction: false,
    }),
    true
  )
  assert.equal(
    shouldRenderCliLogEventRow({
      duplicatedPrimary: true,
      hasExpandableContent: false,
      hasInteraction: true,
    }),
    true
  )
  assert.equal(
    shouldRenderCliLogEventRow({
      duplicatedPrimary: false,
      hasExpandableContent: false,
      hasInteraction: false,
    }),
    true
  )
})

test('shouldRenderCliLogOutputEntry hides first child when it duplicates the output group title', () => {
  assert.equal(
    shouldRenderCliLogOutputEntry({
      outputIndex: 0,
      entryHeadline: '2026-05-30T17:57:47 ERROR codex_core::tools::router: error=Exit code: 1',
      entryDetail: '',
      groupHeadline: '2026-05-30T17:57:47 ERROR codex_core::tools::router: error=Exit code: 1',
    }),
    false
  )
})

test('shouldRenderCliLogOutputEntry keeps non-duplicated output and duplicated rows with detail', () => {
  assert.equal(
    shouldRenderCliLogOutputEntry({
      outputIndex: 1,
      entryHeadline: 'Wall time: 0.1 seconds',
      entryDetail: '',
      groupHeadline: '2026-05-30T17:57:47 ERROR codex_core::tools::router: error=Exit code: 1',
    }),
    true
  )
  assert.equal(
    shouldRenderCliLogOutputEntry({
      outputIndex: 0,
      entryHeadline: 'Output:',
      entryDetail: 'fatal: not a git repository',
      groupHeadline: 'Output:',
    }),
    true
  )
})

test('shouldRenderCliLogCommandBlock hides command block when JSON detail already contains the same command', () => {
  assert.equal(
    shouldRenderCliLogCommandBlock({
      command: 'powershell.exe -Command "New-Item -ItemType Directory"',
      detail: '{\n  "command": "powershell.exe -Command \\"New-Item -ItemType Directory\\""\n}',
    }),
    false
  )
})

test('shouldRenderCliLogCommandBlock keeps command block when detail does not include it', () => {
  assert.equal(
    shouldRenderCliLogCommandBlock({
      command: 'npm test',
      detail: '退出码：0',
    }),
    true
  )
})
