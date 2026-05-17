# 平台集成规范

## 1. 共通目标

- 自动检测 Codex / Claude 是否已安装
- 自动创建用户目录下的 `.codex`、`.claude`
- 自动写入指向 `http://ai.oneapi.center/` 的配置
- 自动执行测试命令验证可用性

## 2. Codex

- 安装优先使用国内 npm 镜像
- 检测 `codex` 命令是否可用
- 配置文件优先写入 `~/.codex/config.toml`
- Windows 优先走 WSL 或本机命令行

## 3. Claude

- 安装优先使用国内 npm 镜像
- 检测 `claude` 命令是否可用
- 配置文件优先写入 `~/.claude/settings.json`
- 优先支持本机原生命令行

## 4. 安装流程

1. 检测环境
2. 安装 CLI
3. 创建目录
4. 写配置
5. 执行测试
6. 显示结果

## 5. Windows 细节

- 优先检测 PowerShell 与 WSL
- 目录统一使用 `%USERPROFILE%`
- 命令执行结果必须显示进度

