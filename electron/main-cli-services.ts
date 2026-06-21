// @ts-nocheck
import { clipboard, dialog, nativeImage, shell, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { createReadStream, createWriteStream, mkdirSync, promises as fs, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import process from 'node:process'
import type { ChatCompletionResponse } from '../src/shared/contracts'
import type { CliExtensionEntry, CliExtensionInstallRequest, CliExtensionInstallResult, CliInteractionPrompt, CliPlanState, DesktopDeleteCliMessageRequest, DesktopDeleteCliSessionsRequest } from '../src/shared/desktop'
import { buildClaudePlanStateFromRecords, buildCodexPlanStateFromRecords, parseClaudePlanMutationFromRecord, parseCodexPlanStateFromRecord } from '../src/lib/cli-plan.ts'
import { isClaudeAssistantTerminalMessage } from '../src/lib/cli-history-filter.ts'
import { buildExecutionCycleEvents } from '../src/process/execution-orchestrator/run-request.ts'
import { buildFinalPrompt } from '../src/process/prompt-assembler/build-final-prompt.ts'
import { buildCliExtensionDedupeKey, parseMarkdownFrontmatterMeta } from '../src/lib/cli-extensions.ts'
import { buildBundledCodexCuratedSkillEntries, buildBundledMarketplaceEntries } from '../src/lib/cli-marketplace-catalog.ts'
import { pickClaudeApiKeyFromUnknown, resolveClaudeDesktopEnv } from '../src/lib/claude-cli-config.ts'
import { extractCliUserTask } from '../src/lib/cli-prompt.ts'
import { isCliSessionReadyForLatestTurn } from '../src/lib/cli-session-readiness.ts'
import { normalizeDesktopCliApiKey } from '../src/lib/cli-deploy.ts'
import { buildCliPromptCacheKey, injectCliPromptCacheKeyIntoJsonBody } from '../src/lib/cli-prompt-cache-key.ts'
import { MIN_DESKTOP_CLI_NODE_MAJOR, buildClaudePermissionArgs, buildCodexSandboxArgs, buildNodeBackedCliScriptPath, buildWindowsNodeExecutableCandidates, buildWindowsNpmGlobalCliCandidates, buildWindowsCommandShimArgs, isDesktopCliNodeVersionSupported, resolveWindowsCommandShimCommand, sanitizeCliNpmEnvironment, shouldUseWindowsCommandShimForPath, supportsCodexAskForApprovalFlag } from '../src/lib/desktop-service.ts'
import { buildCliRetryOutputSnapshot, buildCliInteractionResponse, classifyCliStderrLine, detectCliInteractionFromText, detectCliInteractionFromToolUse, summarizeCliFailure, shouldAutoRetryCliRequest } from '../src/lib/cli-runtime.ts'
import { extractCodexCommandExecutionOutputEntries, extractCodexCommandExecutionToolUseEntries, extractCodexFunctionCallOutputEntries, extractCodexFunctionCallToolUseEntries, normalizeCliToolInputForDetail } from '../src/lib/cli-tool-events.ts'
import { resolveInteractionDecision } from '../src/process/execution-orchestrator/interaction-policy.ts'
import { createCliHistoryServices, extractCodexAssistantTextFromEvent, extractCodexFileChanges, extractClaudeFileChanges, mergeFileChanges, shouldIgnoreCodexMessage } from './main-cli-history.ts'
import { createPeerMcpBridgeServices } from './main-peer-mcp.ts'
import { createCliNodeRuntimeServices } from './main-cli-node-runtime.ts'

export function createCliServices(deps) {
  const {
    app, cliConfig, serverBaseUrlRef, DEFAULT_CODEX_MODEL, DEFAULT_CLAUDE_MODEL, DEFAULT_CODEX_BASE_URL, DEFAULT_CLAUDE_BASE_URL,
    pathExists, readBundledCliCatalogFile, normalizeCodexBaseUrl, normalizeClaudeBaseUrl,
    getToolchainRoot, getManagedNodeRoot, getManagedNpmPrefix, getManagedPrefixBin, getManagedCliExecutableCandidates, getManagedNodeExecutableCandidates, getManagedNpmExecutableCandidates, getNpmCliScriptCandidates, getNpmCommand, firstExistingPath, resolveNpmCliScriptPath, buildNpmInvocation,
    clearDirectory, flattenSingleNestedDirectory, describeDirectoryEntries, shouldUseWindowsCommandShim, createLineConsumer, spawnCommandWithHandlers, stopChildProcess, writeChildStdinSafely, runCommand, locateSystemExecutable, locateExecutable, resolveCliSpawnCommand, resolveNodeBackedCliInvocation, inspectCli,
    getRendererStorageValue, setRendererStorageValue, applyRendererDesktopModelSelection, getDesktopUserHeaderValue, getDesktopAccessTokenHeaderValue, requestMobileBridgeApi, requestMobileBridgeJson,
    resolveCliAdditionalAccessDirectories, rememberCliAuthorizedDirectory, readBridgeClientProjectPath, postMobileBridgeJobEvent, createLocalCliMobileBridgeMirror, syncMobileBridgeSessionsSnapshot,
    startCliPowerSaveBlocker, stopCliPowerSaveBlocker, activeCliProcesses, activeCliRequestStates, stoppedCliRequests, mobileBridgeProgressMirrors, updateActiveCliSessionState,
  } = deps
  const getServerBaseUrl = () => serverBaseUrlRef.value

function readJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function normalizeCliTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .map((item) => {
      if (typeof item === 'string') {
        return item
      }
      if (!item || typeof item !== 'object') {
        return ''
      }
      const record = item as Record<string, unknown>
      return typeof record.text === 'string'
        ? record.text
        : typeof record.content === 'string'
          ? record.content
          : ''
    })
    .filter(Boolean)
    .join('\n')
}

function stringifyCliJsonValue(value: unknown) {
  if (value === undefined || value === null) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function normalizeCustomToolCallArguments(input: unknown) {
  return JSON.stringify({ input: stringifyCliJsonValue(input) })
}

function extractCustomToolInputFromArguments(argumentsText: string) {
  const trimmed = argumentsText.trim()
  if (!trimmed) {
    return ''
  }
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && 'input' in parsed) {
      return stringifyCliJsonValue((parsed as Record<string, unknown>).input)
    }
    if (typeof parsed === 'string') {
      return parsed
    }
  } catch {
    // Fall through to raw tool text.
  }
  return trimmed
}

function normalizeChatImageUrl(value: unknown) {
  if (typeof value === 'string') {
    return value
  }
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return typeof record.url === 'string' ? record.url : stringifyCliJsonValue(value)
}

function responsesInputToChatMessages(input: unknown) {
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }]
  }
  if (!Array.isArray(input)) {
    return []
  }
  const messages: Array<Record<string, unknown>> = []
  let pendingAssistantIndex = -1
  let pendingReasoning = ''
  const appendToolCallToPendingAssistant = (toolCall: Record<string, unknown>) => {
    if (pendingAssistantIndex < 0 || !messages[pendingAssistantIndex]) {
      messages.push({
        role: 'assistant',
        content: '',
        ...(pendingReasoning ? { reasoning_content: pendingReasoning } : {}),
      })
      pendingAssistantIndex = messages.length - 1
      pendingReasoning = ''
    }
    const current = messages[pendingAssistantIndex]
    const existing = Array.isArray(current.tool_calls) ? current.tool_calls : []
    current.tool_calls = [...existing, toolCall]
  }
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const record = item as Record<string, unknown>
    const type = typeof record.type === 'string' ? record.type : ''
    if (type === 'function_call_output' || type === 'custom_tool_call_output') {
      pendingAssistantIndex = -1
      pendingReasoning = ''
      messages.push({
        role: 'tool',
        tool_call_id: typeof record.call_id === 'string' ? record.call_id : undefined,
        content: stringifyCliJsonValue(record.output),
      })
      continue
    }
    if (type === 'function_call' || type === 'custom_tool_call') {
      const name = typeof record.name === 'string' ? record.name.trim() : ''
      if (!name) {
        continue
      }
      appendToolCallToPendingAssistant({
        id: typeof record.call_id === 'string' ? record.call_id : `call_${messages.length}`,
        type: 'function',
        function: {
          name,
          arguments: type === 'custom_tool_call'
            ? normalizeCustomToolCallArguments(record.input)
            : stringifyCliJsonValue(record.arguments),
        },
      })
      continue
    }
    if (type === 'reasoning') {
      const summary = Array.isArray(record.summary)
        ? record.summary.map((part) => normalizeCliTextContent((part as Record<string, unknown>)?.text)).join('')
        : normalizeCliTextContent(record.text || record.content)
      if (summary.trim()) {
        if (pendingAssistantIndex >= 0 && messages[pendingAssistantIndex]) {
          messages[pendingAssistantIndex].reasoning_content = summary
        } else {
          pendingReasoning = summary
        }
      }
      continue
    }
    const role = record.role === 'assistant' ? 'assistant' : record.role === 'system' || record.role === 'developer' ? 'system' : 'user'
    const contentValue = Array.isArray(record.content)
      ? record.content.map((part) => {
        const partRecord = part && typeof part === 'object' ? part as Record<string, unknown> : {}
        const partType = typeof partRecord.type === 'string' ? partRecord.type : ''
        if (partType === 'input_text' || partType === 'output_text') {
          return { type: 'text', text: normalizeCliTextContent(partRecord.text) }
        }
        if (partType === 'input_image') {
          return { type: 'image_url', image_url: normalizeChatImageUrl(partRecord.image_url) }
        }
        if (partType === 'summary_text' || partType === 'reasoning_text') {
          return null
        }
        return partRecord.text ? { type: 'text', text: normalizeCliTextContent(partRecord.text) } : null
      }).filter(Boolean)
      : normalizeCliTextContent(record.content)
    const message: Record<string, unknown> = {
      role,
      content: Array.isArray(contentValue) && contentValue.length === 1 && contentValue[0]?.type === 'text'
        ? contentValue[0].text
        : contentValue,
    }
    if (role === 'assistant') {
      if (pendingReasoning) {
        message.reasoning_content = pendingReasoning
        pendingReasoning = ''
      }
      pendingAssistantIndex = messages.length
    } else {
      pendingAssistantIndex = -1
      pendingReasoning = ''
    }
    messages.push(message)
  }
  return messages
}

function resolveResponsesToolName(toolDef: Record<string, unknown>) {
  const direct = typeof toolDef.name === 'string' ? toolDef.name.trim() : ''
  if (direct) {
    return direct
  }
  const custom = toolDef.custom && typeof toolDef.custom === 'object'
    ? toolDef.custom as Record<string, unknown>
    : null
  return typeof custom?.name === 'string' ? custom.name.trim() : ''
}

function convertResponsesToolsToChatTools(tools: unknown) {
  if (!Array.isArray(tools)) {
    return {}
  }
  const customToolNames = new Set<string>()
  const chatTools = tools.flatMap((tool) => {
    if (!tool || typeof tool !== 'object') {
      return []
    }
    const record = tool as Record<string, unknown>
    const type = typeof record.type === 'string' ? record.type : ''
    if (type === 'function') {
      const name = resolveResponsesToolName(record)
      return name ? [{
        type: 'function',
        function: {
          name,
          description: typeof record.description === 'string' ? record.description : '',
          parameters: record.parameters || { type: 'object' },
        },
      }] : []
    }
    if (type === 'custom') {
      const name = resolveResponsesToolName(record)
      if (!name) {
        return []
      }
      customToolNames.add(name)
      return [{
        type: 'function',
        function: {
          name,
          description: [
            typeof record.description === 'string' ? record.description : '',
            'Return the tool payload in the single string field `input`.',
          ].filter(Boolean).join('\n\n'),
          parameters: {
            type: 'object',
            properties: {
              input: {
                type: 'string',
                description: 'Raw tool input to pass through exactly as provided by the model.',
              },
            },
            required: ['input'],
            additionalProperties: false,
          },
        },
      }]
    }
    return []
  })
  return {
    tools: chatTools.length ? chatTools : undefined,
    customToolNames,
  }
}

function convertResponsesRequestToChatRequest(body: Record<string, unknown>) {
  const { tools, customToolNames } = convertResponsesToolsToChatTools(body.tools)
  return {
    model: body.model,
    messages: [
      ...(typeof body.instructions === 'string' && body.instructions.trim()
        ? [{ role: 'system', content: body.instructions }]
        : []),
      ...responsesInputToChatMessages(body.input),
    ].filter((item) => item.content || item.role === 'tool' || item.tool_calls),
    stream: body.stream === true,
    temperature: body.temperature,
    top_p: body.top_p,
    max_tokens: body.max_output_tokens,
    max_completion_tokens: body.max_output_tokens,
    tools,
    tool_choice: body.tool_choice,
    parallel_tool_calls: body.parallel_tool_calls,
    reasoning_effort:
      body.reasoning && typeof body.reasoning === 'object'
        ? (body.reasoning as Record<string, unknown>).effort
        : undefined,
  }
}

function convertClaudeMessagesRequestToChatRequest(body: Record<string, unknown>) {
  const tools = Array.isArray(body.tools)
    ? body.tools.flatMap((tool) => {
      const record = tool && typeof tool === 'object' ? tool as Record<string, unknown> : {}
      const name = typeof record.name === 'string' ? record.name.trim() : ''
      return name ? [{
        type: 'function',
        function: {
          name,
          description: typeof record.description === 'string' ? record.description : '',
          parameters: record.input_schema || { type: 'object' },
        },
      }] : []
    })
    : undefined
  const messages: Array<Record<string, unknown>> = []
  for (const item of Array.isArray(body.messages) ? body.messages : []) {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const role = record.role === 'assistant' ? 'assistant' : 'user'
    if (Array.isArray(record.content)) {
      const textParts: string[] = []
      const toolCalls: Array<Record<string, unknown>> = []
      for (const part of record.content) {
        const partRecord = part && typeof part === 'object' ? part as Record<string, unknown> : {}
        const partType = typeof partRecord.type === 'string' ? partRecord.type : ''
        if (partType === 'text') {
          textParts.push(normalizeCliTextContent(partRecord.text))
        } else if (partType === 'tool_use' && role === 'assistant') {
          const name = typeof partRecord.name === 'string' ? partRecord.name.trim() : ''
          if (name) {
            toolCalls.push({
              id: typeof partRecord.id === 'string' ? partRecord.id : `call_${toolCalls.length}`,
              type: 'function',
              function: {
                name,
                arguments: stringifyCliJsonValue(partRecord.input || {}),
              },
            })
          }
        } else if (partType === 'tool_result') {
          messages.push({
            role: 'tool',
            tool_call_id: typeof partRecord.tool_use_id === 'string' ? partRecord.tool_use_id : '',
            content: normalizeCliTextContent(partRecord.content) || stringifyCliJsonValue(partRecord.content),
          })
        }
      }
      if (toolCalls.length || textParts.join('').trim()) {
        messages.push({
          role,
          content: textParts.join('\n'),
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        })
      }
      continue
    }
    messages.push({
      role,
      content: normalizeCliTextContent(record.content),
    })
  }
  return {
    model: body.model,
    messages: [
      ...(typeof body.system === 'string' && body.system.trim()
        ? [{ role: 'system', content: body.system }]
        : []),
      ...messages,
    ].filter((item) => item.content || item.tool_calls || item.role === 'tool'),
    tools: tools?.length ? tools : undefined,
    stream: body.stream === true,
    temperature: body.temperature,
    top_p: body.top_p,
    max_tokens: body.max_tokens,
  }
}

function extractChatResponseText(data: unknown) {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const choices = Array.isArray(record.choices) ? record.choices : []
  const first = choices[0] && typeof choices[0] === 'object' ? choices[0] as Record<string, unknown> : {}
  const message = first.message && typeof first.message === 'object' ? first.message as Record<string, unknown> : {}
  return normalizeCliTextContent(message.content)
}

function extractChatResponseMessage(data: unknown) {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const choices = Array.isArray(record.choices) ? record.choices : []
  const first = choices[0] && typeof choices[0] === 'object' ? choices[0] as Record<string, unknown> : {}
  return first.message && typeof first.message === 'object' ? first.message as Record<string, unknown> : {}
}

function getCustomToolNames(requestBodyObject: Record<string, unknown> | null | undefined) {
  const converted = requestBodyObject ? convertResponsesToolsToChatTools(requestBodyObject.tools) : {}
  return converted.customToolNames || new Set<string>()
}

function readUsageNumber(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.floor(value))
    }
  }
  return 0
}

function normalizeResponsesUsage(value: unknown) {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const inputTokens = readUsageNumber(source, ['input_tokens', 'prompt_tokens'])
  const outputTokens = readUsageNumber(source, ['output_tokens', 'completion_tokens'])
  const totalTokens = readUsageNumber(source, ['total_tokens'])
  const normalizedTotal = totalTokens || inputTokens + outputTokens
  return {
    input_tokens: inputTokens,
    input_tokens_details: source.input_tokens_details && typeof source.input_tokens_details === 'object'
      ? source.input_tokens_details
      : { cached_tokens: readUsageNumber(source, ['prompt_cache_hit_tokens']) },
    output_tokens: outputTokens,
    output_tokens_details: source.output_tokens_details && typeof source.output_tokens_details === 'object'
      ? source.output_tokens_details
      : { reasoning_tokens: 0 },
    total_tokens: normalizedTotal,
  }
}

function convertChatResponseToResponses(data: unknown, model: unknown, requestBodyObject?: Record<string, unknown> | null) {
  const text = extractChatResponseText(data)
  const message = extractChatResponseMessage(data)
  const customToolNames = getCustomToolNames(requestBodyObject)
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
  const output = [
    ...(text ? [{
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text }],
    }] : []),
    ...toolCalls.flatMap((toolCall, index) => {
      const record = toolCall && typeof toolCall === 'object' ? toolCall as Record<string, unknown> : {}
      const fn = record.function && typeof record.function === 'object' ? record.function as Record<string, unknown> : {}
      const name = typeof fn.name === 'string' ? fn.name : ''
      if (!name) {
        return []
      }
      const callId = typeof record.id === 'string' ? record.id : `call_${index}`
      const argumentsText = typeof fn.arguments === 'string' ? fn.arguments : stringifyCliJsonValue(fn.arguments)
      const isCustom = customToolNames.has(name)
      return [{
        id: callId,
        type: isCustom ? 'custom_tool_call' : 'function_call',
        status: 'completed',
        call_id: callId,
        name,
        ...(isCustom ? { input: extractCustomToolInputFromArguments(argumentsText) } : { arguments: argumentsText }),
      }]
    }),
  ]
  return {
    id: `resp_${Date.now()}`,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model,
    status: 'completed',
    output,
    output_text: text,
    usage: normalizeResponsesUsage((data as Record<string, unknown>)?.usage),
  }
}

