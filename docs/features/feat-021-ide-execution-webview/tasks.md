# FEAT-021 IDE Workbench Webviews — 任务

Feature ID: FEAT-021
来源需求: REQ-084
状态: done

## 任务列表

### T-021-01 Webview 前端入口
状态: done
描述: 为 VSCode 插件新增独立 Execution Workbench、Spec Workspace、Feature Spec 三个 Webview 入口、命令注册、CSP 和资源加载，不复用 Product Console 页面、路由、导航或组件。
验证: `npm run ide:build`，Webview HTML/CSP 单测。

### T-021-02 执行工作台布局
状态: done
描述: 实现以任务调度和自动执行为核心的第一屏布局，展示 Job 队列、当前运行、下一步动作、阻塞原因、自动执行控制和审批待办。
验证: VSCode Webview UI 测试或快照验证。

### T-021-03 Queue / Automation Command Bridge
状态: done
描述: 将 enqueue、run now、auto run、pause automation、resume automation、retry、cancel、skip 和 reprioritize 转换为 Control Plane command API 调用并展示 `IdeCommandReceiptV1`。
验证: command payload 单测，extension host message routing 测试。

### T-021-04 Execution Detail Projection
状态: done
描述: 在 Webview 中展示 Execution Record、raw log refs、diff 摘要、`SkillOutputContractV1` 校验结果、produced artifacts 和 `spec-state.json` 投影摘要。
验证: view model normalization 单测，日志增量加载测试。

### T-021-05 独立 UI 边界校验
状态: done
描述: 增加测试或静态检查，确认三组 Webview 不导入 Product Console 页面、App Shell、路由或组件实现，只允许复用 shared contract/type/query client。
验证: dependency boundary test。

### T-021-06 Spec Workspace 全流程控制
状态: done
描述: 实现 Spec Workspace Webview，展示 PRD、EARS Requirements、HLD、UI Spec、Architecture Plan、Data Model、Contracts、Tasks、Quickstart、Execution、Review、Delivery 的阶段状态，并通过受控命令推进当前阶段。
验证: `npm run ide:build`，手动打开 `SpecDrive: Open Spec Workspace`。

### T-021-07 Feature Spec 卡片总览
状态: done
描述: 实现 Feature Spec Webview，按状态卡片展示 Feature 情况，支持查看选中 Feature 详情、打开 artifacts、查看 acceptance/latest run/blockers/traceability，并从 VSCode 内调度执行。
验证: `npm run ide:build`，手动打开 `SpecDrive: Open Feature Spec`。

### T-021-08 UI 概念图归档
状态: done
描述: 将 Execution Workbench、Spec Workspace、Feature Spec 三张 VSCode IDE 概念图保存到 `docs/ui`，并在 Feature 21 文档中引用。
验证: `git diff --check`，检查 `docs/ui/feat-021-*-concept.png` 存在。
