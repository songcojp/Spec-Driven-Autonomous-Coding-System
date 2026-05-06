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
| REQ-086 | 配置项目级与 Job 级执行偏好 | 用户指令“系统级别和任务级别的服务商和 run 模式” |

## 验收标准

- [x] VSCode 插件提供 `SpecDrive: Open System Settings` 命令和 Activity Bar title action。
- [x] System Settings Webview 展示 CLI Adapter 与 RPC Adapter 的 active、draft、preset、schemaVersion、status、validation errors、last dry-run / last probe。
- [x] 用户可以在 Webview 中编辑 JSON 配置，并触发 validate、save draft、activate 和 disable。
- [x] 所有配置修改通过 extension host 调用 Control Plane command API，不直接写 SQLite、配置文件或运行事实源。
- [x] Webview 不复用 Product Console 页面、路由、App Shell 或组件实现。
- [x] Product Console 系统设置保留；VSCode 与 Product Console 共享 `cli_adapter_configs`、`rpc_adapter_configs` 和审计事实源。
- [ ] System Settings Webview 展示 CLI / RPC adapter 的默认模型、已配置 pricing models 和 validation 状态；pricing 仍写在 adapter JSON 的 `defaults.costRates` 中。
- [ ] System Settings 展示并保存当前项目的默认 provider adapter；run mode 由 adapter id 推导。
- [ ] 项目默认 provider 必须从 CLI 或 RPC adapter 配置列表中选择，并由所选 adapter 推导 run mode。
