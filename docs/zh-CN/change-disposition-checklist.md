# 需求新增与变更待处置清单

本文记录从 PRD 与需求文档对比中识别出的新增项和变更项，供人工 Spec 后续流程逐项处置。本文不是通用模板；它是当前这一批问题的待处理清单。

状态说明：

- `待人工确认`：需要你判断是否进入后续 Spec 流程。
- `已写入主线文档`：已进入 PRD、requirements 或 HLD，但仍可能需要人工决定执行策略。
- `需同步实现`：需要后续 Feature Spec、任务或代码实现跟进。
- `需拆分后续 Feature`：不宜塞回已完成 Feature，需要单独形成后续工作。

## 新增清单

| ID | 新增项 | 来源 | 当前文档状态 | 建议后续处置 |
|---|---|---|---|---|
| ADD-001 | 项目宪章创建、导入和生命周期管理 | PRD 第 5 节阶段 1；FR-021 `project-constitution-skill` | 已写入 `REQ-059`、HLD、FEAT-001；已同步为 FEAT-001 follow-up | 作为已完成 FEAT-001 的 follow-up 处理，不拆独立 Project Constitution Feature；后续实现 `TASK-009` 至 `TASK-011`。 |
| ADD-002 | 调度触发模式 | PRD 第 6.8 节 FR-060 | 已写入 `REQ-060`、HLD、FEAT-004 | 人工确认 MVP 是否只实现触发记录与手动/定时入口，还是同时接入 CI/审批/依赖事件。 |
| ADD-003 | Dashboard Board 操作能力 | PRD 第 8.5 节 | 已写入 `REQ-061`、HLD、FEAT-013 | 人工确认拖拽、批量排期、批量运行的 MVP 范围；建议先做受控命令，不直接改状态。 |

## 变更清单

| ID | 变更项 | 来源 | 当前文档状态 | 建议后续处置 |
|---|---|---|---|---|
| CHG-001 | Project 数据模型补充 `trust_level` / 信任级别 | PRD 第 7 节 Project 数据模型；NFR-001 安全策略 | 已增强 `REQ-001`、HLD、FEAT-001 | 人工确认现有 Project schema/实现是否已有字段；如没有，进入后续 schema migration 或 FEAT-001 patch。 |
| CHG-002 | 并行写入策略补全 | PRD 第 6.4 节 FR-032 | 已增强 `REQ-017`、FEAT-007 | 人工确认只读并发、不同文件并发、同文件串行、高风险单 Agent 是否都需要实现为调度规则。 |
| CHG-003 | 计划流水线补充 `quickstart-validation` 与 `spec-consistency-analysis` | PRD 第 6.3 节 FR-021；第 6.6 节 FR-056 | 已增强 `REQ-030`、FEAT-004 | 人工确认这两个 Skill 是内置 Skill 记录即可，还是需要进入 Orchestration 的强制执行步骤。 |
| CHG-004 | Worktree 隔离补充集成测试/E2E 测试资源隔离 | PRD 第 6.8 节 FR-063 | 已增强 `REQ-035`、FEAT-007 | 人工确认测试环境隔离记录落在 Run Contract、Evidence Pack、workspace schema 还是测试运行器配置中。 |
| CHG-005 | Dashboard 基础状态补充 Board 状态入口 | PRD 第 8.1 与 8.5 节 | 已增强 `REQ-052`、FEAT-013 | 人工确认 UI 是否只展示入口，还是在同一 Feature 内实现完整 Board 交互。 |
| CHG-006 | PRD 明确 MVP 不接入 Issue Tracker | PRD 非目标 | 已写入 PRD | 人工确认 requirements/HLD 是否需要补充为显式非目标或约束；当前未新增 REQ。 |
| CHG-007 | PRD 明确失败自动重试上限与退避策略 | PRD 第 6.11 节 FR-092 | 已写入 PRD | 人工确认现有 failure recovery 实现是否已匹配 3 次、2/4/8 分钟退避和失败指纹规则。 |
| CHG-008 | PRD 明确性能阈值在 MVP 中只作基线记录 | PRD 第 9.4 节 | 已写入 PRD | 人工确认 requirements 中 NFR-007 至 NFR-009 是否已足够表达；当前看起来已覆盖。 |

## 人工处置顺序建议

1. 先处理 `CHG-007`，因为它可能影响已交付的 Failure Recovery 实现行为。
2. 再处理 `CHG-001` 和 `ADD-001`，因为它们影响项目基础数据和项目初始化流程。
3. 再处理 `ADD-002`、`CHG-002`、`CHG-003`、`CHG-004`，因为它们影响调度和执行安全边界。
4. 最后处理 `ADD-003` 和 `CHG-005`，因为它们主要影响 Product Console 交互层。
5. `CHG-006` 和 `CHG-008` 可作为文档一致性检查项，不一定需要立刻形成实现任务。

## 关闭条件

- [ ] 每个 `ADD-*` 都已决定：进入现有 Feature patch、拆分新 Feature、暂缓或拒绝。
- [ ] 每个 `CHG-*` 都已决定：只保留文档、同步 Feature Spec、修改实现、补测试或无需动作。
- [ ] 影响已完成 Feature 的项已形成 follow-up、Spec Evolution 或 reopening 记录。
- [ ] 需要实现的项已写入对应 Feature Spec 或任务。
- [ ] 无需实现的项已在人工审查记录中说明原因。

## 本次处置记录

| ID | 处理结论 | 下游同步 | 状态 |
|---|---|---|---|
| ADD-001 | 进入现有 FEAT-001 patch，不拆分新 Feature。 | 已在 FEAT-001 requirements、design、tasks 中标记项目宪章 follow-up，并保留 `REQ-059` 追踪。 | 需同步实现 |
