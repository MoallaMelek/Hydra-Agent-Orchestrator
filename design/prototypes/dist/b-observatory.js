(() => {
  // packages/protocol/src/verification.ts
  var checkSpecBinding = (c) => JSON.stringify([c.id, c.ecosystem, c.label, c.kind, c.argv, c.cwd, c.timeoutSec, c.required]);
  function verificationReceipt(task, evidence) {
    const revision = task.workspace?.headSha;
    const latest = /* @__PURE__ */ new Map();
    for (const e of [...evidence].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
      if (revision && e.phase === "verify" && e.commitSha === revision) latest.set(e.checkId, e);
    }
    const checks = task.checks.map((spec) => {
      const result = latest.get(spec.id);
      const state2 = !result ? "missing" : result.exitCode === 0 && !result.timedOut && !result.spawnError && !result.treeMutated ? "passed" : "failed";
      return { spec, result, state: state2 };
    });
    const failed = checks.filter((c) => c.state === "failed");
    const missing = checks.filter((c) => c.state === "missing");
    const passed = checks.filter((c) => c.state === "passed");
    const state = failed.length ? "failed" : missing.length || !checks.length || !revision ? "unverified" : "passed";
    return { revision, checks, failed, missing, passed, state };
  }
  function approvalContext(task, evidence) {
    const receipt = verificationReceipt(task, evidence);
    const unresolved = [];
    if (task.mode === "safe" && !task.checksApproved) unresolved.push("Safe-mode checks have not been approved.");
    if (!task.checks.length) unresolved.push("No verification checks are configured.");
    const reviewStage = task.stages.filter((s) => s.stage === "review").at(-1);
    const verifyStage = task.stages.filter((s) => s.stage === "verify").at(-1);
    if (reviewStage?.status !== "succeeded" || verifyStage?.status !== "succeeded") unresolved.push("Review and verification must finish successfully before acceptance.");
    for (const c of receipt.checks) {
      if (c.state !== "passed") unresolved.push(`${c.spec.label}: ${c.state === "missing" ? "no final result at this revision" : "failed or untrusted result"}.`);
      if (c.result && (c.result.taskId !== task.id || c.result.required !== c.spec.required)) unresolved.push(`${c.spec.label}: evidence does not match this task/check policy.`);
      if (c.result && (c.result.checkSpec !== checkSpecBinding(c.spec) || !verifyStage?.endedAt || c.result.startedAt < verifyStage.startedAt || c.result.startedAt > verifyStage.endedAt)) unresolved.push(`${c.spec.label}: evidence is stale or its command definition is untrusted.`);
      if (c.result?.definitionsChanged) unresolved.push(`${c.spec.label}: check definitions changed since planning; the result cannot authorize application.`);
    }
    if (!task.review) unresolved.push("No reviewer decision is recorded.");
    if (task.review?.verdict !== "approve" || task.review?.findings.some((f) => f.severity === "blocker" || f.severity === "major")) unresolved.push("Reviewer approval is unresolved.");
    if (task.review?.acceptanceCriteriaMet.some((c) => !c.met)) unresolved.push("The reviewer reports unmet acceptance criteria.");
    if (!receipt.revision || task.reviewedSha !== receipt.revision) unresolved.push("Review does not cover this revision.");
    const evidenceIds = receipt.checks.flatMap((c) => c.result ? [c.result.id] : []).sort();
    const snapshot = JSON.stringify({
      version: 1,
      taskId: task.id,
      mode: task.mode,
      revision: receipt.revision,
      baseSha: task.workspace?.baseSha,
      checks: task.checks,
      checkDigest: task.checkDigest,
      review: task.review,
      reviewedSha: task.reviewedSha ?? null,
      stages: task.stages.filter((s) => s.stage === "review" || s.stage === "verify"),
      // Bind result facts and output digest, not the large redacted display tail.
      results: receipt.checks.map((c) => {
        if (!c.result) return null;
        const { outputTail: _tail, ...facts } = c.result;
        return facts;
      })
    });
    return { snapshot, unresolved, evidenceIds, allowed: unresolved.length === 0 };
  }

  // packages/ui/src/ops/intel/graph.ts
  var ms = (iso) => iso ? Date.parse(iso) : null;
  var shortSha = (sha) => sha.slice(0, 7);
  var COMMIT_NOTE = /Commit ([0-9a-f]{7,40})/;
  var ROLE_OF_STAGE = { plan: "planner", implement: "implementer", fix: "implementer", review: "reviewer" };
  var STAGE_LABEL = { plan: "Plan", implement: "Build", review: "Review", fix: "Repair", verify: "Checks", demo: "Before / after", approval: "Your decision", apply: "Apply" };
  var passedEvidence = (e) => e.exitCode === 0 && !e.timedOut && !e.spawnError && !e.treeMutated;
  function runStatus(r) {
    return r.status === "running" ? "running" : r.status === "succeeded" ? "ok" : r.status === "canceled" || r.status === "interrupted" ? "canceled" : "failed";
  }
  function stageStatus(s, task) {
    if (s.status === "running") return task.status === "waiting_input" ? "waiting" : "running";
    if (s.status === "succeeded") return s.stage === "verify" && /failed/.test(s.note ?? "") ? "failed" : "ok";
    if (s.status === "failed") return "failed";
    if (s.status === "skipped") return "idle";
    return "canceled";
  }
  function fileTarget(a) {
    if (a.kind !== "read" && a.kind !== "edit") return null;
    const t = a.target.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (!t || /\s/.test(t) || t.includes("*")) return null;
    return t;
  }
  function buildIntel(input) {
    const { task, now } = input;
    const nodes = [];
    const edges = [];
    const byId = /* @__PURE__ */ new Map();
    const gaps = [];
    const add = (n) => {
      if (!byId.has(n.id)) {
        byId.set(n.id, n);
        nodes.push(n);
      }
      return byId.get(n.id);
    };
    const link = (from, to, kind, basis, at) => {
      const id = `${kind}:${from}>${to}`;
      if (!edges.some((e) => e.id === id)) edges.push({ id, from, to, kind, basis, at });
    };
    const runs = [...input.runs].filter((r) => r.taskId === task.id).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const evidence = [...input.evidence].filter((e) => e.taskId === task.id).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const live = task.status === "running" || task.status === "queued" || task.status === "waiting_input";
    const created = ms(task.createdAt);
    add({ id: "mission", kind: "mission", label: task.title || task.prompt.slice(0, 80), detail: task.prompt, basis: "observed", status: task.status === "failed" ? "failed" : task.status === "completed" ? "ok" : task.status === "waiting_input" ? "waiting" : task.status === "canceled" ? "canceled" : "running", actor: "human", at: created, end: ms(task.updatedAt), weight: 3 });
    const stages = [...task.stages].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    stages.forEach((s, i) => {
      const id = `stage:${s.stage}:${s.attempt}`;
      const role = ROLE_OF_STAGE[s.stage];
      add({ id, kind: "stage", label: `${STAGE_LABEL[s.stage]}${s.attempt > 1 ? ` \xB7 attempt ${s.attempt}` : ""}`, detail: s.note ?? "", basis: "observed", status: stageStatus(s, task), actor: role ?? (s.stage === "approval" || s.stage === "apply" ? "human" : "engine"), at: ms(s.startedAt), end: ms(s.endedAt), stage: s.stage, attempt: s.attempt, weight: 1, stageRecord: s });
      if (i > 0) {
        const p = stages[i - 1];
        link(`stage:${p.stage}:${p.attempt}`, id, "sequence", "observed", ms(s.startedAt));
      }
    });
    const stageOfRun = (r) => {
      const t0 = ms(r.startedAt);
      const candidates = stages.filter((s) => s.stage === r.stage && ms(s.startedAt) <= t0 + 1);
      return candidates.at(-1) ?? null;
    };
    const files = /* @__PURE__ */ new Map();
    const fileNode = (path) => {
      let f = files.get(path);
      if (!f) {
        f = { path, planned: false, reads: 0, edits: 0, diff: null, findings: 0, touchedBy: [] };
        files.set(path, f);
      }
      return f;
    };
    const planAt = ms(stages.find((s) => s.stage === "plan")?.endedAt) ?? created;
    for (const p of task.plan?.filesLikelyTouched ?? []) {
      fileNode(p.replace(/\\/g, "/").replace(/^\.\//, "")).planned = true;
    }
    for (const r of runs) {
      const id = `run:${r.id}`;
      const facts = { run: r, reads: 0, edits: 0, searches: 0, commands: [], activity: r.activity };
      for (const a of r.activity) {
        if (a.kind === "read") facts.reads++;
        else if (a.kind === "edit") facts.edits++;
        else if (a.kind === "search") facts.searches++;
        else if (a.kind === "command") facts.commands.push(a.target);
        const path = fileTarget(a);
        if (path) {
          const f = fileNode(path);
          if (a.kind === "read") f.reads++;
          else f.edits++;
          if (!f.touchedBy.includes(r.role)) f.touchedBy.push(r.role);
          link(id, `file:${path}`, a.kind === "edit" ? "edit" : "read", "observed", ms(a.at));
        }
      }
      const s = stageOfRun(r);
      const roleName = r.role === "planner" ? "Planner" : r.role === "implementer" ? "Implementer" : "Reviewer";
      add({ id, kind: "run", label: `${roleName} \xB7 ${STAGE_LABEL[r.stage]}${s && s.attempt > 1 ? ` ${s.attempt}` : ""}`, detail: r.error ?? r.tail.slice(-400), basis: "observed", status: runStatus(r), actor: r.role, at: ms(r.startedAt), end: ms(r.endedAt), stage: r.stage, attempt: s?.attempt, weight: 1 + r.activity.length, runFacts: facts });
      if (s) link(`stage:${s.stage}:${s.attempt}`, id, "performs", "observed", ms(r.startedAt));
    }
    const revs = [];
    const known = (sha) => revs.find((r) => r.sha.startsWith(sha) || sha.startsWith(r.sha));
    const addRev = (sha, at, role) => {
      if (!sha) return null;
      const k = known(sha);
      if (k) {
        if (sha.length > k.sha.length) k.sha = sha;
        if (role === "head" || role === "applied") k.role = role;
        if (k.at === null || at !== null && at < k.at) k.at = at ?? k.at;
        return k;
      }
      const r = { sha, at, role };
      revs.push(r);
      return r;
    };
    addRev(task.workspace?.baseSha, ms(stages[0]?.startedAt) ?? created, "base");
    for (const s of stages) {
      const m = COMMIT_NOTE.exec(s.note ?? "");
      if (m) addRev(m[1], ms(s.endedAt), "work");
    }
    for (const e of evidence) addRev(e.commitSha, ms(e.startedAt), "work");
    addRev(task.workspace?.headSha, null, "head");
    addRev(task.applied?.afterSha, ms(task.acceptance?.at), "applied");
    revs.sort((a, b) => a.role === "base" ? -1 : b.role === "base" ? 1 : (a.at ?? Infinity) - (b.at ?? Infinity));
    const revId = (sha) => {
      if (!sha) return null;
      const k = known(sha);
      return k ? `rev:${shortSha(k.sha)}` : null;
    };
    revs.forEach((r, i) => {
      const id = `rev:${shortSha(r.sha)}`;
      add({ id, kind: "revision", label: shortSha(r.sha), detail: r.role === "base" ? "Your branch when the mission started" : r.role === "applied" ? "Applied to your branch" : r.role === "head" ? "Current proposed revision" : "Intermediate revision", basis: "observed", status: "idle", actor: r.role === "base" ? "human" : "implementer", at: r.at, end: null, weight: 1, revision: { sha: r.sha, short: shortSha(r.sha), role: r.role, index: i } });
      if (i > 0) link(`rev:${shortSha(revs[i - 1].sha)}`, id, "parent", "derived", r.at);
    });
    for (const s of stages) {
      const m = COMMIT_NOTE.exec(s.note ?? "");
      const rid = m ? revId(m[1]) : null;
      if (!rid) continue;
      const run = runs.filter((r) => r.stage === s.stage && stageOfRun(r)?.attempt === s.attempt).at(-1);
      if (run) link(`run:${run.id}`, rid, "produced", "derived", ms(s.endedAt));
    }
    for (const e of evidence) {
      const id = `check:${e.id}`;
      const end = ms(e.startedAt) + e.durationMs;
      add({ id, kind: "check", label: e.label, detail: e.phase === "demo_base" ? "On your original branch, for the before/after comparison" : e.phase === "pre_review" ? "Before review" : e.phase === "verify" ? "Verification" : "Result comparison", basis: "observed", status: passedEvidence(e) ? "ok" : "failed", actor: "engine", at: ms(e.startedAt), end, weight: 1, evidence: e });
      const rid = revId(e.commitSha);
      if (rid) link(id, rid, "tested", "observed", end);
    }
    const reviews = input.reviews?.length ? [...input.reviews] : task.review ? [{ review: task.review, reviewedSha: task.reviewedSha ?? null, at: ms(stages.filter((s) => s.stage === "review").at(-1)?.endedAt) ?? ms(task.updatedAt) }] : [];
    const reviewStages = stages.filter((s) => s.stage === "review" && s.status !== "running");
    if (!input.reviews?.length && reviewStages.length > reviews.length) {
      gaps.push(`${reviewStages.length - reviews.length} earlier review record(s) are not retained by this view; their stage notes remain.`);
    }
    reviews.forEach((rv, ri) => {
      const reviewer = runs.filter((r) => r.role === "reviewer" && ms(r.endedAt) !== null && ms(r.endedAt) <= rv.at + 2e3).at(-1);
      const rid = revId(rv.reviewedSha);
      if (reviewer && rid) link(`run:${reviewer.id}`, rid, "reviewed", "observed", rv.at);
      rv.review.findings.forEach((f, fi) => {
        const id = `finding:${ri}:${fi}`;
        add({ id, kind: "finding", label: f.issue, detail: f.suggestion, basis: "observed", status: f.severity === "blocker" || f.severity === "major" ? "blocked" : "idle", actor: "reviewer", at: rv.at, end: null, weight: f.severity === "blocker" ? 3 : f.severity === "major" ? 2 : 1, finding: { ...f, review: ri, reviewedSha: rv.reviewedSha } });
        if (reviewer) link(`run:${reviewer.id}`, id, "raised", "observed", rv.at);
        if (f.file) {
          const p = f.file.replace(/\\/g, "/");
          fileNode(p).findings++;
          link(id, `file:${p}`, "concerns", "observed", rv.at);
        }
      });
    });
    const head = revs.find((r) => r.role === "head" || r.role === "applied");
    if (input.diff && "files" in input.diff) {
      for (const df of input.diff.files) {
        const f = fileNode(df.path);
        f.diff = { status: df.status, additions: df.additions, deletions: df.deletions, patch: df.patch };
        const hid = revId(input.diff.headSha);
        if (hid) link(hid, `file:${df.path}`, "changed", "observed", head?.at ?? null);
      }
      if (input.diff.truncated) gaps.push("The diff was truncated by the engine; some files are not listed.");
    } else if (task.intent === "change" && task.workspace?.removed) gaps.push("The isolated workspace was removed after delivery, so per-file line changes are no longer available.");
    else if (task.intent === "change" && task.workspace) gaps.push("The final diff was not loaded.");
    const latest = reviews.length - 1;
    const blocking = new Set(reviews[latest]?.review.findings.filter((f) => f.file && (f.severity === "blocker" || f.severity === "major")).map((f) => f.file.replace(/\\/g, "/")) ?? []);
    for (const f of files.values()) {
      const id = `file:${f.path}`;
      const touchedAt = edges.filter((e) => e.to === id && e.at !== null).map((e) => e.at).sort((a, b) => a - b)[0] ?? null;
      add({ id, kind: "file", label: f.path.split("/").pop() ?? f.path, detail: f.path, basis: f.diff || f.reads || f.edits ? "observed" : "planned", status: blocking.has(f.path) ? "blocked" : "idle", actor: null, at: touchedAt ?? (f.planned ? planAt : null), end: null, weight: 1 + f.edits * 2 + f.reads + (f.diff ? Math.ceil((f.diff.additions + f.diff.deletions) / 4) : 0), file: f });
      if (f.planned) link("mission", id, "planned", "planned", planAt);
    }
    if (task.intent === "change") {
      const ctx = approvalContext(task, evidence);
      const waiting = task.status === "waiting_input";
      const decided = task.acceptance ?? null;
      const status = decided || task.outcome === "applied" ? "ok" : task.outcome ? "canceled" : waiting && task.waitReason === "final_approval" ? ctx.allowed ? "waiting" : "blocked" : waiting ? "waiting" : "idle";
      const lastEnd = ms(stages.at(-1)?.endedAt);
      const recordedAt = ms(stages.find((s) => s.stage === "approval")?.startedAt);
      const at = recordedAt ?? (waiting && task.waitReason === "plan_approval" ? planAt : waiting || decided ? lastEnd : null);
      add({ id: "decision", kind: "decision", label: decided ? "Accepted" : task.outcome === "applied" ? "Applied" : task.outcome ? "Closed" : waiting ? task.waitReason === "plan_approval" ? "Approve the plan" : "Your decision" : "Your decision", detail: decided ? `Accepted ${shortSha(decided.revision)} by ${decided.actor}` : "", basis: recordedAt === null && at !== null && task.waitReason !== "plan_approval" ? "derived" : "observed", status, actor: "human", at, end: ms(decided?.at), weight: 2, decision: { waiting: task.waitReason, outcome: task.outcome, acceptance: decided, unresolved: ctx.unresolved, allowed: ctx.allowed } });
      const target = revId(decided?.revision ?? task.workspace?.headSha);
      if (target && at !== null) link("decision", target, "decides", "observed", at);
    }
    const moments = [...new Set([...nodes.flatMap((n) => [n.at, n.end]), ...edges.map((e) => e.at)].filter((x) => typeof x === "number"))].sort((a, b) => a - b);
    const counts = { mission: 0, stage: 0, run: 0, file: 0, revision: 0, check: 0, finding: 0, decision: 0 };
    for (const n of nodes) counts[n.kind]++;
    return { task, nodes, edges, byId, start: created, end: Math.max(moments.at(-1) ?? created, live && task.status === "running" ? now : 0), moments, live, counts, gaps };
  }
  function projectAt(g, cursor) {
    if (cursor === null || cursor >= g.end) return g;
    const keep = (n) => n.kind === "mission" || n.at !== null && n.at <= cursor;
    const nodes = g.nodes.filter(keep).map((n) => {
      if (n.end !== null && n.end > cursor && (n.kind === "run" || n.kind === "stage" || n.kind === "check")) return { ...n, status: "running", end: null };
      if (n.kind === "file" && n.file?.diff) return { ...n, file: { ...n.file, diff: null } };
      if (n.kind === "mission") return { ...n, status: "running" };
      return n;
    });
    const ids = new Set(nodes.map((n) => n.id));
    const edges = g.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && (e.at === null ? e.kind === "parent" : e.at <= cursor));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const counts = { mission: 0, stage: 0, run: 0, file: 0, revision: 0, check: 0, finding: 0, decision: 0 };
    for (const n of nodes) counts[n.kind]++;
    return { ...g, nodes, edges, byId, counts, end: cursor, live: true };
  }

  // design/prototypes/src/shared.ts
  var SCENARIO_NAME = {
    repair: "Repair journey",
    clean: "Applied change",
    "verify-fail": "Failing check",
    "plan-gate": "Plan approval",
    failure: "Execution failure",
    question: "Question"
  };
  var ORDER = ["repair", "verify-fail", "plan-gate", "clean", "failure", "question"];
  async function loadPack() {
    const pack = await fetch("data/missions.json").then((r) => r.json());
    const missions = pack.missions.map((m) => {
      const graph = buildIntel({ task: m.detail.task, runs: m.detail.runs, evidence: m.detail.evidence, diff: m.diff, reviews: m.reviews.map((r) => ({ review: r.review, reviewedSha: r.reviewedSha, at: Date.parse(r.at) })), now: Date.parse(pack.recordedAt) });
      return { scenario: m.scenario, title: m.detail.task.title, project: pack.projects.find((p) => p.id === m.detail.task.projectId), graph, raw: m };
    });
    missions.sort((a, b) => ORDER.indexOf(a.scenario) - ORDER.indexOf(b.scenario));
    return { pack, missions };
  }
  var el = (tag, attrs = {}, ...kids) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === void 0 || v === null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "style" && typeof v === "object") {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith("--")) node.style.setProperty(sk, String(sv));
          else node.style[sk] = sv;
        }
      } else node.setAttribute(k, v === true ? "" : String(v));
    }
    for (const kid of kids) if (kid !== null && kid !== void 0 && kid !== false) node.append(kid);
    return node;
  };
  var fmtDuration = (ms2) => ms2 < 1e3 ? `${Math.round(ms2)} ms` : ms2 < 6e4 ? `${(ms2 / 1e3).toFixed(ms2 < 1e4 ? 1 : 0)} s` : `${Math.floor(ms2 / 6e4)} min ${Math.round(ms2 % 6e4 / 1e3)} s`;
  var fmtOffset = (t, start) => {
    const s = Math.max(0, (t - start) / 1e3);
    return s < 60 ? `+${s.toFixed(1)}s` : `+${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s`;
  };
  var KIND_NAME = { mission: "Mission", stage: "Stage", run: "Agent run", file: "File", revision: "Revision", check: "Engine check", finding: "Review finding", decision: "Your decision" };
  var BASIS_TEXT = { observed: "Observed", derived: "Derived", planned: "Planned", unavailable: "Unavailable" };
  var BASIS_HELP = {
    observed: "Recorded directly by the engine.",
    derived: "Computed from recorded facts by a stated rule.",
    planned: "Stated intent from the plan, not an outcome.",
    unavailable: "Known to exist but not retained in this data."
  };
  var ROLE_NAME = { planner: "Planner", implementer: "Implementer", reviewer: "Reviewer", engine: "Hydra engine", human: "You" };
  var PROVIDER_NAME = (id) => id === "claude" ? "Claude Code" : id === "codex" ? "Codex CLI" : id === "scripted" ? "Scripted fixture agent" : id;
  var statusWord = (n) => {
    if (n.kind === "check") return n.status === "ok" ? "Passed" : n.status === "running" ? "Running" : "Failed";
    if (n.kind === "finding") return n.finding.severity[0].toUpperCase() + n.finding.severity.slice(1);
    if (n.kind === "decision") return n.status === "blocked" ? "Blocked" : n.status === "waiting" ? "Waiting for you" : n.status === "ok" ? "Accepted" : n.status === "canceled" ? "Closed" : "Not reached";
    return { running: "Running", ok: "Succeeded", failed: "Failed", waiting: "Waiting", blocked: "Blocked", canceled: "Canceled", idle: "" }[n.status];
  };
  function neighbours(g, id) {
    const ins = [];
    const outs = [];
    for (const e of g.edges) {
      if (e.to === id && g.byId.has(e.from)) ins.push({ node: g.byId.get(e.from), kind: e.kind });
      if (e.from === id && g.byId.has(e.to)) outs.push({ node: g.byId.get(e.to), kind: e.kind });
    }
    return { ins, outs };
  }
  var EDGE_VERB = {
    sequence: ["came after", "handed off to"],
    performs: ["ran in", "ran"],
    read: ["read by", "read"],
    edit: ["edited by", "edited"],
    produced: ["produced by", "produced"],
    parent: ["followed", "followed by"],
    tested: ["tested by", "tested"],
    reviewed: ["reviewed by", "reviewed"],
    raised: ["raised by", "raised"],
    concerns: ["flagged by", "concerns"],
    planned: ["planned in", "plans to touch"],
    changed: ["changed in", "changes"],
    decides: ["decided by", "decides on"]
  };
  function diffBlock(patch) {
    const pre = el("pre", { class: "insp-diff", tabindex: "0", "aria-label": "Diff" });
    for (const line of patch.split("\n").slice(0, 240)) {
      const cls = line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : line.startsWith("@@") ? "hunk" : "";
      pre.append(el("span", { class: cls }, line + "\n"));
    }
    return pre;
  }
  function renderInspector(g, n, opts) {
    if (!n) {
      const t = g.task;
      return el(
        "div",
        { class: "insp insp-empty" },
        el("p", { class: "insp-eyebrow" }, "Mission"),
        el("h2", { class: "insp-title" }, t.title),
        el("p", { class: "insp-prompt" }, t.prompt),
        el("p", { class: "insp-hint" }, "Select anything on the map to see the record behind it. Keyboard: Tab to the map, arrow keys to move, Enter to inspect, F to focus, Esc to step back."),
        g.gaps.length ? el("div", { class: "insp-gaps" }, el("p", { class: "insp-eyebrow" }, "Not in this data"), ...g.gaps.map((x) => el("p", {}, x))) : null
      );
    }
    const head = el(
      "header",
      { class: "insp-head" },
      el("p", { class: "insp-eyebrow" }, `${KIND_NAME[n.kind]}${n.actor ? " \xB7 " + ROLE_NAME[n.actor] : ""}`),
      el("h2", { class: "insp-title" }, n.kind === "file" ? n.file.path : n.label),
      el(
        "div",
        { class: "insp-tags" },
        statusWord(n) ? el("span", { class: `insp-status s-${n.status}` }, statusWord(n)) : null,
        el("span", { class: `insp-basis b-${n.basis}`, title: BASIS_HELP[n.basis] }, BASIS_TEXT[n.basis]),
        n.at !== null ? el("span", { class: "insp-time" }, fmtOffset(n.at, g.start)) : null,
        n.end !== null && n.at !== null ? el("span", { class: "insp-time" }, fmtDuration(n.end - n.at)) : null
      )
    );
    const body = el("div", { class: "insp-body" });
    const facts = (rows) => el("dl", { class: "insp-facts" }, ...rows.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]));
    if (n.kind === "run") {
      const f = n.runFacts;
      body.append(facts([["Provider", PROVIDER_NAME(f.run.provider)], ["Stage", `${STAGE_LABEL[f.run.stage]}${n.attempt && n.attempt > 1 ? ` \xB7 attempt ${n.attempt}` : ""}`], ["Reported calls", `${f.reads} read \xB7 ${f.edits} edit \xB7 ${f.searches} search \xB7 ${f.commands.length} command`], ["Tokens", `${(f.run.usage.inputTokens + f.run.usage.outputTokens).toLocaleString()}${f.run.usage.costUsd ? ` \xB7 $${f.run.usage.costUsd.toFixed(3)}` : " \xB7 unpriced"}`]]));
      const list = el("ol", { class: "insp-ops" });
      for (const a of f.activity) list.append(el("li", {}, el("span", { class: `op op-${a.kind}` }, a.tool), " ", el("code", {}, a.target), el("span", { class: "insp-dim" }, " " + fmtOffset(Date.parse(a.at), g.start))));
      body.append(el("h3", {}, "Reported tool calls"), f.activity.length ? list : el("p", { class: "insp-dim" }, "No tool calls were reported for this run."));
      body.append(el("p", { class: "insp-note" }, "Tool calls are what the provider CLI reported: names and targets only. Hydra never records file contents or model reasoning."));
    }
    if (n.kind === "file") {
      const f = n.file;
      body.append(facts([["Planned", f.planned ? "Named in the plan" : "Not named in the plan"], ["Reported", `${f.reads} read \xB7 ${f.edits} edit`], ["Touched by", f.touchedBy.map((r) => ROLE_NAME[r]).join(", ") || "No agent reported touching it"], ["In final change", f.diff ? `${f.diff.status} \xB7 +${f.diff.additions} \u2212${f.diff.deletions}` : "Not in the final diff"], ["Findings", String(f.findings)]]));
      if (f.diff?.patch) body.append(el("h3", {}, "Change against your branch"), diffBlock(f.diff.patch));
    }
    if (n.kind === "check") {
      const e = n.evidence;
      body.append(facts([["Command", el("code", {}, e.argv.join(" "))], ["Revision", el("code", {}, e.commitSha.slice(0, 10))], ["When", n.detail], ["Exit", e.spawnError ? `Could not start: ${e.spawnError}` : e.timedOut ? "Timed out" : String(e.exitCode)], ["Duration", fmtDuration(e.durationMs)], ["Output", `${e.outputBytes.toLocaleString()} bytes${e.outputTruncated ? " \xB7 truncated" : ""} \xB7 sha256 ${e.outputSha256.slice(0, 12)}`]]));
      if (e.treeMutated) body.append(el("p", { class: "insp-warn" }, "The check modified tracked files, so Hydra treats this result as untrustworthy."));
      body.append(el("h3", {}, passedEvidence(e) ? "Output (tail)" : "Why it failed (output tail)"), el("pre", { class: "insp-log", tabindex: "0" }, e.outputTail.split("\n").slice(-40).join("\n") || "(no output)"));
    }
    if (n.kind === "finding") {
      const f = n.finding;
      body.append(el("p", { class: "insp-lead" }, f.issue), facts([["Suggestion", f.suggestion || "\u2014"], ["File", f.file ?? "No file named"], ["Review", `Review ${f.review + 1}${f.reviewedSha ? ` of ${f.reviewedSha.slice(0, 7)}` : ""}`]]));
    }
    if (n.kind === "revision") {
      const r = n.revision;
      const checks = g.nodes.filter((x) => x.kind === "check" && x.evidence.commitSha.startsWith(r.short));
      body.append(facts([["Commit", el("code", {}, r.sha)], ["Role", n.detail], ["Checks on it", checks.length ? `${checks.filter((c) => c.status === "ok").length} passed \xB7 ${checks.filter((c) => c.status === "failed").length} failed` : "None ran on this revision"]]));
      body.append(el("p", { class: "insp-note" }, "Revisions are listed in the order they appeared in records. Git ancestry is not part of this data, so the chain between them is derived."));
    }
    if (n.kind === "stage") {
      body.append(facts([["Note", n.detail || "\u2014"], ["Status", n.stageRecord.status]]));
    }
    if (n.kind === "decision") {
      const d = n.decision;
      if (d.acceptance) body.append(facts([["Accepted revision", el("code", {}, d.acceptance.revision.slice(0, 10))], ["By", `${d.acceptance.actor} \xB7 ${d.acceptance.source}`], ["Evidence bound", `${d.acceptance.evidenceIds.length} check results`], ["Receipt", el("code", {}, d.acceptance.decisionId)]]));
      else if (d.waiting === "final_approval") {
        body.append(el("p", { class: "insp-lead" }, d.allowed ? "Checks and review cover this exact revision. Accepting fast-forwards your branch to it." : "Hydra will refuse acceptance until these are resolved:"));
        if (!d.allowed) body.append(el("ul", { class: "insp-unresolved" }, ...d.unresolved.map((u) => el("li", {}, u))));
        body.append(el("div", { class: "insp-actions" }, el("button", { class: "btn btn-primary", disabled: !d.allowed, title: d.allowed ? "" : "Blocked by the engine policy" }, "Accept revision"), el("button", { class: "btn" }, "Request changes"), el("button", { class: "btn btn-quiet" }, "Reject")), el("p", { class: "insp-note" }, "Prototype: decision buttons are inert. In Hydra they send the existing engine command, which re-checks the same policy."));
      } else if (d.waiting === "plan_approval") {
        const plan = g.task.plan;
        if (plan) body.append(el("p", { class: "insp-lead" }, plan.summary), el("h3", {}, "Steps"), el("ol", { class: "insp-list" }, ...plan.steps.map((s) => el("li", {}, s))), el("h3", {}, "Risks"), el("ul", { class: "insp-list" }, ...plan.risks.map((s) => el("li", {}, s))));
        body.append(el("div", { class: "insp-actions" }, el("button", { class: "btn btn-primary" }, "Approve plan"), el("button", { class: "btn" }, "Revise")), el("p", { class: "insp-note" }, "Prototype: inert controls."));
      } else body.append(el("p", {}, "No decision has been requested yet."));
    }
    if (n.kind === "mission") body.append(el("p", { class: "insp-prompt" }, g.task.prompt));
    const { ins, outs } = neighbours(g, n.id);
    if (ins.length || outs.length) {
      const rel = el("ul", { class: "insp-rel" });
      for (const { node, kind } of ins) rel.append(el("li", {}, el("span", { class: "insp-dim" }, (EDGE_VERB[kind]?.[0] ?? kind) + " "), el("button", { class: "linkish", onclick: () => opts.onSelect(node.id) }, node.kind === "file" ? node.file.path : node.label)));
      for (const { node, kind } of outs) rel.append(el("li", {}, el("span", { class: "insp-dim" }, (EDGE_VERB[kind]?.[1] ?? kind) + " "), el("button", { class: "linkish", onclick: () => opts.onSelect(node.id) }, node.kind === "file" ? node.file.path : node.label)));
      body.append(el("h3", {}, "Connections"), rel);
    }
    return el("div", { class: "insp" }, head, body);
  }
  function fixtureBanner(pack) {
    return el("div", { class: "fixture-banner", role: "note" }, el("b", {}, "Recorded fixture"), ` \xB7 real Hydra ${pack.engineVersion} engine, Git worktrees and check processes \xB7 agents are the scripted test adapter, so tool calls and review text are scripted, not model activity \xB7 recorded ${new Date(pack.recordedAt).toLocaleString()}`);
  }

  // design/prototypes/src/b-observatory.ts
  var NS = "http://www.w3.org/2000/svg";
  var svg = (tag, attrs = {}, ...kids) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== void 0 && v !== null && v !== false) n.setAttribute(k, String(v));
    for (const k of kids) if (k !== null) n.append(k);
    return n;
  };
  var reduced = matchMedia("(prefers-reduced-motion: reduce)");
  var GUTTER = 168;
  var OUT = 128;
  async function main() {
    const { pack, missions } = await loadPack();
    const root = document.getElementById("app");
    let mi = 0;
    let full = missions[0].graph;
    let g = full;
    let cursor = null;
    let win = [full.start, full.end];
    let selected = null;
    let depth = false;
    let marks = [];
    const missionPicker = el("select", { id: "mission", "aria-label": "Mission" }, ...missions.map((m, i) => el("option", { value: String(i) }, `${SCENARIO_NAME[m.scenario] ?? m.scenario} \u2014 ${m.title}`)));
    const depthBtn = el("button", { class: "btn", "aria-pressed": "false", title: "Tilt the planes into a stack for orientation" }, "Depth");
    const fitBtn = el("button", { class: "btn btn-quiet" }, "Whole mission");
    const playBtn = el("button", { class: "btn" }, "Replay");
    const title = el("h1", { class: "m-title" });
    const meta = el("div", { class: "m-meta" });
    const overview = el("div", { class: "overview", role: "group", "aria-label": "Overview and replay. Drag to zoom into a time window; click to move the replay cursor." });
    const obs = el("div", { class: "observatory", role: "application", "aria-label": "Observatory planes. Tab moves between planes; left and right arrows move through recorded marks in time; Enter inspects." });
    const stack = el("div", { class: "stack" });
    const narrow = el("div", { class: "narrow" });
    obs.append(stack);
    const section = el("aside", { class: "xsect", "aria-label": "Cross-section and evidence" });
    const live = el("div", { class: "sr-only", "aria-live": "polite" });
    root.append(
      fixtureBanner(pack),
      el(
        "header",
        { class: "top" },
        el("div", { class: "brand" }, el("span", { class: "mark", "aria-hidden": "true" }), el("b", {}, "Hydra"), el("span", { class: "mono dim" }, "B \xB7 Engineering observatory")),
        missionPicker,
        el("span", { class: "grow" }),
        fitBtn,
        depthBtn,
        playBtn
      ),
      el(
        "main",
        { class: "room" },
        el("section", { class: "deck", "aria-label": "Mission observatory" }, el("div", { class: "mhead" }, title, meta), overview, obs, narrow),
        section
      ),
      live
    );
    function load(i) {
      mi = i;
      full = missions[i].graph;
      g = full;
      cursor = null;
      win = [full.start, Math.max(full.end, full.start + 1e3)];
      selected = null;
      render();
    }
    function xOf(t, width) {
      const [a, b] = win;
      return GUTTER + (t - a) / Math.max(1, b - a) * (width - GUTTER - OUT);
    }
    function inWin(t) {
      return t !== null && t >= win[0] - 1 && t <= win[1] + 1;
    }
    function render() {
      g = projectAt(full, cursor);
      const width = obs.clientWidth || 1e3;
      title.textContent = g.task.title;
      const head = full.nodes.filter((n) => n.kind === "revision");
      meta.replaceChildren(
        el("span", { class: "pill" }, g.task.intent === "analyze" ? "Question" : "Change"),
        el("span", { class: "pill" }, full.task.status.replace("_", " ") + (full.task.waitReason ? " \xB7 " + full.task.waitReason.replace("_", " ") : "")),
        el("span", { class: "mono dim" }, `${missions[mi].project.name} \xB7 ${fmtDuration(full.end - full.start)} recorded \xB7 ${head.length} revision${head.length === 1 ? "" : "s"}`)
      );
      renderOverview();
      marks = [];
      stack.replaceChildren(...planes(width));
      narrow.replaceChildren(el("p", { class: "plane-note" }, "Time planes need a wider window. Revisions, in recorded order:"), ...full.nodes.filter((n) => n.kind === "revision").map((r) => el("button", { class: "btn", onclick: () => select(r.id) }, `${r.revision.short} \xB7 ${r.detail}`)));
      stack.querySelectorAll("[data-id]").forEach((m) => m.addEventListener("click", (e) => {
        e.stopPropagation();
        select(m.dataset.id);
      }));
      applySelection();
      renderSection();
    }
    function planeShell(i, name, sub, height, width) {
      const s = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "group", "aria-label": `${name} plane` });
      s.append(svg("rect", { x: 0, y: 0, width, height, class: "plane-bg" }));
      s.append(svg("text", { x: 18, y: 22, class: "plane-name" }, name), svg("text", { x: 18, y: 38, class: "plane-sub" }, sub));
      s.append(svg("line", { x1: GUTTER - 10, x2: GUTTER - 10, y1: 46, y2: height - 8, class: "gutter-rule" }));
      s.append(svg("text", { x: width - OUT + 14, y: 22, class: "plane-sub" }, i === 2 ? "FINAL CHANGE" : i === 3 ? "AT HEAD" : ""));
      const wrap = el("div", { class: "plane", style: { "--i": String(i) }, tabindex: "0", "data-plane": String(i), "aria-label": `${name}: ${sub}` }, s);
      return { s, wrap };
    }
    function gates(s, height, width, top) {
      for (const r of g.nodes.filter((n) => n.kind === "revision")) {
        const t = r.at ?? full.end;
        if (!inWin(t)) continue;
        const x = xOf(t, width);
        const gsel = svg("g", { "data-id": r.id, class: `gate ${r.revision.role}`, tabindex: "-1", role: "button", "aria-label": `Revision ${r.revision.short}` });
        gsel.append(svg("line", { x1: x, x2: x, y1: 0, y2: height, class: "gate-line" }));
        if (top) {
          gsel.append(svg("rect", { x: x - 34, y: 4, width: 68, height: 18, rx: 2, class: "gate-tab" }), svg("text", { x, y: 17, class: "gate-label", "text-anchor": "middle" }, `${r.revision.short}${r.revision.role === "base" ? " base" : r.revision.role === "head" || r.revision.role === "applied" ? " head" : ""}`));
        }
        s.append(gsel);
        if (top) marks.push({ id: r.id, x, plane: 0, label: `Revision ${r.revision.short}` });
      }
    }
    function planes(width) {
      const out = [];
      const lane = (y, label, s) => {
        s.append(svg("text", { x: GUTTER - 18, y: y + 4, class: "lane-label", "text-anchor": "end" }, label), svg("line", { x1: GUTTER, x2: width - OUT, y1: y, y2: y, class: "lane-rule" }));
      };
      {
        const h = 84;
        const { s, wrap } = planeShell(0, "You", "request \xB7 decision", h, width);
        gates(s, h, width, true);
        lane(54, "decisions", s);
        const m = g.byId.get("mission");
        if (inWin(m.at)) {
          const x = xOf(m.at, width);
          s.append(mark("mission", x, 54, svg("circle", { cx: x, cy: 54, r: 5, class: "m-human" }), "Asked", 0));
        }
        const d = g.byId.get("decision");
        if (d && d.at !== null && inWin(d.at)) {
          const x = xOf(d.at, width);
          const shape = svg("g", {}, svg("circle", { cx: x, cy: 54, r: 7, class: d.status === "blocked" ? "m-stop-ring" : "m-human-ring" }), svg("line", { x1: x - 11, x2: x + 11, y1: 54, y2: 54, class: d.status === "blocked" ? "m-stop-ring" : "m-human-ring" }), svg("line", { x1: x, x2: x, y1: 43, y2: 65, class: d.status === "blocked" ? "m-stop-ring" : "m-human-ring" }));
          s.append(mark("decision", x, 54, shape, d.label + (d.status === "blocked" ? " \xB7 blocked" : d.status === "waiting" ? " \xB7 waiting" : ""), 0, true));
        }
        out.push(wrap);
      }
      {
        const roles = ["planner", "implementer", "reviewer"];
        const h = 56 + roles.length * 34;
        const { s, wrap } = planeShell(1, "Agents", "runs \xB7 tool calls", h, width);
        gates(s, h, width, false);
        const yOf = (r) => 62 + roles.indexOf(r) * 34;
        roles.forEach((r) => lane(yOf(r), ROLE_NAME[r], s));
        const runs = g.nodes.filter((n) => n.kind === "run").sort((a, b) => a.at - b.at);
        runs.forEach((r, i) => {
          const next = runs[i + 1];
          if (!next || r.end === null || !inWin(r.end)) return;
          const x1 = xOf(r.end, width), x2 = xOf(next.at, width), y1 = yOf(r.actor), y2 = yOf(next.actor);
          s.append(svg("path", { d: `M${x1},${y1} C${x1 + 18},${y1} ${x2 - 18},${y2} ${x2},${y2}`, class: "baton" }));
        });
        for (const r of runs) {
          if (!inWin(r.at) && !inWin(r.end)) continue;
          const x1 = xOf(Math.max(r.at, win[0]), width), x2 = xOf(Math.min(r.end ?? full.end, win[1]), width);
          const y = yOf(r.actor);
          const f = r.runFacts;
          const beam = svg("g", {});
          beam.append(svg("rect", { x: x1, y: y - 6, width: Math.max(3, x2 - x1), height: 12, rx: 2, class: `beam ${r.status}` }));
          for (const a of f.activity) {
            const t = Date.parse(a.at);
            if (!inWin(t) || cursor !== null && t > cursor) continue;
            const ax = xOf(t, width);
            beam.append(a.kind === "edit" ? svg("rect", { x: ax - 1, y: y - 9, width: 2, height: 18, class: "tick-edit" }) : a.kind === "command" ? svg("rect", { x: ax - 2.5, y: y - 2.5, width: 5, height: 5, class: "tick-cmd" }) : svg("circle", { cx: ax, cy: y, r: 1.8, class: "tick-read" }));
          }
          s.append(mark(r.id, x1, y, beam, `${r.label} \xB7 ${statusWord(r)} \xB7 ${f.activity.length} reported calls`, 1));
          s.append(svg("text", { x: x1, y: y - 11, class: "beam-label" }, `${STAGE_LABEL[r.stage]}${r.attempt && r.attempt > 1 ? " " + r.attempt : ""}`));
        }
        out.push(wrap);
      }
      {
        const files = g.nodes.filter((n) => n.kind === "file").sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
        const h = 56 + Math.max(files.length, 1) * 26;
        const { s, wrap } = planeShell(2, "Code", "files touched", h, width);
        gates(s, h, width, false);
        if (!files.length) s.append(svg("text", { x: GUTTER, y: 70, class: "plane-sub" }, "No file activity recorded at this point."));
        files.forEach((f, i) => {
          const y = 62 + i * 26;
          const ff = f.file;
          s.append(svg("text", { x: GUTTER - 18, y: y + 4, class: `file-label ${ff.diff ? "changed" : ""} ${f.basis === "planned" ? "planned" : ""}`, "text-anchor": "end", "data-id": f.id }, ff.path.length > 22 ? "\u2026" + ff.path.slice(-21) : ff.path));
          s.append(svg("line", { x1: GUTTER, x2: width - OUT, y1: y, y2: y, class: `lane-rule ${f.basis === "planned" ? "planned" : ""}` }));
          for (const e of g.edges.filter((e2) => e2.to === f.id && (e2.kind === "read" || e2.kind === "edit"))) {
            if (!inWin(e.at)) continue;
            const x = xOf(e.at, width);
            s.append(e.kind === "edit" ? svg("rect", { x: x - 1.5, y: y - 8, width: 3, height: 16, class: "tick-edit", "data-id": e.from }) : svg("circle", { cx: x, cy: y, r: 2.4, class: "tick-read", "data-id": e.from }));
          }
          for (const e of g.edges.filter((e2) => e2.to === f.id && e2.kind === "concerns")) {
            const fd = g.byId.get(e.from);
            if (!inWin(fd.at)) continue;
            const x = xOf(fd.at, width) + 6;
            const sev = fd.finding.severity;
            s.append(mark(fd.id, x, y, svg("path", { d: `M${x},${y - 7} L${x + 6},${y + 4} L${x - 6},${y + 4} Z`, class: `finding ${sev}` }), `${sev} finding: ${fd.label}`, 2));
          }
          if (ff.diff) {
            const tot = ff.diff.additions + ff.diff.deletions || 1;
            const w = 48;
            const x0 = width - OUT + 14;
            s.append(svg("rect", { x: x0, y: y - 4, width: w * ff.diff.additions / tot, height: 8, class: "diff-add" }), svg("rect", { x: x0 + w * ff.diff.additions / tot, y: y - 4, width: w * ff.diff.deletions / tot, height: 8, class: "diff-del" }), svg("text", { x: x0 + w + 8, y: y + 4, class: "diff-num" }, `+${ff.diff.additions} \u2212${ff.diff.deletions}`));
          }
          marks.push({ id: f.id, x: GUTTER - 20, plane: 2, label: `File ${ff.path}` });
          const hit = svg("rect", { x: 0, y: y - 12, width: GUTTER - 8, height: 24, class: "row-hit", "data-id": f.id });
          s.append(hit);
        });
        out.push(wrap);
      }
      {
        const checks = g.nodes.filter((n) => n.kind === "check");
        const labels = [...new Set(checks.map((c) => c.label))];
        const h = 56 + Math.max(labels.length, 1) * 30;
        const { s, wrap } = planeShell(3, "Proof", "checks per revision", h, width);
        gates(s, h, width, false);
        if (!labels.length) s.append(svg("text", { x: GUTTER, y: 70, class: "plane-sub" }, "No checks have run at this point."));
        labels.forEach((l, i) => {
          const y = 64 + i * 30;
          lane(y, l, s);
          for (const c of checks.filter((c2) => c2.label === l)) {
            if (!inWin(c.at)) continue;
            const x = xOf(c.at, width);
            const w = Math.max(10, xOf(c.end ?? c.at, width) - x);
            const ok = c.status === "ok";
            const baseline = c.evidence.phase === "demo_base";
            const hex = svg("g", {}, svg("rect", { x, y: y - 7, width: w, height: 14, rx: 7, class: `proof ${c.status} ${baseline ? "baseline" : ""}` }), ok || baseline ? null : svg("text", { x: x + w / 2, y: y + 4, class: "proof-x", "text-anchor": "middle" }, c.status === "running" ? "\u2026" : "\u2715"));
            if (baseline) hex.append(svg("text", { x: x + w / 2, y: y - 10, class: "baseline-label", "text-anchor": "middle" }, ok ? "original \u2713" : "original \u2715"));
            s.append(mark(c.id, x, y, hex, `${l} ${statusWord(c)} at ${c.evidence.commitSha.slice(0, 7)}${baseline ? " (your original code, for before/after)" : ""}`, 3));
          }
          const headRev = full.nodes.find((n) => n.kind === "revision" && (n.revision.role === "head" || n.revision.role === "applied"));
          const atHead = checks.filter((c) => c.label === l && headRev && c.evidence.commitSha.startsWith(headRev.revision.short) && c.evidence.phase === "verify").at(-1);
          s.append(svg("text", { x: width - OUT + 12, y: y + 4, class: `athead ${atHead ? atHead.status : "none"}` }, atHead ? atHead.status === "ok" ? "\u2713 passed" : "\u2715 failed" : "\u2014 none"));
        });
        out.push(wrap);
      }
      if (cursor !== null && inWin(cursor)) for (const w of out) {
        const s = w.querySelector("svg");
        const x = xOf(cursor, width);
        s.append(svg("line", { x1: x, x2: x, y1: 0, y2: Number(s.getAttribute("height")), class: "cursor" }));
      }
      return out;
    }
    function mark(id, x, y, shape, label, plane, wide = false) {
      const gEl = svg("g", { "data-id": id, class: "mk", role: "button", "aria-label": label });
      gEl.append(shape);
      if (wide) {
        const nearEnd = x > (obs.clientWidth || 1e3) - OUT - 200;
        gEl.append(svg("text", { x: nearEnd ? x - 14 : x + 14, y: y + 4, class: "mk-label", "text-anchor": nearEnd ? "end" : "start" }, label));
      }
      marks.push({ id, x, plane, label });
      return gEl;
    }
    function renderOverview() {
      const width = overview.clientWidth || 1e3;
      const h = 64;
      const s = svg("svg", { width, height: h, viewBox: `0 0 ${width} ${h}` });
      const X = (t) => 10 + (t - full.start) / Math.max(1, full.end - full.start) * (width - 20);
      s.append(svg("rect", { x: 0, y: 0, width, height: h, class: "ov-bg" }));
      for (const st of full.nodes.filter((n) => n.kind === "stage")) {
        const row = st.actor === "planner" ? 0 : st.actor === "implementer" ? 1 : st.actor === "reviewer" ? 2 : 3;
        const x1 = X(st.at), x2 = X(st.end ?? full.end);
        s.append(svg("rect", { x: x1, y: 10 + row * 11, width: Math.max(2, x2 - x1), height: 8, rx: 2, class: `ov-stage ${st.status} r-${st.actor}` }));
      }
      for (const c of full.nodes.filter((n) => n.kind === "check" && n.status === "failed" && n.evidence.phase !== "demo_base")) s.append(svg("rect", { x: X(c.at) - 1, y: 6, width: 2, height: 50, class: "ov-fail" }));
      s.append(svg("rect", { x: X(win[0]), y: 2, width: Math.max(2, X(win[1]) - X(win[0])), height: h - 4, class: "ov-win" }));
      if (cursor !== null) s.append(svg("line", { x1: X(cursor), x2: X(cursor), y1: 0, y2: h, class: "cursor" }));
      s.append(svg("text", { x: width - 12, y: h - 8, class: "ov-label", "text-anchor": "end" }, cursor === null ? "all records \xB7 drag to zoom \xB7 click to replay to a moment" : `replay ${fmtOffset(cursor, full.start)}`));
      overview.replaceChildren(s);
      let dragX = null;
      const T = (x) => full.start + (x - 10) / (width - 20) * (full.end - full.start);
      s.addEventListener("pointerdown", (e) => {
        dragX = e.offsetX;
        s.setPointerCapture(e.pointerId);
      });
      s.addEventListener("pointerup", (e) => {
        if (dragX === null) return;
        const a = Math.min(dragX, e.offsetX), b = Math.max(dragX, e.offsetX);
        dragX = null;
        if (b - a < 6) {
          const t = T(e.offsetX);
          cursor = t >= full.end - 50 ? null : Math.max(full.start, t);
        } else {
          win = [Math.max(full.start, T(a)), Math.min(full.end, T(b))];
        }
        render();
      });
    }
    function related(id) {
      const r = /* @__PURE__ */ new Set([id]);
      for (const e of g.edges) {
        if (e.from === id) r.add(e.to);
        if (e.to === id) r.add(e.from);
      }
      return r;
    }
    function applySelection() {
      const rel = selected ? related(selected) : null;
      stack.classList.toggle("has-sel", !!rel);
      stack.querySelectorAll("[data-id]").forEach((m) => m.classList.toggle("rel", !!rel && rel.has(m.dataset.id)));
      stack.querySelectorAll("[data-id]").forEach((m) => m.classList.toggle("sel", m.dataset.id === selected));
    }
    function select(id) {
      selected = id;
      applySelection();
      renderSection();
      const n = id ? g.byId.get(id) : null;
      if (n) live.textContent = `${KIND_NAME[n.kind]} ${n.kind === "file" ? n.file.path : n.label}. ${statusWord(n) ?? ""}.`;
    }
    function renderSection() {
      const n = selected ? g.byId.get(selected) ?? null : null;
      const parts = [];
      if (n?.kind === "revision") {
        const sha = n.revision.short;
        const checks = g.nodes.filter((c) => c.kind === "check" && c.evidence.commitSha.startsWith(sha));
        const produced = g.edges.filter((e) => e.kind === "produced" && e.to === n.id).map((e) => g.byId.get(e.from));
        const reviewed = g.edges.filter((e) => e.kind === "reviewed" && e.to === n.id).map((e) => g.byId.get(e.from));
        const findings = g.nodes.filter((f) => f.kind === "finding" && f.finding.reviewedSha?.startsWith(sha));
        const decided = g.edges.some((e) => e.kind === "decides" && e.to === n.id);
        parts.push(el(
          "div",
          { class: "xs" },
          el("p", { class: "insp-eyebrow" }, "Cross-section"),
          el("h2", { class: "insp-title mono" }, sha),
          el("p", { class: "insp-hint" }, n.detail),
          el(
            "ol",
            { class: "xs-rows" },
            el("li", {}, el("span", { class: "xs-k" }, "Made by"), el("span", {}, produced.length ? produced.map((p) => p.label).join(", ") : n.revision.role === "base" ? "Your branch" : "Not named in records")),
            el("li", {}, el("span", { class: "xs-k" }, "Proof"), el("span", {}, checks.length ? `${checks.filter((c) => c.status === "ok").length} passed \xB7 ${checks.filter((c) => c.status === "failed").length} failed` : "No checks ran here")),
            el("li", {}, el("span", { class: "xs-k" }, "Review"), el("span", {}, reviewed.length ? `${reviewed.map((r) => r.label).join(", ")} \xB7 ${findings.length} finding${findings.length === 1 ? "" : "s"}` : "Not reviewed at this revision")),
            el("li", {}, el("span", { class: "xs-k" }, "Decision"), el("span", {}, decided ? "Your decision applies to this revision" : "\u2014"))
          )
        ));
      }
      parts.push(renderInspector(g, n, { onSelect: (id) => select(id) }));
      section.replaceChildren(...parts);
      if (!reduced.matches) {
        section.classList.remove("reveal");
        void section.offsetWidth;
        section.classList.add("reveal");
      }
    }
    let kIndex = -1;
    obs.addEventListener("keydown", (e) => {
      const plane = Number(document.activeElement?.dataset?.plane ?? -1);
      if (plane < 0) return;
      const list = marks.filter((m) => m.plane === plane).sort((a, b) => a.x - b.x);
      if (!list.length) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        kIndex = Math.max(0, Math.min(list.length - 1, kIndex + (e.key === "ArrowRight" ? 1 : -1)));
        const m = list[kIndex];
        selected = m.id;
        applySelection();
        live.textContent = m.label;
      } else if (e.key === "Enter" && selected) {
        renderSection();
      } else if (e.key === "Escape") {
        select(null);
      }
    });
    obs.addEventListener("focusin", () => {
      kIndex = -1;
    });
    missionPicker.addEventListener("change", () => load(Number(missionPicker.value)));
    depthBtn.addEventListener("click", () => {
      depth = !depth;
      depthBtn.setAttribute("aria-pressed", String(depth));
      obs.classList.toggle("depth", depth);
    });
    fitBtn.addEventListener("click", () => {
      win = [full.start, full.end];
      render();
    });
    let timer = 0;
    playBtn.addEventListener("click", () => {
      if (timer) {
        clearInterval(timer);
        timer = 0;
        playBtn.textContent = "Replay";
        cursor = null;
        render();
        return;
      }
      const moments = full.moments;
      let i = 0;
      playBtn.textContent = "Stop";
      timer = window.setInterval(() => {
        const m = moments[i++];
        if (m === void 0 || m >= full.end) {
          clearInterval(timer);
          timer = 0;
          playBtn.textContent = "Replay";
          cursor = null;
        } else cursor = m;
        render();
      }, reduced.matches ? 900 : 380);
    });
    new ResizeObserver(() => render()).observe(obs);
    window.hydraProto = { select, mission: (i) => {
      missionPicker.value = String(i);
      load(i);
    }, depth: () => depthBtn.click(), cursor: (f) => {
      cursor = f >= 1 ? null : full.start + f * (full.end - full.start);
      render();
    }, rev: (k) => select(full.nodes.filter((n) => n.kind === "revision")[k]?.id ?? null) };
    load(0);
  }
  Promise.allSettled([document.fonts.load('500 13px "Atkinson Hyperlegible Next"'), document.fonts.load('500 12px "Atkinson Hyperlegible Mono"')]).then(main);
})();
