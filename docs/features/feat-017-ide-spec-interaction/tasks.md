# FEAT-017 IDE Spec Interaction — 任务

Feature ID: FEAT-017
来源需求: REQ-076、REQ-077、REQ-078
状态: done

## 任务列表

### T-017-01 Hover Provider
状态: done
描述: 在 PRD、requirements、HLD 和 Feature Spec 中显示 requirement、Feature、traceability 和状态。
验证: provider 单测或 extension test。

### T-017-02 CodeLens Provider
状态: done
描述: 提供添加澄清、生成/更新 EARS、更新设计、拆分 Feature、执行任务等动作入口。
验证: extension test。

### T-017-03 Comments 草稿与提交
状态: done
描述: 使用 VSCode Comments API 保存草稿并提交 `SpecChangeRequestV1`。
验证: Comments lifecycle test。

### T-017-04 Control Plane command API
状态: done
描述: 增加 IDE action 接收、command receipt 和 `stale_source` 校验。
验证: command validation 单测。
