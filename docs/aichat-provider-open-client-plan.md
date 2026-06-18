# AIChat Provider Open Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the desktop client open directly without login, support optional user-owned OpenAI-compatible AIChat and Image providers, keep OneAPI account features intact, mark Codex/Claude bridge-only models as OneAPI-only, make CLI output timeline-first, and prepare the client codebase for open source release without server secrets.

**Architecture:** Split the product into two explicit channels: `OneAPI Account Channel` and `AIChat Provider Channel`. The OneAPI channel always targets the official OneAPI server for login, subscription, service status, update, and mobile bridge. The AIChat provider channel is a local desktop preference that can route Chat/Image generation to either OneAPI or a user-configured OpenAI-compatible endpoint without changing OneAPI account APIs.

**Tech Stack:** React, TypeScript, Electron IPC, Zustand/localStorage persistence, Vite, Node test runner.

---

## Non-Negotiable Boundaries

1. Do not change `new-api-main`, Android, iOS, or other non-desktop folders in this task.
2. Every functional change in `OneAPI_PC` must be mirrored to `OneAPI_MAC`.
3. `serverBaseUrl` remains the OneAPI account/update/mobile server. Do not repurpose it for third-party AI providers.
4. Custom API keys must never be sent to OneAPI business endpoints.
5. OneAPI access tokens must never be sent to custom provider endpoints.
6. Mobile bridge is OneAPI-only. It must require OneAPI login and must not inherit custom provider config.
7. Codex/Claude DeepSeek and Xiaomi MiMo bridge models are OneAPI-only. When custom provider mode is active, show them under their vendor filters but disabled, with a top notice: `OneAPI专用桥接服务`.
8. Third-party provider support must include both Chat completions and Image generation where the endpoint is OpenAI-compatible.
9. The open-source client must not include database credentials, server SSH information, MinIO credentials, internal deployment passwords, or private IPs.
10. Security must rely on server-side authentication, authorization, DB network isolation, least-privilege DB accounts, rate limiting, and audit logging. Never rely on hiding client source code.

## Required User Experience

### Anonymous Startup

- Client starts directly in the workspace.
- Sidebar footer shows `登录` when no OneAPI account is active.
- Clicking `登录` opens the existing login UI as a modal.
- Login success closes the modal, stores OneAPI user state, and refreshes account-only data.

### Provider Choice

- Add an `AIChat 服务通道` block in the account/deployment area.
- The block contains:
  - Toggle: `使用自定义 API 通道`
  - `Base URL`
  - `API Key`
  - Optional default model input
  - `测试连接`
  - `刷新模型`
- If no user is logged in and no custom provider is enabled, AIChat sends show a clear prompt: `请先登录 OneAPI 或配置自定义 API 通道。`
- If logged in and custom provider disabled, AIChat uses OneAPI.
- If custom provider enabled, AIChat uses the custom provider even when logged in.
- User can disable custom provider at any time and return to OneAPI.

### OneAPI-Only Features

These always use OneAPI and should prompt for login when needed:

- 套餐订阅
- 用量账单
- 服务状态
- 环境部署 one-click OneAPI key generation
- App/手机互联
- 客户端更新

### Codex/Claude Model Picker

- The model source list can still include DeepSeek and Xiaomi MiMo models.
- When custom provider mode is active:
  - DeepSeek and Xiaomi MiMo models remain visible under their filters.
  - The affected model rows are disabled.
  - Disabled row text explains: `需要登录并使用 OneAPI 专用桥接服务`.
  - The model list top shows a non-selectable notice row: `OneAPI专用桥接服务`.
  - Selecting disabled rows must do nothing.
- When OneAPI mode is active and user is logged in, the current behavior remains available.

### CLI Timeline UI

- Codex and Claude AI replies and execution logs should no longer look like chat bubbles/cards.
- Render them as direct chronological timeline rows.
- Keep:
  - current ordering
  - indentation levels
  - leading dots
  - collapsible log groups/rows
  - copy/delete/context actions where currently available
- Remove:
  - message bubble backgrounds
  - log bubble backgrounds
  - card-style borders around CLI output

## File Responsibilities

### Shared Desktop Contracts

- `src/shared/desktop.ts`
  - Add provider request/response types if custom provider calls are routed through Electron main.
  - Extend `DesktopChatStreamRequest` only with provider-neutral fields if needed; do not overload OneAPI-only fields.

### Provider Logic

- Create `src/lib/aichat-provider.ts`
  - Stores and validates local provider config.
  - Exports `AiChatProviderConfig`, `AiChatProviderMode`, `resolveAiChatProviderState`, `normalizeOpenAICompatibleBaseUrl`, and helpers.
  - No React imports.

- Create `src/domains/aichat-provider.ts`
  - Exports `sendAiChatCompletion`, `streamAiChatCompletion`, `sendAiImageGeneration`, `listAiChatProviderModels`, `testAiChatProvider`.
  - Routes to existing OneAPI domain functions or custom provider functions.
  - Removes OneAPI-only request fields when calling custom providers.

### Existing Chat Domain

