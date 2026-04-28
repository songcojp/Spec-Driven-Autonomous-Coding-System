# Feature Spec: FEAT-008 Codex Runner

## Source Mapping

| Source | IDs / Sections |
|---|---|
| PRD | 第 6.9 节 FR-070 至 FR-072；第 8.6 节；第 9.1 节 |
| Requirements | REQ-037, REQ-038, REQ-039, REQ-056, NFR-001, NFR-010 |
| HLD | 7.8 Codex Runner, 9 External Integrations, 11 Security, Privacy, and Governance |

## Scope

- 通过 Codex Runner 调用 Codex CLI 执行代码修改、测试或修复。
- 根据任务风险设置 sandbox mode、approval policy、model、profile、output schema、JSON event stream、workspace root 和 session resume。
- 默认禁止 `danger-full-access` 和 bypass approvals。
- 捕获命令输出、JSON event stream、Codex session、原始日志和 Runner 心跳。
- 为 Runner Console 提供在线状态、Codex 版本、sandbox、approval policy、queue、最近日志和心跳状态。

## Non-Scope

- 不决定任务是否完成；状态判断归属 FEAT-009。
- 不创建 worktree；workspace 归属 FEAT-007。
- 不展示 UI；Runner Console 归属 FEAT-013。

## User Value

系统可以用受安全策略约束的方式调用 Codex CLI，让自动编码、测试和修复具备可审计输出、可恢复 session 和可观察心跳。

## Requirements

- Codex Runner 必须产出结构化 Evidence Pack 或原始执行结果供 Evidence Store 处理。
- 高风险任务不得自动以高权限写入模式执行。
- 认证、权限、支付、迁移、密钥和 forbidden files 修改必须触发安全规则。
- Runner 在线时必须每 10 至 30 秒更新心跳。

## Acceptance Criteria

- [ ] Codex Runner 可以在指定 workspace root 中启动 Codex CLI。
- [ ] Runner Policy 能根据任务风险解析 sandbox、approval、model、profile 和输出 schema。
- [ ] 默认 Runner 配置不使用危险权限。
- [ ] Runner Console 可以展示最近心跳时间和当前安全配置。

## Risks and Open Questions

- Codex CLI 输出格式和 session resume 能力需要通过适配层隔离。
- 危险命令和 forbidden files 规则需要与 Review Center 保持一致。
