# FEAT-018 Codex App Server Adapter — 设计

Feature ID: FEAT-018
来源需求: REQ-080、REQ-081
HLD 参考: 第 9 节 Codex App Server Adapter

## 1. 架构决策

- `codex.app_server.run` 与现有 `cli.run` 并存，不替换 CLI Adapter。
- Runner 是唯一允许调用 app-server thread/turn API 的组件。
- Adapter 可连接已有 app-server 或按配置启动 `codex app-server`。
- `SkillInvocationContractV1` 序列化为 turn input，`SkillOutputContractV1` JSON Schema 作为 outputSchema。

## 2. Contract

`CodexAppServerRunContextV1` 包含 workspaceRoot、featureId、taskId、sourcePaths、expectedArtifacts、specState、skillSlug、requestedAction、outputSchema。

`AppServerExecutionProjectionV1` 包含 executionId、threadId、turnId、eventRefs、approvalState、producedArtifacts、summary、error。

## 3. 验证策略

- Integration tests 使用 mock app-server JSON-RPC fixture 覆盖 initialize、thread/start、turn/start、approval request、turn/completed success/failure。
- Unit tests 覆盖 protocol error、capability/schema detection 和 raw log projection。
