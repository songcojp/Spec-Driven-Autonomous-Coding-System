# Feature Spec: FEAT-007 Workspace Isolation

## Source Mapping

| Source | IDs / Sections |
|---|---|
| PRD | 第 6.4 节 FR-032；第 6.6 节 FR-058；第 6.8 节 FR-063；第 9.1 至 9.2 节 |
| Requirements | REQ-017, REQ-032, REQ-035, EDGE-004, EDGE-005, NFR-002 |
| HLD | 7.7 Workspace Manager, 11 Security, Privacy, and Governance, 13 Deployment and Runtime Topology |

## Scope

- 为并行 Feature、任务或任务组创建独立 Git worktree 和隔离分支。
- 记录 worktree 路径、分支名、base commit、目标分支、关联 Feature/Task、Runner 和清理状态。
- 判断同文件、锁文件、数据库 schema、公共配置和共享运行时资源是否必须串行。
- 合并前执行冲突检测、Spec Alignment Check 和必要测试。
- 支持回滚自动修改和失败任务重放所需的 workspace 边界。

## Non-Scope

- 不执行 Codex Run；执行归属 FEAT-008。
- 不完成 Spec Alignment 算法；检测归属 FEAT-009。
- 不创建 PR；交付归属 FEAT-012。

## User Value

系统可以安全地把写入任务隔离到明确 worktree 和分支中，降低并行修改冲突，并为失败回滚提供可执行边界。

## Requirements

- 任意并行写入都必须追踪到独立 worktree、分支、任务标识和合并目标。
- 互相影响文件或依赖的 Feature 不得并行 implementing。
- 合并前必须执行冲突检测、Spec Alignment Check 和必要测试。
- 并行写入冲突时必须禁止并行或要求隔离并进入合并前检测。
- 共享运行时资源污染风险必须使用 mock、命名空间隔离、临时容器、独立实例或串行执行。

## Acceptance Criteria

- [ ] worktree 记录包含路径、分支、base commit、目标分支、Feature/Task、Runner 和清理状态。
- [ ] 同文件、高冲突目录、schema、锁文件或公共配置默认串行。
- [ ] 合并前检查可以阻止冲突或未通过测试的变更。
- [ ] 高风险或失败修改有可执行回滚路径。

## Risks and Open Questions

- 数据库、缓存和外部 API 的运行时隔离策略可能超出 MVP，需先保留串行和 mock 兜底。
- worktree 清理必须避免删除用户未提交的人工修改。