function convertChatResponseToClaude(data: unknown, model: unknown) {
  const text = extractChatResponseText(data)
  const message = extractChatResponseMessage(data)
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
  const usage = (data as Record<string, any>)?.usage || {}
  return {
    id: `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model,
    content: [
      ...(text ? [{ type: 'text', text }] : []),
      ...toolCalls.flatMap((toolCall, index) => {
        const record = toolCall && typeof toolCall === 'object' ? toolCall as Record<string, unknown> : {}
        const fn = record.function && typeof record.function === 'object' ? record.function as Record<string, unknown> : {}
        const name = typeof fn.name === 'string' ? fn.name : ''
        if (!name) {
          return []
        }
        const rawInput = typeof fn.arguments === 'string' ? fn.arguments : stringifyCliJsonValue(fn.arguments)
        let input: unknown = {}
        try {
          input = rawInput.trim() ? JSON.parse(rawInput) : {}
        } catch {
          input = rawInput
        }
        return [{
          type: 'tool_use',
          id: typeof record.id === 'string' ? record.id : `call_${index}`,
          name,
          input,
        }]
      }),
    ],
    stop_reason: toolCalls.length ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: Number(usage.prompt_tokens || 0),
      output_tokens: Number(usage.completion_tokens || 0),
    },
  }
}

function createChatSseBridge(client: CliClient, model: unknown, requestBodyObject?: Record<string, unknown> | null) {
  const responseId = `resp_${Date.now()}`
  const messageId = `msg_${Date.now()}`
  const customToolNames = getCustomToolNames(requestBodyObject)
  let started = false
  let textStarted = false
  let textDone = false
  let closed = false
  let claudeTextStarted = false
  let nextOutputIndex = 0
  let assistantOutputIndex = -1
  let bufferedText = ''
  const toolIndexes = new Map<number, {
    outputIndex: number
    id: string
    name: string
    args: string
    isCustom: boolean
    added: boolean
  }>()

  const event = (payload: unknown, eventName?: string) =>
    client === 'claude'
      ? `${eventName ? `event: ${eventName}\n` : ''}data: ${JSON.stringify(payload)}\n\n`
      : `data: ${JSON.stringify(payload)}\n\n`

  const start = () => {
    if (started) {
      return ''
    }
    started = true
    if (client === 'claude') {
      return event({
        type: 'message_start',
        message: {
          id: messageId,
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }, 'message_start')
    }
    return event({
      type: 'response.created',
      response: {
        id: responseId,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        status: 'in_progress',
        model,
      },
    })
  }

  const ensureTextStarted = () => {
    if (client === 'claude') {
      if (claudeTextStarted) {
        return ''
      }
      claudeTextStarted = true
      assistantOutputIndex = nextOutputIndex++
      return event({
        type: 'content_block_start',
        index: assistantOutputIndex,
        content_block: { type: 'text', text: '' },
      }, 'content_block_start')
    }
    if (textStarted) {
      return ''
    }
    textStarted = true
    assistantOutputIndex = nextOutputIndex++
    return [
      event({
        type: 'response.output_item.added',
        output_index: assistantOutputIndex,
        item: { id: messageId, type: 'message', role: 'assistant', status: 'in_progress', content: [] },
      }),
      event({
        type: 'response.content_part.added',
        item_id: messageId,
        output_index: assistantOutputIndex,
        content_index: 0,
        part: { type: 'output_text', text: '' },
      }),
    ].join('')
  }

  const ensureTextDone = () => {
    if (textDone) {
      return ''
    }
    textDone = true
    if (client === 'claude') {
      return claudeTextStarted
        ? event({ type: 'content_block_stop', index: assistantOutputIndex }, 'content_block_stop')
        : ''
    }
    return textStarted
      ? [
        event({
          type: 'response.output_text.done',
          item_id: messageId,
          output_index: assistantOutputIndex,
          content_index: 0,
          text: bufferedText,
        }),
        event({
          type: 'response.content_part.done',
          item_id: messageId,
          output_index: assistantOutputIndex,
          content_index: 0,
          part: { type: 'output_text', text: bufferedText },
        }),
        event({
          type: 'response.output_item.done',
          output_index: assistantOutputIndex,
          item: {
            id: messageId,
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: bufferedText }],
          },
        }),
      ].join('')
      : ''
  }

  const emitTextDelta = (text: string) => {
    if (!text) {
      return ''
    }
    bufferedText += text
    if (client === 'claude') {
      return start() + ensureTextStarted() + event({
        type: 'content_block_delta',
        index: assistantOutputIndex,
        delta: { type: 'text_delta', text },
      }, 'content_block_delta')
    }
    return start() + ensureTextStarted() + event({
      type: 'response.output_text.delta',
      item_id: messageId,
      output_index: assistantOutputIndex,
      content_index: 0,
      delta: text,
    })
  }

  const emitToolDelta = (toolCall: Record<string, unknown>, fallbackIndex: number) => {
    const index = typeof toolCall.index === 'number' ? toolCall.index : fallbackIndex
    const fn = toolCall.function && typeof toolCall.function === 'object'
      ? toolCall.function as Record<string, unknown>
      : {}
    let state = toolIndexes.get(index)
    if (!state) {
      const id = typeof toolCall.id === 'string' && toolCall.id.trim() ? toolCall.id.trim() : `call_${index}`
      const name = typeof fn.name === 'string' ? fn.name.trim() : ''
      state = {
        outputIndex: nextOutputIndex++,
        id,
        name,
        args: '',
        isCustom: customToolNames.has(name),
        added: false,
      }
      toolIndexes.set(index, state)
    }
    if (typeof toolCall.id === 'string' && toolCall.id.trim()) {
      state.id = toolCall.id.trim()
    }
    if (typeof fn.name === 'string' && fn.name.trim()) {
      state.name = fn.name.trim()
      state.isCustom = customToolNames.has(state.name)
    }
    const argsDelta = typeof fn.arguments === 'string' ? fn.arguments : ''
    state.args += argsDelta
    const chunks: string[] = [start(), ensureTextDone()]
    if (client === 'claude') {
      if (!state.added && state.name) {
        state.added = true
        chunks.push(event({
          type: 'content_block_start',
          index: state.outputIndex,
          content_block: {
            type: 'tool_use',
            id: state.id,
            name: state.name,
            input: {},
          },
        }, 'content_block_start'))
      }
      if (argsDelta) {
        chunks.push(event({
          type: 'content_block_delta',
          index: state.outputIndex,
          delta: {
            type: 'input_json_delta',
            partial_json: argsDelta,
          },
        }, 'content_block_delta'))
      }
      return chunks.join('')
    }
    if (!state.added && state.name) {
      state.added = true
      chunks.push(event({
        type: 'response.output_item.added',
        output_index: state.outputIndex,
        item: {
          id: state.id,
          type: state.isCustom ? 'custom_tool_call' : 'function_call',
          status: 'in_progress',
          call_id: state.id,
          name: state.name,
        },
      }))
    }
    if (argsDelta) {
      chunks.push(event(state.isCustom ? {
        type: 'response.custom_tool_call_input.delta',
        item_id: state.id,
        output_index: state.outputIndex,
        delta: extractCustomToolInputFromArguments(state.args),
      } : {
        type: 'response.function_call_arguments.delta',
        item_id: state.id,
        output_index: state.outputIndex,
        delta: argsDelta,
      }))
    }
    return chunks.join('')
  }

  const handlePayload = (data: Record<string, unknown>) => {
    const choice = Array.isArray(data.choices) ? data.choices[0] as Record<string, unknown> : null
    const delta = choice?.delta && typeof choice.delta === 'object' ? choice.delta as Record<string, unknown> : null
    const chunks: string[] = []
    if (delta) {
      const reasoning = normalizeCliTextContent(delta.reasoning_content || delta.reasoning)
      const text = normalizeCliTextContent(delta.content)
      if (reasoning) {
        chunks.push(emitTextDelta(reasoning))
      }
      if (text) {
        chunks.push(emitTextDelta(text))
      }
      if (Array.isArray(delta.tool_calls)) {
        delta.tool_calls.forEach((toolCall, index) => {
          if (toolCall && typeof toolCall === 'object') {
            chunks.push(emitToolDelta(toolCall as Record<string, unknown>, index))
          }
        })
      }
    }
    if (choice?.finish_reason) {
      chunks.push(finish(data.usage as Record<string, unknown> | undefined))
    }
    return chunks.join('')
  }

  const finish = (usage?: Record<string, unknown>) => {
    if (closed) {
      return ''
    }
    closed = true
    const chunks = [start(), ensureTextDone()]
    if (client === 'claude') {
      for (const [, state] of [...toolIndexes].sort(([left], [right]) => left - right)) {
        if (state.added) {
          chunks.push(event({ type: 'content_block_stop', index: state.outputIndex }, 'content_block_stop'))
        }
      }
      chunks.push(event({
        type: 'message_delta',
        delta: { stop_reason: toolIndexes.size ? 'tool_use' : 'end_turn', stop_sequence: null },
        usage: { output_tokens: Number(usage?.completion_tokens || 0) },
      }, 'message_delta'))
      chunks.push(event({ type: 'message_stop' }, 'message_stop'))
      return chunks.join('')
    }
    for (const [, state] of [...toolIndexes].sort(([left], [right]) => left - right)) {
      const payload = state.isCustom ? {
        type: 'response.custom_tool_call_input.done',
        item_id: state.id,
        output_index: state.outputIndex,
        call_id: state.id,
        name: state.name,
        input: extractCustomToolInputFromArguments(state.args),
      } : {
        type: 'response.function_call_arguments.done',
        item_id: state.id,
        output_index: state.outputIndex,
        call_id: state.id,
        name: state.name,
        arguments: state.args,
      }
      chunks.push(event(payload))
      chunks.push(event({
        type: 'response.output_item.done',
        output_index: state.outputIndex,
        item: {
          id: state.id,
          type: state.isCustom ? 'custom_tool_call' : 'function_call',
          status: 'completed',
          call_id: state.id,
          name: state.name,
          ...(state.isCustom
            ? { input: extractCustomToolInputFromArguments(state.args) }
            : { arguments: state.args }),
        },
      }))
    }
    chunks.push(event({
      type: 'response.completed',
      response: {
        id: responseId,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        status: 'completed',
        model,
        output: [],
        usage: normalizeResponsesUsage(usage),
      },
    }))
    chunks.push('data: [DONE]\n\n')
    return chunks.join('')
  }

  return { handlePayload, finish }
}

async function pipeConvertedChatSse(upstream: Response, response: http.ServerResponse, client: CliClient, model: unknown, requestBodyObject?: Record<string, unknown> | null) {
  const bridge = createChatSseBridge(client, model, requestBodyObject)
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false
  const emit = (text: string) => {
    if (text) {
      response.write(text)
    }
  }
  const consumeEvent = (eventText: string) => {
    const dataLines = eventText
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
    for (const payload of dataLines) {
      if (!payload) {
        continue
      }
      if (payload === '[DONE]') {
        if (!finished) {
          emit(bridge.finish())
          finished = true
        }
        continue
      }
      const data = readJsonObject(payload)
      if (data) {
        emit(bridge.handlePayload(data))
      }
    }
  }
  if (upstream.body) {
    for await (const chunk of Readable.fromWeb(upstream.body)) {
      buffer += decoder.decode(chunk as Buffer, { stream: true })
      let separatorIndex = buffer.search(/\r?\n\r?\n/)
      while (separatorIndex >= 0) {
        const eventText = buffer.slice(0, separatorIndex)
        const match = buffer.slice(separatorIndex).match(/^\r?\n\r?\n/)
        buffer = buffer.slice(separatorIndex + (match?.[0].length || 2))
        consumeEvent(eventText)
        separatorIndex = buffer.search(/\r?\n\r?\n/)
      }
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) {
    consumeEvent(buffer)
  }
  if (!finished) {
    emit(bridge.finish())
  }
}

async function createCliPromptCacheProxy(input: {
  targetBaseUrl: string
  apiKey: string
  client: CliClient
  projectPath: string
  sessionId?: string
}) {
  const targetBase = new URL(input.targetBaseUrl)
  const promptCacheKey = buildCliPromptCacheKey({
    client: input.client,
    projectPath: input.projectPath,
    sessionId: input.sessionId || `${input.client}-${Date.now()}`,
  })

  const server = http.createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }

      const requestUrl = new URL(request.url || '/', targetBase)
      const shouldBridgeResponses = input.client === 'codex' && /\/responses$/i.test(requestUrl.pathname)
      const shouldBridgeClaudeMessages = input.client === 'claude' && /\/messages$/i.test(requestUrl.pathname)
      const bridgedPath = shouldBridgeResponses || shouldBridgeClaudeMessages ? '/v1/chat/completions' : requestUrl.pathname
      const targetUrl = new URL(bridgedPath + requestUrl.search, targetBase)
      const headers = new Headers()
      for (const [key, value] of Object.entries(request.headers)) {
        if (!value || key.toLowerCase() === 'host' || key.toLowerCase() === 'content-length') {
          continue
        }
        headers.set(key, Array.isArray(value) ? value.join(', ') : value)
      }
      if (shouldBridgeResponses || shouldBridgeClaudeMessages) {
        headers.set('authorization', `Bearer ${input.apiKey}`)
        headers.delete('x-api-key')
        headers.delete('anthropic-version')
        headers.delete('anthropic-beta')
      }

      let body: BodyInit | undefined
      let requestBodyObject: Record<string, unknown> | null = null
      if (chunks.length > 0) {
        const rawBody = Buffer.concat(chunks).toString('utf8')
        const contentType = headers.get('content-type') || ''
        if (contentType.toLowerCase().includes('application/json')) {
          const withPromptCacheKey = injectCliPromptCacheKeyIntoJsonBody(rawBody, promptCacheKey)
          requestBodyObject = readJsonObject(withPromptCacheKey)
          if (requestBodyObject && shouldBridgeResponses) {
            body = JSON.stringify(convertResponsesRequestToChatRequest(requestBodyObject))
          } else if (requestBodyObject && shouldBridgeClaudeMessages) {
            body = JSON.stringify(convertClaudeMessagesRequestToChatRequest(requestBodyObject))
          } else {
            body = withPromptCacheKey
          }
          headers.set('content-length', Buffer.byteLength(body).toString())
        } else {
          body = rawBody
        }
      }

      const upstream = await fetch(targetUrl, {
        method: request.method || 'GET',
        headers,
        body,
      })
      const upstreamHeaders = Object.fromEntries(upstream.headers.entries())
      if ((shouldBridgeResponses || shouldBridgeClaudeMessages) && upstream.ok) {
        const contentType = upstream.headers.get('content-type') || ''
        if (contentType.includes('text/event-stream')) {
          delete upstreamHeaders['content-length']
          delete upstreamHeaders['content-encoding']
          response.writeHead(upstream.status, {
            ...upstreamHeaders,
            'content-type': 'text/event-stream; charset=utf-8',
          })
          await pipeConvertedChatSse(upstream, response, input.client, requestBodyObject?.model, requestBodyObject)
          response.end()
          return
        }
        const upstreamText = await upstream.text()
        const data = readJsonObject(upstreamText)
        const converted = input.client === 'claude'
          ? convertChatResponseToClaude(data, requestBodyObject?.model)
          : convertChatResponseToResponses(data, requestBodyObject?.model, requestBodyObject)
        const convertedText = JSON.stringify(converted)
        response.writeHead(upstream.status, {
          ...upstreamHeaders,
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(convertedText).toString(),
        })
        response.end(convertedText)
        return
      }

      response.writeHead(upstream.status, upstreamHeaders)
      if (upstream.body) {
        for await (const chunk of Readable.fromWeb(upstream.body)) {
          response.write(chunk)
        }
      }
      response.end()
    } catch (error) {
      response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : 'CLI prompt cache proxy failed',
        },
      }))
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw new Error('CLI prompt cache proxy failed to bind local port')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

async function readCurrentCodexConfig() {
  const targetPath = cliConfig.codex.configPath
  const raw = await fs.readFile(targetPath, 'utf8')
  const parsed = parseTomlDocument(raw)
  const model = readTomlTopLevelString(parsed.preamble, 'model') || DEFAULT_CODEX_MODEL
  const provider = readTomlTopLevelString(parsed.preamble, 'model_provider') || 'oneapi_desktop'
  const credentialsStore = readTomlTopLevelString(parsed.preamble, 'cli_auth_credentials_store')
  const providerSection =
    parsed.sections.find((section) => section.header === `model_providers.${provider}`) ||
    parsed.sections.find((section) => section.header === 'model_providers.oneapi_desktop')
  const apiKey = providerSection ? readCodexProviderToken(providerSection.lines) : ''
  const baseUrl = providerSection ? readTomlSectionString(providerSection.lines, 'base_url') : ''

  return {
    client: 'codex' as const,
    apiKey: apiKey?.trim() || '',
    model: model.trim() || DEFAULT_CODEX_MODEL,
    baseUrl: normalizeCodexBaseUrl(baseUrl),
    managedByDesktop: provider === 'oneapi_desktop' && credentialsStore === 'file',
  }
}

type ClaudeSettingsDocument = {
  env?: Record<string, string>
  model?: string
  permissions?: Record<string, unknown>
  [key: string]: unknown
}

type TomlSectionBlock = {
  header: string
  lines: string[]
}

function parseTomlDocument(raw: string) {
  const normalized = raw.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const preamble: string[] = []
  const sections: TomlSectionBlock[] = []
  let currentHeader = ''
  let currentLines: string[] | null = null

  for (const line of lines) {
    const match = line.match(/^\s*\[([^\]]+)\]\s*$/)
    if (match) {
      if (currentLines && currentHeader) {
        sections.push({
          header: currentHeader,
          lines: currentLines,
        })
      }
      currentHeader = match[1].trim()
      currentLines = [line]
      continue
    }

    if (currentLines) {
      currentLines.push(line)
    } else {
      preamble.push(line)
    }
  }

  if (currentLines && currentHeader) {
    sections.push({
      header: currentHeader,
      lines: currentLines,
    })
  }

  return {
    preamble,
    sections,
  }
}

function readTomlTopLevelString(lines: string[], key: string) {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"\\s*$`)
  for (const line of lines) {
    const match = line.match(pattern)
    if (match) {
      return match[1]
    }
  }
  return ''
}

function readTomlSectionString(lines: string[], key: string) {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"\\s*$`)
  for (const line of lines) {
    const match = line.match(pattern)
    if (match) {
      return match[1]
    }
  }
  return ''
}

function readCodexProviderToken(lines: string[]) {
  return (
    readTomlSectionString(lines, 'experimental_bearer_token') ||
    readTomlSectionString(lines, 'api_key')
  )
}

function createCodexProviderSection(apiKey: string, baseUrl: string): TomlSectionBlock {
  const resolvedBaseUrl = normalizeCodexBaseUrl(baseUrl)
  return {
    header: 'model_providers.oneapi_desktop',
    lines: [
      '[model_providers.oneapi_desktop]',
      'name = "oneapi_desktop"',
      `base_url = "${resolvedBaseUrl}"`,
      `api_key = "${apiKey}"`,
      `experimental_bearer_token = "${apiKey}"`,
      'wire_api = "responses"',
    ],
  }
}

function createCodexWindowsSection(): TomlSectionBlock {
  return {
    header: 'windows',
    lines: [
      '[windows]',
      'sandbox = "unelevated"',
    ],
  }
}

function getCodexBundledMarketplaceSourcePath() {
  return `\\\\?\\${path.join(os.homedir(), '.codex', '.tmp', 'bundled-marketplaces', 'openai-bundled')}`
}

function createCodexMarketplaceSection(): TomlSectionBlock {
  return {
    header: 'marketplaces.openai-bundled',
    lines: [
      '[marketplaces.openai-bundled]',
      `last_updated = "${new Date().toISOString()}"`,
      'source_type = "local"',
      `source = '${getCodexBundledMarketplaceSourcePath()}'`,
    ],
  }
}

function serializeTomlInlineStringMap(values: Record<string, string>) {
  return `{ ${Object.entries(values)
    .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
    .join(', ')} }`
}

function createCodexPeerMcpEnv(
  claudeCommand: string,
  claudeSettingsDocument?: ClaudeSettingsDocument | null
) {
  const settingsEnv = (typeof claudeSettingsDocument?.env === 'object' && claudeSettingsDocument.env
    ? claudeSettingsDocument.env
    : {}) as Record<string, string>
  const env: Record<string, string> = {
    ONEAPI_CLAUDE_COMMAND: claudeCommand || 'claude',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:
      settingsEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC?.trim() || '1',
  }
  const apiKey = pickClaudeApiKey(settingsEnv)
  if (apiKey) {
    const normalizedKey = resolveDesktopCliKeyRecord(apiKey)
    env.ANTHROPIC_API_KEY = normalizedKey
    delete env.ANTHROPIC_AUTH_TOKEN
  }
  if (settingsEnv.ANTHROPIC_BASE_URL?.trim()) {
    env.ANTHROPIC_BASE_URL = normalizeClaudeBaseUrl(settingsEnv.ANTHROPIC_BASE_URL)
  }
  if (settingsEnv.API_TIMEOUT_MS?.trim()) {
    env.API_TIMEOUT_MS = settingsEnv.API_TIMEOUT_MS.trim()
  }
  return env
}

function createCodexPeerMcpSection(
  nodePath: string,
  serverPath: string,
  claudeCommand: string,
  claudeSettingsDocument?: ClaudeSettingsDocument | null
): TomlSectionBlock {
  const env = createCodexPeerMcpEnv(claudeCommand, claudeSettingsDocument)
  return {
    header: 'mcp_servers.oneapi_claude',
    lines: [
      '[mcp_servers.oneapi_claude]',
      `command = ${JSON.stringify(nodePath)}`,
      `args = [${JSON.stringify(serverPath)}, "claude"]`,
      `env = ${serializeTomlInlineStringMap(env)}`,
    ],
  }
}

function mergeCodexPeerMcpConfig(
  raw: string,
  nodePath: string,
  serverPath: string,
  claudeCommand: string,
  claudeSettingsDocument?: ClaudeSettingsDocument | null
) {
  const parsed = parseTomlDocument(raw)
  const section = createCodexPeerMcpSection(nodePath, serverPath, claudeCommand, claudeSettingsDocument)
  const sections = parsed.sections.filter((item) => item.header !== section.header)
  sections.push(section)
  return serializeTomlDocument(parsed.preamble, sections)
}

function renameCodexProviderSection(block: TomlSectionBlock, nextHeader: string, nextName: string): TomlSectionBlock {
  return {
    header: nextHeader,
    lines: block.lines.map((line, index) => {
      if (index === 0) {
        return `[${nextHeader}]`
      }
      if (/^\s*name\s*=/.test(line)) {
        return `name = "${nextName}"`
      }
      return line
    }),
  }
}

function serializeTomlDocument(preamble: string[], sections: TomlSectionBlock[]) {
  const blocks = [
    preamble.join('\n').trimEnd(),
    ...sections.map((section) => section.lines.join('\n').trimEnd()).filter(Boolean),
  ].filter(Boolean)

  return `${blocks.join('\n\n').replace(/\n{3,}/g, '\n\n')}\n`
}

function isCodexProviderDifferent(section: TomlSectionBlock, apiKey: string, baseUrl: string) {
  return (
    readCodexProviderToken(section.lines).trim() !== apiKey.trim() ||
    normalizeCodexBaseUrl(readTomlSectionString(section.lines, 'base_url')) !==
      normalizeCodexBaseUrl(baseUrl)
  )
}

function mergeCodexConfig(raw: string, apiKey: string, model: string, baseUrl: string) {
  const parsed = parseTomlDocument(raw)
  const resolvedBaseUrl = normalizeCodexBaseUrl(baseUrl)
  const nextProviderBlock = createCodexProviderSection(apiKey, resolvedBaseUrl)
  const filteredPreamble = parsed.preamble.filter(
    (line) =>
      !/^\s*model\s*=/.test(line) &&
      !/^\s*model_provider\s*=/.test(line) &&
      !/^\s*model_reasoning_effort\s*=/.test(line) &&
      !/^\s*cli_auth_credentials_store\s*=/.test(line)
  )

  const nextPreamble = [
    `model = "${model}"`,
    'model_provider = "oneapi_desktop"',
    'model_reasoning_effort = "high"',
    'cli_auth_credentials_store = "file"',
    '',
    ...filteredPreamble,
  ]

  const sections: TomlSectionBlock[] = []
  const existingOneApiDesktop = parsed.sections.find(
    (section) => section.header === 'model_providers.oneapi_desktop'
  )
  const existingOriginalBackup = parsed.sections.find(
    (section) => section.header === 'model_providers.oneapi_desktop_original'
  )
  const shouldInsertBackup =
    !!existingOneApiDesktop &&
    !existingOriginalBackup &&
    isCodexProviderDifferent(existingOneApiDesktop, apiKey, resolvedBaseUrl)
  let insertedProvider = false
  let insertedBackup = false
  let insertedWindows = false
  let insertedMarketplace = false

  for (const section of parsed.sections) {
    if (section.header === 'model_providers.oneapi_desktop') {
      if (!insertedProvider) {
        sections.push(nextProviderBlock)
        insertedProvider = true
        if (shouldInsertBackup && existingOneApiDesktop && !insertedBackup) {
          sections.push(
            renameCodexProviderSection(
              existingOneApiDesktop,
              'model_providers.oneapi_desktop_original',
              'oneapi_desktop_original'
            )
          )
          insertedBackup = true
        }
      }
      continue
    }

    if (section.header === 'model_providers.oneapi_desktop_original') {
      if (!insertedBackup) {
        sections.push(section)
        insertedBackup = true
      }
      continue
    }

    if (section.header === 'windows') {
      if (!insertedWindows) {
        sections.push(section)
        insertedWindows = true
      }
      continue
    }

    if (section.header === 'marketplaces.openai-bundled') {
      if (!insertedMarketplace) {
        sections.push(createCodexMarketplaceSection())
        insertedMarketplace = true
      }
      continue
    }

    if (!insertedProvider && section.header.startsWith('model_providers.')) {
      sections.push(nextProviderBlock)
      insertedProvider = true
      if (shouldInsertBackup && existingOneApiDesktop && !insertedBackup) {
        sections.push(
          renameCodexProviderSection(
            existingOneApiDesktop,
            'model_providers.oneapi_desktop_original',
            'oneapi_desktop_original'
          )
        )
        insertedBackup = true
      }
    }

    sections.push(section)
  }

  if (!insertedProvider) {
    sections.push(nextProviderBlock)
  }

  if (shouldInsertBackup && existingOneApiDesktop && !insertedBackup) {
    sections.push(
      renameCodexProviderSection(
        existingOneApiDesktop,
        'model_providers.oneapi_desktop_original',
        'oneapi_desktop_original'
      )
    )
  }

  if (!insertedWindows) {
    sections.push(createCodexWindowsSection())
  }

  if (!insertedMarketplace) {
    sections.push(createCodexMarketplaceSection())
  }

  return serializeTomlDocument(nextPreamble, sections)
}

function resolveDesktopCliKeyRecord(apiKey: string) {
  return apiKey.startsWith('sk-') ? apiKey : `sk-${apiKey}`
}

function resolveDeployCliApiKey(request: Pick<CliDeployRequest, 'apiKey' | 'apiKeySource'>) {
  if (request.apiKeySource === 'custom') {
    const trimmed = request.apiKey.trim()
    if (!trimmed) {
      throw new Error('请先填写自定义 API Key。')
    }
    return resolveDesktopCliKeyRecord(trimmed)
  }
  return normalizeDesktopCliApiKey(request.apiKey)
}

function resolveRuntimeCliApiKey(request: Pick<CliRunRequest, 'apiKey'>, fallbackApiKey?: string) {
  const requested = request.apiKey?.trim()
  if (requested) {
    return resolveDesktopCliKeyRecord(requested)
  }
  return resolveDesktopCliKeyRecord(fallbackApiKey?.trim() || '')
}

function maskSensitiveText(value?: string) {
  if (!value) {
    return ''
  }

  return value.replace(/sk-[^\s"'`]+/g, (token) => {
    if (token.length <= 14) {
      return `${token.slice(0, 4)}****`
    }
    return `${token.slice(0, 6)}****${token.slice(-4)}`
  })
}

async function readCurrentClaudeConfig() {
  const targetPath = cliConfig.claude.configPath
  const parsed = await readResolvedClaudeSettingsDocument(targetPath)
  const env = parsed.env || {}
  const managedByDesktop =
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC === '1' ||
    typeof env.ONEAPI_ORIGINAL_ANTHROPIC_API_KEY === 'string'

  return {
    client: 'claude' as const,
    apiKey: pickClaudeApiKey(env),
    model: parsed.model?.trim() || DEFAULT_CLAUDE_MODEL,
    baseUrl: normalizeClaudeBaseUrl(env.ANTHROPIC_BASE_URL),
    managedByDesktop,
  }
}

async function readCurrentClaudeSettingsDocument(targetPath = cliConfig.claude.configPath) {
  const raw = await fs.readFile(targetPath, 'utf8')
  return JSON.parse(raw) as ClaudeSettingsDocument
}

async function readClaudeAuthDocument(targetPath = path.join(cliConfig.claude.dataPath, 'auth.json')) {
  const raw = await fs.readFile(targetPath, 'utf8')
  const parsed = JSON.parse(raw) as Record<string, unknown>
  if ('ANTHROPIC_AUTH_TOKEN' in parsed || 'ONEAPI_ORIGINAL_ANTHROPIC_AUTH_TOKEN' in parsed) {
    delete parsed.ANTHROPIC_AUTH_TOKEN
    delete parsed.ONEAPI_ORIGINAL_ANTHROPIC_AUTH_TOKEN
    await fs.writeFile(targetPath, JSON.stringify(parsed, null, 2), 'utf8')
  }
  return parsed
}

function pickClaudeApiKey(env?: Record<string, string>) {
  return env?.ANTHROPIC_API_KEY?.trim() || ''
}

async function resolveClaudeFallbackApiKey() {
  const claudeAuth = await readClaudeAuthDocument().catch(() => null)
  const fromClaudeAuth = pickClaudeApiKeyFromUnknown(claudeAuth)
  if (fromClaudeAuth) {
    return resolveDesktopCliKeyRecord(fromClaudeAuth)
  }

  const codexAuthPath = path.join(cliConfig.codex.dataPath, 'auth.json')
  const codexAuthRaw = await fs.readFile(codexAuthPath, 'utf8').catch(() => '')
  if (codexAuthRaw.trim()) {
    try {
      const parsed = JSON.parse(codexAuthRaw) as Record<string, unknown>
      const token =
        (typeof parsed.OPENAI_API_KEY === 'string' && parsed.OPENAI_API_KEY.trim()) ||
        ''
      if (token) {
        return resolveDesktopCliKeyRecord(token)
      }
    } catch {
      /* ignore invalid codex auth backup */
    }
  }

  const codexRaw = await fs.readFile(cliConfig.codex.configPath, 'utf8').catch(() => '')
  if (codexRaw.trim()) {
    const parsedToml = parseTomlDocument(codexRaw)
    const provider = readTomlTopLevelString(parsedToml.preamble, 'model_provider') || 'oneapi_desktop'
    const providerSection =
      parsedToml.sections.find((section) => section.header === `model_providers.${provider}`) ||
      parsedToml.sections.find((section) => section.header === 'model_providers.oneapi_desktop')
    const token = providerSection ? readCodexProviderToken(providerSection.lines).trim() : ''
    if (token) {
      return resolveDesktopCliKeyRecord(token)
    }
  }

  return ''
}

