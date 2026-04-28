# Spec-Driven Autonomous Coding System

SpecDrive AutoBuild 是一个由 Spec 驱动的自主编程系统，用于支持长时间运行、可审计的软件交付。

语言： [English](README.md) | 中文 | [日本語](README.ja.md)

---

## 项目简介

SpecDrive AutoBuild 是一个面向软件团队的长时间自主编程系统。它以结构化 Spec 管理产品目标和验收标准，以 Skill 固化可复用工程方法，以 Subagent 隔离上下文并执行任务，以 Codex Runner 完成代码修改、测试、修复和 PR 生成，以内部任务状态机管理任务流转、审批、恢复和交付，并通过看板呈现状态。

一句话：

> 让 AI 在可控、可恢复、可审计的工程流程中持续交付代码。

## 核心组成

```text
Spec Protocol
+ Skill System
+ Subagent Runtime
+ Context Broker
+ Codex Runner
+ Internal Task State Machine
+ Kanban View
```

## 核心能力

* 从自然语言需求生成结构化 Feature Spec。
* 将 PR、RP、PRD 和 EARS 格式需求拆解为可追踪的 Feature Spec。
* 基于 Spec 生成技术计划、任务图、验收标准和风险规则。
* 将大任务拆分为上下文隔离、边界明确的 Subagent Run。
* 为每个 Subagent 提供最小必要上下文，降低上下文污染。
* 使用 Codex Runner 执行编码、测试、修复和 PR 生成。
* 自动判断任务完成、失败、阻塞或需要人工审批。
* 支持长时间运行、失败重试、断点恢复和交付审计。

## 当前状态

本仓库当前处于产品设计阶段，核心产物是 PRD：

* [docs/README.md](docs/README.md)
* [docs/zh-CN/PRD.md](docs/zh-CN/PRD.md)

## MVP 范围

MVP 计划覆盖：

* Spec Protocol 与项目创建。
* Skill 注册、执行和版本管理。
* Subagent Runtime 与 Agent Run Contract。
* Context Broker 与 Evidence Pack。
* Codex Runner 集成。
* 内部任务状态机、看板状态展示、状态检测、失败恢复。
* Review Center、PR 生成和交付报告。

## 里程碑计划

项目计划按以下里程碑演进：

### M1：单项目自主开发

建立面向单个软件项目的完整自主交付闭环。系统应支持项目初始化、Spec 维护、工作选择、任务生成、Codex CLI 执行、证据收集、失败恢复，并产出评审记录、PR 和交付报告等交付物。

### M2：适配更多 CLI

引入 Runner 抽象，使系统能够在 Codex Runner 之外接入更多编码 CLI。运行时需要统一不同 CLI 的命令执行、沙箱策略、上下文注入、证据收集、错误处理和结果回传方式。

### M3：完善开发过程

强化自主开发过程中的工程治理能力，包括更完整的测试计划、分层验证、质量门禁、发布证据、部署准备、环境检查、部署执行、回滚指引，以及更清晰的人工审批节点。

### M4：支持多项目

将系统从单项目自主开发扩展为多项目组合管理。平台应支持项目注册、项目级记忆隔离、独立 Spec 与看板、共享 Skill 治理、跨项目调度、组合级可视化，以及多个活跃交付流之间的安全协同。
