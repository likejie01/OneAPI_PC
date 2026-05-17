# 领域 API 规范

## 1. 聊天域

- 读取可用模型：`GET /api/user/models`
- 读取用户分组：`GET /api/user/self/groups`
- 发送聊天：`POST /v1/chat/completions`
- 流式聊天：沿用现有 SSE / 流式请求能力

## 2. 助手域

- 助手列表：客户端本地持久化优先
- 助手 CRUD：客户端领域层封装
- 提示词、默认模型、参数、标签、启用状态均可编辑

## 3. 订阅域

- 套餐列表：`GET /api/subscription/plans`
- 当前订阅：`GET /api/subscription/self`
- 付款信息：`GET /api/subscription/payment/info`
- 钱包购买：`POST /api/subscription/wallet/pay`

## 4. 钱包域

- 用户信息：`GET /api/user/self`
- 充值信息：`GET /api/user/topup/info`
- 历史充值：`GET /api/user/topup/self`

## 5. 用量域

- 用量统计：`GET /api/usage/token`
- 日志统计：`GET /api/log/self/stat`
- 日志列表：`GET /api/log/self`

## 6. 我的域

- 个人信息：`GET /api/user/self`
- Key 列表：`GET /api/token/`
- Key 详情：`GET /api/token/:id`
- 查看原 key：`POST /api/token/:id/key`
- 新建 key：`POST /api/token/`
- 更新 key：`PUT /api/token/`
- 删除 key：`DELETE /api/token/:id/`
- 批量获取 key：`POST /api/token/batch/keys`

## 7. 安全验证

- 验证接口：`POST /api/verify`
- 2FA 状态：`GET /api/user/2fa/status`
- Passkey 状态：`GET /api/user/passkey`
- 验证成功后缓存 30 分钟

