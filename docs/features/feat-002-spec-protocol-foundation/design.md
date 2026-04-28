# Design: FEAT-002 Spec Protocol Foundation

## Design Summary

Spec Protocol Engine 是需求事实源。它接收原始输入，生成 Feature、Requirement、AcceptanceCriteria、TestScenario、ClarificationLog、RequirementChecklist、SpecVersion 和 SpecSlice，并向调度和 Subagent 提供可验证上下文。

## Components

| Component | Responsibility |
|---|---|
| Requirement Intake | 解析自然语言、PR、RP、PRD、EARS 或混合格式输入。 |
| EARS Decomposer | 生成原子化、可测试、带来源追踪的 EARS Requirement。 |
| Feature Spec Manager | 管理 Feature Spec 生命周期、来源、优先级、假设和不做范围。 |
| Clarification Log | 记录问题、推荐答案、用户答案、影响范围、时间戳和责任人。 |
| Requirement Checklist | 判断 Feature 是否达到 `ready` 质量门槛。 |
| Spec Version Manager | 按 MAJOR、MINOR、PATCH 记录 Spec 演进。 |
| Spec Slicer | 为任务和 Subagent 生成最小上下文切片。 |

## Data Ownership

- Owns: Feature、Requirement、AcceptanceCriteria、TestScenario、ClarificationLog、RequirementChecklist、SpecVersion、SpecSlice。
- Writes: Persistent Store 和 `.autobuild/specs/` 投影。
- Provides: FEAT-004 的 Feature Spec Pool，FEAT-005 的 Context Slice。

## State and Flow

1. 输入需求进入 Requirement Intake。
2. EARS Decomposer 生成 Requirement 和验收候选。
3. Feature Spec Manager 创建或更新 Feature。
4. Checklist 判断是否可以进入 `ready`。
5. 歧义或冲突写入 Clarification Log，并保持 `draft` 或 `review_needed`。
6. 每次变更生成 SpecVersion。

## Dependencies

- FEAT-003 的 Requirement Intake、EARS 和 Checklist Skill schema。
- FEAT-014 的 Spec 实体持久化和审计能力。

## Review and Evidence

- 需求歧义、高影响范围变更和 checklist 未通过结果必须进入 Review Center 或保留为明确阻塞。
- Spec Slice 必须记录来源 Requirement 和 Acceptance Criteria，支持 Status Checker 做 alignment。
