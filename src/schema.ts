import { BootstrapError } from "./errors.ts";
import { runSqlite, type SqlStatement } from "./sqlite.ts";

export type Migration = {
  version: number;
  description: string;
  statements: string[];
};

export const SCHEMA_VERSION = 9;

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "Create MVP control-plane schema",
    statements: [
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL,
        description TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        goal TEXT NOT NULL,
        project_type TEXT NOT NULL,
        tech_preferences_json TEXT NOT NULL,
        target_repo_path TEXT,
        default_branch TEXT,
        environment TEXT NOT NULL,
        automation_enabled INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'created',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS repository_connections (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        remote_url TEXT,
        local_path TEXT NOT NULL,
        default_branch TEXT NOT NULL,
        connected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_read_at TEXT,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      )`,
      `CREATE TABLE IF NOT EXISTS project_health_checks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        status TEXT NOT NULL,
        reasons_json TEXT NOT NULL,
        repository_summary_json TEXT,
        checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      )`,
      `CREATE TABLE IF NOT EXISTS features (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS requirements (
        id TEXT PRIMARY KEY,
        feature_id TEXT,
        source_id TEXT,
        body TEXT NOT NULL,
        acceptance_criteria TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        feature_id TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        required_skill_slug TEXT,
        allowed_files_json TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        status TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        summary TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS agent_run_contracts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        contract_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS evidence_packs (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        task_id TEXT,
        feature_id TEXT,
        path TEXT NOT NULL,
        summary TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS project_memories (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        path TEXT NOT NULL,
        current_version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS memory_version_records (
        id TEXT PRIMARY KEY,
        project_memory_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        summary TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        trigger TEXT NOT NULL,
        allowed_context_json TEXT NOT NULL DEFAULT '[]',
        required_tools_json TEXT NOT NULL DEFAULT '[]',
        risk_level TEXT NOT NULL,
        phase TEXT NOT NULL,
        success_criteria TEXT NOT NULL DEFAULT '',
        failure_handling TEXT NOT NULL DEFAULT '',
        input_schema_json TEXT NOT NULL,
        output_schema_json TEXT NOT NULL,
        built_in INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        team_shared INTEGER NOT NULL DEFAULT 0,
        project_id TEXT,
        current_version TEXT NOT NULL DEFAULT '1.0.0',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS skill_versions (
        id TEXT PRIMARY KEY,
        skill_slug TEXT NOT NULL,
        version TEXT NOT NULL,
        change_summary TEXT,
        snapshot_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(skill_slug, version)
      )`,
      `CREATE TABLE IF NOT EXISTS skill_runs (
        id TEXT PRIMARY KEY,
        skill_slug TEXT NOT NULL,
        run_id TEXT,
        status TEXT NOT NULL,
        input_json TEXT,
        output_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS schema_validation_results (
        id TEXT PRIMARY KEY,
        skill_run_id TEXT,
        skill_slug TEXT NOT NULL,
        direction TEXT NOT NULL,
        valid INTEGER NOT NULL,
        errors_json TEXT NOT NULL,
        evidence_pack_json TEXT,
        state_input TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS skill_project_overrides (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        base_skill_slug TEXT NOT NULL,
        override_skill_slug TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, base_skill_slug)
      )`,
      `CREATE TABLE IF NOT EXISTS worktree_records (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        path TEXT NOT NULL,
        branch TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS review_items (
        id TEXT PRIMARY KEY,
        feature_id TEXT,
        status TEXT NOT NULL,
        severity TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS approval_records (
        id TEXT PRIMARY KEY,
        review_item_id TEXT,
        status TEXT NOT NULL,
        actor TEXT,
        decided_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS delivery_reports (
        id TEXT PRIMARY KEY,
        feature_id TEXT,
        path TEXT NOT NULL,
        summary TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS audit_timeline_events (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS metric_samples (
        id TEXT PRIMARY KEY,
        metric_name TEXT NOT NULL,
        metric_value REAL NOT NULL,
        labels_json TEXT,
        sampled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    ],
  },
  {
    version: 2,
    description: "Add persistence auditability schema",
    statements: [
      "ALTER TABLE features ADD COLUMN folder TEXT",
      "ALTER TABLE features ADD COLUMN primary_requirements_json TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE features ADD COLUMN milestone TEXT",
      "ALTER TABLE features ADD COLUMN dependencies_json TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE features ADD COLUMN updated_at TEXT",
      "UPDATE features SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)",
      "ALTER TABLE requirements ADD COLUMN priority TEXT",
      "ALTER TABLE requirements ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
      "ALTER TABLE requirements ADD COLUMN created_at TEXT",
      "ALTER TABLE requirements ADD COLUMN updated_at TEXT",
      "UPDATE requirements SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP), updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)",
      "ALTER TABLE tasks ADD COLUMN description TEXT",
      "ALTER TABLE tasks ADD COLUMN depends_on_json TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE tasks ADD COLUMN recovery_state TEXT NOT NULL DEFAULT 'pending'",
      "ALTER TABLE tasks ADD COLUMN created_at TEXT",
      "ALTER TABLE tasks ADD COLUMN updated_at TEXT",
      "UPDATE tasks SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP), updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)",
      "ALTER TABLE runs ADD COLUMN feature_id TEXT",
      "ALTER TABLE runs ADD COLUMN project_id TEXT",
      "ALTER TABLE runs ADD COLUMN idempotency_key TEXT",
      "ALTER TABLE runs ADD COLUMN heartbeat_at TEXT",
      "ALTER TABLE runs ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_idempotency_key ON runs(idempotency_key)",
      "ALTER TABLE evidence_packs ADD COLUMN kind TEXT NOT NULL DEFAULT 'generic'",
      "ALTER TABLE evidence_packs ADD COLUMN checksum TEXT",
      "ALTER TABLE evidence_packs ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'",
      "ALTER TABLE project_memories ADD COLUMN summary TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE audit_timeline_events ADD COLUMN source TEXT NOT NULL DEFAULT 'unknown'",
      "ALTER TABLE audit_timeline_events ADD COLUMN reason TEXT NOT NULL DEFAULT ''",
      "UPDATE audit_timeline_events SET payload_json = COALESCE(payload_json, '{}')",
      "ALTER TABLE metric_samples ADD COLUMN unit TEXT NOT NULL DEFAULT 'count'",
      "UPDATE metric_samples SET labels_json = COALESCE(labels_json, '{}')",
      `CREATE TABLE IF NOT EXISTS idempotency_keys (
        key TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        operation TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        result_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS recovery_index_entries (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        feature_id TEXT,
        task_id TEXT,
        run_id TEXT,
        evidence_pack_id TEXT,
        project_memory_id TEXT,
        recovery_state TEXT NOT NULL,
        reason TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_recovery_state ON tasks(recovery_state, status)`,
      `CREATE INDEX IF NOT EXISTS idx_runs_recovery_state ON runs(status, task_id, feature_id)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_timeline_events(entity_type, entity_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_metrics_name_sampled ON metric_samples(metric_name, sampled_at)`,
    ],
  },
  {
    version: 3,
    description: "Add orchestration state machine schema",
    statements: [
      `CREATE TABLE IF NOT EXISTS task_graphs (
        id TEXT PRIMARY KEY,
        feature_id TEXT NOT NULL,
        graph_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS task_graph_tasks (
        id TEXT PRIMARY KEY,
        graph_id TEXT NOT NULL,
        feature_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        source_requirements_json TEXT NOT NULL,
        acceptance_criteria_json TEXT NOT NULL,
        allowed_files_json TEXT NOT NULL,
        dependencies_json TEXT NOT NULL,
        risk TEXT NOT NULL,
        required_skill_slug TEXT NOT NULL,
        subagent TEXT NOT NULL,
        estimated_effort INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS feature_selection_decisions (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        selected_feature_id TEXT,
        candidates_json TEXT NOT NULL,
        reason TEXT NOT NULL,
        memory_summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS state_transitions (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        reason TEXT NOT NULL,
        evidence TEXT NOT NULL,
        triggered_by TEXT NOT NULL,
        review_needed_reason TEXT,
        occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS task_schedules (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS planning_pipeline_runs (
        id TEXT PRIMARY KEY,
        feature_id TEXT NOT NULL,
        status TEXT NOT NULL,
        stages_json TEXT NOT NULL,
        failure_evidence TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      "CREATE INDEX IF NOT EXISTS idx_task_graph_tasks_feature_status ON task_graph_tasks(feature_id, status)",
      "CREATE INDEX IF NOT EXISTS idx_state_transitions_entity ON state_transitions(entity_type, entity_id, occurred_at)",
      "CREATE INDEX IF NOT EXISTS idx_feature_selection_project_created ON feature_selection_decisions(project_id, created_at)",
    ],
  },
  {
    version: 4,
    description: "Add workspace isolation schema",
    statements: [
      "ALTER TABLE worktree_records ADD COLUMN feature_id TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE worktree_records ADD COLUMN task_id TEXT",
      "ALTER TABLE worktree_records ADD COLUMN runner_id TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE worktree_records ADD COLUMN base_commit TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE worktree_records ADD COLUMN target_branch TEXT NOT NULL DEFAULT 'main'",
      "ALTER TABLE worktree_records ADD COLUMN cleanup_status TEXT NOT NULL DEFAULT 'active'",
      "UPDATE worktree_records SET cleanup_status = COALESCE(NULLIF(status, ''), cleanup_status)",
      `CREATE TABLE IF NOT EXISTS conflict_check_results (
        id TEXT PRIMARY KEY,
        severity TEXT NOT NULL,
        parallel_allowed INTEGER NOT NULL,
        reasons_json TEXT NOT NULL,
        conflicting_files_json TEXT NOT NULL,
        conflicting_resources_json TEXT NOT NULL,
        serial_required INTEGER NOT NULL,
        evidence TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS merge_readiness_results (
        id TEXT PRIMARY KEY,
        worktree_id TEXT NOT NULL,
        ready INTEGER NOT NULL,
        blocked_reasons_json TEXT NOT NULL,
        checks_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS rollback_boundaries (
        id TEXT PRIMARY KEY,
        worktree_id TEXT NOT NULL,
        feature_id TEXT NOT NULL,
        task_id TEXT,
        branch TEXT NOT NULL,
        base_commit TEXT NOT NULL,
        diff_summary TEXT NOT NULL,
        rollback_command TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      "CREATE INDEX IF NOT EXISTS idx_worktree_records_feature_cleanup ON worktree_records(feature_id, cleanup_status)",
      "CREATE INDEX IF NOT EXISTS idx_merge_readiness_worktree ON merge_readiness_results(worktree_id, created_at)",
      "CREATE INDEX IF NOT EXISTS idx_rollback_boundaries_worktree ON rollback_boundaries(worktree_id, created_at)",
    ],
  },
  {
    version: 5,
    description: "Add subagent runtime and context broker schema",
    statements: [
      `CREATE TABLE IF NOT EXISTS context_slice_refs (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        refs_json TEXT NOT NULL,
        token_estimate INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS subagent_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT NOT NULL,
        evidence TEXT,
        token_usage_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS result_merges (
        id TEXT PRIMARY KEY,
        run_ids_json TEXT NOT NULL,
        outputs_json TEXT NOT NULL,
        conflicts_json TEXT NOT NULL,
        risks_json TEXT NOT NULL,
        credibility TEXT NOT NULL,
        next_action TEXT NOT NULL,
        board_status TEXT NOT NULL,
        evidence TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      "CREATE INDEX IF NOT EXISTS idx_context_slice_refs_run ON context_slice_refs(run_id, created_at)",
      "CREATE INDEX IF NOT EXISTS idx_subagent_events_run_status ON subagent_events(run_id, status, created_at)",
      "CREATE INDEX IF NOT EXISTS idx_result_merges_action ON result_merges(next_action, created_at)",
    ],
  },
  {
    version: 6,
    description: "Add project memory recovery projection schema",
    statements: [
      "ALTER TABLE memory_version_records ADD COLUMN run_id TEXT",
      "ALTER TABLE memory_version_records ADD COLUMN checksum TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE memory_version_records ADD COLUMN content TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE memory_version_records ADD COLUMN restored_from_version INTEGER",
      `CREATE TABLE IF NOT EXISTS memory_compaction_events (
        id TEXT PRIMARY KEY,
        project_memory_id TEXT NOT NULL,
        from_version INTEGER NOT NULL,
        to_version INTEGER NOT NULL,
        run_id TEXT,
        token_budget INTEGER NOT NULL,
        estimated_tokens_before INTEGER NOT NULL,
        estimated_tokens_after INTEGER NOT NULL,
        preserved_sections_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_memory_versions_memory_version
        ON memory_version_records(project_memory_id, version)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_versions_run
        ON memory_version_records(run_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_memory_compactions_memory
        ON memory_compaction_events(project_memory_id, created_at)`,
    ],
  },
  {
    version: 7,
    description: "Add Codex runner schema",
    statements: [
      `CREATE TABLE IF NOT EXISTS runner_policies (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        risk TEXT NOT NULL,
        sandbox_mode TEXT NOT NULL,
        approval_policy TEXT NOT NULL,
        model TEXT NOT NULL,
        profile TEXT,
        output_schema_json TEXT NOT NULL,
        workspace_root TEXT NOT NULL,
        resume_session_id TEXT,
        heartbeat_interval_seconds INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS runner_heartbeats (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        runner_id TEXT NOT NULL,
        status TEXT NOT NULL,
        sandbox_mode TEXT NOT NULL,
        approval_policy TEXT NOT NULL,
        queue_status TEXT NOT NULL,
        message TEXT,
        beat_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS codex_session_records (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        session_id TEXT,
        workspace_root TEXT NOT NULL,
        command TEXT NOT NULL,
        args_json TEXT NOT NULL,
        exit_code INTEGER,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS raw_execution_logs (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        stdout TEXT NOT NULL,
        stderr TEXT NOT NULL,
        events_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      "CREATE INDEX IF NOT EXISTS idx_runner_policies_run ON runner_policies(run_id, created_at)",
      "CREATE INDEX IF NOT EXISTS idx_runner_heartbeats_runner ON runner_heartbeats(runner_id, beat_at)",
      "CREATE INDEX IF NOT EXISTS idx_codex_sessions_run ON codex_session_records(run_id, completed_at)",
      "CREATE INDEX IF NOT EXISTS idx_raw_execution_logs_run ON raw_execution_logs(run_id, created_at)",
    ],
  },
  {
    version: 8,
    description: "Add status checker and evidence schema",
    statements: [
      `CREATE TABLE IF NOT EXISTS status_check_results (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        task_id TEXT,
        feature_id TEXT,
        project_id TEXT,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        reasons_json TEXT NOT NULL,
        recommended_actions_json TEXT NOT NULL,
        evidence_pack_id TEXT,
        spec_alignment_result_id TEXT,
        evidence_path TEXT,
        evidence_write_ms REAL NOT NULL DEFAULT 0,
        evidence_write_error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS spec_alignment_results (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        task_id TEXT,
        feature_id TEXT,
        aligned INTEGER NOT NULL,
        reasons_json TEXT NOT NULL,
        missing_traceability_json TEXT NOT NULL,
        forbidden_files_json TEXT NOT NULL,
        unauthorized_files_json TEXT NOT NULL,
        coverage_gaps_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS evidence_attachment_refs (
        id TEXT PRIMARY KEY,
        evidence_pack_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        checksum TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      "CREATE INDEX IF NOT EXISTS idx_status_check_results_run ON status_check_results(run_id, created_at)",
      "CREATE INDEX IF NOT EXISTS idx_status_check_results_task_status ON status_check_results(task_id, status, created_at)",
      "CREATE INDEX IF NOT EXISTS idx_spec_alignment_results_run ON spec_alignment_results(run_id, created_at)",
      "CREATE INDEX IF NOT EXISTS idx_evidence_attachment_refs_pack ON evidence_attachment_refs(evidence_pack_id, created_at)",
      "CREATE INDEX IF NOT EXISTS idx_evidence_attachment_refs_run ON evidence_attachment_refs(run_id, created_at)",
    ],
  },
  {
    version: 9,
    description: "Add review center approval context and failure recovery history schema",
    statements: [
      "ALTER TABLE review_items ADD COLUMN project_id TEXT",
      "ALTER TABLE review_items ADD COLUMN task_id TEXT",
      "ALTER TABLE review_items ADD COLUMN run_id TEXT",
      "ALTER TABLE review_items ADD COLUMN review_needed_reason TEXT NOT NULL DEFAULT 'risk_review_needed'",
      "ALTER TABLE review_items ADD COLUMN trigger_reasons_json TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE review_items ADD COLUMN recommended_actions_json TEXT NOT NULL DEFAULT '[]'",
      `UPDATE review_items
        SET recommended_actions_json = '["approve_continue","mark_complete","reject","request_changes"]'
        WHERE recommended_actions_json = '[]'`,
      "ALTER TABLE review_items ADD COLUMN evidence_refs_json TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE review_items ADD COLUMN updated_at TEXT",
      "UPDATE review_items SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)",
      "ALTER TABLE approval_records ADD COLUMN decision TEXT NOT NULL DEFAULT 'approve_continue'",
      `UPDATE approval_records
        SET decision = CASE status
          WHEN 'approved' THEN 'approve_continue'
          WHEN 'rejected' THEN 'reject'
          WHEN 'changes_requested' THEN 'request_changes'
          WHEN 'approve_continue' THEN 'approve_continue'
          WHEN 'reject' THEN 'reject'
          WHEN 'request_changes' THEN 'request_changes'
          WHEN 'rollback' THEN 'rollback'
          WHEN 'split_task' THEN 'split_task'
          WHEN 'update_spec' THEN 'update_spec'
          WHEN 'mark_complete' THEN 'mark_complete'
          ELSE 'request_changes'
        END`,
      "ALTER TABLE approval_records ADD COLUMN reason TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE approval_records ADD COLUMN state_transition_id TEXT",
      "ALTER TABLE approval_records ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'",
      "ALTER TABLE approval_records ADD COLUMN created_at TEXT",
      "UPDATE approval_records SET created_at = COALESCE(created_at, decided_at, CURRENT_TIMESTAMP)",
      "CREATE INDEX IF NOT EXISTS idx_review_items_project_status ON review_items(project_id, status, created_at)",
      "CREATE INDEX IF NOT EXISTS idx_review_items_feature_task ON review_items(feature_id, task_id, status)",
      "CREATE INDEX IF NOT EXISTS idx_approval_records_review_item ON approval_records(review_item_id, decided_at)",
      `CREATE TABLE IF NOT EXISTS recovery_attempts (
        id TEXT PRIMARY KEY,
        fingerprint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        action TEXT NOT NULL,
        strategy TEXT NOT NULL,
        command TEXT,
        file_scope_json TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        evidence_pack_json TEXT,
        attempted_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS forbidden_retry_records (
        id TEXT PRIMARY KEY,
        fingerprint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        failed_strategy TEXT NOT NULL,
        failed_command TEXT,
        failed_file_scope_json TEXT NOT NULL,
        reason TEXT NOT NULL,
        evidence_pack_id TEXT,
        created_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS idx_recovery_attempts_task_fingerprint ON recovery_attempts(task_id, fingerprint_id, attempted_at)",
      "CREATE INDEX IF NOT EXISTS idx_forbidden_retry_records_task_fingerprint ON forbidden_retry_records(task_id, fingerprint_id, created_at)",
    ],
  },
];

export type SchemaState = {
  schemaVersion: number;
  appliedMigrations: number[];
};

export function initializeSchema(dbPath: string, migrations: Migration[] = MIGRATIONS): SchemaState {
  ensureMigrationTable(dbPath);
  const currentVersion = getCurrentSchemaVersion(dbPath);
  const targetVersion = Math.max(...migrations.map((migration) => migration.version), 0);

  if (currentVersion > targetVersion) {
    throw new BootstrapError("schema", "Database schema is newer than this runtime", {
      currentVersion,
      targetVersion,
    });
  }

  const appliedMigrations: number[] = [];
  for (const migration of migrations.sort((a, b) => a.version - b.version)) {
    if (migration.version <= currentVersion) {
      continue;
    }

    applyMigration(dbPath, migration);
    appliedMigrations.push(migration.version);
  }

  return {
    schemaVersion: getCurrentSchemaVersion(dbPath),
    appliedMigrations,
  };
}

export function getCurrentSchemaVersion(dbPath: string): number {
  const result = runSqlite(dbPath, [], [
    {
      name: "version",
      sql: "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
    },
  ]);
  return Number(result.queries.version[0]?.version ?? 0);
}

export function listTables(dbPath: string): string[] {
  const result = runSqlite(dbPath, [], [
    {
      name: "tables",
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    },
  ]);
  return result.queries.tables.map((row) => String(row.name));
}

function ensureMigrationTable(dbPath: string): void {
  runSqlite(dbPath, [
    {
      sql: `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL,
        description TEXT NOT NULL
      )`,
    },
  ]);
}

function applyMigration(dbPath: string, migration: Migration): void {
  const statements: SqlStatement[] = [
    { sql: "BEGIN" },
    ...migration.statements.map((sql) => ({ sql })),
    {
      sql: "INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, CURRENT_TIMESTAMP, ?)",
      params: [migration.version, migration.description],
    },
    { sql: "COMMIT" },
  ];

  try {
    runSqlite(dbPath, statements);
  } catch (error) {
    try {
      runSqlite(dbPath, [{ sql: "ROLLBACK" }]);
    } catch {
      // The adapter already rolls back failed transactions before closing.
    }
    throw new BootstrapError("schema", `Schema migration ${migration.version} failed`, {
      description: migration.description,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
