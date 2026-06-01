import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractCodexCommandExecutionOutputEntries,
  extractCodexCommandExecutionToolUseEntries,
  extractCodexFunctionCallOutputEntries,
  extractCodexFunctionCallToolUseEntries,
  normalizeCliToolInputForDetail,
  parseCliToolInput,
} from './cli-tool-events.ts'

test('parseCliToolInput parses JSON arguments from Codex function calls', () => {
  assert.deepEqual(
    parseCliToolInput('{"command":"git status --short","workdir":"D:\\\\WorkSpace\\\\NewAPI"}'),
    {
      command: 'git status --short',
      workdir: 'D:\\WorkSpace\\NewAPI',
    }
  )
})

test('extractCodexFunctionCallToolUseEntries reads Codex response_item function calls', () => {
  assert.deepEqual(
    extractCodexFunctionCallToolUseEntries({
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'shell_command',
        call_id: 'call_123',
        arguments: '{"command":"npm test","workdir":"D:\\\\WorkSpace\\\\NewAPI\\\\OneAPI_PC_Rebuild"}',
      },
    }),
    [
      {
        id: 'call_123',
        name: 'shell_command',
        input: {
          command: 'npm test',
          workdir: 'D:\\WorkSpace\\NewAPI\\OneAPI_PC_Rebuild',
        },
        textBefore: '',
      },
    ]
  )
})

test('extractCodexCommandExecutionToolUseEntries reads Codex command execution items', () => {
  assert.deepEqual(
    extractCodexCommandExecutionToolUseEntries({
      type: 'item.started',
      item: {
        id: 'item_123',
        type: 'command_execution',
        command: '"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command "Get-Content -LiteralPath \'D:\\\\WorkSpace\\\\Demo\\\\src\\\\app\\\\(main)\\\\page.tsx\'"',
        status: 'in_progress',
      },
    }),
    [
      {
        id: 'item_123',
        name: 'shell_command',
        input: {
          command: '"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command "Get-Content -LiteralPath \'D:\\\\WorkSpace\\\\Demo\\\\src\\\\app\\\\(main)\\\\page.tsx\'"',
        },
        textBefore: '',
      },
    ]
  )
})

test('extractCodexFunctionCallOutputEntries reads Codex tool output records', () => {
  assert.deepEqual(
    extractCodexFunctionCallOutputEntries({
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call_123',
        output: 'Chunk ID: abc\nProcess exited with code 0\nOutput:\nindex.html',
      },
    }),
    [
      {
        id: 'call_123',
        output: 'Chunk ID: abc\nProcess exited with code 0\nOutput:\nindex.html',
        stdout: 'Chunk ID: abc\nProcess exited with code 0\nOutput:\nindex.html',
        stderr: '',
        exitCode: undefined,
      },
    ]
  )
})

test('extractCodexCommandExecutionOutputEntries reads completed command output', () => {
  assert.deepEqual(
    extractCodexCommandExecutionOutputEntries({
      type: 'item.completed',
      item: {
        id: 'item_123',
        type: 'command_execution',
        stdout: 'created index.html',
        stderr: 'warning: skipped cache',
        exit_code: 0,
      },
    }),
    [
      {
        id: 'item_123',
        output: 'created index.html\n\nwarning: skipped cache',
        stdout: 'created index.html',
        stderr: 'warning: skipped cache',
        exitCode: 0,
      },
    ]
  )
})

test('normalizeCliToolInputForDetail hides false replace_all edit defaults from logs', () => {
  assert.deepEqual(
    normalizeCliToolInputForDetail({
      replace_all: false,
      file_path: 'D:\\WorkSpace\\TestClaude\\src\\App.css',
      old_string: '.hero { padding: 1rem; }',
      new_string: '.hero { padding: 1.5rem; }',
    }),
    {
      file_path: 'D:\\WorkSpace\\TestClaude\\src\\App.css',
      old_string: '.hero { padding: 1rem; }',
      new_string: '.hero { padding: 1.5rem; }',
    }
  )
})
