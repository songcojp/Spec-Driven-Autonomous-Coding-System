# FEAT-022 IDE System Settings Webview — 设计

Feature ID: FEAT-022
来源需求: REQ-085
HLD 参考: 第 7.15 节 VSCode SpecDrive Extension

## 1. 架构决策

- 新增 VSCode System Settings Webview，作为 IDE 内系统设置管理入口。
- 查询使用 `GET /ide/system-settings`，返回 IDE 可消费的 CLI/RPC Adapter 设置投影。
- 修改使用现有 `POST /ide/commands` 受控命令通道，动作与 Product Console 保持一致。
- 配置事实源仍为 `cli_adapter_configs` 与 `rpc_adapter_configs`；不新增 IDE 专属配置表。
- Webview 使用 VSCode 原生 Webview HTML/CSS 与 shared helper，不导入 Product Console UI。

## 2. 主要交互

| 区域 | 说明 |
|---|---|
| CLI Adapter | 展示 active/draft/preset、校验结果、最近 dry-run 和 JSON 编辑器。 |
| RPC Adapter | 展示 active/draft/preset、校验结果、最近 probe 和 JSON 编辑器。 |
| 操作按钮 | Validate、Save Draft、Activate、Disable、Refresh。 |
| 状态反馈 | 命令 receipt 通过 VSCode notification 展示，Webview 随后刷新配置投影。 |

## 3. 边界

- Webview 不直接访问 SQLite、Scheduler 内部状态、配置文件或运行事实源。
- `activate` 失败不得覆盖现有 active adapter。
- Product Console 与 VSCode System Settings 是两个 UI 入口，不是两套配置状态。

## 4. 验证策略

- Node tests 覆盖 `/ide/system-settings` 和 `/ide/commands` 中 CLI/RPC Adapter 受控命令。
- Webview boundary test 覆盖命令注册、Activity Bar title action、消息路由和 Product Console UI 隔离。
- `npm run ide:build` 覆盖 VSCode extension 类型与 Webview 编译。
