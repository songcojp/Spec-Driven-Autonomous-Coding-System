# SpecDrive IDE 开发规划

## Summary

基于 `docs/zh-CN/vscode-codex-rpc-prd.md`，SpecDrive IDE 按 5 个 Feature 交付：先做 VSCode 只读入口，再补文档交互和受控命令，随后实现 Codex RPC Adapter，最后闭合执行、审批、结果投影和体验增强。核心边界保持不变：VSCode 插件只做 IDE UI、查询、受控命令提交和状态订阅；Control Plane / Scheduler / Runner / Execution Record / 文件化 Spec 状态继续作为事实源。

建议新增 Feature Specs：

- `FEAT-016 SpecDrive IDE Foundation`
- `FEAT-017 IDE Spec Interaction`
- `FEAT-018 Codex RPC Adapter`
- `FEAT-019 IDE Execution Loop`
- `FEAT-020 IDE Diagnostics and UX Refinement`

## Key Changes

- 新增 VSCode 插件包，默认放在 `apps/vscode-extension/`，使用 TypeScript + VSCode Extension API；新增脚本 `ide:build`、`ide:test`，不引入独立仓库。
- 补齐 UI 中立的 Control Plane 接口，避免复用 `/console/*` 命名承载 IDE：新增查询接口用于 workspace context、spec tree、queue summary、execution detail；新增 command endpoint 接收 IDE action 并返回 command receipt。
- 将 `ConsoleCommandAction` 泛化为控制面命令模型，新增 IDE 需要的动作：`submit_spec_change_request`、`enqueue_feature`、`run_feature_now`、`run_task_now`、`pause_job`、`resume_job`、`retry_execution`、`cancel_execution`、`skip_feature`、`reprioritize_job`、`approve_app_server_request`。
- 新增 `codex.rpc.run` executor/adapter，与现有 `cli.run` 并存；Runner 是唯一调用 `thread/start`、`thread/resume`、`turn/start`、`turn/interrupt` 的组件。
- Execution Record 扩展记录 app-server `threadId`、`turnId`、transport、capabilities、raw event log reference、approval state、output schema validation result；不新增重型 Evidence Pack。
- `feature-pool-queue.json` 和 `docs/features/<feature-id>/spec-state.json` 仍为 Feature 文件化状态事实源；SQLite 仍保存 scheduler job、execution record、adapter config、command receipt、raw logs 和轻量活动记录。

## Implementation Plan

- FEAT-016：建立插件骨架、Control Plane client、workspace 识别、Spec Explorer 只读树、PRD / requirements / HLD / Feature Spec 文件导航、Task Queue 只读展示。
- FEAT-017：实现 Hover、CodeLens、Comments 草稿与提交、`SpecChangeRequest` textHash 校验、stale source 处理；所有写入意图走 Control Plane command API。
- FEAT-018：实现 `CodexAppServerAdapter`，支持启动/连接 `codex app-server`、initialize/initialized、thread start/resume、turn start/interrupt、capability/schema 检测、事件流落 raw logs。
- FEAT-019：打通 Feature/Task 执行闭环、Execution Record Webview、approval pending 恢复、取消/重试/恢复、`SkillOutputContractV1` 校验和 `spec-state.json` 投影。
- FEAT-020：补完整 Diagnostics、日志增量渲染、diff 摘要、状态过滤、Product Console 跳转、插件重载恢复、性能优化和多语言 UI 预留。

## Interfaces And Contracts

- `SpecDriveWorkspaceContextV1`：workspaceRoot、specRoot、language、projectId、activeAdapter、controlPlaneHealth、recognizedSources。
- `SpecTreeNodeV1`：nodeType、id、label、path、status、priority、dependencies、blockedReasons、latestExecutionId。
- `SpecChangeRequestV1`：projectId、workspaceRoot、source file/range/textHash、intent、comment、targetRequirementId、traceability。
- `IdeCommandReceiptV1`：commandId、action、status、schedulerJobId、executionId、blockedReasons、acceptedAt。
- `CodexAppServerRunContextV1`：workspaceRoot、featureId、taskId、sourcePaths、expectedArtifacts、specState、skillSlug、requestedAction、outputSchema。
- `AppServerExecutionProjectionV1`：executionId、threadId、turnId、eventRefs、approvalState、producedArtifacts、summary、error。

## Test Plan

- Node tests：workspace/spec discovery、command validation、textHash stale detection、queue actions、retry/cancel state transitions、Codex RPC adapter fixtures、Execution Record projection。
- VSCode extension tests：activation、Spec Explorer rendering、file navigation、Hover/CodeLens providers、Comments lifecycle、Webview state rendering。
- Integration tests：mock app-server JSON-RPC flow covering initialize、thread/start、turn/start、event stream、approval request、turn/completed success/failure。
- Regression tests：existing `npm test` remains green; Product Console `/console/*` behavior must not regress.
- Manual/browser-like IDE verification：open repo in VSCode, identify current SpecDrive project, view Feature queue, submit a clarification, enqueue one mock execution, reload window and recover state。

## Assumptions

- 首轮实现放在当前 monorepo，不新建外部插件仓库。
- 插件 UI 首版中文优先，但 factual artifacts、diff、logs、commands、paths 保持原文。
- Product Console 不删除，只保留系统设置、adapter 配置、队列调试和全局状态总览。
- 当前未跟踪的 `docs/zh-CN/vscode-codex-rpc-prd.md` 是本次规划来源；实施时需先把它纳入正式 Spec 流并避免误提交无关的 `docs/zh-CN/README.md` 现有改动。
