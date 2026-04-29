# Design: FEAT-003 Retired - Platform Skill Center Removed

## Design Summary

本 Feature 已废弃。SpecDrive 平台边界收缩为调度和状态维护，不再扫描、注册、展示或调用 Skill。

## Data and API Impact

- 删除平台 Skill runtime API 和 Console 查询。
- 最终 schema 删除 Skill 相关表；历史迁移只作为升级路径保留。
- `ReadyState` 不再包含 `projectSkills`。

## Integration Rule

Codex CLI 或外部工具若使用 Skill 文件，应在平台之外自行处理。平台只接收外部运行产生的状态、证据、审计和恢复建议输入。
