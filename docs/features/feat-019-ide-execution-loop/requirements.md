# FEAT-019 IDE Execution Loop — 需求

Feature ID: FEAT-019
Feature 名称: IDE Execution Loop
状态: todo
里程碑: M8
依赖: FEAT-016、FEAT-018、FEAT-004、FEAT-008、FEAT-014

## 目标

打通 VSCode Task Queue 到 Runner app-server 执行闭环，支持 Feature/Task 入队、立即运行、暂停、恢复、重试、取消、跳过、重排优先级、Execution Record 查看和 app-server 审批。

## 来源需求

| 需求 ID | 描述 | 来源 |
|---|---|---|
| REQ-079 | 管理 VSCode Task Queue 动作 | VSCode 插件 PRD REQ-VSC-003、第 7.6 节 |
| REQ-081 | 记录 RPC Execution Projection | VSCode 插件 PRD 第 7.9 节 |
| REQ-082 | 支持 VSCode app-server 审批交互 | VSCode 插件 PRD 第 7.8 节 |
| REQ-086 | 配置项目级与 Job 级执行偏好 | 用户指令“系统级别和任务级别的服务商和 run 模式” |

## 验收标准

- [ ] Task Queue 支持 enqueue、run now、pause、resume、retry、cancel、skip、reprioritize 和 refresh。
- [ ] running Job cancel 必须调用 Runner `turn/interrupt`。
- [ ] retry 引用上一条 execution id，并创建新 Job 和 Execution Record。
- [ ] approval pending 可恢复，插件重载后仍能展示。
- [ ] 未响应审批不得自动通过。
- [ ] Enqueue、Run Now 和 Start Auto Run 创建新 Job 时可以携带 Job 级 `runMode` 与 provider adapter，覆盖项目级默认。
- [ ] Feature Spec Webview 多选 Feature 后点击 Schedule 时，每个选中 Feature 都创建独立 `feature_execution` Job，并携带同一组 Job 级 `runMode` 与 provider adapter。
- [ ] `cli` 偏好创建 `cli.run`，`rpc` 偏好创建 `rpc.run`，且 Execution Record 记录最终偏好。
- [ ] Retry 继承 previous execution 的 run mode 与 provider adapter。
