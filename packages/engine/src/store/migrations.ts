/**
 * Ordered schema migrations. Index + 1 = resulting `PRAGMA user_version`.
 * Never edit a shipped migration; append a new one.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE projects (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    status TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    doc TEXT NOT NULL
  );
  CREATE INDEX tasks_project ON tasks(project_id, updated_at);
  CREATE TABLE agent_runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, doc TEXT NOT NULL);
  CREATE INDEX agent_runs_task ON agent_runs(task_id);
  CREATE TABLE evidence (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, doc TEXT NOT NULL);
  CREATE INDEX evidence_task ON evidence(task_id);
  CREATE TABLE events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    type TEXT NOT NULL,
    task_id TEXT,
    doc TEXT NOT NULL
  );
  CREATE INDEX events_task ON events(task_id, seq);
  CREATE TABLE devices (id TEXT PRIMARY KEY, doc TEXT NOT NULL, keys TEXT NOT NULL);
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE audit (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL
  );
  CREATE TABLE remote_commands (device_id TEXT NOT NULL, command_id TEXT NOT NULL, at TEXT NOT NULL, ack TEXT NOT NULL,
    PRIMARY KEY (device_id, command_id));
  `
]
