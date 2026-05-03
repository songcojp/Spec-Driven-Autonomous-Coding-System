# FEAT-018 RPC Adapter: Multi Provider — 设计

Feature ID: FEAT-018
来源需求: REQ-080、REQ-081
HLD 参考: 第 7.8 节 Execution Adapter Layer、第 9 节 RPC Adapter

## 1. 架构决策

- `rpc.run` 是新的 RPC Adapter job type；`codex.app_server.run` 仅作为迁移期兼容别名保留。
- RPC Adapter 与 `cli.run` 并存，不替换 CLI Adapter。
- Execution Adapter Layer 是唯一允许调用 app-server thread/turn API 的组件；VSCode 插件和 Product Console 只能提交受控命令和订阅状态。
- Adapter 可连接已有 app-server、按配置启动 `codex app-server`、启动 `gemini --acp` ACP agent，或后续连接 HTTP/JSON-RPC/WebSocket 远程执行服务。
- `ExecutionAdapterInvocationV1` 是 provider 调用输入；其中的 `SkillInvocationContractV1` 序列化为 turn input，`SkillOutputContractV1` JSON Schema 作为 outputSchema。

## 2. Contract

`RpcAdapterConfigV1` 扩展 `ExecutionAdapterConfigV1`，包含 `kind = "rpc"`、`provider`、`transport` (`stdio`/`http`/`jsonrpc`/`websocket`)、`endpoint`、`command`、`args`、`headersAllowlist`、`authRef`、`requestTimeoutMs`、`capabilityDetection`、`requestMapping`、`eventMapping`、`outputMapping`。

`ExecutionAdapterInvocationV1` 包含 workspaceRoot、featureId、taskId、sourcePaths、expectedArtifacts、specState、skillSlug、requestedAction、outputSchema、resume 和 constraints。

`ExecutionAdapterResultV1.providerSession` 对 Codex app-server provider 至少包含 threadId、turnId、transport、model、cwd、capabilities、eventRefs 和 approvalState；对 Gemini ACP provider 至少包含 sessionId、transport、model、cwd、capabilities、eventRefs 和 approvalState。

`ExecutionAdapterEventV1` 用于投影 app-server turn/item 事件、Gemini ACP session update、permission request、token usage、diff update、assistant message 和 command output。raw provider payload 必须写入 raw log 或 payloadRef，不直接进入轻量 API 响应。

## 3. Provider Mapping

| Provider | Transport | Required Operations |
|---|---|---|
| `codex-app-server` | stdio / JSON-RPC | initialize、thread/start、thread/resume、turn/start、turn/interrupt、approval response、event stream。 |
| `gemini-acp` | stdio / JSON-RPC | initialize、newSession、loadSession、prompt、cancel、permission request、session update、prompt response。 |
| `http-app-server` | HTTP / JSON-RPC | capability detection、session start/resume、request start、cancel/interrupt、approval response、event stream or polling。 |
| `websocket-app-server` | WebSocket | connect、session start/resume、request start、interrupt、approval response、bidirectional event stream。 |

## 4. 验证策略

- Integration tests 使用 mock app-server JSON-RPC fixture 覆盖 initialize、thread/start、turn/start、approval request、turn/completed success/failure。
- Integration tests 使用 mock Gemini ACP JSON-RPC fixture 覆盖 initialize、newSession/loadSession、prompt success、permission request、prompt cancelled 和 protocol failure。
- Unit tests 覆盖 protocol error、capability/schema detection、adapter result projection 和 raw log projection。
- Migration tests 覆盖 `codex.app_server.run` 兼容别名进入 `rpc.run` 执行路径，但新代码和新文档不得继续把 app-server 绑定到 Runner 概念。
