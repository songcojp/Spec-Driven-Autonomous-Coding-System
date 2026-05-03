# FEAT-022 IDE System Settings Webview — 需求

Feature ID: FEAT-022
Feature 名称: IDE System Settings Webview
状态: done
里程碑: M8
依赖: FEAT-016、FEAT-018、FEAT-021

## 目标

在 VSCode 插件中新增独立 System Settings Webview，使用户可以在 IDE 内管理 CLI Adapter 与 RPC Adapter 配置，同时继续复用 Control Plane 受控命令、审计和现有配置事实源。

## 来源需求

| 需求 ID | 描述 | 来源 |
|---|---|---|
| REQ-085 | 在 VSCode IDE 中管理系统设置 | 用户指令“vscode ide添加系统设置” |

## 验收标准

- [x] VSCode 插件提供 `SpecDrive: Open System Settings` 命令和 Activity Bar title action。
- [x] System Settings Webview 展示 CLI Adapter 与 RPC Adapter 的 active、draft、preset、schemaVersion、status、validation errors、last dry-run / last probe。
- [x] 用户可以在 Webview 中编辑 JSON 配置，并触发 validate、save draft、activate 和 disable。
- [x] 所有配置修改通过 extension host 调用 Control Plane command API，不直接写 SQLite、配置文件或运行事实源。
- [x] Webview 不复用 Product Console 页面、路由、App Shell 或组件实现。
- [x] Product Console 系统设置保留；VSCode 与 Product Console 共享 `cli_adapter_configs`、`rpc_adapter_configs` 和审计事实源。
