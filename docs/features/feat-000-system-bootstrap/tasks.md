# Tasks: FEAT-000 AutoBuild System Bootstrap

- [x] TASK-000-001: 实现 Config Loader，合并环境变量、`.autobuild.config.json` 和命令行参数，输出规范化 `AppConfig`（port、artifactRoot、dbPath、logLevel、runnerConfig）；缺少必填项时输出缺失字段并拒绝启动。
- [x] TASK-000-002: 实现 Artifact Dir Initializer，幂等创建 `.autobuild/memory/`、`.autobuild/specs/`、`.autobuild/evidence/`、`.autobuild/reports/`、`.autobuild/runs/` 目录树；目录已存在时跳过，不覆盖已有文件；磁盘权限不足时输出结构化错误。
- [x] TASK-000-003: 设计并实现 `schema_migrations` 表结构及版本比对逻辑；首次运行时创建全量 schema（Project、Feature、Requirement、Task、Run、AgentRunContract、EvidencePack、ProjectMemory、MemoryVersionRecord、Skill、SkillVersion、SkillRun、WorktreeRecord、ReviewItem、ApprovalRecord、DeliveryReport、AuditTimelineEvent、MetricSample）；重启时检测版本一致则跳过。
- [x] TASK-000-004: 实现 schema 迁移执行器，按版本号顺序执行内嵌迁移脚本，每条迁移在事务中执行，失败时回滚并输出迁移版本和原因。
- [x] TASK-000-005: 实现 Skill Seeder，批量插入 REQ-011 规定的 21 个内置 Skill 元数据占位（名称、slug、触发条件、风险等级、阶段），按 slug 去重，已存在时跳过；种子数据以代码内嵌常量维护。
- [x] TASK-000-006: 实现 System Ready Gate，串联 Config Loader → Artifact Dir Initializer → Schema Manager → Skill Seeder 的启动顺序；全部成功后设置进程就绪状态；任一步骤失败时以非零退出码中止进程。
- [x] TASK-000-007: 实现 `GET /health` 接口，返回 `{ status, version, schemaVersion, artifactRoot }`；Bootstrap 未完成时返回 `initializing`；失败时返回 `error` 和错误描述。
- [x] TASK-000-008: 编写单元测试，覆盖 Config Loader 合并逻辑（含缺失字段校验）、Skill Seeder 去重逻辑、Schema 版本比对逻辑。
- [x] TASK-000-009: 编写集成测试，覆盖首次启动目录和表结构创建、重启幂等（不重复创建/插入）、迁移脚本执行后版本递增、Bootstrap 失败时进程退出码非零。
- [x] TASK-000-010: 确认 `.autobuild/` 默认位置（目标仓库根目录 vs AutoBuild 运行目录），并在 `AppConfig` 和 HLD Section 9 中统一修正命名，解决 Open Question。

## Execution Evidence

- Pre-implementation review: pass；无阻塞澄清。
- Targeted regression: `timeout 180s node --test tests/bootstrap.test.ts`，9 tests passed。
- Codex review loop: 3 passes；修复 `.autobuild/` 位置开放问题和默认解析措辞；剩余 `in-progress` 发现为 Stage 4 临时状态，Stage 9 已恢复 `done`。
- Final full-suite gate: `timeout 600s npm test`，230 tests passed。
