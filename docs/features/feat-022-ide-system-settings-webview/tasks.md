# FEAT-022 IDE System Settings Webview — 任务

Feature ID: FEAT-022
来源需求: REQ-085
状态: done

## 任务列表

### T-022-01 IDE settings query
状态: done
描述: 新增 `GET /ide/system-settings`，返回共享 CLI/RPC Adapter 设置投影。
验证: `node --test tests/specdrive-ide.test.ts`

### T-022-02 Webview command entry
状态: done
描述: 注册 `specdrive.openSystemSettings` 命令、activation event 和 Spec Explorer title action。
验证: `node --test tests/specdrive-ide-webview-boundary.test.ts`

### T-022-03 Settings Webview UI
状态: done
描述: 新增独立 System Settings Webview，展示 CLI/RPC Adapter 配置、preset、校验状态和 JSON 编辑器。
验证: `npm run ide:build`

### T-022-04 Controlled settings commands
状态: done
描述: 将 validate、save draft、activate、disable 转换为 `/ide/commands` 受控命令，保留审计和配置事实源边界。
验证: `node --test tests/specdrive-ide.test.ts`

### T-022-05 Spec sync and boundary tests
状态: done
描述: 同步 requirements、HLD 和 Feature index，补充 Webview 不复用 Product Console UI 的边界测试。
验证: `git diff --check`