async function readResolvedClaudeSettingsDocument(targetPath = cliConfig.claude.configPath) {
  const parsed = await readCurrentClaudeSettingsDocument(targetPath).catch(() => ({} as ClaudeSettingsDocument))
  const currentEnv = (typeof parsed.env === 'object' && parsed.env ? parsed.env : {}) as Record<string, string>
  const claudeAuth = await readClaudeAuthDocument().catch(() => null)
  const fallbackKey = await resolveClaudeFallbackApiKey()
  const resolvedEnv = resolveClaudeDesktopEnv({
    currentEnv,
    authDocument: claudeAuth,
    fallbackApiKey: fallbackKey,
    defaultBaseUrl: DEFAULT_CLAUDE_BASE_URL,
  })
  const changed = JSON.stringify(resolvedEnv) !== JSON.stringify(currentEnv)
  const nextDocument: ClaudeSettingsDocument = {
    ...parsed,
    env: resolvedEnv,
  }

  if (changed) {
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, JSON.stringify(nextDocument, null, 2), 'utf8')
  }

  return nextDocument
}

function buildClaudeCliEnv(
  runtime: NodeRuntimeInfo | null,
  settings?: ClaudeSettingsDocument | null
) {
  const baseEnv: NodeJS.ProcessEnv = buildCliExecutionEnv(runtime)
  const nextEnv = { ...baseEnv }
  delete nextEnv.ANTHROPIC_AUTH_TOKEN
  delete nextEnv.ONEAPI_ORIGINAL_ANTHROPIC_AUTH_TOKEN
  const configEnv = settings?.env || {}

  for (const [key, value] of Object.entries(configEnv)) {
    if (key === 'ANTHROPIC_AUTH_TOKEN' || key === 'ONEAPI_ORIGINAL_ANTHROPIC_AUTH_TOKEN') {
      continue
    }
    if (typeof value === 'string' && value.trim()) {
      nextEnv[key] = value
    }
  }

  const apiKey = pickClaudeApiKey(configEnv)
  if (apiKey) {
    const normalizedKey = resolveDesktopCliKeyRecord(apiKey)
    nextEnv.ANTHROPIC_API_KEY = normalizedKey
  }

  if (configEnv.ANTHROPIC_BASE_URL?.trim()) {
    nextEnv.ANTHROPIC_BASE_URL = normalizeClaudeBaseUrl(configEnv.ANTHROPIC_BASE_URL)
  }
  delete nextEnv.ANTHROPIC_AUTH_TOKEN
  delete nextEnv.ONEAPI_ORIGINAL_ANTHROPIC_AUTH_TOKEN

  return nextEnv
}

function buildCodexCliEnv(
  runtime: NodeRuntimeInfo | null,
  claudeSettings?: ClaudeSettingsDocument | null
) {
  return buildClaudeCliEnv(runtime, claudeSettings)
}

function applyClaudeApiEnvironmentToProcess(apiKey: string, baseUrl: string) {
  process.env.ANTHROPIC_API_KEY = apiKey
  delete process.env.ANTHROPIC_AUTH_TOKEN
  process.env.ANTHROPIC_BASE_URL = baseUrl
  process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  process.env.API_TIMEOUT_MS = '600000'
}

