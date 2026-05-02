# FEAT-016 SpecDrive IDE Foundation — 任务

Feature ID: FEAT-016
来源需求: REQ-074、REQ-075
状态: done

## 任务列表

### T-016-01 插件骨架与脚本
状态: done
描述: 在 `apps/vscode-extension/` 建立 VSCode 插件工程，并新增 `ide:build`、`ide:test` 脚本。
验证: `npm run ide:build`、`npm run ide:test`

### T-016-02 Workspace 识别
状态: done
描述: 实现多语言/单语言 SpecDrive 文档结构扫描、Feature 队列和 `.autobuild` 状态识别。
验证: workspace discovery 单测。

### T-016-03 Control Plane Client
状态: done
描述: 实现 workspace context、spec tree、queue summary 和 execution detail 查询客户端。
验证: query fixture 单测。

### T-016-04 Spec Explorer 只读树
状态: done
描述: 渲染 PRD、requirements、HLD、Feature Specs、Task Queue 和 Execution Record 节点。
验证: VSCode extension test。
