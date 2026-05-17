# AICoding Spec

## 项目名

OneAPI Windows Desktop Client

## 目标

实现一个可交付的 Windows 桌面客户端，覆盖：

- 聊天
- 助手
- 订阅
- 钱包
- 用量
- 我的
- Codex 工作台
- Claude 工作台

## 范围

- 只做 Windows
- 中文界面
- UTF-8
- Electron + React + TypeScript
- 复用远程服务 `http://ai.oneapi.center/`

## 约束

- 不改后端语义
- 不混用大型 UI 框架
- 遵循 `UISpec.md`
- 布局与 Mac 高度一致

## 完成标准

- 可登录
- 可聊天
- 可管理助手
- 可查看与购买订阅
- 可查看钱包与用量
- 可新建和查看 key
- 可进行 30 分钟密码保护
- 可安装与配置 Codex / Claude
- 可验证构建与打包