function quotePosixShellValue(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function upsertShellEnvSource(profilePath: string, sourcePath: string) {
  const markerStart = '# >>> OneAPI Claude env >>>'
  const markerEnd = '# <<< OneAPI Claude env <<<'
  const block = [
    markerStart,
    `[ -f ${quotePosixShellValue(sourcePath)} ] && . ${quotePosixShellValue(sourcePath)}`,
    markerEnd,
  ].join('\n')
  const current = await fs.readFile(profilePath, 'utf8').catch(() => '')
  const next = current.includes(markerStart)
    ? current.replace(
        new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`),
        block
      )
    : `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${block}\n`
  if (next !== current) {
    await fs.writeFile(profilePath, next, 'utf8')
  }
}

async function persistPosixClaudeApiEnvironment(apiKey: string, baseUrl: string) {
  const envPath = path.join(os.homedir(), '.oneapi-claude-env')
  const content = [
    `export ANTHROPIC_API_KEY=${quotePosixShellValue(apiKey)}`,
    'unset ANTHROPIC_AUTH_TOKEN',
    `export ANTHROPIC_BASE_URL=${quotePosixShellValue(baseUrl)}`,
    `export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`,
    `export API_TIMEOUT_MS=600000`,
    '',
  ].join('\n')
  await fs.writeFile(envPath, content, { encoding: 'utf8', mode: 0o600 })
  await fs.chmod(envPath, 0o600).catch(() => undefined)
  await upsertShellEnvSource(path.join(os.homedir(), '.zshenv'), envPath)
  await upsertShellEnvSource(path.join(os.homedir(), '.bash_profile'), envPath)
  await runCommand('launchctl', ['setenv', 'ANTHROPIC_API_KEY', apiKey], { timeoutMs: 10000 }).catch(() => null)
  await runCommand('launchctl', ['unsetenv', 'ANTHROPIC_AUTH_TOKEN'], { timeoutMs: 10000 }).catch(() => null)
  await runCommand('launchctl', ['setenv', 'ANTHROPIC_BASE_URL', baseUrl], { timeoutMs: 10000 }).catch(() => null)
}

async function persistWindowsClaudeApiEnvironment(apiKey: string, baseUrl: string) {
  const script = [
    '$values = @{',
    '  ANTHROPIC_API_KEY = $env:ONEAPI_ANTHROPIC_API_KEY',
    '  ANTHROPIC_AUTH_TOKEN = $null',
    '  ANTHROPIC_BASE_URL = $env:ONEAPI_ANTHROPIC_BASE_URL',
    '  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1"',
    '  API_TIMEOUT_MS = "600000"',
    '}',
    'foreach ($item in $values.GetEnumerator()) {',
    '  [Environment]::SetEnvironmentVariable($item.Key, $item.Value, "User")',
    '}',
  ].join('\n')
  const result = await spawnCommandWithHandlers('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ], {
    timeoutMs: 15000,
    env: {
      ONEAPI_ANTHROPIC_API_KEY: apiKey,
      ONEAPI_ANTHROPIC_BASE_URL: baseUrl,
    },
  })
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || '写入 Windows 用户环境变量失败')
  }
}

async function persistClaudeApiEnvironment(apiKey: string, baseUrl: string) {
  applyClaudeApiEnvironmentToProcess(apiKey, baseUrl)
  if (process.platform === 'win32') {
    await persistWindowsClaudeApiEnvironment(apiKey, baseUrl)
  } else if (process.platform === 'darwin') {
    await persistPosixClaudeApiEnvironment(apiKey, baseUrl)
  }
}

function normalizeCliExtensionId(
  client: 'codex' | 'claude',
  kind: 'skill' | 'command' | 'plugin',
  name: string,
  targetPath: string
) {
  return `${client}:${kind}:${name.trim().toLowerCase()}:${targetPath.trim().toLowerCase()}`
}

async function readPluginManifest(targetPath: string) {
  const raw = await fs.readFile(targetPath, 'utf8').catch(() => '')
  if (!raw.trim()) {
    return null
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

type LocalClaudeMarketplaceManifest = {
  name?: string
  id?: string
  owner?: {
    name?: string
    email?: string
  }
  plugins?: Array<Record<string, unknown>>
}

type ClaudeMarketplaceInstallInfo = {
  scope?: string
  installPath?: string
  version?: string
  installedAt?: string
  lastUpdated?: string
  gitCommitSha?: string
}

type CodexCuratedSkillCatalogEntry = {
  id: string
  name: string
  description: string
  sourceRoot: string
}

type CodexMarketplaceSource = {
  marketplace: string
  sourceRoot: string
}

function readTomlSectionBoolean(lines: string[], key: string) {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*(true|false)\\s*$`, 'i')
  for (const line of lines) {
    const match = line.match(pattern)
    if (match) {
      return match[1].toLowerCase() === 'true'
    }
  }
  return false
}

function isOfficialAuthorName(value: unknown) {
  if (typeof value !== 'string') {
    return false
  }
  const normalized = value.trim().toLowerCase()
  return normalized === 'openai' || normalized === 'anthropic'
}

function readCodexEnabledPluginKeys(raw: string) {
  const parsed = parseTomlDocument(raw)
  const enabledKeys = new Set<string>()

  for (const section of parsed.sections) {
    const match = section.header.match(/^plugins\."(.+)"$/)
    if (!match) {
      continue
    }
    if (readTomlSectionBoolean(section.lines, 'enabled')) {
      enabledKeys.add(match[1].trim())
    }
  }

  return enabledKeys
}

function mergeCodexPluginEnabled(raw: string, installKey: string) {
  const parsed = parseTomlDocument(raw)
  const targetHeader = `plugins."${installKey}"`
  let updated = false
  const nextSections = parsed.sections.map((section) => {
    if (section.header !== targetHeader) {
      return section
    }
    updated = true
    return {
      header: targetHeader,
      lines: [`[${targetHeader}]`, 'enabled = true'],
    } satisfies TomlSectionBlock
  })

  if (!updated) {
    nextSections.push({
      header: targetHeader,
      lines: [`[${targetHeader}]`, 'enabled = true'],
    })
  }

  return serializeTomlDocument(parsed.preamble, nextSections)
}

function normalizeCliInstallName(value: string) {
  return value.trim().toLowerCase()
}

function buildCodexCuratedSkillInstallKey(name: string) {
  return `codex-curated-skill:${normalizeCliInstallName(name)}`
}

function isCodexCuratedSkillInstallKey(value?: string) {
  return value?.startsWith('codex-curated-skill:') || false
}

function normalizeCodexLocalPath(value: string) {
  return value.trim().replace(/^\\\\\?\\/, '').replace(/^['"]|['"]$/g, '')
}

function isPathInside(targetPath: string, parentPath: string) {
  const normalizedTarget = path.resolve(targetPath)
  const normalizedParent = path.resolve(parentPath)
  return normalizedTarget === normalizedParent || normalizedTarget.startsWith(`${normalizedParent}${path.sep}`)
}

async function readCodexCuratedSkillCatalog(): Promise<CodexCuratedSkillCatalogEntry[]> {
  const cachePath = path.join(cliConfig.codex.dataPath, 'vendor_imports', 'skills-curated-cache.json')
  const vendorRoot = path.join(cliConfig.codex.dataPath, 'vendor_imports', 'skills')
  const raw = await fs.readFile(cachePath, 'utf8').catch(() => '')
  if (!raw.trim()) {
    return []
  }

  let document: {
    skills?: Array<Record<string, unknown>>
  }
  try {
    document = JSON.parse(raw) as {
      skills?: Array<Record<string, unknown>>
    }
  } catch {
    return []
  }

  const skills = Array.isArray(document.skills) ? document.skills : []
  const resolved = await Promise.all(
    skills.map(async (item) => {
      const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : ''
      const id =
        (typeof item.id === 'string' && item.id.trim()) ||
        name
      const repoPath =
        (typeof item.repoPath === 'string' && item.repoPath.trim()) ||
        `skills/.curated/${id}`
      const sourceRoot = path.join(vendorRoot, repoPath)
      if (!name || !(await pathExists(sourceRoot))) {
        return null
      }
      return {
        id,
        name,
        description:
          (typeof item.description === 'string' && item.description.trim()) ||
          (typeof item.shortDescription === 'string' && item.shortDescription.trim()) ||
          '',
        sourceRoot,
      } satisfies CodexCuratedSkillCatalogEntry
    })
  )

  return resolved.filter((item): item is CodexCuratedSkillCatalogEntry => !!item)
}

async function readBundledCodexCuratedSkillCatalog() {
  return readBundledCliCatalogFile<BundledCodexCuratedSkillCatalog>('codex-curated-skills.json')
}

async function readBundledCodexPublicMarketplaceCatalog() {
  return readBundledCliCatalogFile<BundledPluginMarketplaceCatalog>('codex-public-marketplace.json')
}

async function readBundledClaudeOfficialMarketplaceCatalog() {
  return readBundledCliCatalogFile<BundledPluginMarketplaceCatalog>('claude-official-marketplace.json')
}

function readCodexMarketplaceSources(raw: string) {
  const parsed = parseTomlDocument(raw)
  const sources: CodexMarketplaceSource[] = []

  for (const section of parsed.sections) {
    const match = section.header.match(/^marketplaces\.(.+)$/)
    if (!match) {
      continue
    }
    const marketplace = match[1].trim()
    const sourceType = readTomlSectionString(section.lines, 'source_type').trim().toLowerCase()
    const sourceRoot = normalizeCodexLocalPath(readTomlSectionString(section.lines, 'source'))
    if (sourceType !== 'local' || !marketplace || !sourceRoot) {
      continue
    }
    sources.push({
      marketplace,
      sourceRoot,
    })
  }

  return sources
}

async function listCodexMarketplaceExtensionsFromSource(
  source: CodexMarketplaceSource,
  enabledPluginKeys: Set<string>
) {
  const manifestPath = path.join(source.sourceRoot, '.agents', 'plugins', 'marketplace.json')
  const raw = await fs.readFile(manifestPath, 'utf8').catch(() => '')
  if (!raw.trim()) {
    return []
  }

  let document: {
    plugins?: Array<Record<string, unknown>>
  }
  try {
    document = JSON.parse(raw) as {
      plugins?: Array<Record<string, unknown>>
    }
  } catch {
    return []
  }

  const entries: CliExtensionEntry[] = []
  const plugins = Array.isArray(document.plugins) ? document.plugins : []
  for (const plugin of plugins) {
    const sourceValue = plugin.source
    const relativePath =
      typeof sourceValue === 'string'
        ? sourceValue.trim()
        : sourceValue && typeof sourceValue === 'object' && typeof (sourceValue as Record<string, unknown>).path === 'string'
          ? ((sourceValue as Record<string, unknown>).path as string).trim()
          : ''
    if (!relativePath) {
      continue
    }

    const pluginRoot = path.join(source.sourceRoot, relativePath)
    const pluginManifestPath = path.join(pluginRoot, '.codex-plugin', 'plugin.json')
    if (!(await pathExists(pluginManifestPath))) {
      continue
    }

    const manifest = await readPluginManifest(pluginManifestPath)
    const meta = resolveCodexPluginMeta(manifest, pluginRoot, source.marketplace)
    const installed = enabledPluginKeys.has(meta.installKey)
    const pluginId = normalizeCliExtensionId('codex', 'plugin', meta.pluginName, meta.installKey)
    entries.push({
      id: pluginId,
      client: 'codex',
      kind: 'plugin',
      name: meta.manifestName,
      description: meta.description,
      path: pluginRoot,
      source: source.marketplace,
      marketplace: source.marketplace,
      installed,
      official: meta.official,
      installable: !installed,
      installKey: meta.installKey,
    })

    const skillsDir = path.join(pluginRoot, 'skills')
    if (installed && await pathExists(skillsDir)) {
      entries.push(...await listSkillEntriesFromRoot({
        client: 'codex',
        root: skillsDir,
        sourceLabel: meta.manifestName,
        marketplace: source.marketplace,
        installed,
        official: meta.official,
        installable: false,
        installKey: meta.installKey,
        parentPluginId: pluginId,
        parentPluginName: meta.manifestName,
        relativeRootForFallback: skillsDir,
      }))
    }
  }

  return entries
}

async function listCodexCachedExtensions(enabledPluginKeys: Set<string>) {
  const pluginsCacheRoot = path.join(cliConfig.codex.dataPath, 'plugins', 'cache')
  const entries: CliExtensionEntry[] = []
  if (!(await pathExists(pluginsCacheRoot))) {
    return entries
  }

  const manifestPaths = await walkFiles(
    pluginsCacheRoot,
    (filePath) =>
      path.basename(filePath).toLowerCase() === 'plugin.json' &&
      filePath.toLowerCase().includes(`${path.sep}.codex-plugin${path.sep}`.toLowerCase())
  )

  for (const manifestPath of manifestPaths) {
    const pluginRoot = path.dirname(path.dirname(manifestPath))
    const marketplace = path.relative(pluginsCacheRoot, pluginRoot).split(/[\\/]/).filter(Boolean)[0] || 'cache'
    const manifest = await readPluginManifest(manifestPath)
    const meta = resolveCodexPluginMeta(manifest, pluginRoot, marketplace)
    const installed = enabledPluginKeys.has(meta.installKey)
    const pluginId = normalizeCliExtensionId('codex', 'plugin', meta.pluginName, meta.installKey)
    entries.push({
      id: pluginId,
      client: 'codex',
      kind: 'plugin',
      name: meta.manifestName,
      description: meta.description,
      path: pluginRoot,
      source: marketplace,
      marketplace,
      installed,
      official: meta.official,
      installable: !installed,
      installKey: meta.installKey,
    })

    const skillsDir = path.join(pluginRoot, 'skills')
    if (installed && await pathExists(skillsDir)) {
      entries.push(...await listSkillEntriesFromRoot({
        client: 'codex',
        root: skillsDir,
        sourceLabel: meta.manifestName,
        marketplace,
        installed,
        official: meta.official,
        installable: false,
        installKey: meta.installKey,
        parentPluginId: pluginId,
        parentPluginName: meta.manifestName,
        relativeRootForFallback: skillsDir,
      }))
    }
  }

  return entries
}

async function listSkillEntriesFromRoot(options: {
  client: CliClient
  root: string
  sourceLabel: string
  marketplace?: string
  installed: boolean
  official: boolean
  installable: boolean
  installKey?: string
  parentPluginId?: string
  parentPluginName?: string
  relativeRootForFallback?: string
}) {
  const files = await walkFiles(options.root, (filePath) => path.basename(filePath).toUpperCase() === 'SKILL.MD')
  const entries = await Promise.all(
    files.map(async (filePath) => {
      const raw = await fs.readFile(filePath, 'utf8').catch(() => '')
      const meta = parseMarkdownFrontmatterMeta(raw)
      const relativePath = path.relative(options.relativeRootForFallback || options.root, filePath)
      const skillRoot = path.dirname(filePath)
      const fallbackName = relativePath.split(/[\\/]/).filter(Boolean).at(-2) || path.basename(skillRoot)
      return {
        id: normalizeCliExtensionId(options.client, 'skill', meta.name || fallbackName, skillRoot),
        client: options.client,
        kind: 'skill' as const,
        name: meta.name || fallbackName,
        description: meta.description,
        path: skillRoot,
        source: options.sourceLabel,
        marketplace: options.marketplace,
        installed: options.installed,
        official: options.official,
        installable: options.installable,
        installKey: options.installKey,
        parentPluginId: options.parentPluginId,
        parentPluginName: options.parentPluginName,
      } satisfies CliExtensionEntry
    })
  )

  return entries
}

async function listCommandEntriesFromRoot(options: {
  root: string
  sourceLabel: string
  marketplace?: string
  installed: boolean
  official: boolean
  installable: boolean
  installKey?: string
  parentPluginId?: string
  parentPluginName?: string
}) {
  const files = await walkFiles(options.root, (filePath) => path.extname(filePath).toLowerCase() === '.md')
  const entries = await Promise.all(
    files.map(async (filePath) => {
      const raw = await fs.readFile(filePath, 'utf8').catch(() => '')
      const meta = parseMarkdownFrontmatterMeta(raw)
      const commandName = meta.name || path.basename(filePath, path.extname(filePath))
      return {
        id: normalizeCliExtensionId('claude', 'command', commandName, filePath),
        client: 'claude' as const,
        kind: 'command' as const,
        name: commandName,
        description: meta.description,
        path: filePath,
        source: options.sourceLabel,
        marketplace: options.marketplace,
        installed: options.installed,
        official: options.official,
        installable: options.installable,
        installKey: options.installKey,
        parentPluginId: options.parentPluginId,
        parentPluginName: options.parentPluginName,
      } satisfies CliExtensionEntry
    })
  )

  return entries
}

function resolveCodexPluginMeta(
  manifest: Record<string, unknown> | null,
  pluginRoot: string,
  marketplace: string
) {
  const interfaceSection =
    manifest && typeof manifest.interface === 'object' && manifest.interface
      ? (manifest.interface as Record<string, unknown>)
      : null
  const authorSection =
    manifest && typeof manifest.author === 'object' && manifest.author
      ? (manifest.author as Record<string, unknown>)
      : null
  const manifestName =
    (interfaceSection && typeof interfaceSection.displayName === 'string' && interfaceSection.displayName.trim()) ||
    (manifest && typeof manifest.name === 'string' && manifest.name.trim()) ||
    path.basename(pluginRoot)
  const pluginName =
    (manifest && typeof manifest.name === 'string' && manifest.name.trim()) || manifestName
  const description =
    (interfaceSection && typeof interfaceSection.shortDescription === 'string' && interfaceSection.shortDescription.trim()) ||
    (manifest && typeof manifest.description === 'string' && manifest.description.trim()) ||
    ''
  const authorName =
    (interfaceSection && typeof interfaceSection.developerName === 'string' && interfaceSection.developerName.trim()) ||
    (authorSection && typeof authorSection.name === 'string' && authorSection.name.trim()) ||
    ''

  return {
    manifestName,
    pluginName,
    description,
    authorName,
    official: isOfficialAuthorName(authorName),
    installKey: `${pluginName}@${marketplace}`,
  }
}

async function listCodexExtensions(): Promise<CliExtensionEntry[]> {
  const configRaw = await fs.readFile(cliConfig.codex.configPath, 'utf8').catch(() => '')
  const enabledPluginKeys = readCodexEnabledPluginKeys(configRaw)
  const skillsRoot = path.join(cliConfig.codex.dataPath, 'skills')
  const entries: CliExtensionEntry[] = []
  const curatedCatalog = await readCodexCuratedSkillCatalog()
  const bundledCuratedCatalog = await readBundledCodexCuratedSkillCatalog()
  const curatedByKey = curatedCatalog.reduce<Map<string, CodexCuratedSkillCatalogEntry>>((map, item) => {
    map.set(normalizeCliInstallName(item.name), item)
    map.set(normalizeCliInstallName(path.basename(item.sourceRoot)), item)
    return map
  }, new Map())
  const installedCuratedKeys = new Set<string>()

  if (await pathExists(skillsRoot)) {
    const localSkillEntries = await listSkillEntriesFromRoot({
      client: 'codex',
      root: skillsRoot,
      sourceLabel: '本地技能',
      installed: true,
      official: false,
      installable: false,
      relativeRootForFallback: skillsRoot,
    })
    for (const entry of localSkillEntries) {
      if (entry.path.toLowerCase().includes(`${path.sep}.system${path.sep}`.toLowerCase())) {
        entry.source = '系统'
        entry.official = true
        continue
      }

      const curated =
        curatedByKey.get(normalizeCliInstallName(entry.name)) ||
        curatedByKey.get(normalizeCliInstallName(path.basename(entry.path)))
      if (curated) {
        entry.source = '官方技能'
        entry.official = true
        entry.installKey = buildCodexCuratedSkillInstallKey(curated.name)
        installedCuratedKeys.add(normalizeCliInstallName(curated.name))
      }
    }
    entries.push(...localSkillEntries)
  }

  for (const curated of curatedCatalog) {
    const curatedKey = normalizeCliInstallName(curated.name)
    if (installedCuratedKeys.has(curatedKey)) {
      continue
    }
    entries.push({
      id: normalizeCliExtensionId('codex', 'skill', curated.name, curated.sourceRoot),
      client: 'codex',
      kind: 'skill',
      name: curated.name,
      description: curated.description,
      path: curated.sourceRoot,
      source: '官方技能',
      installed: false,
      official: true,
      installable: true,
      installKey: buildCodexCuratedSkillInstallKey(curated.name),
    })
  }

  if (bundledCuratedCatalog) {
    entries.push(
      ...buildBundledCodexCuratedSkillEntries(
        bundledCuratedCatalog,
        installedCuratedKeys
      )
    )
  }

  for (const source of readCodexMarketplaceSources(configRaw)) {
    entries.push(...await listCodexMarketplaceExtensionsFromSource(source, enabledPluginKeys))
  }

  const bundledPublicMarketplace = await readBundledCodexPublicMarketplaceCatalog()
  if (bundledPublicMarketplace) {
    entries.push(...buildBundledMarketplaceEntries('codex', bundledPublicMarketplace, enabledPluginKeys))
  }

  entries.push(...await listCodexCachedExtensions(enabledPluginKeys))

  return entries
}

async function readInstalledClaudePluginsDocument() {
  const registryPath = path.join(cliConfig.claude.dataPath, 'plugins', 'installed_plugins.json')
  const raw = await fs.readFile(registryPath, 'utf8').catch(() => '')
  if (!raw.trim()) {
    return {
      registryPath,
      document: {
        version: 2,
        plugins: {},
      } satisfies ClaudeInstalledPluginsDocument,
    }
  }

  try {
    return {
      registryPath,
      document: JSON.parse(raw) as ClaudeInstalledPluginsDocument,
    }
  } catch {
    return {
      registryPath,
      document: {
        version: 2,
        plugins: {},
      } satisfies ClaudeInstalledPluginsDocument,
    }
  }
}

async function listClaudeInstalledExtensions() {
  const entries: CliExtensionEntry[] = []
  const commandsRoot = path.join(cliConfig.claude.dataPath, 'commands')
  if (await pathExists(commandsRoot)) {
    entries.push(...await listCommandEntriesFromRoot({
      root: commandsRoot,
      sourceLabel: '本地命令',
      installed: true,
      official: false,
      installable: false,
    }))
  }

  const { document } = await readInstalledClaudePluginsDocument()
  const pluginGroups = document.plugins || {}
  for (const [pluginKey, installs] of Object.entries(pluginGroups)) {
    for (const [index, installInfo] of installs.entries()) {
      const installRoot = installInfo.installPath?.trim() || ''
      if (!installRoot) {
        continue
      }
      const manifest = await readPluginManifest(path.join(installRoot, '.claude-plugin', 'plugin.json'))
      const authorSection =
        manifest && typeof manifest.author === 'object' && manifest.author
          ? (manifest.author as Record<string, unknown>)
          : null
      const manifestName =
        (manifest && typeof manifest.name === 'string' && manifest.name.trim()) ||
        pluginKey.split('@')[0] ||
        path.basename(installRoot)
      const description =
        (manifest && typeof manifest.description === 'string' && manifest.description.trim()) || ''
      const authorName =
        (authorSection && typeof authorSection.name === 'string' && authorSection.name.trim()) || ''
      const [pluginName, marketplace = 'installed'] = pluginKey.split('@')
      const pluginId = normalizeCliExtensionId('claude', 'plugin', `${pluginName}:${index}`, installRoot)
      entries.push({
        id: pluginId,
        client: 'claude',
        kind: 'plugin',
        name: manifestName,
        description,
        path: installRoot,
        source: pluginKey,
        marketplace,
        installed: true,
        official: isOfficialAuthorName(authorName),
        installable: false,
        installKey: pluginKey,
      })

      const skillsDir = path.join(installRoot, 'skills')
      if (await pathExists(skillsDir)) {
        entries.push(...await listSkillEntriesFromRoot({
          client: 'claude',
          root: skillsDir,
          sourceLabel: manifestName,
          marketplace,
          installed: true,
          official: isOfficialAuthorName(authorName),
          installable: false,
          installKey: pluginKey,
          parentPluginId: pluginId,
          parentPluginName: manifestName,
          relativeRootForFallback: skillsDir,
        }))
      }

      const pluginCommandsDir = path.join(installRoot, 'commands')
      if (await pathExists(pluginCommandsDir)) {
        entries.push(...await listCommandEntriesFromRoot({
          root: pluginCommandsDir,
          sourceLabel: manifestName,
          marketplace,
          installed: true,
          official: isOfficialAuthorName(authorName),
          installable: false,
          installKey: pluginKey,
          parentPluginId: pluginId,
          parentPluginName: manifestName,
        }))
      }
    }
  }

  return entries
}

async function listClaudeMarketplaceExtensions() {
  const marketplacesRoot = path.join(cliConfig.claude.dataPath, 'plugins', 'marketplaces')
  const { document } = await readInstalledClaudePluginsDocument()
  const installedPluginKeys = new Set(Object.keys(document.plugins || {}))
  const entries: CliExtensionEntry[] = []
  if (await pathExists(marketplacesRoot)) {
    const marketplaceNames = await fs.readdir(marketplacesRoot).catch(() => [] as string[])

    for (const marketplaceName of marketplaceNames) {
      const marketplaceRoot = path.join(marketplacesRoot, marketplaceName)
      const marketplaceManifestPath = path.join(marketplaceRoot, '.claude-plugin', 'marketplace.json')
      if (!(await pathExists(marketplaceManifestPath))) {
        continue
      }
      const raw = await fs.readFile(marketplaceManifestPath, 'utf8').catch(() => '')
      if (!raw.trim()) {
        continue
      }

      const marketplaceManifest = (() => {
        try {
          return JSON.parse(raw) as LocalClaudeMarketplaceManifest
        } catch {
          return null
        }
      })()
      if (!marketplaceManifest?.plugins?.length) {
        continue
      }

      for (const plugin of marketplaceManifest.plugins) {
        const pluginName = typeof plugin.name === 'string' && plugin.name.trim() ? plugin.name.trim() : ''
        if (!pluginName) {
          continue
        }
        const installKey = `${pluginName}@${marketplaceName}`
        const installed = installedPluginKeys.has(installKey)
        const description = typeof plugin.description === 'string' ? plugin.description.trim() : ''
        const authorSection =
          typeof plugin.author === 'object' && plugin.author ? (plugin.author as Record<string, unknown>) : null
        const sourceValue = plugin.source
        const sourceLabel = `${marketplaceName}`
        const official =
          isOfficialAuthorName(authorSection?.name) ||
          (typeof sourceValue === 'string' && sourceValue.startsWith('./plugins/'))
        const pluginPathHint =
          typeof sourceValue === 'string' && sourceValue.trim()
            ? path.join(marketplaceRoot, sourceValue)
            : marketplaceRoot
        const pluginId = normalizeCliExtensionId('claude', 'plugin', pluginName, installKey)

        entries.push({
          id: pluginId,
          client: 'claude',
          kind: 'plugin',
          name: pluginName,
          description,
          path: pluginPathHint,
          source: sourceLabel,
          marketplace: marketplaceName,
          installed,
          official,
          installable: !installed,
          installKey,
        })

        // 未安装的市场插件只展示插件本体。子技能/命令只有安装后才是可调用对象，
        // 提前展开会造成同名 configure 等条目重复出现，并让安装状态看起来互相串联。
      }
    }
  }

  const bundledOfficialMarketplace = await readBundledClaudeOfficialMarketplaceCatalog()
  if (bundledOfficialMarketplace) {
    entries.push(...buildBundledMarketplaceEntries('claude', bundledOfficialMarketplace, installedPluginKeys))
  }

  return entries
}

async function listCliExtensions(client: CliClient): Promise<CliExtensionEntry[]> {
  const entries = client === 'codex'
    ? await listCodexExtensions()
    : [...await listClaudeInstalledExtensions(), ...await listClaudeMarketplaceExtensions()]

  const unique = new Map<string, CliExtensionEntry>()
  for (const item of entries) {
    const dedupeKey = buildCliExtensionDedupeKey(item)
    const existing = unique.get(dedupeKey)
    if (!existing) {
      unique.set(dedupeKey, item)
      continue
    }
    const existingInstalled = existing.installed !== false
    const itemInstalled = item.installed !== false
    const existingInCache = isPathInside(existing.path, path.join(cliConfig.codex.dataPath, 'plugins', 'cache'))
    const itemInCache = isPathInside(item.path, path.join(cliConfig.codex.dataPath, 'plugins', 'cache'))
    if (!existingInstalled && itemInstalled) {
      unique.set(dedupeKey, item)
      continue
    }
    if (existingInstalled === itemInstalled && !existingInCache && itemInCache) {
      unique.set(dedupeKey, item)
      continue
    }
    if (existingInstalled === itemInstalled && !existing.official && !!item.official) {
      unique.set(dedupeKey, item)
    }
  }
  return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name))
}

async function installCodexCuratedSkill(entry: CliExtensionEntry): Promise<CliExtensionInstallResult> {
  const sourceRoot = entry.path.trim()
  const skillFilePath = path.join(sourceRoot, 'SKILL.md')
  let resolvedSourceRoot = sourceRoot
  let tempRoot = ''

  try {
    if (!resolvedSourceRoot || !(await pathExists(skillFilePath))) {
      const catalogSource = entry.catalogSource
      if (!catalogSource?.repoUrl || !catalogSource.subdir) {
        return {
          success: false,
          message: '未找到可安装的官方技能目录。',
        }
      }
      tempRoot = path.join(os.tmpdir(), 'oneapi-codex-skill-install', randomUUID())
      resolvedSourceRoot = await cloneGitRepoSubdir(catalogSource.repoUrl, tempRoot, {
        ref: catalogSource.sha || catalogSource.ref,
        subdir: catalogSource.subdir,
      })
    }

    const targetDirName = path.basename(resolvedSourceRoot)
    const targetRoot = path.join(cliConfig.codex.dataPath, 'skills', targetDirName)
    await fs.rm(targetRoot, { recursive: true, force: true })
    await fs.mkdir(path.dirname(targetRoot), { recursive: true })
    await fs.cp(resolvedSourceRoot, targetRoot, { recursive: true })
  } finally {
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }
  return {
    success: true,
    message: '安装完成。下次发送消息时将自动生效，无需重启当前客户端。',
  }
}

async function installCodexMarketplacePlugin(entry: CliExtensionEntry): Promise<CliExtensionInstallResult> {
  const installKey = entry.installKey?.trim() || ''
  if (!installKey) {
    return {
      success: false,
      message: '缺少可安装的插件标识。',
    }
  }

  let sourceRoot = entry.path.trim()
  const cacheRoot = path.join(cliConfig.codex.dataPath, 'plugins', 'cache')
  let tempRoot = ''
  try {
    const manifestPath = path.join(sourceRoot, '.codex-plugin', 'plugin.json')
    if (!sourceRoot || !(await pathExists(manifestPath))) {
      const catalogSource = entry.catalogSource
      if (!catalogSource?.repoUrl || !catalogSource.subdir) {
        return {
          success: false,
          message: '未找到可安装的插件目录。',
        }
      }
      tempRoot = path.join(os.tmpdir(), 'oneapi-codex-plugin-install', randomUUID())
      sourceRoot = await cloneGitRepoSubdir(catalogSource.repoUrl, tempRoot, {
        ref: catalogSource.sha || catalogSource.ref,
        subdir: catalogSource.subdir,
      })
    }

    if (sourceRoot && !isPathInside(sourceRoot, cacheRoot)) {
      const manifest = await readPluginManifest(path.join(sourceRoot, '.codex-plugin', 'plugin.json'))
      const pluginName =
        (manifest && typeof manifest.name === 'string' && manifest.name.trim()) ||
        installKey.split('@')[0] ||
        path.basename(sourceRoot)
      const versionToken =
        (entry.catalogSource?.sha?.trim()) ||
        (manifest && typeof manifest.version === 'string' && manifest.version.trim()) ||
        path.basename(sourceRoot) ||
        `${Date.now()}`
      const marketplace = entry.marketplace?.trim() || installKey.split('@')[1] || 'marketplace'
      const installPath = path.join(cacheRoot, marketplace, pluginName, versionToken)
      await fs.rm(installPath, { recursive: true, force: true })
      await fs.mkdir(path.dirname(installPath), { recursive: true })
      await fs.cp(sourceRoot, installPath, { recursive: true })
    }
  } finally {
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  const currentRaw = await fs.readFile(cliConfig.codex.configPath, 'utf8').catch(() => '')
  const nextRaw = mergeCodexPluginEnabled(currentRaw, installKey)
  await fs.mkdir(path.dirname(cliConfig.codex.configPath), { recursive: true })
  await fs.writeFile(cliConfig.codex.configPath, nextRaw, 'utf8')
  return {
    success: true,
    message: '安装完成。下次发送消息时将自动生效，无需重启当前客户端。',
  }
}

function normalizeMarketplaceGitUrl(value: string) {
  const normalized = value.trim()
  if (!normalized) {
    return normalized
  }
  if (/^(https?:\/\/|git@)/i.test(normalized)) {
    return normalized
  }
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
    return `https://github.com/${normalized}.git`
  }
  return normalized
}

function isGitCommitish(value: string) {
  return /^[0-9a-f]{7,40}$/i.test(value.trim())
}

function parseGitHubRepoSlug(repoUrl: string) {
  const normalized = repoUrl.trim().replace(/\.git(?:[#?].*)?$/i, '')
  const httpsMatch = normalized.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:[/#?].*)?$/i)
  if (httpsMatch) {
    return {
      owner: httpsMatch[1],
      repo: httpsMatch[2],
    }
  }

  const sshMatch = normalized.match(/^git@github\.com:([^/]+)\/([^/#?]+)$/i)
  if (sshMatch) {
    return {
      owner: sshMatch[1],
      repo: sshMatch[2],
    }
  }

  const shortMatch = normalized.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  if (shortMatch) {
    return {
      owner: shortMatch[1],
      repo: shortMatch[2],
    }
  }

  return null
}

function encodeGitHubArchiveRef(ref: string) {
  return ref
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
}

function buildGitHubArchiveUrl(repoUrl: string, ref: string, archiveType: 'tar.gz' | 'zip') {
  const slug = parseGitHubRepoSlug(repoUrl)
  const normalizedRef = ref.trim()
  if (!slug || !normalizedRef) {
    return ''
  }

  return `https://codeload.github.com/${slug.owner}/${slug.repo}/${archiveType}/${encodeGitHubArchiveRef(normalizedRef)}`
}

async function downloadUrlToFile(url: string, targetPath: string, timeoutMs = 180000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'OneAPI-Desktop',
      },
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    if (response.body) {
      await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(targetPath))
      return
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(targetPath, buffer)
  } finally {
    clearTimeout(timer)
  }
}

async function extractTarGzArchive(archivePath: string, extractRoot: string) {
  await clearDirectory(extractRoot)
  const extractResult = await spawnCommandWithHandlers(
    'tar',
    ['-xzf', archivePath, '-C', extractRoot, '--strip-components=1'],
    {
      timeoutMs: 300000,
    }
  )
  if (extractResult.exitCode !== 0) {
    throw new Error(extractResult.stderr.trim() || extractResult.stdout.trim() || '解压 tar.gz 归档失败。')
  }
}

async function extractZipArchive(archivePath: string, extractRoot: string) {
  await clearDirectory(extractRoot)
  if (process.platform === 'win32') {
    const extractResult = await spawnCommandWithHandlers(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${extractRoot.replace(/'/g, "''")}' -Force`,
      ],
      {
        timeoutMs: 300000,
      }
    )
    if (extractResult.exitCode !== 0) {
      throw new Error(extractResult.stderr.trim() || extractResult.stdout.trim() || '解压 zip 归档失败。')
    }
    await flattenSingleNestedDirectory(extractRoot)
    return
  }

  const extractResult = await spawnCommandWithHandlers('unzip', ['-q', archivePath, '-d', extractRoot], {
    timeoutMs: 300000,
  })
  if (extractResult.exitCode !== 0) {
    throw new Error(extractResult.stderr.trim() || extractResult.stdout.trim() || '解压 zip 归档失败。')
  }
  await flattenSingleNestedDirectory(extractRoot)
}

async function downloadGitHubArchiveSubdir(
  repoUrl: string,
  tempRoot: string,
  options: {
    ref?: string
    subdir?: string
  } = {}
) {
  const normalizedRef = options.ref?.trim() || ''
  if (!parseGitHubRepoSlug(repoUrl) || !normalizedRef) {
    return null
  }

  const extractRoot = path.join(tempRoot, 'repo-archive')
  const tarArchivePath = path.join(tempRoot, 'repo.tar.gz')
  const tarArchiveUrl = buildGitHubArchiveUrl(repoUrl, normalizedRef, 'tar.gz')
  try {
    await downloadUrlToFile(tarArchiveUrl, tarArchivePath)
    await extractTarGzArchive(tarArchivePath, extractRoot)
  } catch (tarError) {
    const zipArchivePath = path.join(tempRoot, 'repo.zip')
    const zipArchiveUrl = buildGitHubArchiveUrl(repoUrl, normalizedRef, 'zip')
    try {
      await downloadUrlToFile(zipArchiveUrl, zipArchivePath)
      await extractZipArchive(zipArchivePath, extractRoot)
    } catch (zipError) {
      throw new Error(
        `下载或解压 GitHub 归档失败。tar.gz: ${tarError instanceof Error ? tarError.message : String(tarError)}；zip: ${
          zipError instanceof Error ? zipError.message : String(zipError)
        }`,
        { cause: zipError }
      )
    }
  }

  const relativePath = options.subdir?.trim() ? options.subdir.trim() : ''
  const resolvedRoot = relativePath ? path.join(extractRoot, relativePath) : extractRoot
  if (!(await pathExists(resolvedRoot))) {
    throw new Error(`GitHub 归档中未找到目录：${relativePath || '.'}`)
  }
  return resolvedRoot
}

async function cloneGitRepoSubdir(
  repoUrl: string,
  tempRoot: string,
  options: {
    ref?: string
    subdir?: string
  } = {}
) {
  const normalizedUrl = normalizeMarketplaceGitUrl(repoUrl)
  if (!normalizedUrl) {
    throw new Error('缺少可用的仓库地址。')
  }

  const normalizedRef = options.ref?.trim() || ''
  let archiveError = ''
  try {
    const archiveSourceRoot = await downloadGitHubArchiveSubdir(normalizedUrl, tempRoot, {
      ref: normalizedRef,
      subdir: options.subdir,
    })
    if (archiveSourceRoot) {
      return archiveSourceRoot
    }
  } catch (error) {
    archiveError = error instanceof Error ? error.message : String(error)
  }

  const cloneTarget = path.join(tempRoot, 'repo')
  await fs.mkdir(tempRoot, { recursive: true })
  const cloneArgs = ['clone', '--depth', '1']
  if (normalizedRef && !isGitCommitish(normalizedRef)) {
    cloneArgs.push('--branch', normalizedRef)
  }
  cloneArgs.push(normalizedUrl, cloneTarget)
  const cloneResult = await spawnCommandWithHandlers('git', cloneArgs, {
    timeoutMs: 180000,
  })
  if (cloneResult.exitCode !== 0) {
    const gitError = cloneResult.stderr.trim() || cloneResult.stdout.trim() || '克隆仓库失败。'
    throw new Error(archiveError ? `${gitError}\n归档下载也失败：${archiveError}` : gitError)
  }

  if (normalizedRef && isGitCommitish(normalizedRef)) {
    let checkoutResult = await spawnCommandWithHandlers('git', ['-C', cloneTarget, 'checkout', normalizedRef], {
      timeoutMs: 180000,
    })
    if (checkoutResult.exitCode !== 0) {
      const fetchResult = await spawnCommandWithHandlers('git', ['-C', cloneTarget, 'fetch', '--depth', '1', 'origin', normalizedRef], {
        timeoutMs: 180000,
      })
      if (fetchResult.exitCode === 0) {
        checkoutResult = await spawnCommandWithHandlers('git', ['-C', cloneTarget, 'checkout', 'FETCH_HEAD'], {
          timeoutMs: 180000,
        })
      }
    }
    if (checkoutResult.exitCode !== 0) {
      throw new Error(checkoutResult.stderr.trim() || checkoutResult.stdout.trim() || '切换仓库版本失败。')
    }
  }

  const relativePath = options.subdir?.trim() ? options.subdir.trim() : ''
  const resolvedRoot = relativePath ? path.join(cloneTarget, relativePath) : cloneTarget
  if (!(await pathExists(resolvedRoot))) {
    throw new Error(`仓库中未找到目录：${relativePath || '.'}`)
  }
  return resolvedRoot
}

async function cloneClaudeMarketplaceSource(
  source: Record<string, unknown>,
  tempRoot: string,
  fallbackPath = ''
) {
  const rawUrl =
    (typeof source.url === 'string' && source.url.trim()) ||
    (typeof source.repo === 'string' && source.repo.trim()) ||
    ''
  const repoUrl = normalizeMarketplaceGitUrl(rawUrl)
  if (!repoUrl) {
    throw new Error('插件源缺少可用的仓库地址。')
  }
  const ref =
    (typeof source.sha === 'string' && source.sha.trim()) ||
    (typeof source.ref === 'string' && source.ref.trim()) ||
    ''
  const relativePath = typeof source.path === 'string' && source.path.trim() ? source.path.trim() : fallbackPath.trim()
  return cloneGitRepoSubdir(repoUrl, tempRoot, {
    ref,
    subdir: relativePath,
  })
}

async function resolveClaudeMarketplacePluginSource(pluginKey: string) {
  const [pluginName, marketplaceName] = pluginKey.split('@')
  if (!pluginName || !marketplaceName) {
    throw new Error('插件安装标识无效。')
  }

  const marketplaceRoot = path.join(cliConfig.claude.dataPath, 'plugins', 'marketplaces', marketplaceName)
  const marketplaceManifestPath = path.join(marketplaceRoot, '.claude-plugin', 'marketplace.json')
  const raw = await fs.readFile(marketplaceManifestPath, 'utf8').catch(() => '')
  if (!raw.trim()) {
    throw new Error('未找到插件市场清单。')
  }

  let marketplaceManifest: LocalClaudeMarketplaceManifest
  try {
    marketplaceManifest = JSON.parse(raw) as LocalClaudeMarketplaceManifest
  } catch {
    throw new Error('插件市场清单格式无效。')
  }

  const plugin = marketplaceManifest.plugins?.find((item) => {
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    return name === pluginName
  })
  if (!plugin) {
    throw new Error('未在插件市场中找到目标插件。')
  }

  const rawSource = plugin.source
  if (typeof rawSource === 'string' && rawSource.trim()) {
    const sourceRoot = path.join(marketplaceRoot, rawSource)
    return {
      plugin,
      pluginName,
      marketplaceName,
      sourceRoot,
      versionToken:
        (typeof plugin.version === 'string' && plugin.version.trim()) ||
        path.basename(sourceRoot) ||
        'local',
    }
  }

  if (rawSource && typeof rawSource === 'object') {
    const sourceSpec = rawSource as Record<string, unknown>
    const tempRoot = path.join(os.tmpdir(), 'oneapi-claude-plugin-install', randomUUID())
    const fallbackPath = typeof plugin.subdir === 'string' ? plugin.subdir.trim() : ''
    const sourceRoot = await cloneClaudeMarketplaceSource(sourceSpec, tempRoot, fallbackPath)
    return {
      plugin,
      pluginName,
      marketplaceName,
      sourceRoot,
      tempRoot,
      versionToken:
        (typeof sourceSpec.sha === 'string' && sourceSpec.sha.trim()) ||
        (typeof plugin.version === 'string' && plugin.version.trim()) ||
        (typeof sourceSpec.ref === 'string' && sourceSpec.ref.trim()) ||
        `${Date.now()}`,
    }
  }

  throw new Error('当前插件源不支持自动安装。')
}

async function resolveClaudeMarketplacePluginSourceFromCatalogEntry(entry: CliExtensionEntry) {
  const installKey = entry.installKey?.trim() || ''
  const [pluginName, marketplaceName] = installKey.split('@')
  const catalogSource = entry.catalogSource
  if (!pluginName || !marketplaceName || !catalogSource?.repoUrl) {
    return null
  }

  const rawSource = catalogSource.rawSource
  if (typeof rawSource === 'string' && rawSource.trim()) {
    const tempRoot = path.join(os.tmpdir(), 'oneapi-claude-plugin-install', randomUUID())
    const sourceRoot = await cloneGitRepoSubdir(catalogSource.repoUrl, tempRoot, {
      ref: catalogSource.sha || catalogSource.ref,
      subdir: catalogSource.subdir || rawSource,
    })
    return {
      pluginName,
      marketplaceName,
      sourceRoot,
      tempRoot,
      versionToken: catalogSource.sha || catalogSource.ref || `${Date.now()}`,
    }
  }

  if (rawSource && typeof rawSource === 'object') {
    const tempRoot = path.join(os.tmpdir(), 'oneapi-claude-plugin-install', randomUUID())
    const sourceRoot = await cloneClaudeMarketplaceSource(
      rawSource as Record<string, unknown>,
      tempRoot,
      catalogSource.subdir || ''
    )
    const sourceSpec = rawSource as Record<string, unknown>
    return {
      pluginName,
      marketplaceName,
      sourceRoot,
      tempRoot,
      versionToken:
        (typeof sourceSpec.sha === 'string' && sourceSpec.sha.trim()) ||
        (typeof sourceSpec.ref === 'string' && sourceSpec.ref.trim()) ||
        catalogSource.sha ||
        catalogSource.ref ||
        `${Date.now()}`,
    }
  }

  return null
}

async function installClaudeMarketplacePlugin(entry: CliExtensionEntry): Promise<CliExtensionInstallResult> {
  const installKey = entry.installKey?.trim() || ''
  if (!installKey) {
    return {
      success: false,
      message: '缺少可安装的插件标识。',
    }
  }

  const resolved =
    (await resolveClaudeMarketplacePluginSourceFromCatalogEntry(entry)) ||
    (await resolveClaudeMarketplacePluginSource(installKey))
  const installPath = path.join(
    cliConfig.claude.dataPath,
    'plugins',
    'cache',
    resolved.marketplaceName,
    resolved.pluginName,
    resolved.versionToken
  )

  try {
    await fs.rm(installPath, { recursive: true, force: true })
    await fs.mkdir(path.dirname(installPath), { recursive: true })
    await fs.cp(resolved.sourceRoot, installPath, { recursive: true })
  } finally {
    if (resolved.tempRoot) {
      await fs.rm(resolved.tempRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  const { registryPath, document } = await readInstalledClaudePluginsDocument()
  const currentInstalls = document.plugins?.[installKey] || []
  const nextInstall: ClaudeMarketplaceInstallInfo = {
    scope: 'user',
    installPath,
    version: resolved.versionToken,
    installedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    gitCommitSha: resolved.versionToken,
  }
  const nextDocument: ClaudeInstalledPluginsDocument = {
    version: document.version || 2,
    plugins: {
      ...(document.plugins || {}),
      [installKey]: [nextInstall, ...currentInstalls.filter((item) => item.installPath !== installPath)],
    },
  }
  await fs.mkdir(path.dirname(registryPath), { recursive: true })
  await fs.writeFile(registryPath, JSON.stringify(nextDocument, null, 2), 'utf8')

  return {
    success: true,
    message: '安装完成。下次发送消息时将自动生效，无需重启当前客户端。',
  }
}

async function installCliExtension(request: CliExtensionInstallRequest): Promise<CliExtensionInstallResult> {
  const currentEntries = await listCliExtensions(request.client)
  const entry = currentEntries.find((item) => item.id === request.extensionId)
  if (!entry) {
    return {
      success: false,
      message: '未找到目标技能或插件。',
    }
  }

  const installTarget =
    (entry.parentPluginId && currentEntries.find((item) => item.id === entry.parentPluginId)) ||
    entry

  if (installTarget.installed !== false) {
    return {
      success: true,
      message: '该技能或插件已经可用。',
    }
  }

  if (!installTarget.installable || !installTarget.installKey) {
    return {
      success: false,
      message: '当前条目不支持直接安装。',
    }
  }

  if (request.client === 'codex') {
    return isCodexCuratedSkillInstallKey(installTarget.installKey)
      ? installCodexCuratedSkill(installTarget)
      : installCodexMarketplacePlugin(installTarget)
  }

  return installClaudeMarketplacePlugin(installTarget)
}

async function readJsonLines(filePath: string) {
  if (!(await pathExists(filePath))) {
    return []
  }

  const content = await fs.readFile(filePath, 'utf8')
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

async function rewriteJsonLinesFile(
  filePath: string,
  shouldKeepLine: (line: string, lineNumber: number) => boolean | Promise<boolean>
) {
  const tempPath = `${filePath}.${Date.now()}.tmp`
  const reader = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  const writer = createWriteStream(tempPath, { encoding: 'utf8' })

  try {
    let lineNumber = 0
    for await (const line of reader) {
      lineNumber += 1
      if (await shouldKeepLine(line, lineNumber)) {
        writer.write(`${line}\n`)
      }
    }

    await new Promise<void>((resolve, reject) => {
      const handleError = (error: Error) => reject(error)
      writer.once('error', handleError)
      writer.end(() => {
        writer.off('error', handleError)
        resolve()
      })
    })
    await fs.rename(tempPath, filePath)
  } catch (error) {
    writer.destroy()
    await fs.rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  } finally {
    reader.close()
  }
}

async function pruneEmptyParentDirectories(startDirectory: string, stopDirectory: string) {
  let current = path.resolve(startDirectory)
  const boundary = path.resolve(stopDirectory)
  while (current.startsWith(boundary) && current !== boundary) {
    const entries = await fs.readdir(current).catch(() => [])
    if (entries.length > 0) {
      return
    }
    await fs.rmdir(current).catch(() => undefined)
    current = path.dirname(current)
  }
}

async function listCliSessionFiles(client: CliClient, sessionId: string) {
  if (client === 'codex') {
    const sessionRoot = path.join(os.homedir(), '.codex', 'sessions')
    return walkFiles(
      sessionRoot,
      (filePath) => filePath.endsWith('.jsonl') && filePath.includes(sessionId)
    )
  }

  const target = await getClaudeSessionFile(sessionId)
  return target ? [target] : []
}

function isMatchingCodexMessageLine(
  line: string,
  input: DesktopDeleteCliMessageRequest['message']
) {
  try {
    const parsed = JSON.parse(line) as {
      type?: string
      timestamp?: string
      payload?: {
        type?: string
        role?: string
        phase?: string
        content?: unknown
      }
    }

    if (parsed.type !== 'response_item' || parsed.payload?.type !== 'message') {
      return false
    }

    const role = parsed.payload.role
    if (role !== input.role) {
      return false
    }

    if (role === 'assistant' && parsed.payload.phase !== 'final_answer') {
      return false
    }

    if (role === 'user' && typeof parsed.payload.phase === 'string' && parsed.payload.phase !== 'input') {
      return false
    }

    const rawContent = contentPartsToText(parsed.payload.content)
    const content = role === 'user' ? sanitizeCliUserPrompt(rawContent) : rawContent
    return content === input.content && toEpochSeconds(parsed.timestamp) * 1000 === input.createdAt
  } catch {
    return false
  }
}

function isMatchingClaudeMessageLine(
  line: string,
  input: DesktopDeleteCliMessageRequest['message']
) {
  try {
    const parsed = JSON.parse(line) as {
      type?: string
      timestamp?: string
      message?: {
        role?: string
        content?: unknown
      }
      toolUseResult?: unknown
    }

    if (parsed.type !== 'user' && parsed.type !== 'assistant') {
      return false
    }

    const role = parsed.message?.role
    if (role !== input.role) {
      return false
    }

    if (role === 'user' && parsed.toolUseResult) {
      return false
    }
    if (role === 'user' && hasClaudeToolContent(parsed.message?.content)) {
      return false
    }
    if (shouldIgnoreClaudeContent(parsed.message?.content)) {
      return false
    }

    const rawContent = contentPartsToText(parsed.message?.content)
    const content = role === 'user' ? sanitizeCliUserPrompt(rawContent) : rawContent
    if (shouldIgnoreClaudeMessage(content)) {
      return false
    }

    return content === input.content && toEpochSeconds(parsed.timestamp) * 1000 === input.createdAt
  } catch {
    return false
  }
}

async function deleteCliHistoryEntry(input: DesktopDeleteCliMessageRequest['message'], client: CliClient, sessionId: string) {
  if (input.role !== 'user') {
    return
  }

  const historyFilePath =
    client === 'codex'
      ? path.join(os.homedir(), '.codex', 'history.jsonl')
      : path.join(os.homedir(), '.claude', 'history.jsonl')

  if (!(await pathExists(historyFilePath))) {
    return
  }

  let deleted = false
  await rewriteJsonLinesFile(historyFilePath, (line) => {
    if (deleted) {
      return true
    }

    try {
      const parsed = JSON.parse(line) as {
        session_id?: string
        text?: string
        ts?: number
        sessionId?: string
        display?: string
        timestamp?: number
      }

      if (client === 'codex') {
        const matches =
          parsed.session_id === sessionId &&
          sanitizeCliUserPrompt(parsed.text || '') === input.content &&
          Math.abs((Number(parsed.ts) || 0) * 1000 - input.createdAt) <= 1000

        if (matches) {
          deleted = true
          return false
        }
        return true
      }

      const matches =
        parsed.sessionId === sessionId &&
        sanitizeCliUserPrompt(parsed.display || '') === input.content &&
        Math.abs((Number(parsed.timestamp) || 0) - input.createdAt) <= 1000

      if (matches) {
        deleted = true
        return false
      }
      return true
    } catch {
      return true
    }
  })
}

async function deleteCliMessage(input: DesktopDeleteCliMessageRequest) {
  const filePath =
    input.message.sourceFilePath?.trim() ||
    (input.client === 'codex'
      ? await getLatestCodexSessionFile(input.sessionId)
      : await getClaudeSessionFile(input.sessionId))

  if (!filePath) {
    throw new Error('未找到对应的会话文件。')
  }

  const explicitLineNumber = Number(input.message.sourceLineNumber || 0)
  let deleted = false

  await rewriteJsonLinesFile(filePath, (line, lineNumber) => {
    if (explicitLineNumber > 0) {
      if (lineNumber === explicitLineNumber) {
        deleted = true
        return false
      }
      return true
    }

    if (deleted) {
      return true
    }

    const matches =
      input.client === 'codex'
        ? isMatchingCodexMessageLine(line, input.message)
        : isMatchingClaudeMessageLine(line, input.message)

    if (matches) {
      deleted = true
      return false
    }

    return true
  })

  if (!deleted) {
    throw new Error('未能在原始会话文件中定位这条消息。')
  }

  await deleteCliHistoryEntry(input.message, input.client, input.sessionId)
  return input.client === 'codex'
    ? getCodexSession(input.sessionId)
    : getClaudeSession(input.sessionId)
}

async function deleteCliSessionHistoryEntries(client: CliClient, sessionId: string) {
  const historyFilePath =
    client === 'codex'
      ? path.join(os.homedir(), '.codex', 'history.jsonl')
      : path.join(os.homedir(), '.claude', 'history.jsonl')

  if (!(await pathExists(historyFilePath))) {
    return
  }

  await rewriteJsonLinesFile(historyFilePath, (line) => {
    try {
      const parsed = JSON.parse(line) as {
        session_id?: string
        sessionId?: string
      }
      return client === 'codex'
        ? parsed.session_id !== sessionId
        : parsed.sessionId !== sessionId
    } catch {
      return true
    }
  })
}

async function deleteCliSessions(input: DesktopDeleteCliSessionsRequest) {
  const deletedSessionIds: string[] = []

  for (const sessionId of [...new Set(input.sessionIds.map((item) => item.trim()).filter(Boolean))]) {
    const sessionFiles = await listCliSessionFiles(input.client, sessionId)
    await Promise.all(
      sessionFiles.map(async (filePath) => {
        await fs.rm(filePath, { force: true }).catch(() => undefined)
        await pruneEmptyParentDirectories(path.dirname(filePath), input.client === 'codex'
          ? path.join(os.homedir(), '.codex', 'sessions')
          : path.join(os.homedir(), '.claude', 'projects'))
      })
    )
    await deleteCliSessionHistoryEntries(input.client, sessionId)
    deletedSessionIds.push(sessionId)
  }

  return {
    deletedCount: deletedSessionIds.length,
    deletedSessionIds,
  }
}

async function walkFiles(root: string, matcher: (filePath: string) => boolean) {
  const results: string[] = []

  async function visit(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await visit(fullPath)
      } else if (matcher(fullPath)) {
        results.push(fullPath)
      }
    }
  }

  if (await pathExists(root)) {
    await visit(root)
  }

  return results
}

const cliHistoryServices = createCliHistoryServices({
  readJsonLines,
  walkFiles,
})
const {
  normalizeWhitespace,
  sanitizeCliUserPrompt,
  getLatestCodexSessionFile,
  listCodexHistory,
  getCodexSession,
  listClaudeHistory,
  getClaudeSessionFile,
  getClaudeSession,
} = cliHistoryServices

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeCliSessionUserContent(value: string) {
  return normalizeWhitespace(sanitizeCliUserPrompt(value))
}

async function waitForCliSession(
  client: CliClient,
  sessionId?: string,
  options: {
    expectedUserContent?: string
    minUpdatedAtMs?: number
  } = {}
) {
  if (!sessionId) {
    return null
  }

  for (let index = 0; index < 40; index += 1) {
    const details =
      client === 'codex'
        ? await getCodexSession(sessionId)
        : await getClaudeSession(sessionId)

    if (details?.messages.length && isCliSessionReadyForLatestTurn(details, {
      expectedUserContent: options.expectedUserContent,
      minUpdatedAtMs: options.minUpdatedAtMs || 0,
      normalizeUserContent: normalizeCliSessionUserContent,
    })) {
      return details
    }

    await wait(250)
  }

  return null
}

function parseJsonObjectsFromText(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>]
      } catch {
        return []
      }
    })
}

function createCliProgressEmitter(
  webContents: WebContents | null,
  client: CliClient,
  requestId: string,
  context: {
    projectPath?: string
    prompt?: string
  } = {},
) {
  let lastPartial = ''

  return {
    send(
      input: {
        kind: CliProgressPayload['kind']
        message: string
        sessionId?: string
        done?: boolean
        files?: CliFileChange[]
        logKind?: CliLogKind
        sourceKind?: string
        assistantChunk?: string
        indentLevel?: number
        detail?: string
        command?: string
        exitCode?: number
        plan?: CliPlanState | null
        interaction?: CliInteractionPrompt
      }
    ) {
      const trimmed = input.message.trim()
      if (!trimmed) {
        return
      }

      const payload = {
        client,
        requestId,
        sessionId: input.sessionId,
        projectPath: context.projectPath,
        prompt: context.prompt,
        kind: input.kind,
        logKind: input.logKind,
        sourceKind: input.sourceKind,
        message: trimmed,
        assistantChunk: input.assistantChunk?.trim() || undefined,
        indentLevel: input.indentLevel,
        createdAt: Date.now(),
        done: input.done,
        files: input.files,
        detail: input.detail,
        command: input.command,
        exitCode: input.exitCode,
        plan: input.plan,
        interaction: input.interaction,
      } satisfies CliProgressPayload
      const state = activeCliRequestStates.get(requestId)
      if (state) {
        state.mobileBridgeLogs.push({
          id: `${requestId}-${payload.createdAt}-${payload.kind}-${payload.sourceKind || payload.logKind || 'status'}-${state.mobileBridgeLogs.length}`,
          type: payload.kind === 'error' || payload.logKind === 'error' ? 'error' : 'log',
          phase: payload.sourceKind || payload.logKind || payload.kind,
          level: payload.kind === 'error' || payload.logKind === 'stderr' ? 2 : 0,
          title: payload.message,
          body: payload.detail || payload.message,
          command: payload.command,
          interactionId: payload.interaction?.id,
          interactionStatus: payload.interaction?.status,
          indentLevel: payload.indentLevel || 0,
          source: 'desktop',
          origin: 'desktop',
          timestamp: payload.createdAt,
        })
        if (state.mobileBridgeLogs.length > 120) {
          state.mobileBridgeLogs.splice(0, state.mobileBridgeLogs.length - 120)
        }
      }
      mobileBridgeProgressMirrors.get(requestId)?.(payload)
      if (webContents && !webContents.isDestroyed()) {
        webContents.send('desktop:cli-progress', payload)
      }
    },
    status(
      message: string,
      sessionId?: string,
      done = false,
      files?: CliFileChange[],
      options: {
        logKind?: CliLogKind
        sourceKind?: string
        assistantChunk?: string
        indentLevel?: number
        detail?: string
        command?: string
        exitCode?: number
        plan?: CliPlanState | null
        interaction?: CliInteractionPrompt
      } = {}
    ) {
      this.send({ kind: 'status', message, sessionId, done, files, ...options })
    },
    error(
      message: string,
      sessionId?: string,
      done = false,
      files?: CliFileChange[],
      options: {
        logKind?: CliLogKind
        sourceKind?: string
        assistantChunk?: string
        indentLevel?: number
        detail?: string
        command?: string
        exitCode?: number
        plan?: CliPlanState | null
        interaction?: CliInteractionPrompt
      } = {}
    ) {
      this.send({
        kind: 'error',
        message,
        sessionId,
        done,
        files,
        logKind: options.logKind || 'error',
        sourceKind: options.sourceKind,
        detail: options.detail,
        command: options.command,
        exitCode: options.exitCode,
        plan: options.plan,
        assistantChunk: options.assistantChunk,
        indentLevel: options.indentLevel,
        interaction: options.interaction,
      })
    },
    partial(message: string, sessionId?: string, done = false, plan?: CliPlanState | null) {
      if (!message || message === lastPartial) {
        return
      }
      lastPartial = message
      this.send({ kind: 'partial', message, sessionId, done, plan })
    },
    intent(
      message: string,
      sessionId?: string,
      detail?: string,
      files?: CliFileChange[],
      sourceKind?: string,
      assistantChunk?: string,
      indentLevel?: number
    ) {
      this.status(message, sessionId, false, files, {
        logKind: 'intent',
        detail,
        sourceKind,
        assistantChunk,
        indentLevel,
      })
    },
    tool(
      message: string,
      sessionId?: string,
      detail?: string,
      files?: CliFileChange[],
      sourceKind?: string,
      indentLevel?: number
    ) {
      this.status(message, sessionId, false, files, { logKind: 'tool', detail, sourceKind, indentLevel })
    },
    command(
      message: string,
      command: string,
      sessionId?: string,
      detail?: string,
      files?: CliFileChange[],
      sourceKind?: string,
      indentLevel?: number
    ) {
      this.status(message, sessionId, false, files, { logKind: 'command', command, detail, sourceKind, indentLevel })
    },
    stdout(message: string, sessionId?: string, detail?: string, sourceKind?: string) {
      this.status(message, sessionId, false, undefined, { logKind: 'stdout', detail, sourceKind })
    },
    stderr(message: string, sessionId?: string, detail?: string, sourceKind?: string) {
      this.error(message, sessionId, false, undefined, { logKind: 'stderr', detail, sourceKind })
    },
    result(
      message: string,
      sessionId?: string,
      exitCode?: number,
      detail?: string,
      files?: CliFileChange[],
      sourceKind?: string,
      indentLevel?: number
    ) {
      this.status(message, sessionId, false, files, { logKind: 'result', exitCode, detail, sourceKind, indentLevel })
    },
    plan(message: string, plan: CliPlanState | null, sessionId?: string, sourceKind = 'plan.update') {
      this.status(message, sessionId, false, undefined, { logKind: 'status', sourceKind, plan })
    },
  }
}

function parseCodexReasoningEffort(value?: string) {
  switch (value) {
    case '关闭':
    case 'off':
    case 'none':
      return ''
    case '低':
    case 'low':
      return 'low'
    case '中':
    case 'medium':
      return 'medium'
    case '高':
    case 'high':
      return 'high'
    case '极高':
    case '极限':
    case 'xhigh':
    case 'max':
      return 'high'
    default:
      return ''
  }
}

function parseClaudeEffort(value?: string) {
  switch (value) {
    case '关闭':
    case 'off':
    case 'none':
      return ''
    case '低':
    case 'low':
      return 'low'
    case '中':
    case 'medium':
      return 'medium'
    case '高':
    case 'high':
      return 'high'
    case '极高':
    case '极限':
    case 'xhigh':
    case 'max':
      return 'max'
    default:
      return ''
  }
}

function parseJsonLine(line: string) {
  try {
    return JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function normalizeCliLogText(value: string, maxLength = 120) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return ''
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized
}

function extractCommandFromUnknown(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return ''
  }

  const source = value as Record<string, unknown>
  const candidates = ['command', 'cmd', 'shell_command', 'script', 'raw_command']
  for (const key of candidates) {
    if (typeof source[key] === 'string' && source[key]?.trim()) {
      return source[key].trim()
    }
  }

  return ''
}

function extractCliFilesFromUnknown(value: unknown): CliFileChange[] {
  if (!value || typeof value !== 'object') {
    return []
  }

  const source = value as Record<string, unknown>
  const candidates = ['path', 'filePath', 'target_file', 'file', 'target']
  for (const key of candidates) {
    const raw = source[key]
    if (typeof raw === 'string' && raw.trim()) {
      return [{
        path: raw.trim(),
        kind: 'unknown',
      }]
    }
  }

  return []
}

function extractPurposeFromUnknown(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return ''
  }

  const source = value as Record<string, unknown>
  const candidates = [
    'description',
    'purpose',
    'reason',
    'summary',
    'explanation',
    'task',
    'prompt',
    'query',
  ]
  for (const key of candidates) {
    if (typeof source[key] === 'string' && source[key]?.trim()) {
      return normalizeCliLogText(source[key].trim())
    }
  }

  return ''
}

function summarizeCommandForCliLog(command: string, maxLength = 88) {
  const normalized = normalizeCliLogText(command, maxLength)
  if (!normalized) {
    return ''
  }
  return normalized
}

function normalizeCliToolDetail(detail: string) {
  const normalized = detail.trim()
  if (!normalized || normalized === '{}' || normalized === '[]' || normalized === 'null') {
    return ''
  }
  return normalized
}

function buildCliFailureDetail(stderrText: string, probableCause?: string) {
  const normalizedProbableCause = probableCause?.trim() || ''
  if (normalizedProbableCause) {
    return `推断原因：${normalizedProbableCause}`
  }

  const firstUsefulLine = stderrText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/warning:\s*no stdin data received in 3s/i.test(line))

  return firstUsefulLine || stderrText.trim()
}

function summarizeCliIntentForLog(value: string, maxLength = 260) {
  const normalized = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^```/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized || shouldIgnoreCodexMessage(normalized)) {
    return ''
  }
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength - 1).trim()}…`
}

function summarizeCliIntentStep(value: string, maxLength = 120) {
  const normalized = summarizeCliIntentForLog(value, maxLength * 2)
  if (!normalized) {
    return ''
  }
  const segments = normalized
    .split(/(?<=[。！？；;.!?])\s*|(?<=\))\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
  const lastSegment = segments.at(-1) || normalized
  return lastSegment.length <= maxLength ? lastSegment : `${lastSegment.slice(0, maxLength - 1).trim()}…`
}

function describeCliToolUse(name: string, input: unknown) {
  const command = extractCommandFromUnknown(input)
  const files = extractCliFilesFromUnknown(input)
  const purpose = extractPurposeFromUnknown(input) || summarizeCommandForCliLog(command)
  const detail = normalizeCliToolDetail(
    input && typeof input === 'object'
      ? safeStringify(normalizeCliToolInputForDetail(input))
      : ''
  )
  return {
    message: `${name ? `正在执行 ${name}` : '正在执行工具调用'}${purpose ? `：${purpose}` : ''}`,
    command,
    detail,
    files,
    purpose,
    meaningful: !!(command || detail || files.length || purpose),
  }
}

function buildCliToolUseEventKey(name: string, described: ReturnType<typeof describeCliToolUse>) {
  return [
    name.trim(),
    described.command.trim(),
    described.detail.trim(),
    described.files.map((item) => item.path).join('|'),
  ].join('::')
}

const MAX_CLI_TOOL_OUTPUT_LOG_CHARS = 20_000

function formatCliToolOutputForLog(value: string) {
  const normalized = value.trim()
  if (normalized.length <= MAX_CLI_TOOL_OUTPUT_LOG_CHARS) {
    return normalized
  }

  const visibleHead = normalized.slice(0, MAX_CLI_TOOL_OUTPUT_LOG_CHARS).trimEnd()
  return [
    visibleHead,
    '',
    `... 输出过长，已截断 ${normalized.length - visibleHead.length} 个字符；完整内容仍保存在原始 CLI 会话记录中。`,
  ].join('\n')
}

function stringifyClaudeToolValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (value === undefined || value === null) {
    return ''
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => stringifyClaudeToolValue(item))
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.text === 'string') {
      return record.text.trim()
    }
    if (typeof record.content === 'string') {
      return record.content.trim()
    }
    if (Array.isArray(record.content)) {
      return stringifyClaudeToolValue(record.content)
    }
    return safeStringify(value).trim()
  }
  return String(value).trim()
}

function extractClaudeToolResultTextFromContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((part) => {
      if (!part || typeof part !== 'object') {
        return ''
      }
      const typedPart = part as {
        type?: unknown
        content?: unknown
      }
      if (typedPart.type !== 'tool_result') {
        return ''
      }
      return stringifyClaudeToolValue(typedPart.content)
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

function extractClaudeToolResultOutputEntries(record: Record<string, unknown>) {
  const entries: Array<{
    id: string
    output: string
    stdout: string
    stderr: string
  }> = []

  if (record.toolUseResult && typeof record.toolUseResult === 'object') {
    const toolUseResult = record.toolUseResult as Record<string, unknown>
    const stdout = [
      stringifyClaudeToolValue(toolUseResult.stdout),
      stringifyClaudeToolValue(toolUseResult.output),
    ].filter(Boolean).join('\n')
    const stderr = [
      stringifyClaudeToolValue(toolUseResult.stderr),
      stringifyClaudeToolValue(toolUseResult.error),
    ].filter(Boolean).join('\n')
    const fileRecord =
      toolUseResult.file && typeof toolUseResult.file === 'object'
        ? toolUseResult.file as Record<string, unknown>
        : null
    const filePath =
      (typeof fileRecord?.filePath === 'string' && fileRecord.filePath.trim()) ||
      (typeof toolUseResult.filePath === 'string' && toolUseResult.filePath.trim()) ||
      ''
    const contentPreview = [
      filePath ? `文件：${filePath}` : '',
      stringifyClaudeToolValue(toolUseResult.structuredPatch),
      stringifyClaudeToolValue(fileRecord?.content),
      stringifyClaudeToolValue(toolUseResult.content),
    ].filter(Boolean).join('\n')
    const output = [stdout, stderr, contentPreview].filter(Boolean).join('\n\n')
    if (output.trim()) {
      entries.push({
        id:
          (typeof toolUseResult.toolUseID === 'string' && toolUseResult.toolUseID.trim()) ||
          (typeof toolUseResult.toolUseId === 'string' && toolUseResult.toolUseId.trim()) ||
          (typeof toolUseResult.id === 'string' && toolUseResult.id.trim()) ||
          filePath,
        output,
        stdout: [stdout, contentPreview].filter(Boolean).join('\n\n'),
        stderr,
      })
    }
  }

  const message =
    record.message && typeof record.message === 'object'
      ? record.message as { content?: unknown }
      : null
  const toolResultText = extractClaudeToolResultTextFromContent(message?.content)
  if (toolResultText) {
    entries.push({
      id: typeof record.uuid === 'string' ? record.uuid.trim() : '',
      output: toolResultText,
      stdout: toolResultText,
      stderr: '',
    })
  }

  return entries
}

function buildCliInteractionKey(input: {
  kind: string
  title: string
  message: string
  command?: string
}) {
  return [
    input.kind.trim(),
    input.title.trim(),
    input.message.trim(),
    input.command?.trim() || '',
  ].join('::')
}

function cloneCliInteractionPrompt(
  interaction: Omit<CliInteractionPrompt, 'status'> & { status?: CliInteractionPrompt['status'] }
): CliInteractionPrompt {
  return {
    ...interaction,
    status: interaction.status || 'pending',
  }
}

function writeCliInteractionResponse(
  requestId: string,
  interactionId: string,
  action: CliInteractionResponseRequest['action']
) {
  const state = activeCliRequestStates.get(requestId)
  const interaction = state?.interactions.get(interactionId)
  if (!state?.child.stdin || !interaction) {
    return false
  }

  if (!writeChildStdinSafely(state.child, buildCliInteractionResponse(action))) {
    return false
  }

  if (action === 'approve_always') {
    state.autoApprove = true
  }
  state.interactions.delete(interactionId)
  return true
}

function emitCliInteractionPrompt(input: {
  client: CliClient
  requestId: string
  sessionId?: string
  progress: ReturnType<typeof createCliProgressEmitter>
  interaction: Omit<CliInteractionPrompt, 'id' | 'status'>
}) {
  const state = activeCliRequestStates.get(input.requestId)
  if (!state) {
    return
  }

  const interactionKey = buildCliInteractionKey(input.interaction)
  if (state.interactionKeys.has(interactionKey)) {
    return
  }
  state.interactionKeys.add(interactionKey)

  if (
    resolveInteractionDecision({
      fullAccess: state.fullAccess,
      autoApproveEligible: !!input.interaction.autoApproveEligible,
      command: input.interaction.command,
    }) === 'auto_approve'
  ) {
    input.progress.status('全权限模式已自动确认本次权限请求。', input.sessionId, false, undefined, {
      logKind: 'status',
      sourceKind: 'interaction.auto_approved',
      detail: input.interaction.message,
      command: input.interaction.command,
      interaction: {
        ...cloneCliInteractionPrompt({
          ...input.interaction,
          id: `${input.requestId}-auto-${Date.now()}`,
          status: 'auto_approved',
        }),
      },
    })
    writeChildStdinSafely(state.child, buildCliInteractionResponse('approve'))
    return
  }

  if (state.autoApprove && input.interaction.autoApproveEligible) {
    input.progress.status('已按“持续确认”设置自动放行本次权限请求。', input.sessionId, false, undefined, {
      logKind: 'status',
      sourceKind: 'interaction.auto_approved.always',
      detail: input.interaction.message,
      command: input.interaction.command,
      interaction: {
        ...cloneCliInteractionPrompt({
          ...input.interaction,
          id: `${input.requestId}-always-${Date.now()}`,
          status: 'approved_always',
        }),
      },
    })
    writeChildStdinSafely(state.child, buildCliInteractionResponse('approve'))
    return
  }

  const interactionId = `${input.requestId}-interaction-${Date.now()}-${state.interactions.size + 1}`
  const pendingInteraction = cloneCliInteractionPrompt({
    ...input.interaction,
    id: interactionId,
    status: 'pending',
  })
  state.interactions.set(interactionId, pendingInteraction)
  input.progress.status(input.interaction.title, input.sessionId, false, undefined, {
    logKind: 'status',
    sourceKind: 'interaction.pending',
    detail: input.interaction.message,
    command: input.interaction.command,
    interaction: pendingInteraction,
  })
}

function extractTextPartContent(part: unknown) {
  if (typeof part === 'string') {
    return part
  }
  if (!part || typeof part !== 'object') {
    return ''
  }

  const typedPart = part as {
    type?: string
    text?: unknown
    content?: unknown
  }

  if (typedPart.type === 'tool_use' || typedPart.type === 'tool_result' || typedPart.type === 'progress') {
    return ''
  }
  if (typeof typedPart.text === 'string') {
    return typedPart.text
  }
  if (typeof typedPart.content === 'string' && typedPart.type !== 'tool_result') {
    return typedPart.content
  }
  return ''
}

function extractToolUseEntries(content: unknown) {
  if (!Array.isArray(content)) {
    return []
  }

  let pendingText = ''

  return content.flatMap((part) => {
    const textPart = extractTextPartContent(part)
    if (textPart) {
      pendingText += textPart
      return []
    }

    if (!part || typeof part !== 'object') {
      return []
    }

    const typedPart = part as {
      id?: string
      type?: string
      name?: string
      input?: unknown
    }

    if (typedPart.type !== 'tool_use') {
      return []
    }

    const nextEntry = {
      id: typedPart.id?.trim() || '',
      name: typedPart.name?.trim() || '',
      input: typedPart.input,
      textBefore: pendingText.trim(),
    }
    pendingText = ''
    return [nextEntry]
  })
}

function extractClaudeTextFromMessage(content: unknown) {
  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((item) => {
      if (typeof item !== 'object' || !item) {
        return ''
      }
      if ('type' in item && item.type === 'text' && 'text' in item && typeof item.text === 'string') {
        return item.text
      }
      return ''
    })
    .join('')
    .trim()
}

function buildCodexExecArgs(
  input: CliRunRequest,
  resumeSessionId?: string,
  supportsAskForApproval = false,
  runtimeConfig?: {
    apiKey?: string
    baseUrl?: string
  }
) {
  const args = ['exec']

  if (runtimeConfig?.apiKey?.trim() && runtimeConfig.baseUrl?.trim()) {
    const apiKey = normalizeDesktopCliApiKey(runtimeConfig.apiKey)
    const baseUrl = normalizeCodexBaseUrl(runtimeConfig.baseUrl)
    args.push(
      '--ignore-user-config',
      '--config',
      'model_provider="oneapi_desktop"',
      '--config',
      'model_providers.oneapi_desktop.name="oneapi_desktop"',
      '--config',
      `model_providers.oneapi_desktop.base_url=${JSON.stringify(baseUrl)}`,
      '--config',
      `model_providers.oneapi_desktop.api_key=${JSON.stringify(apiKey)}`,
      '--config',
      `model_providers.oneapi_desktop.experimental_bearer_token=${JSON.stringify(apiKey)}`,
      '--config',
      'model_providers.oneapi_desktop.wire_api="responses"'
    )
  }

  args.push(
    ...buildCodexSandboxArgs(
      !!input.fullAccess,
      supportsAskForApproval,
      resolveCliAdditionalAccessDirectories(input.projectPath)
    )
  )

  if (input.model?.trim()) {
    args.push('--model', input.model.trim())
  }

  const parsedReasoningEffort = parseCodexReasoningEffort(input.reasoningEffort)
  if (parsedReasoningEffort) {
    args.push(
      '--config',
      `model_reasoning_effort="${parsedReasoningEffort}"`
    )
  }

  args.push('--json', '-C', input.projectPath, '--skip-git-repo-check')

  if (resumeSessionId) {
    args.push('resume', resumeSessionId, input.prompt)
  } else {
    args.push(input.prompt)
  }

  return args
}

const codexAskForApprovalSupportCache = new Map<string, boolean>()

async function detectCodexAskForApprovalSupport(
  executablePath: string,
  managedRuntime?: NodeRuntimeInfo | null
) {
  const cacheKey = executablePath.trim()
  if (codexAskForApprovalSupportCache.has(cacheKey)) {
    return codexAskForApprovalSupportCache.get(cacheKey) || false
  }

  const helpResult = await runCommand(executablePath, ['exec', '--help'], {
    timeoutMs: 15000,
    env: buildCliExecutionEnv(managedRuntime),
  })
  const supported = helpResult.exitCode === 0 && supportsCodexAskForApprovalFlag(
    `${helpResult.stdout}\n${helpResult.stderr}`
  )
  codexAskForApprovalSupportCache.set(cacheKey, supported)
  return supported
}

function isCodexStaleResumeFailure(stdout: string, stderr: string) {
  const combined = `${stdout}\n${stderr}`
  return (
    /thread\/resume failed/i.test(combined) ||
    /no rollout found for thread id/i.test(combined) ||
    /state db returned stale rollout path/i.test(combined)
  )
}

function buildClaudePromptArgs(input: CliRunRequest, resumeSessionId?: string) {
  const args = [
    '-p',
    '--verbose',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    ...buildClaudePermissionArgs(!!input.fullAccess, resolveCliAdditionalAccessDirectories(input.projectPath)),
  ]

  if (input.model?.trim()) {
    args.push('--model', input.model.trim())
  }

  const parsedEffort = parseClaudeEffort(input.reasoningEffort)
  if (parsedEffort) {
    args.push('--effort', parsedEffort)
  }

  if (resumeSessionId) {
    args.push('--resume', resumeSessionId)
  }

  args.push(input.prompt)

  return args
}

function isClaudeStaleResumeFailure(stdout: string, stderr: string) {
  const combined = `${stdout}\n${stderr}`
  return (
    /no conversation found/i.test(combined) ||
    /conversation .* not found/i.test(combined) ||
    /session .* not found/i.test(combined) ||
    /resume .* failed/i.test(combined)
  )
}

async function runCodexPrompt(
  webContents: WebContents | null,
  input: CliRunRequest
): Promise<CliRunResponse> {
  const requestStartedAtMs = Date.now()
  const progress = createCliProgressEmitter(webContents, 'codex', input.requestId, {
    projectPath: input.projectPath,
    prompt: extractCliUserTask(input.prompt) || input.prompt,
  })
  const requestedSessionId = input.sessionId?.trim()
  const resumeSessionId = requestedSessionId && await getLatestCodexSessionFile(requestedSessionId)
    ? requestedSessionId
    : undefined
  let sessionId = resumeSessionId || requestedSessionId
  let partialText = ''
  let planState: CliPlanState | null = null
  let lastToolIntentText = ''
  let consumedAssistantChars = 0
  let sawCodexCompletion = false
  let stoppedAfterCodexCompletion = false
  let sawCodexVisibleProgress = false
  const seenToolUseEvents = new Set<string>()
  const seenToolOutputEvents = new Set<string>()
  let activeCodexChild: ChildProcess | null = null
  let codexCompletionStopTimer: NodeJS.Timeout | null = null
  const runtimeDiagnostics: CliRuntimeDiagnostics = {}
  const executablePath = await locateExecutable('codex')
  const managedRuntime = await readManagedNodeRuntime()
  const spawnCommand = resolveCliSpawnCommand('codex', executablePath)
  const supportsAskForApproval = await detectCodexAskForApprovalSupport(executablePath, managedRuntime)
  const currentConfig = await readCurrentCodexConfig().catch(() => null)
  const claudeSettingsForCodex = await readResolvedClaudeSettingsDocument().catch(() => null)
  const runtimeApiKey = resolveRuntimeCliApiKey(input, currentConfig?.apiKey)
  const runtimeBaseUrl = normalizeCodexBaseUrl(input.baseUrl || currentConfig?.baseUrl)
  const codexProxy = runtimeBaseUrl
    ? await createCliPromptCacheProxy({
      targetBaseUrl: runtimeBaseUrl,
      apiKey: runtimeApiKey,
      client: 'codex',
      projectPath: input.projectPath,
      sessionId: sessionId || input.sessionId,
    }).catch(() => null)
    : null
  const codexRuntimeConfig = {
    apiKey: runtimeApiKey,
    baseUrl: codexProxy?.baseUrl || runtimeBaseUrl,
  }
  const codexEnv = buildCodexCliEnv(managedRuntime, claudeSettingsForCodex)
  let args = buildCodexExecArgs(input, resumeSessionId, supportsAskForApproval, codexRuntimeConfig)
  const takeAssistantChunk = (snapshot: string, explicitChunk = '') => {
    const normalizedExplicitChunk = explicitChunk.trim()
    if (snapshot.length < consumedAssistantChars) {
      consumedAssistantChars = 0
    }
    if (normalizedExplicitChunk) {
      const matchedIndex = snapshot.indexOf(normalizedExplicitChunk, consumedAssistantChars)
      if (matchedIndex >= consumedAssistantChars) {
        consumedAssistantChars = matchedIndex + normalizedExplicitChunk.length
      }
      return normalizedExplicitChunk
    }

    const nextChunk = snapshot.slice(consumedAssistantChars).trim()
    consumedAssistantChars = snapshot.length
    return nextChunk
  }
  const clearCodexCompletionStopTimer = () => {
    if (codexCompletionStopTimer) {
      clearTimeout(codexCompletionStopTimer)
      codexCompletionStopTimer = null
    }
  }
  const stopCodexAfterCompletion = () => {
    if (codexCompletionStopTimer || !activeCodexChild?.pid) {
      return
    }
    codexCompletionStopTimer = setTimeout(() => {
      if (!activeCodexChild?.pid || activeCodexChild.exitCode !== null || activeCodexChild.killed) {
        return
      }
      stoppedAfterCodexCompletion = true
      void stopChildProcess(activeCodexChild)
    }, 1200)
  }
  const emitCodexToolUse = (
    toolName: string,
    toolInput: unknown,
    sourceKind: string,
    options: {
      assistantSnapshot?: string
      assistantChunk?: string
    } = {}
  ) => {
    const interaction = detectCliInteractionFromToolUse(toolName, toolInput)
    if (interaction) {
      emitCliInteractionPrompt({
        client: 'codex',
        requestId: input.requestId,
        sessionId,
        progress,
        interaction,
      })
    }

    const described = describeCliToolUse(toolName, toolInput)
    if (!described.meaningful) {
      return
    }
    const eventKey = buildCliToolUseEventKey(toolName, described)
    if (seenToolUseEvents.has(eventKey)) {
      return
    }
    seenToolUseEvents.add(eventKey)
    sawCodexVisibleProgress = true

    const assistantSnapshot = options.assistantSnapshot || partialText
    const assistantChunk = takeAssistantChunk(assistantSnapshot, options.assistantChunk || '')
    const intentText = summarizeCliIntentStep(assistantChunk || assistantSnapshot)
    if (intentText && intentText !== lastToolIntentText) {
      lastToolIntentText = intentText
      progress.intent(
        '执行意图',
        sessionId,
        intentText,
        undefined,
        toolName.trim() ? `intent.before_tool.${toolName.trim()}` : 'intent.before_tool',
        intentText
      )
    }
    if (described.command) {
      progress.command(described.message, described.command, sessionId, described.detail, described.files, sourceKind)
      return
    }
    progress.tool(described.message, sessionId, described.detail, described.files, sourceKind)
  }
  const emitCodexToolOutput = (
    outputEntry: {
      id: string
      output: string
      stdout: string
      stderr: string
      exitCode?: number
    },
    sourceKind: string
  ) => {
    const eventKey = [
      sourceKind,
      outputEntry.id.trim(),
      outputEntry.output.trim(),
      typeof outputEntry.exitCode === 'number' ? outputEntry.exitCode : '',
    ].join('::')
    if (seenToolOutputEvents.has(eventKey)) {
      return
    }
    seenToolOutputEvents.add(eventKey)
    sawCodexVisibleProgress = true

    const exitDetail = typeof outputEntry.exitCode === 'number'
      ? `退出码：${outputEntry.exitCode}`
      : ''
    if (outputEntry.stdout.trim()) {
      progress.stdout(
        exitDetail ? '命令输出（含退出码）' : '命令输出',
        sessionId,
        formatCliToolOutputForLog(outputEntry.stdout),
        sourceKind,
      )
    }
    if (outputEntry.stderr.trim()) {
      progress.stderr(
        '命令错误输出',
        sessionId,
        formatCliToolOutputForLog(outputEntry.stderr),
        sourceKind,
      )
    }
    if (!outputEntry.stdout.trim() && !outputEntry.stderr.trim() && outputEntry.output.trim()) {
      progress.stdout(
        exitDetail ? '命令输出（含退出码）' : '命令输出',
        sessionId,
        formatCliToolOutputForLog(outputEntry.output),
        sourceKind,
      )
    }
  }

  progress.intent('Codex 已开始处理当前任务。', sessionId, undefined, undefined, 'request.started')
  if (requestedSessionId && !resumeSessionId) {
    progress.status(
      '原 Codex 会话文件已不存在，已自动新建会话继续执行。',
      requestedSessionId,
      false,
      undefined,
      { logKind: 'status', sourceKind: 'session.resume.missing' }
    )
  }

  const runCodexOnce = () => spawnCommandWithHandlers(spawnCommand, args, {
    cwd: input.projectPath,
    timeoutMs: 15 * 60 * 1000,
    env: codexEnv,
    keepStdinOpen: false,
    stdinData: '\n',
    onSpawn: (child) => {
      activeCodexChild = child
      activeCliProcesses.set(input.requestId, child)
      startCliPowerSaveBlocker(input.requestId)
      activeCliRequestStates.set(input.requestId, {
        client: 'codex',
        child,
        webContents,
        sessionId: sessionId || input.sessionId || `running-codex-${input.requestId}`,
        projectPath: input.projectPath,
        prompt: input.prompt,
        startedAt: requestStartedAtMs,
        fullAccess: !!input.fullAccess,
        autoApprove: false,
        interactions: new Map(),
        interactionKeys: new Set(),
        mobileBridgeLogs: [],
      })
      void syncMobileBridgeSessionsSnapshot(true).catch(() => undefined)
    },
    onStdoutLine: (line) => {
      const parsed = parseJsonLine(line)
      if (!parsed) {
        const interaction = detectCliInteractionFromText(line)
        if (interaction) {
          emitCliInteractionPrompt({
            client: 'codex',
            requestId: input.requestId,
            sessionId,
            progress,
            interaction,
          })
        }
        return
      }

      if (parsed.type === 'thread.started' && typeof parsed.thread_id === 'string') {
        sessionId = parsed.thread_id
        updateActiveCliSessionState(input.requestId, sessionId)
        progress.intent('已连接到 Codex 会话。', sessionId, 'thread.started', undefined, 'thread.started')
        return
      }

      if (parsed.type === 'turn.started') {
        progress.intent('Codex 正在分析项目并准备执行。', sessionId, 'turn.started', undefined, 'turn.started')
        return
      }

      if (parsed.type === 'turn.completed') {
        sawCodexCompletion = true
        stopCodexAfterCompletion()
        return true
      }

      const payload =
        typeof parsed.payload === 'object' && parsed.payload
          ? parsed.payload as Record<string, unknown>
          : null

      const nextPlanState = parseCodexPlanStateFromRecord(parsed)
      if (nextPlanState) {
        planState = nextPlanState
        progress.plan(`计划已更新，共 ${nextPlanState.items.length} 项。`, planState, sessionId, 'plan.update_plan')
      }

      const streamedAssistantText = extractCodexAssistantTextFromEvent(parsed)
      if (streamedAssistantText) {
        partialText = streamedAssistantText
        sawCodexVisibleProgress = true
        progress.partial(partialText, sessionId, false, planState)
      }

      if (parsed.type === 'response_item' && payload?.type === 'message' && payload.role === 'assistant') {
        const assistantText = contentPartsToText(payload.content)
        if (assistantText.trim() && !shouldIgnoreCodexMessage(assistantText)) {
          partialText = assistantText
          sawCodexVisibleProgress = true
          progress.partial(partialText, sessionId, false, planState)
        }
      }

      const contentCandidates = [
        payload?.content,
        typeof payload?.message === 'object' && payload.message
          ? (payload.message as { content?: unknown }).content
          : undefined,
      ]

      for (const candidate of contentCandidates) {
        const toolEntries = extractToolUseEntries(candidate)
        for (const toolEntry of toolEntries) {
          emitCodexToolUse(
            toolEntry.name,
            toolEntry.input,
            toolEntry.name?.trim() ? `tool_use.${toolEntry.name.trim()}` : 'tool_use',
            {
              assistantSnapshot: partialText,
              assistantChunk: toolEntry.textBefore,
            }
          )
        }
      }

      const functionCallToolEntries = extractCodexFunctionCallToolUseEntries(parsed)
      const commandExecutionEntries = extractCodexCommandExecutionToolUseEntries(parsed)
      for (const toolEntry of [...functionCallToolEntries, ...commandExecutionEntries]) {
        emitCodexToolUse(
          toolEntry.name,
          toolEntry.input,
          toolEntry.name?.trim() ? `codex.tool_use.${toolEntry.name.trim()}` : 'codex.tool_use',
          {
            assistantSnapshot: partialText,
            assistantChunk: toolEntry.textBefore,
          }
        )
      }

      for (const outputEntry of extractCodexFunctionCallOutputEntries(parsed)) {
        emitCodexToolOutput(outputEntry, 'codex.tool_output')
      }

      for (const outputEntry of extractCodexCommandExecutionOutputEntries(parsed)) {
        emitCodexToolOutput(outputEntry, 'codex.command_output')
      }

      const lineFileChanges = extractCodexFileChanges([line])
      if (lineFileChanges.length > 0) {
        progress.result('已记录文件变更', sessionId, undefined, typeof parsed.type === 'string' ? parsed.type : '', lineFileChanges, typeof parsed.type === 'string' ? parsed.type : 'file_change')
        return
      }

      if (parsed.type === 'error' && typeof parsed.message === 'string') {
        progress.error(parsed.message, sessionId, false, undefined, { logKind: 'error', sourceKind: typeof parsed.type === 'string' ? parsed.type : 'error', detail: typeof parsed.type === 'string' ? parsed.type : '' })
      }
    },
    onStderrLine: (line) => {
      const interaction = detectCliInteractionFromText(line)
      if (interaction) {
        emitCliInteractionPrompt({
          client: 'codex',
          requestId: input.requestId,
          sessionId,
          progress,
          interaction,
        })
      }
      const classified = classifyCliStderrLine(line)
      progress.status(classified.title, sessionId, false, undefined, {
        logKind: classified.logKind,
        sourceKind: classified.sourceKind,
        detail: line,
      })
    },
  })
  let result = await runCodexOnce()
  clearCodexCompletionStopTimer()
  let attempt = 0
  if (
    resumeSessionId &&
    result.exitCode !== 0 &&
    !stoppedCliRequests.has(input.requestId) &&
    isCodexStaleResumeFailure(result.stdout, result.stderr)
  ) {
    progress.status(
      '原 Codex 会话状态已失效，已自动新建会话重试。',
      resumeSessionId,
      false,
      undefined,
      { logKind: 'status', sourceKind: 'session.resume.recovered' }
    )
    sessionId = undefined
    partialText = ''
    planState = null
    lastToolIntentText = ''
    consumedAssistantChars = 0
    sawCodexVisibleProgress = false
    seenToolUseEvents.clear()
    seenToolOutputEvents.clear()
    sawCodexCompletion = false
    stoppedAfterCodexCompletion = false
    activeCodexChild = null
    clearCodexCompletionStopTimer()
    args = buildCodexExecArgs(input, undefined, supportsAskForApproval, codexRuntimeConfig)
    attempt += 1
    result = await runCodexOnce()
    clearCodexCompletionStopTimer()
  }
  let retryDiagnostics = summarizeCliFailure(result.stdout, result.stderr)
  if (
    shouldAutoRetryCliRequest({
      diagnostics: retryDiagnostics,
      attempt,
      aborted: stoppedCliRequests.has(input.requestId),
      exitCode: result.exitCode,
      output: buildCliRetryOutputSnapshot(
        partialText,
        sawCodexVisibleProgress ? '已产生 Codex 执行日志' : ''
      ),
    })
  ) {
    progress.status('检测到服务器瞬时异常，已自动重试一次。', sessionId, false, undefined, {
      logKind: 'status',
      sourceKind: 'request.retry.transient',
      detail: retryDiagnostics.probableCause || '',
    })
    partialText = ''
    lastToolIntentText = ''
    consumedAssistantChars = 0
    seenToolUseEvents.clear()
    seenToolOutputEvents.clear()
    sawCodexCompletion = false
    stoppedAfterCodexCompletion = false
    activeCodexChild = null
    clearCodexCompletionStopTimer()
    result = await runCodexOnce()
    clearCodexCompletionStopTimer()
    retryDiagnostics = summarizeCliFailure(result.stdout, result.stderr)
  }
  activeCliProcesses.delete(input.requestId)
  activeCliRequestStates.delete(input.requestId)
  await codexProxy?.close().catch(() => undefined)
  stopCliPowerSaveBlocker(input.requestId)
  void syncMobileBridgeSessionsSnapshot(true).catch(() => undefined)
  const aborted = stoppedCliRequests.delete(input.requestId)
  if (aborted) {
    progress.status('Codex 已停止本次回复。', sessionId, true, undefined, { logKind: 'status', sourceKind: 'request.aborted', plan: planState })
    return {
      success: false,
      requestId: input.requestId,
      output: '',
      error: '用户已停止当前回复',
      raw: result.stdout,
      sessionId,
      metadata: {
        aborted: true,
        exitCode: result.exitCode,
        threadId: sessionId ?? '',
        usage: null,
        fileChanges: [],
        plan: planState,
        diagnostics: runtimeDiagnostics,
        completedWithWarnings: false,
      },
    }
  }
  if (!aborted) {
    progress.status('Codex 输出已结束，正在整理会话记录。', sessionId, true, undefined, {
      logKind: 'status',
      sourceKind: 'request.stream.completed',
      plan: planState,
    })
  }

  const events = parseJsonObjectsFromText(result.stdout)
  const threadEvent = events.find((item) => item.type === 'thread.started')
  const usageEvent = [...events]
    .reverse()
    .find((item) => item.type === 'turn.completed')
  const fileChanges = mergeFileChanges(
    [],
    extractCodexFileChanges(result.stdout.split(/\r?\n/))
  )
  if (!sessionId && typeof threadEvent?.thread_id === 'string') {
    sessionId = threadEvent.thread_id
  }

  const session = await waitForCliSession('codex', sessionId, {
    expectedUserContent: input.prompt,
    minUpdatedAtMs: requestStartedAtMs,
  })
  runtimeDiagnostics.sessionFileFound = !!session
  runtimeDiagnostics.sessionReadAttempts = 40
  const sessionOutput = session?.messages.filter((item) => item.role === 'assistant').at(-1)?.content ?? ''
  const output = sessionOutput || partialText.trim()
  Object.assign(runtimeDiagnostics, retryDiagnostics)
  if (!session && output) {
    runtimeDiagnostics.sessionIssue = true
    runtimeDiagnostics.probableCause =
      runtimeDiagnostics.probableCause || 'CLI 已返回内容，但本地会话文件未能在等待窗口内落盘'
  }
  const completionReached = sawCodexCompletion || !!usageEvent
  const success =
    !aborted &&
    output.length > 0 &&
    (result.exitCode === 0 || (completionReached && stoppedAfterCodexCompletion))
  const completedWithWarnings = !aborted && !success && output.length > 0 && !!runtimeDiagnostics.policyIssue

  if (success) {
    progress.partial(output, sessionId, true)
    progress.status('Codex 已完成本次回复。', sessionId, true, fileChanges, { logKind: 'status', sourceKind: 'turn.completed', plan: planState })
    if (!session) {
      progress.status(
        'Codex 已返回结果，但本地会话记录未及时落盘；最近会话可能暂时不可见。',
        sessionId,
        false,
        undefined,
        {
          logKind: 'status',
          sourceKind: 'session.persistence.warning',
          detail: runtimeDiagnostics.probableCause || '',
        }
      )
    }
  } else if (completedWithWarnings) {
    progress.partial(output, sessionId, true)
    progress.status('Codex 已返回回复，但部分命令被本地执行策略拦截。', sessionId, true, fileChanges, {
      logKind: 'status',
      sourceKind: 'turn.completed.with_warnings',
      detail: runtimeDiagnostics.probableCause || '',
      exitCode: result.exitCode,
      plan: planState,
    })
  } else if (aborted) {
    progress.status('Codex 已停止本次回复。', sessionId, true, undefined, { logKind: 'status', sourceKind: 'request.aborted', plan: planState })
  } else if (result.stderr.trim()) {
    progress.error('Codex 执行失败', sessionId, true, fileChanges, {
      logKind: 'error',
      sourceKind: 'request.failed',
      detail: buildCliFailureDetail(result.stderr.trim(), runtimeDiagnostics.probableCause),
      exitCode: result.exitCode,
      plan: planState,
    })
  }
  await syncMobileBridgeSessionsSnapshot(true).catch(() => undefined)

  return {
    success: success || completedWithWarnings,
    requestId: input.requestId,
    output,
    error: aborted ? '用户已停止当前回复' : result.stderr.trim(),
    raw: result.stdout,
    sessionId,
    metadata: {
      aborted,
      exitCode: result.exitCode,
      threadId: sessionId ?? '',
      usage: usageEvent?.usage ?? null,
      fileChanges,
      plan: planState,
      diagnostics: runtimeDiagnostics,
      completedWithWarnings,
    },
  }
}

async function runClaudePrompt(
  webContents: WebContents | null,
  input: CliRunRequest
): Promise<CliRunResponse> {
  const requestStartedAtMs = Date.now()
  const progress = createCliProgressEmitter(webContents, 'claude', input.requestId, {
    projectPath: input.projectPath,
    prompt: extractCliUserTask(input.prompt) || input.prompt,
  })
  const requestedSessionId = input.sessionId?.trim()
  const resumeSessionId = requestedSessionId && await getClaudeSessionFile(requestedSessionId)
    ? requestedSessionId
    : undefined
  let sessionId = resumeSessionId || requestedSessionId
  let partialText = ''
  let finalResult: Record<string, unknown> | null = null
  let planState: CliPlanState | null = null
  const planRecords: Array<Record<string, unknown>> = []
  const seenToolUseEvents = new Set<string>()
  const seenToolOutputEvents = new Set<string>()
  const toolUseIndentLevels = new Map<string, number>()
  let lastToolIntentText = ''
  let consumedAssistantChars = 0
  let sawClaudeResult = false
  let stoppedAfterClaudeResult = false
  let activeClaudeChild: ChildProcess | null = null
  let claudeResultStopTimer: NodeJS.Timeout | null = null
  const runtimeDiagnostics: CliRuntimeDiagnostics = {}
  const executablePath = await locateExecutable('claude')
  const managedRuntime = await readManagedNodeRuntime()
  const claudeSettings = await readResolvedClaudeSettingsDocument().catch(() => null)
  const runtimeApiKey = resolveRuntimeCliApiKey(input, pickClaudeApiKey(claudeSettings?.env || {}))
  const runtimeBaseUrl = normalizeClaudeBaseUrl(input.baseUrl || claudeSettings?.env?.ANTHROPIC_BASE_URL)
  const claudeProxy = runtimeBaseUrl
    ? await createCliPromptCacheProxy({
      targetBaseUrl: runtimeBaseUrl,
      apiKey: runtimeApiKey,
      client: 'claude',
      projectPath: input.projectPath,
      sessionId: sessionId || input.sessionId,
    }).catch(() => null)
    : null
  let args = buildClaudePromptArgs(input, resumeSessionId)
  const takeAssistantChunk = (snapshot: string, explicitChunk = '') => {
    const normalizedExplicitChunk = explicitChunk.trim()
    if (snapshot.length < consumedAssistantChars) {
      consumedAssistantChars = 0
    }
    if (normalizedExplicitChunk) {
      const matchedIndex = snapshot.indexOf(normalizedExplicitChunk, consumedAssistantChars)
      if (matchedIndex >= consumedAssistantChars) {
        consumedAssistantChars = matchedIndex + normalizedExplicitChunk.length
      }
      return normalizedExplicitChunk
    }

    const nextChunk = snapshot.slice(consumedAssistantChars).trim()
    consumedAssistantChars = snapshot.length
    return nextChunk
  }
  const clearClaudeResultStopTimer = () => {
    if (claudeResultStopTimer) {
      clearTimeout(claudeResultStopTimer)
      claudeResultStopTimer = null
    }
  }
  const stopClaudeAfterResult = () => {
    if (claudeResultStopTimer || !activeClaudeChild?.pid) {
      return
    }
    claudeResultStopTimer = setTimeout(() => {
      if (!activeClaudeChild?.pid || activeClaudeChild.exitCode !== null || activeClaudeChild.killed) {
        return
      }
      stoppedAfterClaudeResult = true
      void stopChildProcess(activeClaudeChild)
    }, 1200)
  }

  const emitClaudeToolUse = (
    toolName: string,
    toolInput: unknown,
    sourceKind: string,
    options: {
      toolUseId?: string
      indentLevel?: number
      assistantSnapshot?: string
      assistantChunk?: string
    } = {}
  ) => {
    const described = describeCliToolUse(toolName, toolInput)
    if (!described.meaningful) {
      return
    }
    const eventKey = buildCliToolUseEventKey(toolName, described)
    if (seenToolUseEvents.has(eventKey)) {
      return
    }
    seenToolUseEvents.add(eventKey)
    const indentLevel = Math.max(0, options.indentLevel || 0)
    if (options.toolUseId) {
      toolUseIndentLevels.set(options.toolUseId, indentLevel)
    }
    const assistantChunk = takeAssistantChunk(options.assistantSnapshot || partialText, options.assistantChunk || '')
    const intentText = summarizeCliIntentStep(assistantChunk || options.assistantSnapshot || partialText)
    if (intentText && intentText !== lastToolIntentText) {
      lastToolIntentText = intentText
      progress.intent(
        '执行意图',
        sessionId,
        intentText,
        undefined,
        toolName.trim() ? `intent.before_tool.${toolName.trim()}` : 'intent.before_tool',
        intentText,
        indentLevel
      )
    }
    if (described.command) {
      progress.command(
        described.message,
        described.command,
        sessionId,
        described.detail,
        described.files,
        sourceKind,
        indentLevel
      )
      return
    }
    progress.tool(described.message, sessionId, described.detail, described.files, sourceKind, indentLevel)
  }
  const emitClaudeToolOutput = (
    outputEntry: {
      id: string
      output: string
      stdout: string
      stderr: string
    },
    sourceKind: string
  ) => {
    const eventKey = [
      sourceKind,
      outputEntry.id.trim(),
      outputEntry.output.trim(),
    ].join('::')
    if (seenToolOutputEvents.has(eventKey)) {
      return
    }
    seenToolOutputEvents.add(eventKey)

    if (outputEntry.stdout.trim()) {
      progress.stdout(
        '工具输出',
        sessionId,
        formatCliToolOutputForLog(outputEntry.stdout),
        sourceKind,
      )
    }
    if (outputEntry.stderr.trim()) {
      progress.stderr(
        '工具错误输出',
        sessionId,
        formatCliToolOutputForLog(outputEntry.stderr),
        sourceKind,
      )
    }
    if (!outputEntry.stdout.trim() && !outputEntry.stderr.trim() && outputEntry.output.trim()) {
      progress.stdout(
        '工具输出',
        sessionId,
        formatCliToolOutputForLog(outputEntry.output),
        sourceKind,
      )
    }
  }

  progress.intent('Claude 已开始处理当前任务。', sessionId, undefined, undefined, 'request.started')
  progress.status('正在解析 Claude 执行环境。', sessionId, false, undefined, {
    logKind: 'status',
    sourceKind: 'runtime.env',
  })
  if (requestedSessionId && !resumeSessionId) {
    progress.status(
      '原 Claude 会话文件已不存在，已自动新建会话继续执行。',
      requestedSessionId,
      false,
      undefined,
      { logKind: 'status', sourceKind: 'session.resume.missing' }
    )
  }

  const runClaudeOnce = async () => {
    const invocation = await resolveNodeBackedCliInvocation('claude', executablePath, managedRuntime, args)
    progress.status('正在启动 Claude CLI。', sessionId, false, undefined, {
      logKind: 'status',
      sourceKind: 'runtime.spawn',
    })
    return spawnCommandWithHandlers(invocation.command, invocation.args, {
    cwd: input.projectPath,
    timeoutMs: 15 * 60 * 1000,
    env: {
      ...buildClaudeCliEnv(managedRuntime, claudeSettings),
      ANTHROPIC_API_KEY: runtimeApiKey,
      ANTHROPIC_BASE_URL: runtimeBaseUrl,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      API_TIMEOUT_MS: '600000',
      ...(claudeProxy ? { ANTHROPIC_BASE_URL: claudeProxy.baseUrl } : {}),
    },
    keepStdinOpen: false,
    stdinData: '\n',
    onSpawn: (child) => {
      activeClaudeChild = child
      activeCliProcesses.set(input.requestId, child)
      startCliPowerSaveBlocker(input.requestId)
      progress.status('Claude CLI 已启动，正在等待执行输出。', sessionId, false, undefined, {
        logKind: 'status',
        sourceKind: 'runtime.spawned',
      })
      activeCliRequestStates.set(input.requestId, {
        client: 'claude',
        child,
        webContents,
        sessionId: sessionId || input.sessionId || `running-claude-${input.requestId}`,
        projectPath: input.projectPath,
        prompt: input.prompt,
        startedAt: requestStartedAtMs,
        fullAccess: !!input.fullAccess,
        autoApprove: false,
        interactions: new Map(),
        interactionKeys: new Set(),
        mobileBridgeLogs: [],
      })
      void syncMobileBridgeSessionsSnapshot(true).catch(() => undefined)
    },
    onStdoutLine: (line) => {
      const parsed = parseJsonLine(line)
      if (!parsed) {
        const interaction = detectCliInteractionFromText(line)
        if (interaction) {
          emitCliInteractionPrompt({
            client: 'claude',
            requestId: input.requestId,
            sessionId,
            progress,
            interaction,
          })
        }
        return
      }

      if (
        typeof parsed.session_id === 'string' &&
        parsed.session_id &&
        sessionId !== parsed.session_id
      ) {
        sessionId = parsed.session_id
        updateActiveCliSessionState(input.requestId, sessionId)
        progress.intent('已连接到 Claude 会话。', sessionId, 'session.connected', undefined, 'session.connected')
      }

      const planMutation = parseClaudePlanMutationFromRecord(parsed)
      if (planMutation) {
        planRecords.push(parsed)
        planState = buildClaudePlanStateFromRecords(planRecords)
        if (planState) {
          progress.plan(`计划已更新，共 ${planState.items.length} 项。`, planState, sessionId, 'plan.task_update')
        }
      }

      for (const outputEntry of extractClaudeToolResultOutputEntries(parsed)) {
        emitClaudeToolOutput(outputEntry, 'claude.tool_output')
      }

      if (parsed.type === 'system') {
        if (parsed.subtype === 'init') {
          progress.intent('Claude 会话初始化完成。', sessionId, 'system.init', undefined, 'system.init')
          return
        }
        return
      }

      if (parsed.type === 'assistant') {
        const parsedMessage =
          typeof parsed.message === 'object' && parsed.message
            ? (parsed.message as { content?: unknown })
            : undefined
        const assistantText = extractClaudeTextFromMessage(parsedMessage?.content)
        if (assistantText) {
          partialText = assistantText
        }
        const toolEntries = extractToolUseEntries(parsedMessage?.content)
        for (const toolEntry of toolEntries) {
          if (!toolEntry.name) {
            continue
          }
          const interaction = detectCliInteractionFromToolUse(toolEntry.name, toolEntry.input)
          if (interaction) {
            emitCliInteractionPrompt({
              client: 'claude',
              requestId: input.requestId,
              sessionId,
              progress,
              interaction,
            })
          }
          emitClaudeToolUse(toolEntry.name, toolEntry.input, `assistant.tool_use.${toolEntry.name}`, {
            toolUseId: toolEntry.id,
            assistantSnapshot: partialText,
            assistantChunk: toolEntry.textBefore,
          })
        }
        return
      }

      if (parsed.type === 'progress' && typeof parsed.data === 'object' && parsed.data) {
        const progressData = parsed.data as Record<string, unknown>
        if (progressData.type === 'agent_progress') {
          const parentToolUseId = typeof parsed.parentToolUseID === 'string' ? parsed.parentToolUseID.trim() : ''
          const indentLevel = parentToolUseId ? (toolUseIndentLevels.get(parentToolUseId) ?? 0) + 1 : 1
          const nestedMessage =
            typeof progressData.message === 'object' && progressData.message
              ? progressData.message as Record<string, unknown>
              : null
          const nestedPrompt = typeof progressData.prompt === 'string' ? progressData.prompt.trim() : ''

          if (nestedPrompt) {
            progress.intent('子任务目标', sessionId, nestedPrompt, undefined, 'agent_progress.prompt', nestedPrompt, indentLevel)
          }

          if (nestedMessage?.type === 'assistant') {
            const nestedPayload =
              typeof nestedMessage.message === 'object' && nestedMessage.message
                ? nestedMessage.message as { content?: unknown }
                : undefined
            const nestedAssistantText = extractClaudeTextFromMessage(nestedPayload?.content)
            const nestedToolEntries = extractToolUseEntries(nestedPayload?.content)
            for (const toolEntry of nestedToolEntries) {
              if (!toolEntry.name) {
                continue
              }
              emitClaudeToolUse(toolEntry.name, toolEntry.input, `agent_progress.tool_use.${toolEntry.name}`, {
                toolUseId: toolEntry.id,
                indentLevel,
                assistantSnapshot: nestedAssistantText,
                assistantChunk: toolEntry.textBefore,
              })
            }
          }

          return
        }
      }

      if (parsed.type === 'stream_event' && typeof parsed.event === 'object' && parsed.event) {
        const event = parsed.event as Record<string, unknown>
        if (
          event.type === 'content_block_start' &&
          typeof event.content_block === 'object' &&
          event.content_block
        ) {
          const block = event.content_block as Record<string, unknown>
          if (block.type === 'tool_use' && typeof block.name === 'string') {
            const interaction = detectCliInteractionFromToolUse(block.name, block.input)
            if (interaction) {
              emitCliInteractionPrompt({
                client: 'claude',
                requestId: input.requestId,
                sessionId,
                progress,
              interaction,
            })
          }
            emitClaudeToolUse(block.name, block.input, `stream.tool_use.${block.name}`, {
              toolUseId: typeof block.id === 'string' ? block.id : '',
              assistantSnapshot: partialText,
            })
          }
        }

        if (
          event.type === 'content_block_delta' &&
          typeof event.delta === 'object' &&
          event.delta
        ) {
          const delta = event.delta as Record<string, unknown>
          if (delta.type === 'text_delta' && typeof delta.text === 'string') {
            partialText += delta.text
            progress.partial(partialText, sessionId, false, planState)
          }
        }
        return
      }

      if (parsed.type === 'result') {
        finalResult = parsed
        sawClaudeResult = true
        stopClaudeAfterResult()
        return true
      }
    },
    onStderrLine: (line) => {
      const interaction = detectCliInteractionFromText(line)
      if (interaction) {
        emitCliInteractionPrompt({
          client: 'claude',
          requestId: input.requestId,
          sessionId,
          progress,
          interaction,
        })
      }
      const classified = classifyCliStderrLine(line)
      progress.status(classified.title, sessionId, false, undefined, {
        logKind: classified.logKind,
        sourceKind: classified.sourceKind,
        detail: line,
      })
    },
    })
  }
  let result = await runClaudeOnce()
  clearClaudeResultStopTimer()
  let attempt = 0
  if (
    resumeSessionId &&
    result.exitCode !== 0 &&
    !stoppedCliRequests.has(input.requestId) &&
    isClaudeStaleResumeFailure(result.stdout, result.stderr)
  ) {
    progress.status(
      '原 Claude 会话状态已失效，已自动新建会话重试。',
      resumeSessionId,
      false,
      undefined,
      { logKind: 'status', sourceKind: 'session.resume.recovered' }
    )
    sessionId = undefined
    partialText = ''
    finalResult = null
    planState = null
    planRecords.length = 0
    seenToolUseEvents.clear()
    seenToolOutputEvents.clear()
    toolUseIndentLevels.clear()
    lastToolIntentText = ''
    consumedAssistantChars = 0
    sawClaudeResult = false
    stoppedAfterClaudeResult = false
    activeClaudeChild = null
    clearClaudeResultStopTimer()
    args = buildClaudePromptArgs(input)
    attempt += 1
    result = await runClaudeOnce()
    clearClaudeResultStopTimer()
  }
  let retryDiagnostics = summarizeCliFailure(result.stdout, result.stderr)
  if (
    shouldAutoRetryCliRequest({
      diagnostics: retryDiagnostics,
      attempt,
      aborted: stoppedCliRequests.has(input.requestId),
      exitCode: result.exitCode,
      output: buildCliRetryOutputSnapshot(
        partialText,
        seenToolUseEvents.size > 0 ? '已产生 Claude 执行日志' : ''
      ),
    })
  ) {
    progress.status('检测到服务器瞬时异常，已自动重试一次。', sessionId, false, undefined, {
      logKind: 'status',
      sourceKind: 'request.retry.transient',
      detail: retryDiagnostics.probableCause || '',
    })
    partialText = ''
    finalResult = null
    planState = null
    planRecords.length = 0
    seenToolUseEvents.clear()
    seenToolOutputEvents.clear()
    toolUseIndentLevels.clear()
    lastToolIntentText = ''
    consumedAssistantChars = 0
    sawClaudeResult = false
    stoppedAfterClaudeResult = false
    activeClaudeChild = null
    clearClaudeResultStopTimer()
    result = await runClaudeOnce()
    clearClaudeResultStopTimer()
    retryDiagnostics = summarizeCliFailure(result.stdout, result.stderr)
  }
  activeCliProcesses.delete(input.requestId)
  activeCliRequestStates.delete(input.requestId)
  await claudeProxy?.close().catch(() => undefined)
  stopCliPowerSaveBlocker(input.requestId)
  void syncMobileBridgeSessionsSnapshot(true).catch(() => undefined)
  const aborted = stoppedCliRequests.delete(input.requestId)
  if (aborted) {
    progress.status('Claude 已停止本次回复。', sessionId, true, undefined, { logKind: 'status', sourceKind: 'request.aborted', plan: planState })
    return {
      success: false,
      requestId: input.requestId,
      output: '',
      error: '用户已停止当前回复',
      raw: result.stdout,
      sessionId,
      metadata: {
        ...(finalResult ?? { exitCode: result.exitCode }),
        aborted: true,
        fileChanges: [],
        plan: planState,
        diagnostics: runtimeDiagnostics,
        completedWithWarnings: false,
      },
    }
  }

  if (!finalResult) {
    finalResult =
      [...parseJsonObjectsFromText(result.stdout)]
        .reverse()
        .find((item) => item.type === 'result') ?? null
  }
  if (finalResult) {
    sawClaudeResult = true
  }

  const fileChanges = mergeFileChanges([], extractClaudeFileChanges(result.stdout.split(/\r?\n/)))

  if (!sessionId && typeof finalResult?.session_id === 'string') {
    sessionId = finalResult.session_id
  }

  const session = await waitForCliSession('claude', sessionId, {
    expectedUserContent: input.prompt,
    minUpdatedAtMs: requestStartedAtMs,
  })
  runtimeDiagnostics.sessionFileFound = !!session
  runtimeDiagnostics.sessionReadAttempts = 40
  const transcriptOutput =
    session?.messages.filter((item) => item.role === 'assistant').at(-1)?.content ?? ''
  const parsedOutput =
    typeof finalResult?.result === 'string'
      ? finalResult.result
      : extractClaudeTextFromMessage(
          typeof finalResult?.message === 'object' && finalResult.message
            ? (finalResult.message as { content?: unknown }).content
            : undefined
        )
  const output = transcriptOutput || parsedOutput || partialText.trim()
  Object.assign(runtimeDiagnostics, retryDiagnostics)
  if (!session && output) {
    runtimeDiagnostics.sessionIssue = true
    runtimeDiagnostics.probableCause =
      runtimeDiagnostics.probableCause || 'CLI 已返回内容，但本地会话文件未能在等待窗口内落盘'
  }
  const success =
    !aborted &&
    output.length > 0 &&
    (
      result.exitCode === 0 ||
      (sawClaudeResult && stoppedAfterClaudeResult) ||
      (sawClaudeResult && finalResult?.is_error !== true)
    )
  const completedWithWarnings =
    !aborted &&
    !success &&
    output.length > 0 &&
    (!!runtimeDiagnostics.policyIssue || (sawClaudeResult && finalResult?.is_error === true))
  if (!aborted) {
    progress.status('Claude 输出已结束，正在整理会话记录。', sessionId, true, undefined, {
      logKind: 'status',
      sourceKind: 'request.stream.completed',
      plan: planState,
    })
  }

  if (success) {
    progress.partial(output, sessionId, true)
    progress.status('Claude 已完成本次回复。', sessionId, true, fileChanges, { logKind: 'status', sourceKind: 'result', plan: planState })
    if (!session) {
      progress.status(
        'Claude 已返回结果，但本地会话记录未及时落盘；最近会话可能暂时不可见。',
        sessionId,
        false,
        undefined,
        {
          logKind: 'status',
          sourceKind: 'session.persistence.warning',
          detail: runtimeDiagnostics.probableCause || '',
        }
      )
    }
  } else if (completedWithWarnings) {
    progress.partial(output, sessionId, true)
    progress.status('Claude 已返回回复，但部分命令被本地执行策略拦截。', sessionId, true, fileChanges, {
      logKind: 'status',
      sourceKind: 'result.with_warnings',
      detail: runtimeDiagnostics.probableCause || '',
      exitCode: result.exitCode,
      plan: planState,
    })
  } else if (aborted) {
    progress.status('Claude 已停止本次回复。', sessionId, true, undefined, { logKind: 'status', sourceKind: 'request.aborted', plan: planState })
  } else if (result.stderr.trim()) {
    progress.error('Claude 执行失败', sessionId, true, fileChanges, {
      logKind: 'error',
      sourceKind: 'request.failed',
      detail: buildCliFailureDetail(result.stderr.trim(), runtimeDiagnostics.probableCause),
      exitCode: result.exitCode,
      plan: planState,
    })
  }
  await syncMobileBridgeSessionsSnapshot(true).catch(() => undefined)

  return {
    success: success || completedWithWarnings,
    requestId: input.requestId,
    output,
    error: aborted ? '用户已停止当前回复' : result.stderr.trim(),
    raw: result.stdout,
    sessionId,
    metadata: {
      ...(finalResult ?? { exitCode: result.exitCode }),
      aborted,
      fileChanges,
      plan: planState,
      diagnostics: runtimeDiagnostics,
      completedWithWarnings,
    },
  }
}

async function writeCodexConfig(request: CliDeployRequest) {
  const targetPath = cliConfig.codex.configPath
  const resolvedApiKey = resolveDeployCliApiKey(request)
  await fs.mkdir(cliConfig.codex.dataPath, { recursive: true })
  const raw = (await pathExists(targetPath)) ? await fs.readFile(targetPath, 'utf8') : ''
  if (raw) {
    await backupIfNeeded(targetPath)
  }
  await fs.writeFile(
    targetPath,
    mergeCodexConfig(
      raw,
      resolvedApiKey,
      request.model?.trim() || 'gpt-5.5',
      normalizeCodexBaseUrl(request.baseUrl)
    ),
    'utf8'
  )

  const authPath = path.join(cliConfig.codex.dataPath, 'auth.json')
  const authRaw = (await pathExists(authPath)) ? await fs.readFile(authPath, 'utf8') : ''
  let currentAuth: Record<string, unknown> = {}
  if (authRaw.trim()) {
    try {
      currentAuth = JSON.parse(authRaw) as Record<string, unknown>
    } catch {
      await backupIfNeeded(authPath)
    }
  }
  await fs.writeFile(
    authPath,
    JSON.stringify(
      {
        ...currentAuth,
        auth_mode: 'apikey',
        OPENAI_API_KEY: resolvedApiKey,
        OPENAI_BASE_URL: normalizeCodexBaseUrl(request.baseUrl),
        OPENAI_API_BASE: normalizeCodexBaseUrl(request.baseUrl),
      },
      null,
      2
    ),
    'utf8'
  )
}

async function writeClaudeConfig(request: CliDeployRequest) {
  const targetPath = cliConfig.claude.configPath
  const authPath = path.join(cliConfig.claude.dataPath, 'auth.json')
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  const raw = (await pathExists(targetPath)) ? await fs.readFile(targetPath, 'utf8') : '{}'
  let current: Record<string, unknown>

  try {
    current = JSON.parse(raw) as Record<string, unknown>
  } catch {
    await backupIfNeeded(targetPath)
    current = {}
  }

  const currentEnv = (typeof current.env === 'object' && current.env
    ? current.env
    : {}) as Record<string, string>

  const resolvedApiKey = resolveDeployCliApiKey(request)
  const resolvedBaseUrl = normalizeClaudeBaseUrl(request.baseUrl)
  const resolvedModel = request.model?.trim() || DEFAULT_CLAUDE_MODEL

  const env: Record<string, string | undefined> = {
    ...currentEnv,
    ANTHROPIC_API_KEY: resolvedApiKey,
    ANTHROPIC_BASE_URL: resolvedBaseUrl,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    API_TIMEOUT_MS: '600000',
    ONEAPI_ORIGINAL_ANTHROPIC_API_KEY:
      typeof currentEnv.ANTHROPIC_API_KEY === 'string' ? currentEnv.ANTHROPIC_API_KEY : undefined,
    ONEAPI_ORIGINAL_ANTHROPIC_BASE_URL:
      typeof currentEnv.ANTHROPIC_BASE_URL === 'string' ? currentEnv.ANTHROPIC_BASE_URL : undefined,
  }
  delete env.ANTHROPIC_AUTH_TOKEN
  delete env.ONEAPI_ORIGINAL_ANTHROPIC_AUTH_TOKEN

  const nextConfig = {
    ...current,
    env,
    model: resolvedModel,
    permissions:
      typeof current.permissions === 'object' && current.permissions
        ? current.permissions
        : { allow: [], deny: [] },
  }

  await fs.writeFile(targetPath, JSON.stringify(nextConfig, null, 2), 'utf8')
  await fs.writeFile(
    authPath,
    JSON.stringify(
      {
        auth_mode: 'apikey',
        ANTHROPIC_API_KEY: resolvedApiKey,
        ANTHROPIC_BASE_URL: resolvedBaseUrl,
        model: resolvedModel,
      },
      null,
      2
    ),
    'utf8'
  )
  await persistClaudeApiEnvironment(resolvedApiKey, resolvedBaseUrl)

  const written = await readResolvedClaudeSettingsDocument(targetPath)
  const writtenKey = resolveDesktopCliKeyRecord(pickClaudeApiKey(written.env))
  const writtenBaseUrl = normalizeClaudeBaseUrl(written.env?.ANTHROPIC_BASE_URL)
  const writtenModel = written.model?.trim() || DEFAULT_CLAUDE_MODEL
  if (
    writtenKey !== resolvedApiKey ||
    writtenBaseUrl !== resolvedBaseUrl ||
    writtenModel !== resolvedModel
  ) {
    throw new Error('Claude 配置写入后校验失败。')
  }
}

const peerMcpBridgeServices = createPeerMcpBridgeServices({
  app,
  cliConfig,
  pathExists,
  inspectCli,
  readResolvedClaudeSettingsDocument,
  mergeCodexPeerMcpConfig,
  createDeployLogger,
})
const { installPeerMcpBridge } = peerMcpBridgeServices

async function backupIfNeeded(filePath: string) {
  if (!(await pathExists(filePath))) {
    return
  }

  const parsed = path.parse(filePath)
  const backupPath = path.join(
    parsed.dir,
    `${parsed.name}.oneapi-backup-${Date.now()}${parsed.ext}`
  )
  await fs.copyFile(filePath, backupPath)
}

function sendDeployProgress(webContents: WebContents, payload: DeployProgressPayload) {
  webContents.send('desktop:deploy-progress', {
    ...payload,
    createdAt: payload.createdAt || Date.now(),
    detail: maskSensitiveText(payload.detail),
    command: maskSensitiveText(payload.command),
  })
}

function createDeployLogger(
  webContents: WebContents,
  jobId: string,
  client: CliClient
) {
  return {
    emit(
      step: DeployProgressPayload['step'],
      status: DeployStatus,
      message: string,
      options: {
        kind?: DeployProgressPayload['kind']
        detail?: string
        command?: string
        exitCode?: number
      } = {}
    ) {
      sendDeployProgress(webContents, {
        jobId,
        client,
        step,
        status,
        message,
        createdAt: Date.now(),
        ...options,
      })
    },
    info(
      step: DeployProgressPayload['step'],
      status: DeployStatus,
      message: string,
      detail?: string
    ) {
      this.emit(step, status, message, { kind: 'info', detail })
    },
    command(
      step: DeployProgressPayload['step'],
      command: string,
      args: string[],
      cwd?: string
    ) {
      const rendered = [command, ...args].join(' ')
      this.emit(step, 'running', '执行命令', {
        kind: 'command',
        command: cwd ? `${rendered}\n[cwd] ${cwd}` : rendered,
      })
    },
    stdout(step: DeployProgressPayload['step'], line: string) {
      this.emit(step, 'running', 'stdout', {
        kind: 'stdout',
        detail: line,
      })
    },
    stderr(step: DeployProgressPayload['step'], line: string) {
      this.emit(step, 'running', 'stderr', {
        kind: 'stderr',
        detail: line,
      })
    },
    result(
      step: DeployProgressPayload['step'],
      exitCode: number,
      stdout: string,
      stderr: string
    ) {
      const detailParts = [
        stdout.trim() ? `stdout:\n${stdout.trim()}` : '',
        stderr.trim() ? `stderr:\n${stderr.trim()}` : '',
      ].filter(Boolean)

      this.emit(step, exitCode === 0 ? 'success' : 'error', exitCode === 0 ? '命令执行完成' : '命令执行失败', {
        kind: 'result',
        exitCode,
        detail: detailParts.join('\n\n'),
      })
    },
  }
}

async function runLoggedCommand(
  logger: ReturnType<typeof createDeployLogger>,
  step: DeployProgressPayload['step'],
  command: string,
  args: string[],
  options: {
    cwd?: string
    timeoutMs?: number
    env?: NodeJS.ProcessEnv
    stdinData?: string
  } = {}
) {
  logger.command(step, command, args, options.cwd)
  const result = await spawnCommandWithHandlers(command, args, {
    ...options,
    onStdoutLine: (line) => logger.stdout(step, line),
    onStderrLine: (line) => logger.stderr(step, line),
  })
  logger.result(step, result.exitCode, result.stdout, result.stderr)
  return result
}

async function verifyDirectoryWritable(targetPath: string) {
  try {
    await fs.mkdir(targetPath, { recursive: true })
    const probePath = path.join(targetPath, `.oneapi-write-test-${Date.now()}.tmp`)
    await fs.writeFile(probePath, 'ok', 'utf8')
    await fs.rm(probePath, { force: true })
    return {
      ok: true,
      detail: targetPath,
    }
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

async function readResponseTextSafely(response: Response) {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

async function diagnoseCodexEnvironment(
  logger: ReturnType<typeof createDeployLogger>,
  request: CliDeployRequest
) {
  const resolvedBaseUrl = normalizeCodexBaseUrl(request.baseUrl)
  const resolvedKey = resolveDeployCliApiKey(request)

  logger.info('diagnose', 'running', '开始检查 Codex 配置文件与数据目录')

  const writable = await verifyDirectoryWritable(cliConfig.codex.dataPath)
  logger.info(
    'diagnose',
    writable.ok ? 'success' : 'error',
    writable.ok ? 'Codex 数据目录可写' : 'Codex 数据目录不可写',
    writable.detail
  )

  try {
    const current = await readCurrentCodexConfig()
    const configMatches =
      current.baseUrl === resolvedBaseUrl &&
      resolveDesktopCliKeyRecord(current.apiKey) === resolvedKey
    logger.info(
      'diagnose',
      configMatches ? 'success' : 'error',
      configMatches ? 'Codex config.toml 校验通过' : 'Codex config.toml 与预期不一致',
      `baseUrl=${current.baseUrl}\nmodel=${current.model}\nproviderKeyMatched=${configMatches ? 'yes' : 'no'}`
    )
  } catch (error) {
    logger.info(
      'diagnose',
      'error',
      'Codex config.toml 读取或解析失败',
      error instanceof Error ? error.message : String(error)
    )
  }

  try {
    const authPath = path.join(cliConfig.codex.dataPath, 'auth.json')
    const raw = await fs.readFile(authPath, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const authKey =
      typeof parsed.OPENAI_API_KEY === 'string' ? resolveDesktopCliKeyRecord(parsed.OPENAI_API_KEY) : ''
    logger.info(
      'diagnose',
      authKey === resolvedKey ? 'success' : 'error',
      authKey === resolvedKey ? 'Codex auth.json 校验通过' : 'Codex auth.json 与预期不一致',
      authPath
    )
  } catch (error) {
    logger.info(
      'diagnose',
      'error',
      'Codex auth.json 缺失或解析失败',
      error instanceof Error ? error.message : String(error)
    )
  }

  const modelsUrl = `${resolvedBaseUrl}/models`
  try {
    logger.info('diagnose', 'running', '开始检查 Codex 基础连通性', modelsUrl)
    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${resolvedKey}`,
      },
    })
    const text = await readResponseTextSafely(response)
    logger.info(
      'diagnose',
      response.ok ? 'success' : 'error',
      response.ok ? 'Codex /models 连通性正常' : 'Codex /models 连通性失败',
      `status=${response.status}\n${text.slice(0, 500)}`
    )
  } catch (error) {
    logger.info(
      'diagnose',
      'error',
      'Codex /models 连通性异常',
      error instanceof Error ? error.message : String(error)
    )
  }

  const responsesUrl = `${resolvedBaseUrl}/responses`
  try {
    logger.info('diagnose', 'running', '开始检查 Codex /responses 流式响应', responsesUrl)
    const response = await fetch(responsesUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolvedKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model?.trim() || DEFAULT_CODEX_MODEL,
        input: 'hello',
        max_output_tokens: 16,
        stream: true,
      }),
    })

    if (!response.ok) {
      const text = await readResponseTextSafely(response)
      logger.info(
        'diagnose',
        'error',
        'Codex /responses 流式请求失败',
        `status=${response.status}\n${text.slice(0, 500)}`
      )
      return
    }

    const reader = response.body?.getReader()
    if (!reader) {
      logger.info('diagnose', 'error', 'Codex /responses 未返回可读流')
      return
    }

    const firstChunk = await reader.read()
    await reader.cancel().catch(() => undefined)
    if (firstChunk.done || !firstChunk.value?.length) {
      logger.info('diagnose', 'error', 'Codex /responses 流式连接建立成功，但没有收到任何数据块')
      return
    }

    logger.info(
      'diagnose',
      'success',
      'Codex /responses 流式响应正常',
      `首个数据块大小：${firstChunk.value.length} bytes`
    )
  } catch (error) {
    logger.info(
      'diagnose',
      'error',
      'Codex /responses 流式响应异常',
      error instanceof Error ? error.message : String(error)
    )
  }
}