- Modify `src/domains/chat.ts`
  - Keep current OneAPI functions intact.
  - Add direct custom OpenAI-compatible chat/image functions only if `aichat-provider.ts` delegates here.
  - Do not change OneAPI endpoint paths.

### Electron Main

- Modify `electron/main.ts`
  - Add explicit custom-provider IPC only if browser CORS or streaming restrictions require it.
  - Any custom-provider request must accept full URL and explicit API key from renderer payload.
  - Do not persist custom provider config in main unless using a secure local store later.
  - Add host validation for custom URLs: only `http:`/`https:`, no `file:`, no shell execution, no internal path access.

### App Shell

- Modify `src/App.tsx`
  - Remove hard login gate.
  - Add login modal state.
  - Sidebar footer shows login entry when anonymous.
  - Guard account-only pages/actions with `requireOneApiLogin`.
  - Add AIChat provider settings UI.
  - Route AIChat send/image calls through provider domain.
  - Mark mobile bridge as login + OneAPI-only.
  - Mark Codex/Claude OneAPI bridge models disabled in custom provider mode.

### Styles

- Modify `src/styles/*.css`
  - Add provider settings styles consistent with existing account/deployment cards.
  - Add disabled model row and OneAPI-only notice styles.
  - Add CLI timeline/no-bubble styles scoped to `.cli-page` only.

### Tests

- Add `src/lib/aichat-provider.test.ts`
  - URL normalization.
  - provider mode resolution.
  - custom provider request sanitization.
  - bridge-only model disabling predicates.

- Add/extend source tests:
  - Anonymous app shell does not return `LoginScreen` as full-screen gate.
  - Mobile bridge domain references remain OneAPI endpoints.
  - Service status/subscriptions still call `/api/...` OneAPI endpoints.
  - Custom provider requests do not include OneAPI access token.

## Implementation Tasks

### Task 1: Anonymous Shell and Login Modal

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles/modals.css` or `src/styles/workspace.css`

- [ ] Remove the full-screen `if (!auth.user) return <LoginScreen ... />` gate.
- [ ] Add `const [loginDialogOpen, setLoginDialogOpen] = useState(false)`.
- [ ] Sidebar footer anonymous state:
  - label: `登录`
  - no balance
  - click opens login modal
- [ ] Existing logged-in footer remains unchanged.
- [ ] Add `LoginScreen` modal wrapper using existing component.
- [ ] On login success:
  - `auth.setUser(user)`
  - `saveStoredDesktopUserId(user.id)`
  - close modal
  - toast success
- [ ] Account-only pages call `requireOneApiLogin(actionLabel)` and open modal if missing user.

Run:

```bash
npm run build
```

Expected: build passes.

### Task 2: AIChat Provider Config Model

**Files:**
- Create: `src/lib/aichat-provider.ts`
- Create: `src/lib/aichat-provider.test.ts`

- [ ] Define config type with `customEnabled`, `customBaseUrl`, `customApiKey`, `customDefaultModel`, `customModels`.
- [ ] Implement `normalizeOpenAICompatibleBaseUrl(value)`:
  - trims whitespace
  - requires `http://` or `https://`
  - strips trailing slash
  - appends `/v1` when no `/v1` suffix exists
- [ ] Implement `resolveAiChatProviderState(config, user)`:
  - custom enabled + valid base/key => `custom`
  - user logged in => `oneapi`
  - otherwise => `unavailable`
- [ ] Implement `isOneApiBridgeOnlyModel(model)`:
  - true for DeepSeek and Xiaomi MiMo models intended for Codex/Claude bridge.
  - false for normal chat models.

Run:

```bash
node --test --experimental-strip-types src/lib/aichat-provider.test.ts
```

Expected: all tests pass.

### Task 3: Custom Chat and Image Requests

**Files:**
- Create/Modify: `src/domains/aichat-provider.ts`
- Modify: `src/domains/chat.ts`
- Modify: `src/shared/desktop.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`

- [ ] Add custom OpenAI-compatible `/chat/completions` non-stream and stream support.
- [ ] Add custom OpenAI-compatible `/images/generations` support.
- [ ] For custom chat, send only portable fields:
  - `model`
  - `messages`
  - `temperature`
  - `stream`
- [ ] Do not send:
  - `group`
  - `prompt_cache_key`
  - OneAPI user id
  - OneAPI bearer token
- [ ] For custom image generation, send:
  - `model`
  - `prompt`
  - `n`
  - `size`
  - `quality`
  - `response_format`
- [ ] Parse SSE compatible with standard OpenAI chunks.
- [ ] Preserve current OneAPI request functions and endpoints.

Run:

```bash
npm run build
```

Expected: build passes.

