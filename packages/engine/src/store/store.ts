import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  AgentRunInfo, Device, DURABLE_EVENT_TYPES, Evidence, Outcome, Project, Task,
  type EngineEvent, type EventEnvelope
} from '@hydra/protocol'
import type { z } from 'zod'
import { MIGRATIONS } from './migrations.js'
import { isoNow } from '../util/ids.js'

type Row = Record<string, unknown>
export type EventListener = (envelope: EventEnvelope) => void

/**
 * Durable state. Every mutation of a projection appends a journal event in the
 * same transaction, so the journal and projections can never disagree.
 * Listeners are notified only after the transaction commits.
 */
export class Store {
  private readonly db: DatabaseSync
  private readonly listeners = new Set<EventListener>()
  private pending: EventEnvelope[] = []
  private depth = 0
  private lastSeqValue = 0

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    this.migrate()
    const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events').get() as Row
    this.lastSeqValue = Number(row.seq)
  }

  get schemaVersion(): number {
    return Number((this.db.prepare('PRAGMA user_version').get() as Row).user_version)
  }

  get lastSeq(): number {
    return this.lastSeqValue
  }

  close(): void {
    this.db.close()
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Runs fn atomically. Nested calls join the outer transaction. */
  transaction<T>(fn: () => T): T {
    if (this.depth > 0) {
      this.depth++
      try { return fn() } finally { this.depth-- }
    }
    this.depth = 1
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      this.depth = 0
      const flushed = this.pending
      this.pending = []
      for (const envelope of flushed) this.notify(envelope)
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      this.depth = 0
      this.pending = []
      this.lastSeqValue = Number((this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events').get() as Row).seq)
      throw error
    }
  }

  /** Publishes an event: durable types are journaled, live-only types are just broadcast. */
  publish(event: EngineEvent): EventEnvelope {
    const at = isoNow()
    if (!DURABLE_EVENT_TYPES.has(event.type)) {
      const envelope = { seq: this.lastSeqValue, at, event }
      this.notify(envelope)
      return envelope
    }
    return this.transaction(() => {
      const taskId = 'taskId' in event ? event.taskId : 'task' in event ? event.task.id : 'run' in event ? event.run.taskId : 'evidence' in event ? event.evidence.taskId : null
      const info = this.db.prepare('INSERT INTO events (at, type, task_id, doc) VALUES (?, ?, ?, ?)')
        .run(at, event.type, taskId, JSON.stringify(event))
      this.lastSeqValue = Number(info.lastInsertRowid)
      const envelope = { seq: this.lastSeqValue, at, event }
      this.pending.push(envelope)
      return envelope
    })
  }

  eventsAfter(seq: number, limit = 1000): EventEnvelope[] {
    const rows = this.db.prepare('SELECT seq, at, doc FROM events WHERE seq > ? ORDER BY seq LIMIT ?').all(seq, limit) as Row[]
    return rows.map((row) => ({ seq: Number(row.seq), at: String(row.at), event: JSON.parse(String(row.doc)) as EngineEvent }))
  }

  // ── projects ──────────────────────────────────────────────
  putProject(project: Project): void {
    this.transaction(() => {
      this.db.prepare('INSERT INTO projects (id, doc) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc')
        .run(project.id, JSON.stringify(project))
      this.publish({ type: 'project.updated', project })
    })
  }

  deleteProject(id: string): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
      this.publish({ type: 'project.removed', projectId: id })
    })
  }

  listProjects(): Project[] {
    return this.docs('SELECT doc FROM projects ORDER BY id', Project)
  }

  getProject(id: string): Project | null {
    return this.doc('SELECT doc FROM projects WHERE id = ?', Project, id)
  }

  // ── tasks ─────────────────────────────────────────────────
  putTask(task: Task): Task {
    const next = { ...task, updatedAt: isoNow() }
    Task.parse(next)
    this.transaction(() => {
      this.db.prepare(`INSERT INTO tasks (id, project_id, status, updated_at, doc) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at, doc = excluded.doc`)
        .run(next.id, next.projectId, next.status, next.updatedAt, JSON.stringify(next))
      this.publish({ type: 'task.updated', task: next })
    })
    return next
  }

  getTask(id: string): Task | null {
    return this.doc('SELECT doc FROM tasks WHERE id = ?', Task, id)
  }

  listTasks(projectId?: string): Task[] {
    return projectId
      ? this.docs('SELECT doc FROM tasks WHERE project_id = ? ORDER BY updated_at DESC', Task, projectId)
      : this.docs('SELECT doc FROM tasks ORDER BY updated_at DESC', Task)
  }

  tasksWithStatus(statuses: readonly string[]): Task[] {
    const marks = statuses.map(() => '?').join(',')
    return this.docs(`SELECT doc FROM tasks WHERE status IN (${marks})`, Task, ...statuses)
  }

  deleteTask(id: string): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
      this.db.prepare('DELETE FROM agent_runs WHERE task_id = ?').run(id)
      this.db.prepare('DELETE FROM evidence WHERE task_id = ?').run(id)
      this.publish({ type: 'task.deleted', taskId: id })
    })
  }

  // ── agent runs and evidence ───────────────────────────────
  putRun(run: AgentRunInfo): void {
    AgentRunInfo.parse(run)
    this.transaction(() => {
      this.db.prepare('INSERT INTO agent_runs (id, task_id, doc) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc')
        .run(run.id, run.taskId, JSON.stringify(run))
      this.publish({ type: 'run.updated', run })
    })
  }

  listRuns(taskId: string): AgentRunInfo[] {
    return this.docs('SELECT doc FROM agent_runs WHERE task_id = ? ORDER BY id', AgentRunInfo, taskId)
  }

  runsWithStatus(status: string): AgentRunInfo[] {
    return this.docs("SELECT doc FROM agent_runs WHERE json_extract(doc, '$.status') = ?", AgentRunInfo, status)
  }

  putEvidence(evidence: Evidence): void {
    this.transaction(() => {
      this.db.prepare('INSERT INTO evidence (id, task_id, doc) VALUES (?, ?, ?)').run(evidence.id, evidence.taskId, JSON.stringify(evidence))
      this.publish({ type: 'evidence.recorded', evidence })
    })
  }

  listEvidence(taskId: string): Evidence[] {
    return this.docs('SELECT doc FROM evidence WHERE task_id = ? ORDER BY id', Evidence, taskId)
  }

  // ── devices ───────────────────────────────────────────────
  putDevice(device: Device, keys: Record<string, string>): void {
    this.transaction(() => {
      this.db.prepare('INSERT INTO devices (id, doc, keys) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, keys = excluded.keys')
        .run(device.id, JSON.stringify(device), JSON.stringify(keys))
      this.publish({ type: 'device.updated', device })
    })
  }

  listDevices(): Device[] {
    return this.docs('SELECT doc FROM devices ORDER BY id', Device)
  }

  getDeviceKeys(id: string): { device: Device; keys: Record<string, string> } | null {
    const row = this.db.prepare('SELECT doc, keys FROM devices WHERE id = ?').get(id) as Row | undefined
    if (!row) return null
    return { device: Device.parse(JSON.parse(String(row.doc))), keys: JSON.parse(String(row.keys)) as Record<string, string> }
  }

  findDeviceByKey(publicKeyHex: string): { device: Device; keys: Record<string, string> } | null {
    const row = this.db.prepare("SELECT doc, keys FROM devices WHERE json_extract(keys, '$.pub') = ?").get(publicKeyHex) as Row | undefined
    if (!row) return null
    return { device: Device.parse(JSON.parse(String(row.doc))), keys: JSON.parse(String(row.keys)) as Record<string, string> }
  }

  /** Keeps acks for retried commands: 7 days, at most 1000 per device, so storage stays bounded. */
  rememberRemoteCommand(deviceId: string, commandId: string, ack: unknown): void {
    this.db.prepare('INSERT OR IGNORE INTO remote_commands (device_id, command_id, at, ack) VALUES (?, ?, ?, ?)')
      .run(deviceId, commandId, isoNow(), JSON.stringify(ack))
    this.db.prepare('DELETE FROM remote_commands WHERE at < ?').run(new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString())
    this.db.prepare(`DELETE FROM remote_commands WHERE device_id = ? AND command_id NOT IN
      (SELECT command_id FROM remote_commands WHERE device_id = ? ORDER BY at DESC, rowid DESC LIMIT 1000)`).run(deviceId, deviceId)
  }

  countRemoteCommands(deviceId: string): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM remote_commands WHERE device_id = ?').get(deviceId) as Row).n)
  }

  recallRemoteCommand(deviceId: string, commandId: string): unknown {
    const row = this.db.prepare('SELECT ack FROM remote_commands WHERE device_id = ? AND command_id = ?').get(deviceId, commandId) as Row | undefined
    return row ? JSON.parse(String(row.ack)) : undefined
  }

  // ── outcomes (local history for recommendations) ──────────
  recordOutcome(outcome: Outcome): void {
    this.db.prepare('INSERT INTO outcomes (task_id, at, category, strategy, doc) VALUES (?, ?, ?, ?, ?) ON CONFLICT(task_id) DO UPDATE SET at = excluded.at, category = excluded.category, strategy = excluded.strategy, doc = excluded.doc')
      .run(outcome.taskId, outcome.at, outcome.category, outcome.strategy, JSON.stringify(outcome))
  }

  listOutcomes(category?: string, limit = 2000): Outcome[] {
    const rows = (category
      ? this.db.prepare('SELECT doc FROM outcomes WHERE category = ? ORDER BY at DESC LIMIT ?').all(category, limit)
      : this.db.prepare('SELECT doc FROM outcomes ORDER BY at DESC LIMIT ?').all(limit)) as Row[]
    return rows.map((row) => Outcome.parse(JSON.parse(String(row.doc))))
  }

  clearOutcomes(): number {
    return Number(this.db.prepare('DELETE FROM outcomes').run().changes)
  }

  // ── key/value and audit ───────────────────────────────────
  getKv(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as Row | undefined
    return row ? String(row.value) : null
  }

  setKv(key: string, value: string): void {
    this.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  audit(actor: string, action: string, detail: Record<string, unknown>): void {
    this.db.prepare('INSERT INTO audit (at, actor, action, detail) VALUES (?, ?, ?, ?)').run(isoNow(), actor, action, JSON.stringify(detail))
  }

  listAudit(limit = 200): Array<{ seq: number; at: string; actor: string; action: string; detail: unknown }> {
    const rows = this.db.prepare('SELECT seq, at, actor, action, detail FROM audit ORDER BY seq DESC LIMIT ?').all(limit) as Row[]
    return rows.map((row) => ({ seq: Number(row.seq), at: String(row.at), actor: String(row.actor), action: String(row.action), detail: JSON.parse(String(row.detail)) }))
  }

  /** Consistent online snapshot of the whole database into a new file. */
  backupTo(file: string): void {
    mkdirSync(dirname(file), { recursive: true })
    this.db.prepare('VACUUM INTO ?').run(file)
  }

  // ── internals ─────────────────────────────────────────────
  private migrate(): void {
    const current = this.schemaVersion
    if (current > MIGRATIONS.length) {
      throw new Error(`Database schema v${current} is newer than this Hydra build (v${MIGRATIONS.length}). Refusing to open.`)
    }
    for (let version = current; version < MIGRATIONS.length; version++) {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.db.exec(MIGRATIONS[version]!)
        this.db.exec(`PRAGMA user_version = ${version + 1}`)
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    }
  }

  private notify(envelope: EventEnvelope): void {
    for (const listener of this.listeners) {
      try { listener(envelope) } catch { /* a faulty listener must not break the engine */ }
    }
  }

  private doc<S extends z.ZodTypeAny>(sql: string, schema: S, ...params: Array<string | number>): z.infer<S> | null {
    const row = this.db.prepare(sql).get(...params) as Row | undefined
    return row ? schema.parse(JSON.parse(String(row.doc))) : null
  }

  private docs<S extends z.ZodTypeAny>(sql: string, schema: S, ...params: Array<string | number>): Array<z.infer<S>> {
    return (this.db.prepare(sql).all(...params) as Row[]).map((row) => schema.parse(JSON.parse(String(row.doc))))
  }
}