async function diagnoseClaudeEnvironment(
  logger: ReturnType<typeof createDeployLogger>,
  request: CliDeployRequest
) {
  const resolvedBaseUrl = normalizeClaudeBaseUrl(request.baseUrl)
  const resolvedKey = resolveDeployCliApiKey(request)

  logger.info('diagnose', 'running', '开始检查 Claude 配置文件与数据目录')

  const writable = await verifyDirectoryWritable(cliConfig.claude.dataPath)
  logger.info(
    'diagnose',
    writable.ok ? 'success' : 'error',
    writable.ok ? 'Claude 数据目录可写' : 'Claude 数据目录不可写',
    writable.detail
  )

  try {
    const current = await readCurrentClaudeConfig()
    const configMatches =
      current.baseUrl === resolvedBaseUrl &&
      resolveDesktopCliKeyRecord(current.apiKey) === resolvedKey
    logger.info(
      'diagnose',
      configMatches ? 'success' : 'error',
      configMatches ? 'Claude settings.json 校验通过' : 'Claude settings.json 与预期不一致',
      `baseUrl=${current.baseUrl}\nmodel=${current.model}\nproviderKeyMatched=${configMatches ? 'yes' : 'no'}`
    )
  } catch (error) {
    logger.info(
      'diagnose',
      'error',
      'Claude settings.json 读取或解析失败',
      error instanceof Error ? error.message : String(error)
    )
  }

  try {
    const parsed = await readClaudeAuthDocument()
    const authKey = resolveDesktopCliKeyRecord(pickClaudeApiKeyFromUnknown(parsed))
    logger.info(
      'diagnose',
      authKey === resolvedKey ? 'success' : 'error',
      authKey === resolvedKey ? 'Claude auth.json 校验通过' : 'Claude auth.json 与预期不一致',
      path.join(cliConfig.claude.dataPath, 'auth.json')
    )
  } catch (error) {
    logger.info(
      'diagnose',
      'error',
      'Claude auth.json 缺失或解析失败',
      error instanceof Error ? error.message : String(error)
    )
  }
}

