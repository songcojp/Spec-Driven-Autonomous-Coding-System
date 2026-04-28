# Design: FEAT-006 Project Memory and Recovery Projection

## Design Summary

Project Memory Service 维护给 Codex CLI 注入的项目级恢复投影。它从持久状态、Evidence 和状态机事件生成压缩上下文，但不拥有调度事实。Recovery Bootstrap 用 Memory、数据库、Git 和文件系统共同恢复运行状态。

## Components

| Component | Responsibility |
|---|---|
| Memory Initializer | 创建 `.autobuild/memory/project.md` 和初始版本。 |
| Memory Injector | 生成 `[PROJECT MEMORY]` 上下文块。 |
| Memory Updater | 根据 Evidence、StatusCheckResult 和 StateTransition 幂等更新。 |
| Memory Compactor | 在预算超限时压缩旧证据、决策和已完成任务。 |
| Memory Version Manager | 记录版本、时间戳、run_id 和回滚索引。 |
| Recovery Bootstrap | 重启后恢复 Run、任务、Runner 心跳、worktree、Codex session、Evidence 和 Memory。 |

## Data Ownership

- Owns: ProjectMemory、MemoryVersionRecord、MemoryCompactionEvent。
- Reads: Task/Feature 状态、Evidence、Run、Git/worktree、Codex session。
- Writes: `.autobuild/memory/project.md`、版本索引、审计事件。

## State and Flow

1. Project 创建后 Memory Initializer 写初始文件。
2. Run 启动前 Memory Injector 生成注入块。
3. Run 结束后 Memory Updater 处理 Evidence 和状态转移。
4. 超预算时 Memory Compactor 生成压缩版本。
5. 重启时 Recovery Bootstrap 对齐数据库、Git、文件系统和 Memory 投影。

## Dependencies

- FEAT-001 初始化项目。
- FEAT-004 提供 Feature/Task 状态。
- FEAT-009 提供 Evidence 和 StatusCheckResult。
- FEAT-014 提供幂等键、版本索引和审计。

## Review and Evidence

- Memory 压缩、回滚和冲突修正必须进入 Audit Timeline。
- Memory 与真实状态冲突时，修正动作需要记录来源事实。
