# FEAT-018 Codex RPC Adapter — 任务

Feature ID: FEAT-018
来源需求: REQ-080、REQ-081
状态: done

## 任务列表

### T-018-01 Adapter 配置与 Job 类型
状态: done
描述: 增加 `codex.rpc.run` executor/adapter 配置和 scheduler job routing。
验证: scheduler/adapter 单测。

### T-018-02 JSON-RPC lifecycle
状态: done
描述: 实现 app-server initialize、thread start/resume、turn start/interrupt。
验证: mock app-server integration test。

### T-018-03 Event Projection
状态: done
描述: 将 turn/item、turn/completed、error 和 raw output 写入 raw logs 与 Execution Record。
验证: projection 单测。

### T-018-04 Output Schema 校验
状态: done
描述: 校验 `SkillOutputContractV1`，成功/失败分别投影状态。
验证: schema fixture tests。