function buildClaudeMessagesApiUrl(baseUrl: string) {
  return `${normalizeClaudeBaseUrl(baseUrl).replace(/\/+$/, '')}/v1/messages`
}

async function probeClaudeMessagesApi(request: CliDeployRequest) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  const resolvedKey = resolveDeployCliApiKey(request)
  const resolvedBaseUrl = normalizeClaudeBaseUrl(request.baseUrl)
  const resolvedModel = request.model?.trim() || DEFAULT_CLAUDE_MODEL
  try {
    const response = await fetch(buildClaudeMessagesApiUrl(resolvedBaseUrl), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': resolvedKey,
        authorization: `Bearer ${resolvedKey}`,
      },
      body: JSON.stringify({
        model: resolvedModel,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    })
    const text = await response.text().catch(() => '')
    if (response.ok) {
      return {
        ok: true,
        detail: `status=${response.status} endpoint=${buildClaudeMessagesApiUrl(resolvedBaseUrl)}`,
      }
    }
    return {
      ok: false,
      detail: [
        `status=${response.status} endpoint=${buildClaudeMessagesApiUrl(resolvedBaseUrl)}`,
        maskSensitiveText(text).slice(0, 2000),
      ].filter(Boolean).join('\n'),
    }
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timer)
  }
}

const cliNodeRuntimeServices = createCliNodeRuntimeServices({
  getToolchainRoot,
  getManagedNodeRoot,
  getManagedNpmPrefix,
  getManagedPrefixBin,
  getManagedNodeExecutableCandidates,
  getManagedNpmExecutableCandidates,
  firstExistingPath,
  resolveNpmCliScriptPath,
  runCommand,
  locateSystemExecutable,
  getNpmCommand,
  clearDirectory,
  flattenSingleNestedDirectory,
  runLoggedCommand,
  buildNpmInvocation,
})
const {
  ensureNodeRuntime,
  buildRuntimeEnv,
  buildCliExecutionEnv,
  readManagedNodeRuntime,
  runLoggedNpmCommand,
  installCliPackage,
} = cliNodeRuntimeServices

