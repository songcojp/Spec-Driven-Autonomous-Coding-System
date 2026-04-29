# Tasks: FEAT-007 Workspace Isolation

- [x] TASK-001: 定义 WorktreeRecord、ConflictCheckResult 和 MergeReadinessResult 数据模型。
- [x] TASK-002: 实现 worktree 创建、分支命名、base commit 和目标分支记录。
- [x] TASK-003: 实现写入冲突分类规则，覆盖同文件、锁文件、schema、公共配置和共享资源。
- [x] TASK-004: 实现并行 Feature 开关检查，禁止依赖未完成或文件范围冲突的 Feature 并行。
- [x] TASK-005: 实现合并前冲突检测入口，并接入 Spec Alignment 和必要测试结果。
- [x] TASK-006: 实现回滚边界记录，包括 base commit、diff 摘要和任务分支。
- [x] TASK-007: 实现 worktree 清理状态机，避免清理未交付或含用户修改的路径。
- [x] TASK-008: 添加冲突分类、并行阻断、合并前检查和清理安全测试。
- [ ] TASK-009: 将并行写入策略固化为可执行判定：只读可并行、不同文件可并行、同文件或同分支写入默认串行、高风险任务单 Agent。
- [ ] TASK-010: 为集成测试和端到端测试记录可审计的测试资源隔离边界，覆盖 Run Contract、Evidence Pack、workspace schema 和测试运行器输入。
