import { BootstrapError } from "./errors.ts";
import { runSqlite, type SqlStatement } from "./sqlite.ts";

export type Migration = {
  version: number;
  description: string;
  statements: string[];
};

export const SCHEMA_VERSION = 1;

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
        risk_level TEXT NOT NULL,
        phase TEXT NOT NULL,
        input_schema_json TEXT NOT NULL,
        output_schema_json TEXT NOT NULL,
        built_in INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS skill_versions (
        id TEXT PRIMARY KEY,
        skill_slug TEXT NOT NULL,
        version TEXT NOT NULL,
        change_summary TEXT,
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
