# FEAT-016 SpecDrive IDE Foundation — 需求

Feature ID: FEAT-016
Feature 名称: SpecDrive IDE Foundation
状态: todo
里程碑: M8
依赖: FEAT-001、FEAT-002、FEAT-004、FEAT-014

## 目标

建立 VSCode 插件基础能力，使用户打开工作区后可以识别 SpecDrive 项目、连接本地 Control Plane，并通过 Spec Explorer 只读查看主线 Spec、Feature Specs、Feature 状态和 Task Queue 摘要。

## 来源需求

| 需求 ID | 描述 | 来源 |
|---|---|---|
| REQ-074 | 识别 VSCode SpecDrive 工作区 | VSCode 插件 PRD REQ-VSC-001 |
| REQ-075 | 提供 VSCode Spec Explorer | VSCode 插件 PRD REQ-VSC-002、REQ-VSC-003 |

## 验收标准

- [ ] 插件可识别多语言和单语言 SpecDrive 文档结构。
- [ ] 插件能读取 `docs/features/README.md`、`feature-pool-queue.json` 和 Feature `spec-state.json`。
- [ ] Spec Explorer 展示 PRD、requirements、HLD、Feature Specs 和 Task Queue。
- [ ] 点击树节点打开对应文件、状态面板或最近 Execution Record。
- [ ] 未识别到项目时只显示初始化/连接提示，不执行调度。
