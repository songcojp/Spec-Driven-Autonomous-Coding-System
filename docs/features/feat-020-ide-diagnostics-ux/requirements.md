# FEAT-020 IDE Diagnostics and UX Refinement — 需求

Feature ID: FEAT-020
Feature 名称: IDE Diagnostics and UX Refinement
状态: done
里程碑: M8
依赖: FEAT-016、FEAT-017、FEAT-019

## 目标

补齐 VSCode Diagnostics、日志增量渲染、diff 摘要、状态过滤、Product Console 跳转、插件重载恢复和多语言 UI 预留，使 IDE 入口可用于日常持续操作。

## 来源需求

| 需求 ID | 描述 | 来源 |
|---|---|---|
| REQ-083 | 提供 VSCode Diagnostics 和体验增强 | VSCode 插件 PRD REQ-VSC-007 |

## 验收标准

- [x] 缺失 requirement id、acceptance criteria 或 Feature 三件套时显示 warning。
- [x] blocked / failed Feature 对应文件或节点显示 problem marker。
- [x] Diagnostics 来自文件扫描、spec-state 或 Control Plane 查询结果。
- [x] 插件重载后恢复 Spec Explorer、Task Queue、pending approval 和最近执行状态。
- [x] 日志和 diff 摘要可增量查看，并能跳转 Product Console。
