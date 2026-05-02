# FEAT-020 IDE Diagnostics and UX Refinement — 设计

Feature ID: FEAT-020
来源需求: REQ-083
HLD 参考: 第 7.15 节 VSCode SpecDrive Extension

## 1. 架构决策

- Diagnostics 由三类事实源合并：workspace 文件扫描、Feature `spec-state.json`、Control Plane queue/execution 查询。
- 日志增量渲染消费 raw log refs，不把完整聊天记录写入 `spec-state.json`。
- Product Console 跳转只作为辅助入口，状态事实源仍为 workspace 文件和 Execution Record。
- 多语言 UI 预留使用 VSCode locale 和用户配置，不翻译事实数据、路径、日志、diff 或命令输出。

## 2. 验证策略

- Extension tests 覆盖 diagnostics lifecycle、problem marker、reload recovery 和 Product Console deep link。
- 手动验证打开当前仓库、查看 Feature queue、触发 mock execution、重载窗口恢复状态。
