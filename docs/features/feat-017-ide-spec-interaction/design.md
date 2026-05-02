# FEAT-017 IDE Spec Interaction — 设计

Feature ID: FEAT-017
来源需求: REQ-076、REQ-077、REQ-078
HLD 参考: 第 7.15 节 VSCode SpecDrive Extension

## 1. 架构决策

- Hover 和 CodeLens 只读解析当前文档和 Control Plane 查询结果。
- Comments API 保存本地草稿，提交时生成 `SpecChangeRequestV1`。
- Control Plane command API 负责校验 projectId、workspaceRoot、source path、adapter config、权限边界和 `textHash`。
- 文档写入由 Codex 执行并通过 Git diff 呈现；插件只提交意图和展示结果。

## 2. Contract

`SpecChangeRequestV1` 至少包含：

- projectId
- workspaceRoot
- source file / range / textHash
- intent
- comment
- targetRequirementId
- traceability

## 3. 验证策略

- Node tests 覆盖 textHash stale detection、intent routing 和 command validation。
- VSCode extension tests 覆盖 Hover、CodeLens provider 和 Comments lifecycle。
