# OneAPI PC

[中文](#中文) | [English](#english)

## 中文

OneAPI PC 是一个基于 Electron、React、TypeScript 和 Vite 的桌面客户端。项目面向 Windows 桌面环境，提供 OneAPI 账号登录、订阅与用量展示、AI Chat、Codex/Claude 执行日志、插件与技能选择、Markdown 渲染以及本地桌面能力集成。

### 功能概览

- OneAPI 账号登录、订阅套餐展示和用量进度展示
- AI Chat 对话界面，支持 Markdown、代码块和附件预览
- Codex 与 Claude 工作流界面，展示运行日志、工具调用和执行状态
- 助手、skill、plugin 等扩展选择入口
- 明亮/暗黑主题下的桌面端 UI 适配
- Electron 打包，支持 Windows 安装包和便携版构建

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
├── electron/              # Electron 主进程相关源码
├── public/                # 静态资源
├── scripts/               # 打包与图标处理脚本
├── src/                   # React 渲染进程源码
├── docs/                  # 项目文档与安全检查清单
├── package.json           # 脚本、依赖和 electron-builder 配置
└── vite.config.ts         # Vite/Electron 构建配置
```

### 本地开发

安装依赖：

```powershell
npm install
```

启动 Vite 开发服务器：

```powershell
npm run dev
```

启动 Electron 开发模式：

```powershell
npm run dev:electron
```

### 测试和构建

运行测试：

```powershell
npm test
```

运行生产构建：

```powershell
npm run build
```

打包 Windows 安装包和便携版：

```powershell
npm run build:win
```

构建产物会生成到 `release/`，该目录不会提交到 Git。

### 环境与安全

- 不要提交 `server.env`、`.env*`、密钥、令牌、私有服务器地址或任何本地凭据。
- `release/`、`dist/`、`dist-electron/`、`.cache/` 和 `node_modules/` 均为本地生成内容，不应进入仓库。
- 发布前建议阅读 [docs/open-source-security-checklist.md](docs/open-source-security-checklist.md)，并执行其中的源码扫描命令。

### 许可与来源

本项目代码采用 [Apache License 2.0](LICENSE) 授权，并包含 [NOTICE](NOTICE) 来源与权益声明。二次开发、分发或派生项目必须保留原始版权、许可文本和 NOTICE，并清楚说明项目基于 OneAPI PC 修改。

`OneAPI`、`OneAPI PC`、`OneAPI MAC`、项目标识、官方服务、订阅产品、更新渠道和相关商业权益不随源码许可授权转让。如需使用 OneAPI 品牌、官方服务端点或商业分发渠道，需获得权利方单独授权。

## English

OneAPI PC is a desktop client built with Electron, React, TypeScript, and Vite. It targets Windows desktop usage and includes OneAPI account login, subscription and usage views, AI Chat, Codex/Claude execution logs, plugin and skill pickers, Markdown rendering, and local desktop integration.

### Features

- OneAPI account login, subscription plan display, and usage progress
- AI Chat interface with Markdown, code blocks, and attachment previews
- Codex and Claude workflow screens with execution logs, tool calls, and status output
- Assistant, skill, plugin, and extension selection
- Light and dark desktop UI support
- Electron packaging for Windows installer and portable builds

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
├── scripts/               # Packaging and icon scripts
├── src/                   # React renderer source
├── docs/                  # Project docs and security checklist
├── package.json           # Scripts, dependencies, and electron-builder config
└── vite.config.ts         # Vite/Electron build config
```

### Local Development

Install dependencies:

```powershell
npm install
```

Start the Vite dev server:

```powershell
npm run dev
```

Start Electron in development mode:

```powershell
npm run dev:electron
```

### Test and Build

Run tests:

```powershell
npm test
```

Run a production build:

```powershell
npm run build
```

Build the Windows installer and portable executable:

```powershell
npm run build:win
```

Build artifacts are written to `release/`, which is intentionally excluded from Git.

### Environment and Security

- Do not commit `server.env`, `.env*`, keys, tokens, private server addresses, or local credentials.
- `release/`, `dist/`, `dist-electron/`, `.cache/`, and `node_modules/` are generated locally and should not be committed.
- Before publishing, review [docs/open-source-security-checklist.md](docs/open-source-security-checklist.md) and run the source scan listed there.

### License and Attribution

This project is licensed under the [Apache License 2.0](LICENSE) and includes a [NOTICE](NOTICE) file for attribution and rights statements. Modified, redistributed, or derivative versions must retain the original copyright notices, license text, and NOTICE file, and must clearly state that they are based on OneAPI PC.

The names `OneAPI`, `OneAPI PC`, `OneAPI MAC`, project logos, official hosted services, subscription products, update channels, and related commercial rights are not licensed with the source code. Use of OneAPI branding, official service endpoints, or commercial distribution channels may require separate permission from the rights holder.
