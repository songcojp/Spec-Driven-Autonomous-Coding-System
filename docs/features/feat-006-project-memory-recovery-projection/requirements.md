# Feature Spec: FEAT-006 Project Memory and Recovery Projection

## Source Mapping

| Source | IDs / Sections |
|---|---|
| PRD | 第 4.4 节；第 6.5 节 FR-044 至 FR-048；第 6.8 节 FR-064 |
| Requirements | REQ-019, REQ-020, REQ-021, REQ-022, REQ-023, REQ-036, EDGE-006, EDGE-007, NFR-003, NFR-004 |
| HLD | 7.6 Project Memory Service, 10.4 Review and Recovery Workflow, 13 Deployment and Runtime Topology |

## Scope

- 初始化 `.autobuild/memory/project.md`，包含项目名称、目标、默认分支、当前 Spec 版本、初始任务状态快照和空运行记录。
- 在 Codex CLI 会话启动前注入 `[PROJECT MEMORY]` 上下文块。
- 根据 Evidence Pack、Status Checker 和状态转移幂等更新 Project Memory。
- 超过默认 8000 tokens 预算时压缩旧 Evidence 摘要、历史决策和已完成任务列表。
- 维护包含时间戳和 run_id 的 Memory 版本记录，并支持查看和回滚。
- 系统重启或 Runner 恢复时恢复未完成 Run、任务、Runner 心跳、Git worktree、Codex session、最近 Evidence 和 Memory。

## Non-Scope

- Project Memory 不是 Feature Spec Pool、Persistent Store 或 Git 状态的真实来源。
- 不实现完整失败恢复策略；恢复归属 FEAT-010。
- 不实现 UI 展示；Memory 状态展示归属 FEAT-013。

## User Value

长时间 CLI 会话可以跨重启和恢复保留当前目标、任务状态、关键决策、阻塞和失败模式，减少重复探索和上下文丢失。

## Requirements

- 新项目必须包含可读取的 Project Memory 文件。
- CLI 会话可以从 Project Memory 恢复当前任务、看板状态、上次 Run、阻塞、禁止操作和待审批事项。
- Memory 更新必须可幂等重放。
- 压缩不得删除当前任务、当前状态快照、当前阻塞和禁止操作。
- Memory 与真实状态冲突时必须以 Persistent Store、Git/worktree 和文件系统核查结果为准。

## Acceptance Criteria

- [ ] `.autobuild/memory/project.md` 初始化成功且可读取。
- [ ] Codex CLI 会话前可以生成 `[PROJECT MEMORY]` 注入内容。
- [ ] Run 结束后 Memory 更新任务状态、决策、阻塞和失败模式。
- [ ] 每次压缩操作都写入审计日志。
- [ ] 重启后系统能继续未完成流程或明确标记阻塞原因。

## Risks and Open Questions

- 默认 8000 tokens 预算是否按项目规模配置仍待确认。
- Memory 回滚必须避免覆盖调度真实状态。