### Task 4: Provider Settings UI and AIChat Routing

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles/workspace.css`

- [ ] Add `AIChat 服务通道` settings block in account/deployment screen.
- [ ] Load/save provider config via local storage helpers.
- [ ] Add test connection and model refresh actions.
- [ ] Chat send flow calls `sendAiChatCompletion` / `streamAiChatCompletion`.
- [ ] Image generation flow calls `sendAiImageGeneration`.
- [ ] If provider unavailable, replace pending assistant message with guidance text and do not call network.
- [ ] Model picker includes custom model list when custom provider is active.

Run:

```bash
npm run build
```

Expected: build passes.

### Task 5: OneAPI-Only Guardrails

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/domains/mobile-bridge.ts` only if guard messages need helper functions.

- [ ] 套餐订阅 requires OneAPI login.
- [ ] 用量账单 requires OneAPI login.
- [ ] 手机互联 requires OneAPI login and OneAPI provider mode.
- [ ] Service status remains public/OneAPI and must never use custom provider baseUrl.
- [ ] Update checks remain OneAPI/default release server.
- [ ] If user is on custom provider and opens mobile bridge, show explanation:
  - `App 互联需要登录并使用 OneAPI 中转服务，第三方 API 无法完成跨端同步。`

Run:

```bash
npm run build
```

Expected: build passes.

### Task 6: Codex/Claude OneAPI Bridge Model Availability

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/lib/assistant-workspace.ts` if model predicates belong there.
- Modify: `src/styles/workspace.css`

- [ ] Pass provider mode into `CliWorkspace`.
- [ ] In custom provider mode, keep DeepSeek/MiMo rows visible but disabled.
- [ ] Add top notice row in CLI model picker: `OneAPI专用桥接服务`.
- [ ] Disabled rows do not call `setSelectedModel`.
- [ ] If selected model becomes disabled after switching provider mode, fallback to default Codex/Claude model or clear selection with toast.

Run:

```bash
npm run build
```

Expected: build passes.

### Task 7: CLI Timeline No-Bubble Styling

**Files:**
- Modify: `src/App.tsx` if class scoping is needed.
- Modify: `src/styles/cli.css`
- Modify: `src/styles/markdown.css`
- Modify: `src/styles/modals.css`
- Modify: `src/styles/workspace.css`

- [ ] Scope changes under `.cli-page`.
- [ ] Make `.cli-page .message-bubble` background transparent.
- [ ] Remove border/shadow/card padding from `.cli-page .message-bubble`.
- [ ] Make `.cli-page .cli-log-bubble` background transparent.
- [ ] Make `.cli-page .cli-log-phase-section`, `.cli-log-output-card`, `.cli-log-diagnostic-group` transparent/minimal.
- [ ] Preserve `.cli-log-time-dot`, `.cli-log-event-dot`, indentation, and collapse buttons.
- [ ] Ensure Chat page bubbles are unchanged.

Run:

```bash
npm run build
```

Expected: build passes.

### Task 8: Open Source Security Audit

**Files:**
- Create: `docs/open-source-security-checklist.md`
- Modify: `.gitignore`
- Modify: source files only if secrets or private addresses are found.

- [ ] Search source excluding `release`, `dist`, `node_modules`, `.cache`:

```bash
rg -n "password|secret|DATABASE|POSTGRES|MINIO|SSH|PRIVATE|192\\.168|root@|server\\.env|sk-[A-Za-z0-9]" OneAPI_PC OneAPI_MAC -g "!release/**" -g "!dist/**" -g "!dist-electron/**" -g "!node_modules/**" -g "!.cache/**"
```

- [ ] Remove private deployment details from source.
- [ ] Ensure `server.env`, `.env*`, release output, dist output, cache folders are ignored.
- [ ] Document that DB protection is server-side:
  - database not publicly reachable
  - no DB credentials in client
  - API auth required
  - least-privilege DB user
  - rate limiting
  - audit logging
  - server validation for subscription/payment/mobile bridge

Run:

```bash
npm run build
```

Expected: build passes.

### Task 9: Sync to Mac and Final Verification

**Files:**
- Mirror every changed `OneAPI_PC` file to matching `OneAPI_MAC` file, adapting only platform-specific differences.

- [ ] Copy or patch matching files.
- [ ] Run targeted tests in both clients.
- [ ] Run builds in both clients:

```bash
cd D:\WorkSpace\NewAPI\OneAPI_PC
npm run build

cd D:\WorkSpace\NewAPI\OneAPI_MAC
npm run build
```

Expected: both pass. Existing Vite chunk warnings and inlineDynamicImports warning are non-blocking.

## Acceptance Criteria

- Anonymous launch enters workspace.
- Sidebar anonymous footer opens login modal.
- Login preserves OneAPI service usage and mobile bridge.
- Custom API can chat without OneAPI login.
- Custom API can generate images if provider supports `/v1/images/generations`.
- OneAPI subscriptions/status/update/mobile bridge never use custom provider baseUrl.
- Custom provider does not receive OneAPI access token or user id.
- OneAPI endpoints do not receive custom API key.
- Codex/Claude DeepSeek/MiMo bridge models are disabled with OneAPI-only explanation in custom mode.
- CLI output appears as direct timeline rows, not bubbles/cards.
- Chat page bubbles are unchanged.
- PC and Mac behavior match.
- No server secrets or private infrastructure credentials are present in source intended for open source release.
