# Design: FEAT-002 Spec Protocol Foundation

## Design Summary

Spec Protocol Engine 是需求事实源。它接收原始输入，扫描当前项目的 Spec Sources，生成 Feature、Requirement、AcceptanceCriteria、TestScenario、ClarificationLog、RequirementChecklist、SpecVersion 和 SpecSlice，并向调度、Runner 和 Status Checker 提供可验证上下文。

## Components

| Component | Responsibility |
|---|---|
| Spec Source Scanner | 扫描 PRD、EARS、requirements、HLD、design、Feature Spec、tasks 和 README / 索引等来源，输出路径、类型、追踪关系、缺失项、冲突项和澄清项。 |
| Requirement Intake | 解析自然语言、PR、RP、PRD、EARS 或混合格式输入。 |
| EARS Decomposer | 生成原子化、可测试、带来源追踪的 EARS Requirement。 |
| Feature Spec Manager | 管理 Feature Spec 生命周期、来源、优先级、假设和不做范围。 |
| Clarification Log | 记录问题、推荐答案、用户答案、影响范围、时间戳和责任人。 |
| Requirement Checklist | 判断 Feature 是否达到 `ready` 质量门槛。 |
| Spec Version Manager | 按 MAJOR、MINOR、PATCH 记录 Spec 演进。 |
| Spec Slicer | 为任务和状态检测生成可追踪 Spec 片段。 |

## Data Ownership

- Owns: Feature、Requirement、AcceptanceCriteria、TestScenario、ClarificationLog、RequirementChecklist、SpecVersion、SpecSlice、SpecSourceScanResult。
- Writes: Persistent Store 和 `.autobuild/specs/` 投影。
- Provides: FEAT-004 的 Feature Spec Pool，FEAT-009 的 Spec Alignment 输入。

## State and Flow

1. 阶段 2 开始时，Spec Source Scanner 自动扫描当前项目的 PRD、EARS、requirements、HLD、design、Feature Spec、tasks 和 README / 索引。
2. Requirement Intake 合并扫描结果和用户上传或提交的需求输入。
3. EARS Decomposer 生成 Requirement 和验收候选。
4. Feature Spec Manager 创建或更新 Feature。
5. Checklist 判断是否可以进入 `ready`。
6. 歧义或冲突写入 Clarification Log，并保持 `draft` 或 `review_needed`。
7. 每次变更生成 SpecVersion。

当 Feature Spec 拆分结果包含项目初始化作为首个 Feature Spec 时，Feature Spec Manager 必须在该 Feature 的 `requirements.md`、`design.md` 和 `tasks.md` 中固化 `.gitignore` 创建或安全更新要求。该规则服务于目标项目的规格生成，不绑定 SpecDrive AutoBuild 自身仓库。

Spec Source Scanner 只读已有规格产物；HLD 生成、Feature Spec 拆分和规划流水线由 FEAT-004 的阶段 3 受控流程负责。

## Dependencies

- FEAT-003 的 CLI Skill Directory。
- FEAT-014 的 Spec 实体持久化和审计能力。

## Review and Evidence

- 需求歧义、高影响范围变更和 checklist 未通过结果必须进入 Review Center 或保留为明确阻塞。
- Spec Slice 必须记录来源 Requirement 和 Acceptance Criteria，支持 Status Checker 做 alignment。
