# FEAT-019 IDE Execution Loop — 任务

Feature ID: FEAT-019
来源需求: REQ-079、REQ-081、REQ-082
状态: todo

## 任务列表

### T-019-01 Queue Command Actions
状态: not-started
描述: 实现 IDE queue action 到 Control Plane command API 的映射和回执展示。
验证: command action 单测。

### T-019-02 Execution Record 面板
状态: not-started
描述: 展示 thread/turn、raw logs、diff summary、produced artifacts 和 output schema 校验结果。
验证: VSCode Webview test。

### T-019-03 Approval Pending 恢复
状态: not-started
描述: 展示 app-server approval request，并支持 accept、acceptForSession、decline、cancel。
验证: approval lifecycle test。

### T-019-04 Cancel / Retry / Resume
状态: not-started
描述: 实现 running turn interrupt、retry 关联 previous execution、blocked resume。
验证: queue transition tests。
