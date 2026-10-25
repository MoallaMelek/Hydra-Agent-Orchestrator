(() => {
  // ../../packages/protocol/src/verification.ts
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

  // ../../packages/ui/src/ops/intel/graph.ts
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

  // src/shared.ts
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
    const pack = window.__HYDRA_FIXTURES ?? await fetch("data/missions.json").then((r) => r.json());
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
    return el("div", { class: "fixture-banner", role: "note" }, el("b", {}, "Recorded fixture"), ` \xB7 real Hydra engine at commit ${String(pack.engineCommit ?? "unknown").slice(0, 7)} (alpha.6 line), Git worktrees and check processes \xB7 agents are the scripted test adapter, so tool calls and review text are scripted, not model activity \xB7 recorded ${new Date(pack.recordedAt).toLocaleString()}`);
  }
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = s * 1664525 + 1013904223 >>> 0;
      return s / 4294967296;
    };
  }

  // src/a-network.ts
  var C = {
    void: "#07090c",
    deck: "#0d1117",
    guide: "#161d26",
    ink: "#e8ecf1",
    ink2: "#9ba6b4",
    ink3: "#5c6776",
    planner: "#74b9ff",
    implementer: "#ffb24a",
    reviewer: "#3fd0c4",
    engine: "#a9b6c6",
    human: "#f4efe3",
    stop: "#ff5b52"
  };
  var hue = (actor) => actor && C[actor] || C.ink2;
  var reduced = matchMedia("(prefers-reduced-motion: reduce)");
  var RX = 640;
  var RY = 400;
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function layoutMission(g) {
    const pos = /* @__PURE__ */ new Map();
    const stages = g.nodes.filter((n) => n.kind === "stage");
    const span = Math.PI * 2;
    const a0 = -Math.PI / 2;
    stages.forEach((s, i) => {
      const a = a0 + span * i / Math.max(stages.length, 1) + 1e-4;
      pos.set(s.id, { x: Math.cos(a) * RX, y: Math.sin(a) * RY });
      const runs = g.edges.filter((e) => e.from === s.id && e.kind === "performs").map((e) => e.to);
      runs.forEach((rid, j) => {
        const spread = (j - (runs.length - 1) / 2) * 0.12;
        pos.set(rid, { x: Math.cos(a + spread) * RX * 0.84, y: Math.sin(a + spread) * RY * 0.8 });
      });
    });
    const revs = g.nodes.filter((n) => n.kind === "revision").sort((a, b) => a.revision.index - b.revision.index);
    const w = Math.min(560, 230 * Math.max(revs.length - 1, 1));
    revs.forEach((r, i) => pos.set(r.id, { x: revs.length === 1 ? 0 : -w / 2 + w * i / (revs.length - 1), y: -40 }));
    const byRev = /* @__PURE__ */ new Map();
    for (const e of g.edges) if (e.kind === "tested") {
      const list = byRev.get(e.to) ?? [];
      list.push(g.byId.get(e.from));
      byRev.set(e.to, list);
    }
    for (const [rid, checks] of byRev) {
      const c = pos.get(rid);
      checks.forEach((ch, i) => {
        const a = Math.PI + Math.PI * (i + 0.5) / checks.length;
        pos.set(ch.id, { x: c.x + Math.cos(a) * 36, y: c.y + Math.sin(a) * 36 });
      });
    }
    const head = revs.at(-1);
    if (g.byId.has("decision")) pos.set("decision", head ? { x: pos.get(head.id).x + 110, y: pos.get(head.id).y + 10 } : { x: 0, y: 120 });
    pos.set("mission", { x: 0, y: 0 });
    const free = g.nodes.filter((n) => n.kind === "file" || n.kind === "finding");
    for (const n of free) {
      const h = hash(n.id);
      pos.set(n.id, { x: (h % 1e3 / 1e3 - 0.5) * 520, y: 60 + (h >> 10) % 1e3 / 1e3 * 180 });
    }
    const springs = g.edges.filter((e) => (free.some((f) => f.id === e.from) || free.some((f) => f.id === e.to)) && e.from !== "mission");
    const strength = { edit: 0.05, read: 0.012, concerns: 0.09, raised: 0.01, changed: 0.03, planned: 4e-3 };
    const ideal = { edit: 140, read: 220, concerns: 30, raised: 200, changed: 120, planned: 260 };
    for (let it = 0; it < 360; it++) {
      const cool = 1 - it / 400;
      for (const e of springs) {
        const a = pos.get(e.from), b = pos.get(e.to);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        const f = (d - (ideal[e.kind] ?? 160)) * (strength[e.kind] ?? 0.01) * cool;
        const fromFree = free.some((n) => n.id === e.from), toFree = free.some((n) => n.id === e.to);
        if (fromFree) {
          a.x += dx / d * f;
          a.y += dy / d * f;
        }
        if (toFree) {
          b.x -= dx / d * f;
          b.y -= dy / d * f;
        }
      }
      const all = [...free.map((n) => pos.get(n.id))];
      const fixed = [...revs.map((r) => pos.get(r.id)), ...[...byRev.values()].flat().map((c) => pos.get(c.id))];
      for (let i = 0; i < all.length; i++) {
        const p = all[i];
        for (let j = i + 1; j < all.length; j++) {
          const q = all[j];
          const dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy + 0.01;
          if (d2 < 170 * 170) {
            const f = 4200 / d2 * cool;
            const d = Math.sqrt(d2);
            p.x -= dx / d * f;
            p.y -= dy / d * f;
            q.x += dx / d * f;
            q.y += dy / d * f;
          }
        }
        for (const q of fixed) {
          const dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy + 0.01;
          if (d2 < 110 * 110) {
            const d = Math.sqrt(d2);
            const f = 5200 / d2 * cool;
            p.x -= dx / d * f;
            p.y -= dy / d * f;
          }
        }
        const ex = p.x / (RX * 0.66), ey = p.y / (RY * 0.62), er = Math.hypot(ex, ey);
        if (er > 1) {
          p.x /= er;
          p.y /= er;
        }
      }
    }
    const stacks = /* @__PURE__ */ new Map();
    for (const e of g.edges) if (e.kind === "concerns") {
      const f = pos.get(e.to);
      if (!f) continue;
      const i = stacks.get(e.to) ?? 0;
      stacks.set(e.to, i + 1);
      pos.set(e.from, { x: f.x - 26 - i * 18, y: f.y });
    }
    for (const n of g.nodes) if (n.kind === "finding" && !g.edges.some((e) => e.kind === "concerns" && e.from === n.id)) {
      const rv = g.edges.find((e) => e.kind === "raised" && e.to === n.id);
      const r = rv ? pos.get(rv.from) : null;
      if (r) pos.set(n.id, { x: r.x * 0.8, y: r.y * 0.8 });
    }
    return pos;
  }
  function projectScene(missions, projectId) {
    const ms2 = missions.filter((m) => m.project.id === projectId);
    const nodes = [];
    const edges = [];
    const pos = /* @__PURE__ */ new Map();
    const files = /* @__PURE__ */ new Map();
    ms2.forEach((m, i) => {
      const a = -Math.PI / 2 + Math.PI * 2 * i / ms2.length;
      const mid = `m:${m.graph.task.id}`;
      const core = { ...m.graph.byId.get("mission"), id: mid, label: m.title, weight: 4 };
      nodes.push(core);
      pos.set(mid, { x: Math.cos(a) * 360, y: Math.sin(a) * 360 });
      for (const f of m.graph.nodes.filter((n) => n.kind === "file")) {
        const fid = `file:${f.file.path}`;
        if (!files.has(fid)) {
          const copy = { ...f, id: fid, file: { ...f.file, reads: 0, edits: 0, findings: 0, touchedBy: [] }, weight: 1 };
          files.set(fid, copy);
          nodes.push(copy);
        }
        const shared = files.get(fid);
        shared.file.reads += f.file.reads;
        shared.file.edits += f.file.edits;
        shared.weight += f.file.edits * 2 + f.file.reads;
        const kind = f.file.edits ? "edit" : f.file.reads ? "read" : "planned";
        edges.push({ id: `${mid}>${fid}`, from: mid, to: fid, kind, basis: kind === "planned" ? "planned" : "observed", at: f.at });
      }
    });
    for (const f of files.values()) {
      const h = hash(f.id);
      pos.set(f.id, { x: (h % 1e3 / 1e3 - 0.5) * 200, y: ((h >> 10) % 1e3 / 1e3 - 0.5) * 200 });
    }
    for (let it = 0; it < 300; it++) {
      for (const e of edges) {
        const a = pos.get(e.from), b = pos.get(e.to);
        const dx = a.x - b.x, dy = a.y - b.y;
        const k = e.kind === "edit" ? 0.06 : e.kind === "read" ? 0.03 : 0.01;
        b.x += dx * k * 0.5;
        b.y += dy * k * 0.5;
      }
      const fs = [...files.values()].map((f) => pos.get(f.id));
      for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
        const p = fs[i], q = fs[j];
        const dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy + 0.01;
        if (d2 < 9e3) {
          const d = Math.sqrt(d2), f = 900 / d2;
          p.x -= dx / d * f;
          p.y -= dy / d * f;
          q.x += dx / d * f;
          q.y += dy / d * f;
        }
      }
    }
    const g = ms2[0].graph;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const counts = { mission: ms2.length, stage: 0, run: 0, file: files.size, revision: 0, check: 0, finding: 0, decision: 0 };
    return { g: { ...g, nodes, edges, byId, counts, moments: [], gaps: ["Project lens: each mission is collapsed to its core; files link missions that touched the same path."] }, pos, simulated: false, title: `${ms2[0].project.name} \xB7 ${ms2.length} missions` };
  }
  function stressScene(missionCount) {
    const r = rng(7);
    const nodes = [];
    const edges = [];
    const pos = /* @__PURE__ */ new Map();
    const pool = Array.from({ length: Math.round(missionCount * 2.2) }, (_, i) => `src/${["api", "core", "ui", "lib", "test"][i % 5]}/module-${i}.ts`);
    const fileIds = /* @__PURE__ */ new Map();
    const base = { basis: "observed", status: "idle", at: 0, end: null, detail: "SIMULATED" };
    for (let m = 0; m < missionCount; m++) {
      const id = `sim:m${m}`;
      const a = m / missionCount * Math.PI * 2;
      nodes.push({ ...base, id, kind: "mission", label: `Simulated mission ${m + 1}`, actor: "human", weight: 3, status: r() < 0.12 ? "failed" : "ok" });
      pos.set(id, { x: Math.cos(a) * 900, y: Math.sin(a) * 900 });
      const touched = 3 + Math.floor(r() * 9);
      const centre = Math.floor(r() * pool.length);
      for (let k = 0; k < touched; k++) {
        const path = pool[(centre + Math.floor((r() - 0.5) * 30) + pool.length) % pool.length];
        const fid = `sim:${path}`;
        if (!fileIds.has(fid)) {
          const n = { ...base, id: fid, kind: "file", label: path.split("/").pop(), actor: null, weight: 1, file: { path, planned: false, reads: 0, edits: 0, diff: null, findings: 0, touchedBy: [] } };
          fileIds.set(fid, n);
          nodes.push(n);
          pos.set(fid, { x: (r() - 0.5) * 1200, y: (r() - 0.5) * 1200 });
        }
        const kind = r() < 0.45 ? "edit" : "read";
        fileIds.get(fid).weight += kind === "edit" ? 2 : 1;
        edges.push({ id: `${id}>${fid}>${k}`, from: id, to: fid, kind, basis: "observed", at: 0 });
      }
    }
    for (let it = 0; it < 80; it++) for (const e of edges) {
      const a = pos.get(e.from), b = pos.get(e.to);
      b.x += (a.x - b.x) * 0.02;
      b.y += (a.y - b.y) * 0.02;
    }
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const counts = { mission: missionCount, stage: 0, run: 0, file: fileIds.size, revision: 0, check: 0, finding: 0, decision: 0 };
    const g = { task: { title: "SIMULATED density study", prompt: "Generated locally to test rendering and readability. Not Hydra activity." }, nodes, edges, byId, start: 0, end: 0, moments: [], live: false, counts, gaps: ["SIMULATED: generated missions and files for a density test. Nothing here happened."] };
    return { g, pos, simulated: true, title: `SIMULATED density \xB7 ${missionCount} missions \xB7 ${nodes.length} nodes \xB7 ${edges.length} links` };
  }
  async function main() {
    const { pack, missions } = await loadPack();
    const root = document.getElementById("app");
    let mi = 0;
    let lens = "mission";
    let scene = sceneFor();
    let view = scene.g;
    let cursor = null;
    let selected = null;
    let hover = null;
    let keyFocus = null;
    let focusMode = null;
    let showFailures = false;
    const hidden = /* @__PURE__ */ new Set();
    let stressCount = 120;
    let shown = /* @__PURE__ */ new Map();
    let target = /* @__PURE__ */ new Map();
    let from = /* @__PURE__ */ new Map();
    let animStart = 0, animDur = 0;
    let transform = { k: 1, x: 0, y: 0 };
    function sceneFor() {
      if (lens === "project") return projectScene(missions, missions[mi].project.id);
      if (lens === "stress") return stressScene(stressCount);
      const g = missions[mi].graph;
      return { g, pos: layoutMission(g), simulated: false, title: missions[mi].title };
    }
    const canvas = el("canvas", { class: "net", tabindex: "0", role: "application", "aria-label": "Mission evidence map. Arrow keys move between items, Enter inspects, F focuses, Escape steps back, slash searches.", "aria-describedby": "a11y-live" });
    const live = el("div", { id: "a11y-live", class: "sr-only", "aria-live": "polite" });
    const inspector = el("aside", { class: "inspector", "aria-label": "Evidence inspector" });
    const channels = el("div", { class: "channels", role: "toolbar", "aria-label": "Show or hide entity types" });
    const titleEl = el("h1", { class: "m-title" });
    const subEl = el("p", { class: "m-sub" });
    const missionPicker = el("select", { id: "mission", "aria-label": "Mission" }, ...missions.map((m, i) => el("option", { value: String(i) }, `${SCENARIO_NAME[m.scenario] ?? m.scenario} \u2014 ${m.title}`)));
    const lensTabs = el("div", { class: "lens", role: "tablist", "aria-label": "Scope" });
    const search = el("input", { id: "find", type: "search", placeholder: "Find a file, check, finding\u2026", "aria-label": "Find on the map", autocomplete: "off" });
    const results = el("ul", { class: "results", role: "listbox", hidden: true });
    const listView = el("div", { class: "listview", hidden: true });
    const listToggle = el("button", { class: "btn btn-quiet", "aria-pressed": "false" }, "List view");
    const failToggle = el("button", { class: "btn btn-quiet", "aria-pressed": "false", title: "Light up failed checks, blocking findings and blocked decisions" }, "Show failures");
    const fitBtn = el("button", { class: "btn btn-quiet", title: "Fit the map (0)" }, "Fit");
    const play = el("button", { class: "btn", "aria-label": "Replay recorded moments" }, "Replay");
    const scrub = el("input", { id: "scrub", type: "range", min: "0", max: "1000", value: "1000", "aria-label": "Replay position" });
    const scrubText = el("span", { class: "scrub-text mono" }, "Live end");
    const ticks = el("canvas", { class: "ticks", "aria-hidden": "true" });
    const focusBar = el("div", { class: "focusbar", hidden: true });
    ["mission", "project", "stress"].forEach((l) => lensTabs.append(el("button", { role: "tab", "aria-selected": String(l === lens), "data-lens": l, onclick: () => setLens(l) }, l === "mission" ? "Mission" : l === "project" ? "Project" : "Density test")));
    root.append(
      fixtureBanner(pack),
      el(
        "header",
        { class: "top" },
        el("div", { class: "brand" }, el("span", { class: "mark", "aria-hidden": "true" }), el("b", {}, "Hydra"), el("span", { class: "mono dim" }, "A \xB7 Neural command network")),
        el("div", { class: "picker" }, missionPicker, lensTabs),
        el("div", { class: "find" }, search, results)
      ),
      el(
        "main",
        { class: "stage" },
        el(
          "section",
          { class: "mapwrap", "aria-label": "Evidence map" },
          el("div", { class: "maphead" }, el("div", {}, titleEl, subEl), el("div", { class: "tools" }, failToggle, fitBtn, listToggle)),
          channels,
          focusBar,
          canvas,
          listView,
          el("div", { class: "replay" }, play, el("div", { class: "scrubwrap" }, ticks, scrub), scrubText)
        ),
        inspector
      ),
      live
    );
    const ctx = canvas.getContext("2d");
    const tctx = ticks.getContext("2d");
    function setLens(l) {
      lens = l;
      lensTabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.lens === l)));
      missionPicker.disabled = l === "stress";
      rebuild(true);
    }
    function rebuild(fit) {
      scene = sceneFor();
      cursor = null;
      selected = null;
      focusMode = null;
      hover = null;
      keyFocus = null;
      scrub.value = "1000";
      scrub.disabled = lens !== "mission";
      play.disabled = lens !== "mission";
      view = scene.g;
      animateTo(new Map(scene.pos), reduced.matches ? 0 : 420, true);
      if (fit) fitView();
      titleEl.textContent = scene.title;
      subEl.textContent = lens === "mission" ? `${scene.g.task.intent === "analyze" ? "Question" : "Change"} \xB7 ${scene.g.task.status.replace("_", " ")}${scene.g.task.waitReason ? " \xB7 " + scene.g.task.waitReason.replace("_", " ") : ""} \xB7 ${missions[mi].project.name}` : lens === "project" ? "Missions are linked only through files they recorded touching" : "SIMULATED \u2014 generated to test density. Not Hydra activity.";
      root.classList.toggle("is-sim", scene.simulated);
      renderChannels();
      renderInspectorPanel();
      renderList();
      drawTicks();
      draw();
    }
    function animateTo(next, dur, fresh = false) {
      from = /* @__PURE__ */ new Map();
      for (const id of next.keys()) from.set(id, fresh ? centreOf(id, next) : shown.get(id) ?? centreOf(id, next));
      target = next;
      animStart = performance.now();
      animDur = dur;
      if (!dur) {
        shown = new Map(next);
        draw();
        return;
      }
      requestAnimationFrame(tick);
    }
    function centreOf(id, next) {
      const parent = view.edges.find((e) => e.to === id && next.has(e.from));
      const p = parent ? next.get(parent.from) : { x: 0, y: 0 };
      return { x: p.x, y: p.y };
    }
    function tick(now) {
      const t = Math.min(1, (now - animStart) / animDur);
      const e = 1 - Math.pow(1 - t, 3);
      shown = /* @__PURE__ */ new Map();
      for (const [id, p] of target) {
        const f = from.get(id) ?? p;
        shown.set(id, { x: f.x + (p.x - f.x) * e, y: f.y + (p.y - f.y) * e });
      }
      draw();
      if (t < 1) requestAnimationFrame(tick);
    }
    function fitView() {
      const rect = canvas.getBoundingClientRect();
      const pts = [...scene.pos.values()];
      if (!pts.length) return;
      const lx = lens === "mission" ? 210 : 40, ly = lens === "mission" ? 40 : 30;
      const minX = Math.min(...pts.map((p) => p.x)) - lx, maxX = Math.max(...pts.map((p) => p.x)) + lx, minY = Math.min(...pts.map((p) => p.y)) - ly, maxY = Math.max(...pts.map((p) => p.y)) + ly;
      const pad = 24;
      const k = Math.min((rect.width - pad * 2) / Math.max(maxX - minX, 1), (rect.height - pad * 2) / Math.max(maxY - minY, 1), 1.6);
      transform = { k, x: rect.width / 2 - (minX + maxX) / 2 * k, y: rect.height / 2 - (minY + maxY) / 2 * k };
    }
    const toScreen = (p) => ({ x: p.x * transform.k + transform.x, y: p.y * transform.k + transform.y });
    function visibleNodes() {
      return view.nodes.filter((n) => !hidden.has(n.kind) && shown.has(n.id) && !(lens === "mission" && n.kind === "mission"));
    }
    function sizeOf(n) {
      const base = n.kind === "run" ? 5 + Math.sqrt(n.weight) * 1.3 : n.kind === "file" ? 5 + Math.sqrt(n.weight) * 1.4 : n.kind === "revision" ? 9 : n.kind === "check" ? 6 : n.kind === "finding" ? 6 + n.weight : n.kind === "decision" ? 12 : n.kind === "mission" ? lens === "mission" ? 4 : 10 : 6;
      return Math.min(base, 22) * Math.max(0.75, Math.min(transform.k, 1.4));
    }
    function related(id) {
      const s = /* @__PURE__ */ new Set([id]);
      for (const e of view.edges) {
        if (e.from === id) s.add(e.to);
        if (e.to === id) s.add(e.from);
      }
      return s;
    }
    function failing(n) {
      return n.status === "failed" || n.status === "blocked";
    }
    function draw() {
      const dpr = devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = C.void;
      ctx.fillRect(0, 0, rect.width, rect.height);
      const nodes = visibleNodes();
      const ids = new Set(nodes.map((n) => n.id));
      const anchor = keyFocus ?? hover ?? selected;
      const lit = focusMode ? related(focusMode) : anchor ? related(anchor) : null;
      const fails = showFailures ? new Set(nodes.filter(failing).flatMap((n) => [...related(n.id)])) : null;
      const dimmed = (id) => lit && !lit.has(id) || fails && !fails.has(id);
      if (lens === "mission" && !focusMode) {
        const c = toScreen({ x: 0, y: 0 });
        ctx.strokeStyle = C.guide;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, RX * transform.k, RY * transform.k, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([2, 6]);
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, RX * 0.84 * transform.k, RY * 0.8 * transform.k, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        const top = c.y - RY * transform.k;
        ctx.fillStyle = C.ink3;
        ctx.font = `500 10px ${MONO}`;
        ctx.textAlign = "right";
        ctx.fillText("TIME \u2192", c.x - 16, top - 10);
        ctx.strokeStyle = C.ink3;
        ctx.beginPath();
        ctx.moveTo(c.x, top - 6);
        ctx.lineTo(c.x, top + 6);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "lighter";
      for (const e of view.edges) {
        if (!ids.has(e.from) || !ids.has(e.to) || e.kind === "performs" && lens !== "mission") continue;
        const a = toScreen(shown.get(e.from)), b = toScreen(shown.get(e.to));
        const src = view.byId.get(e.from);
        const on = lit ? lit.has(e.from) && lit.has(e.to) && (e.from === (focusMode ?? anchor) || e.to === (focusMode ?? anchor)) : fails ? fails.has(e.from) && fails.has(e.to) : true;
        const recent = cursor !== null && e.at !== null && cursor - e.at < 4e3;
        ctx.strokeStyle = e.kind === "concerns" || e.kind === "tested" && src.status === "failed" ? C.stop : e.kind === "parent" || e.kind === "decides" ? C.human : hue(src.actor);
        ctx.globalAlpha = on ? lit ? 0.85 : recent ? 0.7 : e.kind === "sequence" ? 0.35 : 0.2 : 0.04;
        ctx.lineWidth = (e.kind === "edit" ? 1.6 : e.kind === "sequence" || e.kind === "parent" ? 1.4 : 1) * (lit && on ? 1.4 : 1);
        ctx.setLineDash(e.basis === "derived" ? [6, 4] : e.basis === "planned" ? [1.5, 4] : []);
        if (e.kind === "sequence" && lens === "mission" && !focusMode) {
          const c = toScreen({ x: 0, y: 0 });
          const a1 = Math.atan2((a.y - c.y) / RY, (a.x - c.x) / RX);
          let a2 = Math.atan2((b.y - c.y) / RY, (b.x - c.x) / RX);
          if (a2 < a1) a2 += Math.PI * 2;
          ctx.lineWidth = lit && on ? 3 : 2;
          ctx.globalAlpha = on ? lit ? 0.95 : 0.55 : 0.06;
          ctx.beginPath();
          ctx.ellipse(c.x, c.y, RX * transform.k, RY * transform.k, 0, a1 + 0.08, a2 - 0.08);
          ctx.stroke();
          continue;
        }
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        {
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const c = toScreen({ x: 0, y: 0 });
          ctx.quadraticCurveTo(mx + (c.x - mx) * 0.12, my + (c.y - my) * 0.12, b.x, b.y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      const t = performance.now();
      let breathing = false;
      for (const n of nodes) {
        const p = toScreen(shown.get(n.id));
        const s = sizeOf(n);
        const dim = dimmed(n.id);
        ctx.globalAlpha = dim ? 0.12 : 1;
        const col = hue(n.actor);
        if (n.status === "running" && !reduced.matches && !dim) {
          breathing = true;
          const b = 0.5 + 0.5 * Math.sin(t / 650);
          ctx.fillStyle = col;
          ctx.globalAlpha = 0.12 + 0.12 * b;
          ctx.beginPath();
          ctx.arc(p.x, p.y, s + 8 + b * 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        drawGlyph(n, p, s, col);
        if (n.id === selected || n.id === keyFocus) {
          ctx.strokeStyle = C.ink;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, s + 6, 0, Math.PI * 2);
          ctx.stroke();
          if (n.id === keyFocus) {
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.arc(p.x, p.y, s + 10, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }
      ctx.globalAlpha = 1;
      const placed = [];
      for (const n of nodes) {
        if (dimmed(n.id)) continue;
        const p = toScreen(shown.get(n.id));
        const s = sizeOf(n);
        placed.push([p.x - s - 2, p.y - s - 2, s * 2 + 4, s * 2 + 4]);
      }
      const overlaps = (box) => placed.some((b) => box[0] < b[0] + b[2] && box[0] + box[2] > b[0] && box[1] < b[1] + b[3] && box[1] + box[3] > b[1]);
      const prio = (n) => (lit?.has(n.id) ? 0 : 1) * 10 + { decision: 0, stage: 1, revision: 2, mission: 2, finding: 3, file: 4, run: 6, check: 7 }[n.kind];
      const order = [...nodes].sort((a, b) => prio(a) - prio(b) || b.weight - a.weight);
      for (const n of order) {
        if (dimmed(n.id)) continue;
        const always = n.kind === "stage" || n.kind === "revision" || n.kind === "decision" || n.kind === "file" || n.kind === "mission" || (lit?.has(n.id) ?? false);
        if (!always && transform.k < 1.2) continue;
        const p = toScreen(shown.get(n.id));
        const s = sizeOf(n);
        const text = labelOf(n);
        const mono = n.kind === "revision" || n.kind === "file" || n.kind === "check";
        ctx.font = mono ? `500 11px ${MONO}` : n.kind === "stage" ? `650 12px ${SANS}` : `500 12px ${SANS}`;
        ctx.fontStretch = n.kind === "stage" ? "semi-condensed" : "normal";
        const w = ctx.measureText(text).width;
        let x = p.x + s + 7, y = p.y + 4;
        if (n.kind === "revision") {
          x = p.x - w / 2;
          y = p.y + s + 16;
        }
        if (n.kind === "stage" && lens === "mission" && !focusMode) {
          const c = toScreen({ x: 0, y: 0 });
          const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy) || 1;
          x = p.x + dx / d * 22 - (dx < 0 ? w : 0);
          y = p.y + dy / d * 22 + 4;
        }
        const leftFirst = focusMode !== null && n.id !== focusMode && p.x < toScreen(shown.get(focusMode) ?? { x: 0, y: 0 }).x;
        const right = [x, y], left = [p.x - s - 7 - w, y];
        const slots = n.kind === "stage" || n.kind === "revision" && !focusMode ? [[x, y]] : [...leftFirst ? [left, right] : [right, left], [p.x - w / 2, p.y + s + 15], [p.x - w / 2, p.y - s - 7]];
        let chosen = null;
        for (const [sx, sy] of slots) {
          const box = [sx - 3, sy - 12, w + 6, 17];
          if (!overlaps(box)) {
            chosen = [sx, sy];
            placed.push(box);
            break;
          }
        }
        if (!chosen) continue;
        x = chosen[0];
        y = chosen[1];
        ctx.fillStyle = n.kind === "stage" ? hue(n.actor) : n.kind === "finding" && n.status === "blocked" ? C.stop : lit?.has(n.id) ? C.ink : C.ink2;
        ctx.textAlign = "left";
        ctx.fillText(text, x, y);
        if (n.kind === "stage") {
          ctx.font = `400 10px ${MONO}`;
          ctx.fillStyle = n.status === "failed" ? C.stop : C.ink3;
          ctx.fillText(stageSub(n), x, y + 14);
        }
      }
      ;
      ctx.fontStretch = "normal";
      if (breathing) requestAnimationFrame(() => draw());
    }
    function stageSub(n) {
      const word = statusWord(n);
      return `${word ? word.toUpperCase() : ""}${n.at !== null && lens === "mission" ? " \xB7 " + fmtOffset(n.at, view.start) : ""}`;
    }
    function labelOf(n) {
      if (n.kind === "file") return n.file.path;
      if (n.kind === "revision") return `${n.revision.short}${n.revision.role === "base" ? " \xB7 base" : n.revision.role === "head" ? " \xB7 head" : n.revision.role === "applied" ? " \xB7 applied" : ""}`;
      if (n.kind === "run") return n.label;
      if (n.kind === "check") return `${n.label} ${n.status === "ok" ? "\u2713" : n.status === "failed" ? "\u2715" : "\u2026"}`;
      if (n.kind === "finding") return `${n.finding.severity}: ${n.label.length > 42 ? n.label.slice(0, 40) + "\u2026" : n.label}`;
      if (n.kind === "decision") return `${n.label}${n.status === "blocked" ? " \xB7 blocked" : ""}`;
      return n.label.length > 46 ? n.label.slice(0, 44) + "\u2026" : n.label;
    }
    function drawGlyph(n, p, s, col) {
      ctx.lineWidth = 1.5;
      const fail = n.status === "failed";
      switch (n.kind) {
        case "stage": {
          const c = toScreen({ x: 0, y: 0 });
          ctx.strokeStyle = fail ? C.stop : col;
          ctx.lineWidth = 3.5;
          ctx.lineCap = "round";
          if (lens === "mission" && !focusMode) {
            const ea = Math.atan2((p.y - c.y) / RY, (p.x - c.x) / RX);
            ctx.beginPath();
            ctx.ellipse(c.x, c.y, RX * transform.k, RY * transform.k, 0, ea - 0.07, ea + 0.07);
            ctx.stroke();
          } else {
            ctx.beginPath();
            ctx.moveTo(p.x - 8, p.y);
            ctx.lineTo(p.x + 8, p.y);
            ctx.stroke();
          }
          ctx.lineCap = "butt";
          if (n.status === "running" || n.status === "waiting") {
            ctx.fillStyle = col;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
        case "run":
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
          ctx.fill();
          if (fail) {
            ctx.strokeStyle = C.stop;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
          break;
        case "file": {
          const f = n.file;
          ctx.strokeStyle = f.findings && n.status === "blocked" ? C.stop : C.ink2;
          ctx.setLineDash(n.basis === "planned" ? [1.5, 2.5] : []);
          if (f.diff) {
            ctx.fillStyle = C.ink;
            ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
          } else {
            ctx.fillStyle = C.deck;
            ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
            ctx.strokeRect(p.x - s / 2, p.y - s / 2, s, s);
          }
          ctx.setLineDash([]);
          if (f.diff && f.diff.additions + f.diff.deletions > 0) {
            const total = f.diff.additions + f.diff.deletions;
            const w = Math.max(s, 14);
            ctx.fillStyle = C.ink;
            ctx.fillRect(p.x - w / 2, p.y + s / 2 + 3, w * f.diff.additions / total, 2);
            ctx.fillStyle = C.ink3;
            ctx.fillRect(p.x - w / 2 + w * f.diff.additions / total, p.y + s / 2 + 3, w * f.diff.deletions / total, 2);
          }
          break;
        }
        case "revision": {
          const r = n.revision;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - s);
          ctx.lineTo(p.x + s, p.y);
          ctx.lineTo(p.x, p.y + s);
          ctx.lineTo(p.x - s, p.y);
          ctx.closePath();
          if (r.role === "head" || r.role === "applied") {
            ctx.fillStyle = C.human;
            ctx.fill();
          } else {
            ctx.fillStyle = C.void;
            ctx.fill();
            ctx.strokeStyle = C.human;
            ctx.stroke();
          }
          break;
        }
        case "check": {
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = Math.PI / 6 + i * Math.PI / 3;
            ctx.lineTo(p.x + Math.cos(a) * s, p.y + Math.sin(a) * s);
          }
          ctx.closePath();
          if (n.status === "ok") {
            ctx.fillStyle = C.engine;
            ctx.fill();
          } else if (fail) {
            ctx.fillStyle = C.stop;
            ctx.fill();
            ctx.strokeStyle = C.void;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(p.x - 2.5, p.y - 2.5);
            ctx.lineTo(p.x + 2.5, p.y + 2.5);
            ctx.moveTo(p.x + 2.5, p.y - 2.5);
            ctx.lineTo(p.x - 2.5, p.y + 2.5);
            ctx.stroke();
          } else {
            ctx.strokeStyle = C.engine;
            ctx.stroke();
          }
          break;
        }
        case "finding": {
          const sev = n.finding.severity;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - s);
          ctx.lineTo(p.x + s * 0.9, p.y + s * 0.6);
          ctx.lineTo(p.x - s * 0.9, p.y + s * 0.6);
          ctx.closePath();
          if (sev === "blocker") {
            ctx.fillStyle = C.stop;
            ctx.fill();
          } else {
            ctx.strokeStyle = sev === "major" ? C.stop : sev === "minor" ? C.engine : C.ink3;
            ctx.stroke();
          }
          break;
        }
        case "decision": {
          const blocked = n.status === "blocked";
          ctx.strokeStyle = blocked ? C.stop : C.human;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(p.x - s - 5, p.y);
          ctx.lineTo(p.x - s + 4, p.y);
          ctx.moveTo(p.x + s - 4, p.y);
          ctx.lineTo(p.x + s + 5, p.y);
          ctx.moveTo(p.x, p.y - s - 5);
          ctx.lineTo(p.x, p.y - s + 4);
          ctx.moveTo(p.x, p.y + s - 4);
          ctx.lineTo(p.x, p.y + s + 5);
          ctx.stroke();
          if (n.status === "ok") {
            ctx.fillStyle = C.human;
            ctx.beginPath();
            ctx.arc(p.x, p.y, s * 0.45, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
        case "mission": {
          ctx.strokeStyle = n.status === "failed" ? C.stop : C.human;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(p.x, p.y, s * 0.5, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
      }
    }
    function drawTicks() {
      const dpr = devicePixelRatio || 1;
      const rect = ticks.getBoundingClientRect();
      ticks.width = Math.round(rect.width * dpr);
      ticks.height = Math.round(rect.height * dpr);
      tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      tctx.clearRect(0, 0, rect.width, rect.height);
      if (lens !== "mission") return;
      const g = scene.g;
      const span = Math.max(1, g.end - g.start);
      for (const n of g.nodes) {
        if (n.at === null || n.kind === "mission") continue;
        const x = (n.at - g.start) / span * rect.width;
        tctx.fillStyle = n.status === "failed" || n.status === "blocked" ? C.stop : hue(n.actor);
        const h = n.kind === "stage" ? rect.height : n.kind === "run" ? rect.height * 0.7 : rect.height * 0.4;
        tctx.globalAlpha = 0.8;
        tctx.fillRect(x, rect.height - h, 1.5, h);
      }
      tctx.globalAlpha = 1;
    }
    function renderChannels() {
      channels.replaceChildren();
      const kinds = lens === "mission" ? ["stage", "run", "file", "revision", "check", "finding", "decision"] : ["mission", "file"];
      for (const k of kinds) {
        const count = view.nodes.filter((n) => n.kind === k).length;
        const b = el("button", { class: `chan chan-${k}`, "aria-pressed": String(!hidden.has(k)), onclick: () => {
          if (hidden.has(k)) hidden.delete(k);
          else hidden.add(k);
          renderChannels();
          draw();
        } }, el("span", { class: `glyph g-${k}`, "aria-hidden": "true" }), `${KIND_NAME[k]}${k === "check" || k === "finding" || k === "file" || k === "run" || k === "stage" || k === "mission" ? "s" : ""}`, el("span", { class: "num" }, String(count)));
        channels.append(b);
      }
      channels.append(el("span", { class: "basis-key" }, el("i", { class: "k-obs" }), "observed", el("i", { class: "k-der" }), "derived", el("i", { class: "k-pla" }), "planned"));
    }
    function renderInspectorPanel() {
      const n = selected ? view.byId.get(selected) ?? null : null;
      const content = lens === "mission" || n ? renderInspector(view, n, { onSelect: select }) : el("div", { class: "insp insp-empty" }, el("p", { class: "insp-eyebrow" }, lens === "project" ? "Project lens" : "Density test"), el("h2", { class: "insp-title" }, scene.title), ...scene.g.gaps.map((x) => el("p", { class: "insp-hint" }, x)));
      if (n && lens === "mission") content.prepend(el("div", { class: "insp-focus" }, el("button", { class: "btn btn-quiet", onclick: () => toggleFocus(n.id) }, focusMode === n.id ? "Leave focus (Esc)" : "Focus on this (F)")));
      inspector.replaceChildren(content);
      inspector.classList.remove("reveal");
      void inspector.offsetWidth;
      if (!reduced.matches) inspector.classList.add("reveal");
    }
    function renderList() {
      listView.replaceChildren();
      const groups = ["decision", "stage", "run", "revision", "check", "finding", "file", "mission"];
      for (const k of groups) {
        const items = view.nodes.filter((n) => n.kind === k && !(lens === "mission" && k === "mission"));
        if (!items.length) continue;
        listView.append(el("h3", {}, `${KIND_NAME[k]} (${items.length})`), el("ul", {}, ...items.map((n) => el("li", {}, el("button", { class: "linkish", onclick: () => select(n.id) }, labelOf(n)), " ", el("span", { class: "dim" }, [statusWord(n), n.basis !== "observed" ? n.basis : ""].filter(Boolean).join(" \xB7 "))))));
      }
    }
    function announce(n) {
      if (!n) return;
      const { ins, outs } = neighbours(view, n.id);
      live.textContent = `${KIND_NAME[n.kind]}: ${labelOf(n)}. ${statusWord(n) ?? ""}. ${ins.length + outs.length} connections. Enter to inspect.`;
    }
    function select(id) {
      selected = id;
      keyFocus = id;
      renderInspectorPanel();
      draw();
      if (id) announce(view.byId.get(id) ?? null);
    }
    function toggleFocus(id) {
      if (focusMode === id) {
        focusMode = null;
        focusBar.hidden = true;
        animateTo(new Map(projectedPos()), reduced.matches ? 0 : 360);
        renderInspectorPanel();
        return;
      }
      focusMode = id;
      const { ins, outs } = neighbours(view, id);
      const next = new Map(projectedPos());
      const c = { x: 0, y: 0 };
      next.set(id, c);
      const col = (list, x) => list.forEach((n2, i) => next.set(n2.id, { x, y: (i - (list.length - 1) / 2) * Math.min(64, 520 / Math.max(list.length, 1)) }));
      const uniq = (xs) => [...new Map(xs.map((x) => [x.node.id, x.node])).values()];
      col(uniq(ins), -300);
      col(uniq(outs).filter((n2) => !ins.some((i) => i.node.id === n2.id)), 300);
      animateTo(next, reduced.matches ? 0 : 360);
      const n = view.byId.get(id);
      focusBar.hidden = false;
      focusBar.replaceChildren(el("span", {}, el("b", {}, "Focus: "), labelOf(n), el("span", { class: "dim" }, `  \xB7  ${ins.length} in  \xB7  ${outs.length} out`)), el("button", { class: "btn btn-quiet", onclick: () => toggleFocus(id) }, "Leave focus"));
      const rect = canvas.getBoundingClientRect();
      transform = { k: Math.min(1.3, transform.k * 1.1), x: rect.width / 2, y: rect.height / 2 };
      renderInspectorPanel();
    }
    function projectedPos() {
      const m = /* @__PURE__ */ new Map();
      for (const n of view.nodes) {
        const p = scene.pos.get(n.id);
        if (p) m.set(n.id, p);
      }
      return m;
    }
    function setCursor(c) {
      cursor = c;
      view = lens === "mission" ? projectAt(scene.g, c) : scene.g;
      const next = projectedPos();
      for (const id of next.keys()) if (!shown.has(id)) from.set(id, centreOf(id, next));
      animateTo(next, reduced.matches ? 0 : 260);
      scrubText.textContent = c === null || c >= scene.g.end ? "Live end \xB7 all records" : `${fmtOffset(c, scene.g.start)} \xB7 ${view.nodes.length - 1} records so far`;
      if (selected && !view.byId.has(selected)) selected = null;
      renderChannels();
      renderInspectorPanel();
      renderList();
    }
    scrub.addEventListener("input", () => {
      const v = Number(scrub.value) / 1e3;
      setCursor(v >= 1 ? null : scene.g.start + v * (scene.g.end - scene.g.start));
    });
    let playing = 0;
    play.addEventListener("click", () => {
      if (playing) {
        cancelAnimationFrame(playing);
        playing = 0;
        play.textContent = "Replay";
        return;
      }
      const moments = scene.g.moments;
      let i = 0;
      play.textContent = "Stop";
      let last = 0;
      const step = (t) => {
        if (t - last > (reduced.matches ? 900 : 420)) {
          last = t;
          const m = moments[i++];
          if (m === void 0) {
            playing = 0;
            play.textContent = "Replay";
            setCursor(null);
            scrub.value = "1000";
            return;
          }
          scrub.value = String(Math.round((m - scene.g.start) / Math.max(1, scene.g.end - scene.g.start) * 1e3));
          setCursor(m);
        }
        playing = requestAnimationFrame(step);
      };
      playing = requestAnimationFrame(step);
    });
    function hit(x, y) {
      let best = null, bd = Infinity;
      for (const n of visibleNodes()) {
        const p = toScreen(shown.get(n.id));
        const d = Math.hypot(p.x - x, p.y - y);
        const r = sizeOf(n) + 8;
        if (d < r && d < bd) {
          bd = d;
          best = n.id;
        }
      }
      return best;
    }
    let drag = null;
    canvas.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y, moved: false };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) {
          transform.x = drag.tx + dx;
          transform.y = drag.ty + dy;
          draw();
        }
        return;
      }
      const h = hit(e.clientX - r.left, e.clientY - r.top);
      if (h !== hover) {
        hover = h;
        canvas.style.cursor = h ? "pointer" : "grab";
        draw();
      }
    });
    canvas.addEventListener("pointerup", (e) => {
      const r = canvas.getBoundingClientRect();
      if (drag && !drag.moved) {
        const h = hit(e.clientX - r.left, e.clientY - r.top);
        select(h);
        if (h && e.detail === 2) toggleFocus(h);
      }
      drag = null;
    });
    canvas.addEventListener("pointerleave", () => {
      hover = null;
      draw();
    });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const k = Math.max(0.25, Math.min(4, transform.k * Math.exp(-e.deltaY * 15e-4)));
      transform.x = mx - (mx - transform.x) * k / transform.k;
      transform.y = my - (my - transform.y) * k / transform.k;
      transform.k = k;
      draw();
    }, { passive: false });
    canvas.addEventListener("keydown", (e) => {
      const nodes = visibleNodes();
      if (!nodes.length) return;
      const cur = keyFocus ? toScreen(shown.get(keyFocus) ?? { x: 0, y: 0 }) : null;
      const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (dir[e.key]) {
        e.preventDefault();
        if (!cur) {
          keyFocus = nodes.find((n) => n.kind === "stage")?.id ?? nodes[0].id;
        } else {
          const [dx, dy] = dir[e.key];
          let best = null, bs = Infinity;
          for (const n of nodes) {
            if (n.id === keyFocus || lens === "mission" && n.kind === "mission") continue;
            const p = toScreen(shown.get(n.id));
            const vx = p.x - cur.x, vy = p.y - cur.y;
            const along = vx * dx + vy * dy;
            if (along <= 2) continue;
            const across = Math.abs(vx * dy - vy * dx);
            const score = along + across * 2.2;
            if (score < bs) {
              bs = score;
              best = n.id;
            }
          }
          if (best) keyFocus = best;
        }
        announce(view.byId.get(keyFocus) ?? null);
        draw();
      } else if (e.key === "Enter" && keyFocus) {
        select(keyFocus);
      } else if ((e.key === "f" || e.key === "F") && (keyFocus ?? selected)) {
        toggleFocus(keyFocus ?? selected);
      } else if (e.key === "Escape") {
        if (focusMode) toggleFocus(focusMode);
        else select(null);
      } else if (e.key === "/") {
        e.preventDefault();
        search.focus();
      } else if (e.key === "0") {
        fitView();
        draw();
      } else if (e.key === "+" || e.key === "=") {
        transform.k = Math.min(4, transform.k * 1.2);
        draw();
      } else if (e.key === "-") {
        transform.k = Math.max(0.25, transform.k / 1.2);
        draw();
      }
    });
    canvas.addEventListener("blur", () => {
      keyFocus = selected;
      draw();
    });
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      results.replaceChildren();
      if (!q) {
        results.hidden = true;
        return;
      }
      const hits = view.nodes.filter((n) => labelOf(n).toLowerCase().includes(q) || n.detail.toLowerCase().includes(q)).slice(0, 12);
      results.hidden = !hits.length;
      for (const n of hits) results.append(el("li", { role: "option" }, el("button", { onclick: () => {
        select(n.id);
        results.hidden = true;
        search.value = "";
        canvas.focus();
      } }, el("span", { class: `glyph g-${n.kind}`, "aria-hidden": "true" }), labelOf(n), el("span", { class: "dim" }, " \xB7 " + KIND_NAME[n.kind]))));
    });
    search.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        search.value = "";
        results.hidden = true;
        canvas.focus();
      }
      if (e.key === "Enter") results.querySelector("button")?.click();
    });
    missionPicker.addEventListener("change", () => {
      mi = Number(missionPicker.value);
      rebuild(true);
    });
    failToggle.addEventListener("click", () => {
      showFailures = !showFailures;
      failToggle.setAttribute("aria-pressed", String(showFailures));
      draw();
    });
    fitBtn.addEventListener("click", () => {
      fitView();
      draw();
    });
    listToggle.addEventListener("click", () => {
      const on = listView.hidden;
      listView.hidden = !on;
      canvas.hidden = on;
      listToggle.setAttribute("aria-pressed", String(on));
    });
    new ResizeObserver(() => {
      fitView();
      drawTicks();
      draw();
    }).observe(canvas);
    addEventListener("keydown", (e) => {
      if (e.key === "/" && document.activeElement !== search) {
        e.preventDefault();
        search.focus();
      }
    });
    window.hydraProto = { select, toggleFocus, setLens, setCursor: (v) => {
      scrub.value = String(Math.round(v * 1e3));
      scrub.dispatchEvent(new Event("input"));
    }, mission: (i) => {
      missionPicker.value = String(i);
      missionPicker.dispatchEvent(new Event("change"));
    }, stress: (n) => {
      stressCount = n;
      setLens("stress");
    }, draw, failures: () => failToggle.click(), nodes: () => view.nodes.map((n) => n.id) };
    if (matchMedia("(max-width: 600px)").matches) {
      listView.hidden = false;
      canvas.hidden = true;
      listToggle.setAttribute("aria-pressed", "true");
    }
    rebuild(true);
  }
  var SANS = '"Archivo", "Segoe UI", system-ui, sans-serif';
  var MONO = '"Azeret Mono", "Cascadia Mono", Consolas, monospace';
  Promise.allSettled([document.fonts.load('500 12px "Archivo"'), document.fonts.load('500 11px "Azeret Mono"')]).then(main);
})();
