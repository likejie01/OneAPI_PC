import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCliInteractionResponse,
  classifyCliStderrLine,
  detectCliInteractionFromText,
  detectCliInteractionFromToolUse,
  estimateCliSessionContextUsage,
  isDirectCliCommandPrompt,
  shouldAutoRetryCliRequest,
  summarizeCliFailure,
} from './cli-runtime.ts'

test('classifyCliStderrLine demotes powershell command noise to diagnostic status', () => {
  assert.deepEqual(
    classifyCliStderrLine('CategoryInfo : ObjectNotFound: (C:\\tmp\\SKILL.md:String) [Get-Content], ItemNotFoundException'),
    {
      level: 'status',
      logKind: 'stderr',
      sourceKind: 'stderr.command',
      title: 'CLI 输出了命令诊断信息',
    }
  )
})

test('summarizeCliFailure recognizes bad_response_status_code as upstream issue', () => {
  const result = summarizeCliFailure(
    '',
    '{"error":{"message":"openai_error","type":"bad_response_status_code","code":"bad_response_status_code"}}'
  )

  assert.equal(result.upstreamIssue, true)
  assert.match(result.probableCause || '', /上游模型网关返回异常状态码/)
})

test('shouldAutoRetryCliRequest retries only empty-output transient failures on first attempt', () => {
  assert.equal(
    shouldAutoRetryCliRequest({
      diagnostics: { upstreamIssue: true },
      attempt: 0,
      aborted: false,
      exitCode: 1,
      output: '',
    }),
    true
  )

  assert.equal(
    shouldAutoRetryCliRequest({
      diagnostics: { upstreamIssue: true },
      attempt: 1,
      aborted: false,
      exitCode: 1,
      output: '',
    }),
    false
  )
})

test('isDirectCliCommandPrompt detects leading slash commands', () => {
  assert.equal(isDirectCliCommandPrompt('/compact'), true)
  assert.equal(isDirectCliCommandPrompt('  /resume latest'), true)
  assert.equal(isDirectCliCommandPrompt('请执行 /compact'), false)
})

test('estimateCliSessionContextUsage exposes ratio against soft budget', () => {
  const usage = estimateCliSessionContextUsage(
    'codex',
    [
      {
        content: 'a'.repeat(80_000),
        attachments: [],
        selectedExtensions: [],
      },
    ],
    null
  )

  assert.equal(usage.estimatedTokens >= 20_000, true)
  assert.equal(usage.ratio >= 0.5, true)
})

test('detectCliInteractionFromToolUse recognizes escalated shell command approvals', () => {
  const interaction = detectCliInteractionFromToolUse('shell_command', {
    command: 'Remove-Item temp.txt -Force',
    justification: 'Allow deleting the temporary file before finalizing the build?',
    sandbox_permissions: 'require_escalated',
  })

  assert.deepEqual(interaction, {
    kind: 'approval',
    title: '命令执行需要确认',
    message: 'Allow deleting the temporary file before finalizing the build?',
    command: 'Remove-Item temp.txt -Force',
    autoApproveEligible: true,
  })
})

test('detectCliInteractionFromText recognizes yes-no confirmation prompts', () => {
  const interaction = detectCliInteractionFromText(
    'Do you want to allow stopping the local Vite dev process? [y/N]'
  )

  assert.deepEqual(interaction, {
    kind: 'approval',
    title: 'CLI 正在等待确认',
    message: 'Do you want to allow stopping the local Vite dev process?',
    command: '',
    autoApproveEligible: true,
  })
})

test('buildCliInteractionResponse maps approve and reject actions to stdin replies', () => {
  assert.equal(buildCliInteractionResponse('approve'), 'y\n')
  assert.equal(buildCliInteractionResponse('approve_always'), 'a\n')
  assert.equal(buildCliInteractionResponse('reject'), 'n\n')
})
