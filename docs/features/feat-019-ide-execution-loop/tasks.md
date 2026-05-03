# FEAT-019 IDE Execution Loop — 任务

Feature ID: FEAT-019
来源需求: REQ-079、REQ-081、REQ-082
状态: done

## 任务列表

### T-019-01 Queue Command Actions
状态: done
描述: 实现 IDE queue action 到 Control Plane command API 的映射和回执展示。
验证: `npm run ide:test` 覆盖 retry、cancel、execution detail；`npm run ide:build` 覆盖 VSCode 命令映射类型检查。

### T-019-02 Execution Record 面板
状态: done
描述: 展示 thread/turn、raw logs、diff summary、produced artifacts 和 output schema 校验结果。
验证: `npm run ide:test` 覆盖 Execution Detail projection；VSCode extension 使用 Webview 展示 thread/turn、raw logs、produced artifacts、contract validation 和 approval requests。

### T-019-03 Approval Pending 恢复
状态: done
描述: 展示 Codex RPC approval request，并支持 accept、acceptForSession、decline、cancel。
验证: `npm run ide:test` 覆盖 approval request projection；VSCode Task Queue context menu 提供 accept、acceptForSession、decline、cancel 命令并写回 Execution Record。

### T-019-04 Cancel / Retry / Resume
状态: done
描述: 实现 running turn interrupt、retry 关联 previous execution、blocked resume。
验证: `npm run ide:test` 覆盖 running cancel 调用 `turn/interrupt`、retry 保留 previous execution 并创建新 Job / Execution Record。
