# Desktop CLI and Layout Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SSH tooling, deepen CLI log/file provenance, fix layout and wallet/chart bugs, and standardize logo/branding across PC and Mac clients.

**Architecture:** Keep Electron main-process work responsible for SSH/config/proxy/file access, keep React components responsible for presentation and interaction, and use shared desktop types for any new IPC contracts. Preserve existing PC behavior as the source of truth, then mirror changes to Mac.

**Tech Stack:** Electron + React + TypeScript + Vite + electron-builder + Python SSH helper (if already present in repo or local tooling).

---

### Task 1: SSH tooling entrypoint

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/types.d.ts`
- Modify: `src/shared/desktop.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main.ts`
- Test: `npm run build`

- [ ] **Step 1: Locate the exact CLI toolbar rendering and IPC bridge points**

```ts
// Confirm the right toolbar action list in CliWorkspace and the desktopBridge shape in preload/types.
```

- [ ] **Step 2: Add a new SSH configuration button and modal form**

```tsx
// Add a toolbar action that opens a modal with IP, user, password fields and submits to a new IPC call.
```

- [ ] **Step 3: Wire the main-process SSH configuration handler**

```ts
// Add an IPC handler that shells out to the existing Python SSH helper or a repo-local script if present.
```

- [ ] **Step 4: Run a build to confirm types and wiring**

Run: `npm run build`
Expected: success.

### Task 2: CLI log provenance tree

**Files:**
- Modify: `electron/main.ts`
- Modify: `src/lib/assistant-workspace.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Test: `npm run build`

- [ ] **Step 1: Identify all CLI progress, session, and file-change sources**

```ts
// Trace runCodexPrompt/runClaudePrompt, createCliProgressEmitter, parseCodexSession, parseClaudeSession, and buildCliTimeline.
```

- [ ] **Step 2: Expand progress payloads to carry command/file provenance**

```ts
// Preserve command lines, tool calls, file paths, and file previews in structured metadata.
```

- [ ] **Step 3: Render a collapsed summary card that expands into steps/files**

```tsx
// Show a compact summary such as “Ran 2 commands” and expand to step-by-step logs plus file preview buttons.
```

- [ ] **Step 4: Style the provenance tree and preview affordances**

```css
/* Keep logs left-aligned and visually nested with lightweight disclosure controls. */
```

- [ ] **Step 5: Verify the timeline still builds**

Run: `npm run build`
Expected: success.

### Task 3: Layout and history fixes

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Test: `npm run build`

- [ ] **Step 1: Re-check the assistant/chat/CLI composer and history buttons**

```tsx
// Ensure history/recent-session buttons are in the top row with assistant tabs and not clipped.
```

- [ ] **Step 2: Right-align user bubbles and stabilize button rows**

```tsx
// Keep user bubbles on the right and make message controls consistent across chat/codex/claude.
```

- [ ] **Step 3: Rework recent-session hide/show behavior by project**

```tsx
// Add per-item hide icons and a “hidden sessions” view that groups by project.
```

- [ ] **Step 4: Update sidebar collapsed behavior and logo display**

```css
/* Remove the collapsed expand button, use the icon as the expand affordance, and show the logo in the top collapsed area. */
```

- [ ] **Step 5: Verify layout on build**

Run: `npm run build`
Expected: success.

### Task 4: Wallet and chart corrections

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Test: `npm run build`

- [ ] **Step 1: Locate the wallet total/consume data bindings and usage trend chart source**

```tsx
// Confirm which fields are token余额、真实余额、累计消耗、账单和统计曲线.
```

- [ ] **Step 2: Fix chart x-axis bucketing so dates don’t collapse**

```tsx
// Use stable time buckets and a real scaled x-axis to avoid pileup at the origin.
```

- [ ] **Step 3: Rebuild the bill rows into a 3-up responsive grid with fill bars**

```css
/* Use a left-to-right filled background progress effect and keep each row width adaptive. */
```

- [ ] **Step 4: Reorder wallet overview metrics**

```tsx
// Show current balance first, then cumulative consume, with token-related totals preserved below.
```

- [ ] **Step 5: Build check**

Run: `npm run build`
Expected: success.

### Task 5: My page split and setup relocation

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Test: `npm run build`

- [ ] **Step 1: Identify the exact Me workspace split container**

```tsx
// Use the real me-layout wrapper and move the setup cards into its right-hand column.
```

- [ ] **Step 2: Keep account/sensitive actions on the left**

```tsx
// Leave keys and sensitive actions in the left pane only.
```

- [ ] **Step 3: Move Codex/Claude config cards into the right pane**

```tsx
// Reparent the configuration cards under the right-side container.
```

- [ ] **Step 4: Verify the layout after build**

Run: `npm run build`
Expected: success.

### Task 6: Proxy, logo, and packaging hygiene

**Files:**
- Modify: `electron/main.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `OneAPI_PC/package.json`
- Modify: `OneAPI_MAC/package.json`
- Modify: `OneAPI_PC/docs/...` only if needed for runtime docs
- Test: `npm run build:win`, `npm run build` in Mac

- [ ] **Step 1: Inspect `server.env` and the remote proxy config path**

```bash
# Read local server.env and identify the remote file/service that owns reverse proxy rules.
```

- [ ] **Step 2: Add `www.oneapi.center` mapping for port 68 only**

```conf
# Update only the 68-port mapping and leave other occupied services untouched.
```

- [ ] **Step 3: Replace all app logos with `D:\WorkSpace\NewAPI\Icon.png`**

```tsx
// Swap the static brand assets and installer icon references to the shared image source.
```

- [ ] **Step 4: Rebuild Windows package and confirm fresh artifacts**

Run: `npm run build:win`
Expected: updated `release/` artifacts.

- [ ] **Step 5: Rebuild Mac client**

Run: `npm run build`
Expected: success.
