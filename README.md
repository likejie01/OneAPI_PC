# OneAPI PC

[中文](#中文) | [English](#english)

## 中文

OneAPI PC 是面向 Windows 的 OneAPI 桌面客户端。它把 [ai.oneapi.center](https://ai.oneapi.center) 的账号、订阅、钱包、模型服务和 Codex / Claude 开发工作流整合到一个本地桌面应用中，让用户可以在同一个界面完成 AI 对话、绘图、CLI 项目开发、模型切换、插件/技能调用、设备互联和客户端更新。

### ai.oneapi.center 平台

[ai.oneapi.center](https://ai.oneapi.center) 是 OneAPI 的统一 AI 服务平台，提供多模型聚合、订阅套餐、钱包用量、API Key 管理、模型广场、服务状态、隐私合规与客户端分发能力。桌面客户端是平台能力的本地入口，适合需要稳定桌面体验、长期项目会话、Codex / Claude CLI 工作流和本地文件操作的用户。

### 产品亮点

- **统一账号体系**：登录 OneAPI 后同步订阅、钱包余额、API Key、模型权限和公告更新。
- **AIChat 与图像工作区**：支持 Markdown、代码块、附件预览、模型收藏、推理强度和图像生成/编辑。
- **Codex / Claude 工作流**：支持项目目录、全权限/受限模式、执行日志、计划面板、会话持久化和停止控制。
- **技能与插件**：通过按钮或输入框 `/` 呼出命令、技能、插件选择器，支持安装、收藏、备注、翻译和插入。
- **系统设置**：管理自定义 API 中转、Claude / Codex 部署状态、设备绑定和桌面端专用 Key。
- **隐私合规**：首次登录和新建开发会话时提供安全与隐私提醒，内置协议、隐私政策和内容安全说明。
- **自动更新**：通过桌面更新清单和发布产物支持安装包、便携包下载与版本提示。

### 界面范围

- 系统设置与环境部署
- AIChat / 绘图工作台
- Codex / Claude 项目日志与模型选择
- 钱包用量、套餐订阅、服务状态
- 隐私合规弹窗与 App 互联

### 技术栈

- Electron 42
- React 19
- TypeScript 6
- Vite 8
- electron-builder
- Zustand、Axios、Lucide React、React Markdown、Mermaid

### 目录结构

```text
.
├── build/                 # 应用图标和安装器资源
├── electron/              # Electron 主进程源码
├── public/                # 静态资源
├── scripts/               # 打包、图标和发布辅助脚本
├── src/                   # React 渲染进程源码
├── docs/                  # 项目文档与安全检查清单
├── package.json           # 脚本、依赖和 electron-builder 配置
└── vite.config.ts         # Vite/Electron 构建配置
```

### 本地开发

```powershell
npm install
npm run dev
```

启动 Electron 开发模式：

```powershell
npm run dev:electron
```

### 测试与构建

```powershell
npm test
npm run build
npm run build:win
```

Windows 发布产物生成到 `release/`，主要包括：

- `OneAPI_PC_Setup-1-0.exe`：Windows 安装包
- `OneAPI_PC-1-0.exe`：便携版
- `OneAPI_PC-1-0.zip`：便携压缩包
- `latest.yml`：自动更新清单

### 环境与安全

- 不要提交 `server.env`、`.env*`、密钥、令牌、私有服务器地址或本地凭据。
- `release/`、`dist/`、`dist-electron/`、`.cache/` 和 `node_modules/` 是本地生成内容，不应进入仓库。
- 发布前阅读 [docs/open-source-security-checklist.md](docs/open-source-security-checklist.md)，并执行其中的源码扫描命令。
- 使用第三方模型或 API Key 时，用户输入、附件、代码、日志和会话上下文可能会发送给对应服务商处理，请遵守平台隐私政策和内容安全规则。

### 许可与来源

本项目代码采用 [Apache License 2.0](LICENSE) 授权，并包含 [NOTICE](NOTICE) 来源与权益声明。二次开发、分发或派生项目必须保留原始版权、许可文本和 NOTICE，并清楚说明项目基于 OneAPI PC 修改。

`OneAPI`、`OneAPI PC`、`OneAPI MAC`、项目标识、官方服务、订阅产品、更新渠道和相关商业权益不随源码许可授权转让。如需使用 OneAPI 品牌、官方服务端点或商业分发渠道，需获得权利方单独授权。

## English

OneAPI PC is the Windows desktop client for OneAPI. It brings the [ai.oneapi.center](https://ai.oneapi.center) account system, subscriptions, wallet usage, model access, and Codex / Claude development workflows into a native desktop experience for AI chat, image work, project automation, model switching, skills/plugins, device linking, and desktop updates.

### ai.oneapi.center

[ai.oneapi.center](https://ai.oneapi.center) is the unified OneAPI AI service platform. It provides multi-model access, subscription plans, wallet and usage tracking, API key management, model discovery, service status, privacy compliance, and official client distribution. The desktop client is the local entry point for users who need persistent project sessions, CLI-based development workflows, and access to local files.

### Highlights

- **Unified account**: sync subscriptions, wallet balance, API keys, model permissions, announcements, and updates after login.
- **AIChat and image workspace**: Markdown, code blocks, attachments, model favorites, reasoning controls, and image generation/editing.
- **Codex / Claude workflows**: project folders, full-access or restricted mode, execution logs, plan panel, persistent sessions, and stop control.
- **Skills and plugins**: open command/skill/plugin pickers from the toolbar or with `/`, with install, favorite, note, translate, and insert actions.
- **System settings**: manage custom API relay, Claude / Codex deployment state, device binding, and desktop API keys.
- **Privacy and compliance**: first-login legal confirmation plus safety reminders before new development sessions.
- **Desktop updates**: installer, portable package, ZIP package, and update manifest support.

### Interface Scope

- System settings and environment deployment
- AIChat / image workspace
- Codex / Claude project logs and model selection
- Wallet usage, subscriptions, and service status
- Privacy compliance modal and app linking

### Tech Stack

- Electron 42
- React 19
- TypeScript 6
- Vite 8
- electron-builder
- Zustand, Axios, Lucide React, React Markdown, Mermaid

### Project Structure

```text
.
├── build/                 # App icons and installer assets
├── electron/              # Electron main-process source
├── public/                # Static assets
├── scripts/               # Packaging, icon, and release helper scripts
├── src/                   # React renderer source
├── docs/                  # Project docs and security checklist
├── package.json           # Scripts, dependencies, and electron-builder config
└── vite.config.ts         # Vite/Electron build config
```

### Local Development

```powershell
npm install
npm run dev
```

Start Electron in development mode:

```powershell
npm run dev:electron
```

### Test and Build

```powershell
npm test
npm run build
npm run build:win
```

Windows release artifacts are written to `release/`:

- `OneAPI_PC_Setup-1-0.exe`: Windows installer
- `OneAPI_PC-1-0.exe`: portable executable
- `OneAPI_PC-1-0.zip`: portable ZIP package
- `latest.yml`: update manifest

### Environment and Security

- Do not commit `server.env`, `.env*`, keys, tokens, private server addresses, or local credentials.
- `release/`, `dist/`, `dist-electron/`, `.cache/`, and `node_modules/` are generated locally and should not be committed.
- Before publishing, review [docs/open-source-security-checklist.md](docs/open-source-security-checklist.md) and run the source scan listed there.
- When using third-party models or API keys, prompts, attachments, code, logs, and conversation context may be processed by the selected provider. Follow the platform privacy policy and content safety rules.

### License and Attribution

This project is licensed under the [Apache License 2.0](LICENSE) and includes a [NOTICE](NOTICE) file for attribution and rights statements. Modified, redistributed, or derivative versions must retain the original copyright notices, license text, and NOTICE file, and must clearly state that they are based on OneAPI PC.

The names `OneAPI`, `OneAPI PC`, `OneAPI MAC`, project logos, official hosted services, subscription products, update channels, and related commercial rights are not licensed with the source code. Use of OneAPI branding, official service endpoints, or commercial distribution channels may require separate permission from the rights holder.
