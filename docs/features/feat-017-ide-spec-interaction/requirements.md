# FEAT-017 IDE Spec Interaction — 需求

Feature ID: FEAT-017
Feature 名称: IDE Spec Interaction
状态: done
里程碑: M8
依赖: FEAT-016、FEAT-002、FEAT-012

## 目标

在 VSCode Spec 文档中提供 Hover、CodeLens、Comments 和 `SpecChangeRequestV1` 提交流程，使澄清、需求新增、需求变更和规划类意图都通过 Control Plane 受控命令进入后续 Spec 流程。

## 来源需求

| 需求 ID | 描述 | 来源 |
|---|---|---|
| REQ-076 | 提供 VSCode 文档 Hover、CodeLens 和 Comments | VSCode 插件 PRD REQ-VSC-004 至 REQ-VSC-006 |
| REQ-077 | 提交 SpecChangeRequest 时校验源文本 | VSCode 插件 PRD 第 7.4 节 |
| REQ-078 | 提供 IDE 受控命令接口 | VSCode 插件 PRD 第 7.3 节 |

## 验收标准

- [x] Hover 展示 requirement、Feature、traceability、状态和可用动作。
- [x] CodeLens 动作转换为受控命令，不直接修改运行状态。
- [x] Comment 草稿可提交为 `SpecChangeRequestV1`。
- [x] `textHash` 不匹配时返回 `stale_source` 并要求用户重新确认。
- [x] 新需求路由到 requirement intake；既有 requirement id 修改路由到 spec evolution。