async function deployCli(webContents: WebContents, request: CliDeployRequest, jobId: string) {
  const client = request.client
  const logger = createDeployLogger(webContents, jobId, client)
  let normalizedApiKey: string

  try {
    normalizedApiKey = resolveDeployCliApiKey(request)
  } catch (error) {
    logger.info(
      'config',
      'error',
      `${client} 部署 Key 校验失败`,
      error instanceof Error ? error.message : String(error)
    )
    return
  }
  const deployRequest = {
    ...request,
    apiKey: normalizedApiKey,
  }

  logger.info('detect', 'running', `正在检测 ${client} 与 Node.js 环境`)
  let runtime: NodeRuntimeInfo
  try {
    runtime = await ensureNodeRuntime(logger)
  } catch (error) {
    logger.info(
      'node',
      'error',
      'Node.js 环境准备失败',
      error instanceof Error ? error.message : String(error)
    )
    return
  }

  logger.info(
    'node',
    'success',
    `Node.js 环境已就绪（${runtime.source === 'system' ? '系统' : '内置'}）`,
    `${runtime.nodePath}\n${runtime.version || '未知版本'}`
  )

  const detected = await inspectCli(client)
  logger.info(
    'detect',
    'success',
    detected.installed
      ? `已检测到 ${client}，版本 ${detected.version || '未知'}`
      : detected.brokenInstallation
        ? `检测到损坏的 ${client} 安装，准备重装`
        : `未检测到 ${client}，准备安装`,
    detected.executablePath || '未找到可执行文件'
  )

  if (!detected.installed) {
    logger.info('install', 'running', `正在通过国内镜像安装 ${client}`)

    const installResult = await installCliPackage(client, runtime, logger)
    if (installResult.exitCode !== 0) {
      logger.info(
        'install',
        'error',
        `${client} 安装失败`,
        installResult.stderr || installResult.stdout
      )
      return
    }

    logger.info('install', 'success', `${client} 安装完成`)

    const postInstallDetection = await inspectCli(client)
    if (!postInstallDetection.installed) {
      logger.info(
        'install',
        'error',
        `${client} 安装后仍未检测到可用可执行文件`,
        postInstallDetection.executablePath || '未找到可执行文件'
      )
      return
    }
  }

  logger.info('config', 'running', `正在写入 ${client} 配置`)

  try {
    if (client === 'codex') {
      await writeCodexConfig(deployRequest)
    } else {
      await writeClaudeConfig(deployRequest)
    }

    await fs.mkdir(cliConfig[client].dataPath, { recursive: true })

    logger.info('config', 'success', `${client} 配置写入完成`, cliConfig[client].configPath)
    await installPeerMcpBridge(runtime, logger)
  } catch (error) {
    logger.info(
      'config',
      'error',
      `${client} 配置或 MCP 互联失败`,
      error instanceof Error ? error.message : String(error)
    )
    return
  }

  if (client === 'codex') {
    await diagnoseCodexEnvironment(logger, deployRequest)
  } else {
    await diagnoseClaudeEnvironment(logger, deployRequest)
  }

  logger.info('test', 'running', `正在验证 ${client} 连接`)

  const testProjectPath = path.join(os.homedir())
  if (client === 'claude') {
    logger.info('test', 'running', '正在预检 Claude 兼容接口鉴权')
    const probe = await probeClaudeMessagesApi(deployRequest)
    if (!probe.ok) {
      logger.info('test', 'error', 'Claude 兼容接口预检失败', probe.detail)
      return
    }
    logger.info('test', 'success', 'Claude 兼容接口预检通过', probe.detail)
  }
  const testResult =
    client === 'codex'
      ? await runCodexPrompt(webContents, {
          client,
          requestId: `${jobId}-test`,
          projectPath: testProjectPath,
          prompt: 'hello',
        })
      : await runClaudePrompt(webContents, {
          client,
          requestId: `${jobId}-test`,
          projectPath: testProjectPath,
          prompt: 'hello',
        })

  if (!testResult.success) {
    const runtimeDiagnostics =
      typeof testResult.metadata?.diagnostics === 'object' && testResult.metadata?.diagnostics
        ? testResult.metadata.diagnostics as CliRuntimeDiagnostics
        : null
    logger.info(
      'test',
      'error',
      `${client} 测试失败`,
      [
        testResult.error || testResult.raw,
        runtimeDiagnostics?.probableCause ? `推断原因：${runtimeDiagnostics.probableCause}` : '',
      ].filter(Boolean).join('\n')
    )
    return
  }

  logger.info('test', 'success', `${client} 测试通过`, testResult.output)
  if (typeof testResult.metadata?.diagnostics === 'object' && testResult.metadata?.diagnostics) {
    const runtimeDiagnostics = testResult.metadata.diagnostics as CliRuntimeDiagnostics
    if (runtimeDiagnostics.sessionIssue && !runtimeDiagnostics.networkIssue && !runtimeDiagnostics.authIssue) {
      logger.info(
        'test',
        'error',
        `${client} 运行成功，但本地会话持久化异常`,
        runtimeDiagnostics.probableCause || 'CLI 已返回结果，但客户端没有稳定读到本地会话记录。'
      )
      return
    }
  }

  logger.info('complete', 'success', `${client} 已可直接使用`)
}

  return {
    readCurrentCodexConfig,
    readCurrentClaudeConfig,
    listCliExtensions,
    installCliExtension,
    deleteCliMessage,
    deleteCliSessions,
    listCodexHistory,
    getCodexSession,
    listClaudeHistory,
    getClaudeSession,
    getLatestCodexSessionFile,
    getClaudeSessionFile,
    runCodexPrompt,
    runClaudePrompt,
    writeCodexConfig,
    writeClaudeConfig,
    readManagedNodeRuntime,
    deployCli,
    normalizeWhitespace,
    wait,
    writeCliInteractionResponse,
    createCliProgressEmitter,
    createDeployLogger,
    buildCliExecutionEnv,
  }
}
