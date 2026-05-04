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

### T-021-09 New Feature 需求输入弹窗
状态: done
描述: 在 Feature Spec Webview 顶部增加 New Feature 按钮和弹出输入框，提交自然语言内容后只发送受控需求输入，由模型判定需求新增或需求变更流程，并展示 command receipt、路由结论和阻塞原因。
验证: `npm run ide:build`，`node --test tests/specdrive-ide.test.ts`。

### T-021-10 Feature index 与目录同步刷新
状态: done
描述: 刷新 Feature Spec Webview 时以 `docs/features/README.md` 作为 Feature 身份来源；只读取 index 中 folder 对应的三件套目录，识别缺失 folder、缺失文件和状态冲突。未写入 index 的目录、数据库 Feature 记录和历史同步残留不得生成 Feature 列表项。
验证: `node --test tests/specdrive-ide.test.ts` 覆盖 index 身份来源、非 index 目录不进入 Feature 列表、缺失 folder 和冲突阻塞。

### T-021-11 需求新增 Skill 同步 Feature index
状态: done
描述: 修改 `requirement-intake-skill` 流程，要求新增或更新 Feature Spec 后必须同步 `docs/features/README.md`，写入 Feature ID、Feature、Folder、Status、Primary Requirements、Suggested Milestone 和 Dependencies。
验证: `git diff --check`，检查 `.agents/skills/requirement-intake-skill/SKILL.md` 明确 Feature index 同步责任。

### T-021-12 Feature 详情 tasks.md 任务解析
状态: done
描述: 点击 Feature 后在详情面板解析对应 `tasks.md`，展示任务 ID、标题、状态、描述和验证命令；缺失或无法解析时显示 blocked reason，并保留打开原始 `tasks.md` 的操作。
验证: `node --test tests/specdrive-ide.test.ts` 覆盖 checkbox 和“状态/描述/验证”段落格式；`npm run ide:build` 验证 Webview 编译。

### T-021-13 Need Review 澄清入口
状态: done
描述: 状态为 `need review` / `review_needed` 的 Feature Spec 在工具栏和详情面板显示 Review 入口；点击后弹出澄清输入框，提交后以 `clarification` 意图进入 Spec change request。Feature Spec 详情移除 Evidence 验收项。
验证: `npm run ide:build` 验证 VSCode Webview 编译；`node --test tests/specdrive-ide.test.ts` 验证现有 IDE contract 未回归。

### T-021-14 Feature 分类横向折叠 Panel
状态: done
描述: 将 Feature Spec Webview 的状态看板改为横向分类 panel，固定显示顺序为 `Blocked`、`In-Process`、`Todo`、`Ready`、`Done`；每组支持点击折叠/展开，并在 panel header 显示展开/折叠状态图标；Done 默认折叠，其它默认展开。
验证: `npm run ide:build` 验证 VSCode Webview 编译；`npm run ide:test` 验证现有 IDE contract 和 Webview 边界未回归。

### T-021-15 Feature Dependency Graph
状态: done
描述: 将 `Feature List` 和 `Dependency Graph` 合并为顶部第一个单按钮视图切换；Feature List 视图下按钮显示 `Dependency Graph`，点击后切换到 Dependency Graph 并将文字改为 `Feature List`。Dependency Graph 视图按“依赖项 -> 依赖它的 Feature”展示树状层级，标出缺失依赖，节点支持折叠和展开，并默认展开到二级节点。
验证: `npm run ide:build` 验证 VSCode Webview 编译；`npm run ide:test` 验证现有 IDE contract 和 Webview 边界未回归。

### T-021-16 移除 Feature Index Sync 显示
状态: done
描述: Feature Spec Webview 刷新仍保留 Feature index 与目录扫描合并能力，但不再渲染独立 `Feature Index Sync` 信息区块。
验证: `npm run ide:build` 验证 VSCode Webview 编译；`git diff --check` 验证文档和代码格式。

### T-021-17 Feature List 自适应换行
状态: done
描述: Feature panel 中的 Feature list 改为自适应换行布局，不使用水平滚动条，也不依赖 panel 内垂直滚动条展示卡片。
验证: `npm run ide:build` 验证 VSCode Webview 编译；`git diff --check` 验证文档和代码格式。

### T-021-18 Clarification 技能队列路由
状态: done
描述: VSCode Spec Workspace / Feature Review 的 `clarification` 提交由 Control Plane 路由为 `resolve_clarification`，并在任务队列中创建 `ambiguity-clarification-skill` 技能调用任务。
验证: `node --test tests/specdrive-ide.test.ts` 覆盖 `clarification` receipt、scheduler job 和技能上下文。

### T-021-19 Execution Workbench 选中任务操作
状态: done
描述: Execution Workbench 队列任务支持显式选中；顶部任务操作只对选中任务可用，并按选中任务状态启用、禁用或切换双态按钮。Pause / Resume 合并为一个双态入口。
验证: `npm run ide:build` 验证 VSCode Webview 编译；`node --test tests/specdrive-ide-webview-boundary.test.ts` 覆盖选中任务与按钮状态规则。
