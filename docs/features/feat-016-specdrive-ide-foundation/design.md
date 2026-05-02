# FEAT-016 SpecDrive IDE Foundation — 设计

Feature ID: FEAT-016
来源需求: REQ-074、REQ-075
HLD 参考: 第 7.15 节 VSCode SpecDrive Extension

## 1. 架构决策

- 插件放在 `apps/vscode-extension/`，使用 TypeScript + VSCode Extension API。
- 插件只承担 IDE UI、只读查询、文件导航和状态订阅；不直接写运行事实源。
- Control Plane client 负责 workspace context、spec tree、queue summary 和 execution detail 查询。
- Spec Explorer 的 Feature 状态来自 `docs/features/feature-pool-queue.json`、Feature `spec-state.json` 和 Control Plane queue query 的聚合结果。

## 2. 关键模型

| Contract | 说明 |
|---|---|
| `SpecDriveWorkspaceContextV1` | workspaceRoot、specRoot、language、projectId、activeAdapter、controlPlaneHealth、recognizedSources |
| `SpecTreeNodeV1` | nodeType、id、label、path、status、priority、dependencies、blockedReasons、latestExecutionId |

## 3. 验证策略

- Node tests 覆盖 workspace/spec discovery、language fallback 和 spec tree normalization。
- VSCode extension tests 覆盖 activation、Spec Explorer rendering 和文件导航。
