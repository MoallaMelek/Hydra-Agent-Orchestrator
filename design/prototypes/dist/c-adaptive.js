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

  // src/c-adaptive.ts
  var PHASE_NAME = { plan: "Plan", build: "Build", review: "Review", proof: "Proof", decide: "Decide", answer: "Answer" };
  function phaseOf(g) {
    const t = g.task;
    if (t.intent === "analyze") return "answer";
    if (t.status === "waiting_input" && t.waitReason === "plan_approval") return "plan";
    if (t.status === "waiting_input" || t.status === "completed") return "decide";
    if (t.status === "failed") {
      const last = t.stages.at(-1);
      return last?.stage === "plan" ? "plan" : last?.stage === "review" ? "review" : last?.stage === "verify" ? "proof" : "build";
    }
    const st = t.stage;
    return st === "plan" ? "plan" : st === "implement" || st === "fix" ? "build" : st === "review" ? "review" : st === "verify" || st === "demo" ? "proof" : "decide";
  }
  function phaseState(g, p) {
    const t = g.task;
    const st = (names) => t.stages.filter((s) => names.includes(s.stage));
    if (p === "plan") {
      const s = st(["plan"]);
      if (t.waitReason === "plan_approval" && t.status === "waiting_input") return { word: "Your approval", tone: "you" };
      return s.length ? { word: s.at(-1).status === "failed" ? "Failed" : "Done", tone: s.at(-1).status === "failed" ? "stop" : "done" } : { word: "Not reached", tone: "idle" };
    }
    if (p === "build") {
      const s = st(["implement", "fix"]);
      if (!s.length) return { word: "Not reached", tone: "idle" };
      const last = s.at(-1);
      return { word: last.status === "failed" ? "Failed" : last.status === "running" ? "Running" : s.length > 1 ? `${s.length} rounds` : "Done", tone: last.status === "failed" ? "stop" : last.status === "running" ? "active" : "done", count: s.length };
    }
    if (p === "review") {
      const s = st(["review"]);
      if (!s.length) return { word: "Not reached", tone: "idle" };
      const v = t.review?.verdict;
      return { word: v === "approve" ? "Approved" : v === "changes_requested" ? "Changes requested" : "Running", tone: v === "approve" ? "done" : v ? "stop" : "active", count: s.length };
    }
    if (p === "proof") {
      const s = st(["verify"]);
      if (!s.length) return { word: "Not reached", tone: "idle" };
      const failed = /failed/.test(s.at(-1).note ?? "");
      return { word: failed ? "Check failed" : "Passed", tone: failed ? "stop" : "done" };
    }
    if (p === "decide") {
      const d = g.byId.get("decision");
      if (!d || t.waitReason === "plan_approval") return { word: "Not reached", tone: "idle" };
      return { word: d.status === "ok" ? "Accepted" : d.status === "blocked" ? "Blocked" : d.status === "waiting" ? "Your decision" : d.status === "canceled" ? "Closed" : "Not reached", tone: d.status === "ok" ? "done" : d.status === "blocked" ? "stop" : d.status === "waiting" ? "you" : "idle" };
    }
    return { word: t.answer ? "Answered" : "Running", tone: t.answer ? "done" : "active" };
  }
  async function main() {
    const { pack, missions } = await loadPack();
    const root = document.getElementById("app");
    let m = missions[0];
    let g = m.graph;
    let phase = phaseOf(g);
    let pinned = false;
    let fileFilter = null;
    const missionPicker = el("select", { id: "mission", "aria-label": "Mission" }, ...missions.map((x, i) => el("option", { value: String(i) }, `${SCENARIO_NAME[x.scenario] ?? x.scenario} \u2014 ${x.title}`)));
    const follow = el("button", { class: "btn btn-quiet", "aria-pressed": "true", title: "Follow the phase the mission is in" }, "Following the mission");
    const themeBtn = el("button", { class: "btn btn-quiet", "aria-label": "Switch light or dark" }, "Dark");
    const rail = el("nav", { class: "rail", "aria-label": "Mission phases" });
    const lens = el("section", { class: "lens", "aria-live": "polite" });
    const drawer = el("aside", { class: "drawer", "aria-label": "Evidence", hidden: true });
    const title = el("h1", { class: "m-title" });
    const sub = el("p", { class: "m-sub" });
    root.append(
      fixtureBanner(pack),
      el(
        "header",
        { class: "top" },
        el("div", { class: "brand" }, el("span", { class: "mark", "aria-hidden": "true" }), el("b", {}, "Hydra"), el("span", { class: "dim" }, "C \xB7 Adaptive workspace")),
        missionPicker,
        el("span", { class: "grow" }),
        follow,
        themeBtn
      ),
      el("main", { class: "work" }, el("div", { class: "mhead" }, title, sub), rail, lens),
      drawer
    );
    function transition(fn) {
      const d = document;
      if (d.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) d.startViewTransition(fn);
      else fn();
    }
    function load(i) {
      m = missions[i];
      g = m.graph;
      if (!pinned) phase = phaseOf(g);
      fileFilter = null;
      drawer.hidden = true;
      render();
    }
    function render() {
      title.textContent = g.task.title;
      sub.replaceChildren(el("span", {}, m.project.name), " \xB7 ", el("span", {}, g.task.intent === "analyze" ? "Question" : `Change in ${g.task.mode} mode`), " \xB7 ", el("span", { class: "mono" }, `${fmtDuration(g.end - g.start)} recorded`), " \xB7 ", el("span", {}, `assigned ${PROVIDER_NAME(g.task.assignment.planner)}`));
      renderRail();
      lens.replaceChildren(lensFor(phase));
      lens.dataset.phase = phase;
    }
    function renderRail() {
      rail.replaceChildren();
      const phases = g.task.intent === "analyze" ? ["answer"] : ["plan", "build", "review", "proof", "decide"];
      const live = phaseOf(g);
      phases.forEach((p, i) => {
        const s = phaseState(g, p);
        rail.append(el(
          "button",
          { class: `phase t-${s.tone} ${p === phase ? "on" : ""}`, "aria-current": p === phase ? "step" : void 0, onclick: () => {
            pinned = p !== live;
            follow.setAttribute("aria-pressed", String(!pinned));
            follow.textContent = pinned ? "Return to the current phase" : "Following the mission";
            transition(() => {
              phase = p;
              render();
            });
          } },
          el("span", { class: "ph-n mono" }, String(i + 1).padStart(2, "0")),
          el("span", { class: "ph-name" }, PHASE_NAME[p]),
          el("span", { class: "ph-state" }, s.word),
          p === live ? el("span", { class: "ph-now" }, "now") : null
        ));
      });
    }
    function open(id) {
      const n = g.byId.get(id) ?? null;
      drawer.replaceChildren(el("div", { class: "drawer-head" }, el("button", { class: "btn btn-quiet", onclick: () => {
        drawer.hidden = true;
      } }, "Close")), renderInspector(g, n, { onSelect: open }));
      drawer.hidden = false;
      drawer.querySelector("button")?.focus();
    }
    addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !drawer.hidden) drawer.hidden = true;
    });
    const nodeBtn = (n, kids, cls = "") => el("button", { class: `nb ${cls}`, onclick: () => open(n.id) }, ...kids);
    function lensFor(p) {
      if (p === "answer") return answerLens();
      if (p === "plan") return planLens();
      if (p === "build") return buildLens();
      if (p === "review") return reviewLens();
      if (p === "proof") return proofLens();
      return decideLens();
    }
    function answerLens() {
      const run = g.nodes.find((n) => n.kind === "run");
      return el(
        "div",
        { class: "l-answer" },
        el("p", { class: "eyebrow" }, "Answer"),
        el("div", { class: "answer prose" }, g.task.answer ?? "No answer recorded yet."),
        run ? el("p", { class: "note" }, `${run.runFacts.activity.length} files and searches were reported while answering. `, nodeBtn(run, ["See what was read"], "linky")) : null
      );
    }
    function planLens() {
      const plan = g.task.plan;
      if (!plan) return el("div", { class: "empty" }, "The planner has not produced a plan yet.");
      const files = g.nodes.filter((n) => n.kind === "file" && n.file.planned);
      const later = g.nodes.filter((n) => n.kind === "file" && !n.file.planned && n.file.edits);
      const review = g.task.review;
      const crit = (c) => review?.acceptanceCriteriaMet.find((x) => x.criterion === c);
      const waiting = g.task.status === "waiting_input" && g.task.waitReason === "plan_approval";
      return el(
        "div",
        { class: "l-plan" },
        el("p", { class: "lede" }, plan.summary),
        el(
          "div",
          { class: "plan-grid" },
          el("div", { class: "col" }, el("h2", {}, "Steps"), el("ol", { class: "steps" }, ...plan.steps.map((s) => el("li", {}, s)))),
          el(
            "div",
            { class: "col" },
            el("h2", {}, "Files it expects to touch"),
            el("ul", { class: "files" }, ...files.map((f) => el("li", {}, nodeBtn(f, [el("span", { class: "mono" }, f.file.path), el("span", { class: `tag ${f.file.edits ? "tag-done" : "tag-idle"}` }, f.file.edits ? `edited ${f.file.edits}\xD7` : f.file.reads ? "read only" : "not touched yet")])))),
            later.length ? el("p", { class: "note" }, `Also edited, not in the plan: ${later.map((f) => f.file.path).join(", ")}`) : null
          ),
          el("div", { class: "col" }, el("h2", {}, "Done when"), el("ul", { class: "criteria" }, ...plan.acceptanceCriteria.map((c) => {
            const r = crit(c);
            return el("li", { class: r ? r.met ? "met" : "unmet" : "" }, el("span", { class: "mark-c", "aria-hidden": "true" }, r ? r.met ? "\u2713" : "\u2715" : "\xB7"), el("span", {}, c, r ? el("span", { class: "note" }, ` \u2014 reviewer: ${r.met ? "met" : "not met"}`) : null));
          })))
        ),
        plan.risks.length ? el("div", { class: "risks" }, el("h2", {}, "Risks the planner named"), el("ul", {}, ...plan.risks.map((r) => el("li", {}, r)))) : null,
        waiting ? el("div", { class: "yourturn" }, el("p", {}, el("b", {}, "Your turn. "), "Safe mode stops here until you approve the plan. Nothing has been changed in your repository."), el("div", { class: "actions" }, el("button", { class: "btn btn-primary" }, "Approve plan"), el("button", { class: "btn" }, "Revise the request")), el("p", { class: "note" }, "Prototype: inert controls.")) : null
      );
    }
    function buildLens() {
      const runs = g.nodes.filter((n) => n.kind === "run" && (n.stage === "implement" || n.stage === "fix"));
      const files = g.nodes.filter((n) => n.kind === "file").sort((a, b) => b.file.edits * 3 + (b.file.diff ? 5 : 0) - (a.file.edits * 3 + (a.file.diff ? 5 : 0)));
      const stream = el("ol", { class: "stream" });
      for (const r of runs) {
        stream.append(el("li", { class: "run-head" }, nodeBtn(r, [el("b", {}, `${STAGE_LABEL[r.stage]}${r.attempt && r.attempt > 1 ? " \xB7 round " + r.attempt : ""}`), el("span", { class: "note" }, ` ${PROVIDER_NAME(r.runFacts.run.provider)} \xB7 ${r.status === "ok" ? "finished" : r.status} \xB7 ${r.end && r.at ? fmtDuration(r.end - r.at) : ""}`)])));
        for (const a of r.runFacts.activity) {
          if (fileFilter && a.target !== fileFilter) continue;
          stream.append(el("li", { class: `op-row k-${a.kind}` }, el("span", { class: "mono t" }, fmtOffset(Date.parse(a.at), g.start)), el("span", { class: "verb" }, a.kind === "edit" ? "edited" : a.kind === "read" ? "read" : a.kind === "search" ? "searched" : a.kind === "command" ? "ran" : "used"), el("code", {}, a.target)));
        }
        if (r.status === "failed") stream.append(el("li", { class: "op-row k-fail" }, el("span", { class: "mono t" }, ""), el("span", { class: "verb" }, "failed"), el("span", {}, r.runFacts.run.error ?? "The run failed.")));
      }
      if (!runs.length) stream.append(el("li", { class: "note" }, "No build run has started."));
      const grid = el("div", { class: "tiles" }, ...files.map((f) => {
        const ff = f.file;
        const tot = ff.diff ? ff.diff.additions + ff.diff.deletions : 0;
        return el(
          "button",
          { class: `tile ${ff.diff ? "changed" : ""} ${fileFilter === ff.path ? "on" : ""} ${f.basis === "planned" ? "planned" : ""}`, onclick: () => {
            fileFilter = fileFilter === ff.path ? null : ff.path;
            transition(render);
          }, ondblclick: () => open(f.id) },
          el("span", { class: "mono path" }, ff.path),
          el("span", { class: "counts" }, `${ff.reads} read \xB7 ${ff.edits} edit`),
          ff.diff ? el("span", { class: "bar", "aria-label": `+${ff.diff.additions} \u2212${ff.diff.deletions}` }, el("i", { class: "a", style: { width: `${ff.diff.additions / Math.max(tot, 1) * 100}%` } }), el("i", { class: "d", style: { width: `${ff.diff.deletions / Math.max(tot, 1) * 100}%` } })) : el("span", { class: "note" }, f.basis === "planned" ? "planned, not touched" : "not in the final change"),
          ff.findings ? el("span", { class: "flag" }, `${ff.findings} finding${ff.findings === 1 ? "" : "s"}`) : null
        );
      }));
      return el(
        "div",
        { class: "l-build" },
        el("div", { class: "col-stream" }, el("h2", {}, fileFilter ? `Operations on ${fileFilter}` : "Reported operations"), el("p", { class: "note" }, "Tool calls as the provider reported them: names and targets only."), stream),
        el("div", { class: "col-files" }, el("h2", {}, "Files"), el("p", { class: "note" }, "Select a file to filter the operations; double-click for its diff."), grid)
      );
    }
    function reviewLens() {
      const reviews = m.raw.reviews;
      if (!reviews.length) return el("div", { class: "empty" }, "No review has been recorded yet.");
      const findingsOf = (ri) => g.nodes.filter((n) => n.kind === "finding" && n.finding.review === ri);
      const cols = reviews.map((r, ri) => {
        const later = reviews[ri + 1];
        const list = findingsOf(ri);
        return el(
          "article",
          { class: `review ${r.review.verdict}` },
          el("header", {}, el("p", { class: "eyebrow" }, `Review ${ri + 1} of `, el("span", { class: "mono" }, (r.reviewedSha ?? "").slice(0, 7))), el("h2", {}, r.review.verdict === "approve" ? "Approved" : "Changes requested"), el("p", { class: "note" }, fmtOffset(Date.parse(r.at), g.start))),
          el("ul", { class: "findings" }, ...list.map((f) => {
            const again = later ? later.review.findings.some((x) => x.issue === f.finding.issue) : null;
            return el("li", { class: `sev-${f.finding.severity}` }, nodeBtn(f, [el("span", { class: "sev" }, f.finding.severity), el("span", { class: "issue" }, f.label), el("span", { class: "mono file" }, f.finding.file ?? ""), later ? el("span", { class: `tag ${again ? "tag-stop" : "tag-done"}` }, again ? "raised again next review" : "not raised in the next review") : null]));
          }), list.length ? null : el("li", { class: "note" }, "No findings."))
        );
      });
      const crits = [...new Set(reviews.flatMap((r) => r.review.acceptanceCriteriaMet.map((c) => c.criterion)))];
      const matrix = el(
        "table",
        { class: "matrix" },
        el("thead", {}, el("tr", {}, el("th", {}, "Acceptance criterion"), ...reviews.map((_, i) => el("th", {}, `Review ${i + 1}`)))),
        el("tbody", {}, ...crits.map((c) => el("tr", {}, el("td", {}, c), ...reviews.map((r) => {
          const x = r.review.acceptanceCriteriaMet.find((y) => y.criterion === c);
          return el("td", { class: x ? x.met ? "met" : "unmet" : "" }, x ? x.met ? "\u2713 met" : "\u2715 not met" : "\u2014");
        }))))
      );
      return el(
        "div",
        { class: "l-review" },
        el("div", { class: "reviews" }, ...cols),
        el("h2", {}, "Criteria across reviews"),
        el("div", { class: "tablewrap" }, matrix),
        el("p", { class: "note" }, '"Not raised in the next review" compares finding text between reviews. It is derived; the reviewer does not mark findings resolved.')
      );
    }
    function proofLens() {
      const revs = g.nodes.filter((n) => n.kind === "revision").sort((a, b) => a.revision.index - b.revision.index);
      const checks = g.nodes.filter((n) => n.kind === "check");
      const labels = [...new Set(checks.map((c) => c.label))];
      if (!labels.length) return el("div", { class: "empty" }, "No checks have run yet.");
      const head = revs.find((r) => r.revision.role === "head" || r.revision.role === "applied");
      const t = el(
        "table",
        { class: "matrix proof" },
        el("thead", {}, el("tr", {}, el("th", {}, "Check"), ...revs.map((r) => el("th", { class: r === head ? "head" : "" }, el("span", { class: "mono" }, r.revision.short), el("span", { class: "note" }, r.revision.role === "base" ? " your branch" : r === head ? " proposed" : ""))))),
        el("tbody", {}, ...labels.map((l) => el("tr", {}, el("td", {}, el("code", {}, l)), ...revs.map((r) => {
          const here = checks.filter((c) => c.label === l && c.evidence.commitSha.startsWith(r.revision.short));
          return el("td", { class: r === head ? "head" : "" }, ...here.map((c) => nodeBtn(c, [passedEvidence(c.evidence) ? "\u2713" : "\u2715", el("span", { class: "note" }, ` ${c.evidence.phase === "demo_base" ? "original" : c.evidence.phase === "pre_review" ? "pre-review" : "verify"}`)], `cell ${c.status}`)), here.length ? null : el("span", { class: "note" }, "\u2014"));
        }))))
      );
      return el("div", { class: "l-proof" }, el("p", { class: "lede" }, "Every result is bound to the exact revision it ran on. Acceptance only counts verify results on the proposed revision."), el("div", { class: "tablewrap" }, t));
    }
    function decideLens() {
      const d = g.byId.get("decision");
      const files = g.nodes.filter((n) => n.kind === "file" && n.file.diff);
      const head = g.nodes.find((n) => n.kind === "revision" && (n.revision.role === "head" || n.revision.role === "applied"));
      const base = g.nodes.find((n) => n.kind === "revision" && n.revision.role === "base");
      const atHead = g.nodes.filter((n) => n.kind === "check" && head && n.evidence.commitSha.startsWith(head.revision.short) && n.evidence.phase === "verify");
      const nits = g.task.review?.findings ?? [];
      if (!d) return el("div", { class: "empty" }, g.task.status === "failed" ? `The mission stopped: ${g.task.error ?? "a stage failed"}. Nothing was changed in your repository.` : "The mission has not reached a decision.");
      const status = d.decision;
      return el(
        "div",
        { class: `l-decide ${d.status}` },
        el("p", { class: "eyebrow" }, d.status === "ok" ? "Delivered" : d.status === "blocked" ? "Blocked by Hydra" : "Your decision"),
        el("h2", { class: "big" }, d.status === "ok" ? `Applied ${head?.revision.short ?? ""} to ${g.task.applied?.targetBranch ?? "your branch"}` : d.status === "blocked" ? "This revision cannot be accepted yet" : `Accept ${head?.revision.short ?? "this revision"}?`),
        el(
          "div",
          { class: "brief" },
          el("section", {}, el("h3", {}, "What changes"), files.length ? el("ul", {}, ...files.map((f) => el("li", {}, nodeBtn(f, [el("code", {}, f.file.path), el("span", { class: "note" }, ` +${f.file.diff.additions} \u2212${f.file.diff.deletions}`)], "linky")))) : el("p", { class: "note" }, g.gaps.find((x) => /workspace|diff/i.test(x)) ?? "No file changes.")),
          el("section", {}, el("h3", {}, "What proves it"), atHead.length ? el("ul", {}, ...atHead.map((c) => el("li", {}, nodeBtn(c, [c.status === "ok" ? "\u2713 " : "\u2715 ", el("code", {}, c.label), el("span", { class: "note" }, ` at ${head.revision.short}`)], `linky ${c.status}`)))) : el("p", { class: "note" }, "No verify results at this revision.")),
          el("section", {}, el("h3", {}, "What remains"), status.unresolved.length && d.status !== "ok" ? el("ul", { class: "unresolved" }, ...status.unresolved.map((u) => el("li", {}, u))) : el("ul", {}, ...nits.map((f) => el("li", {}, el("span", { class: "note" }, f.severity + ": "), f.issue)), nits.length ? null : el("li", { class: "note" }, "Nothing open."))),
          el("section", {}, el("h3", {}, d.status === "ok" ? "Receipt" : "What accepting does"), d.status === "ok" && status.acceptance ? el("p", {}, `Accepted by ${status.acceptance.actor} from the ${status.acceptance.source}, bound to ${status.acceptance.evidenceIds.length} check results. Receipt `, el("code", {}, status.acceptance.decisionId.slice(0, 8))) : el("p", {}, `Fast-forwards your branch from `, el("code", {}, base?.revision.short ?? "base"), ` to `, el("code", {}, head?.revision.short ?? "head"), `. Hydra re-checks the same evidence when you click, and refuses if anything changed.`))
        ),
        d.status === "waiting" || d.status === "blocked" ? el("div", { class: `actions ${d.status === "waiting" ? "yourturn" : ""}` }, el("button", { class: "btn btn-primary", disabled: d.status === "blocked" }, "Accept revision"), el("button", { class: "btn" }, "Request changes"), el("button", { class: "btn btn-quiet" }, "Reject"), el("span", { class: "note" }, "Prototype: inert controls.")) : null
      );
    }
    missionPicker.addEventListener("change", () => transition(() => load(Number(missionPicker.value))));
    follow.addEventListener("click", () => {
      pinned = false;
      follow.setAttribute("aria-pressed", "true");
      follow.textContent = "Following the mission";
      transition(() => {
        phase = phaseOf(g);
        render();
      });
    });
    themeBtn.addEventListener("click", () => {
      const dark = document.documentElement.dataset.theme !== "dark";
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      themeBtn.textContent = dark ? "Light" : "Dark";
    });
    window.hydraProto = { mission: (i) => {
      missionPicker.value = String(i);
      load(i);
    }, phase: (p) => {
      pinned = true;
      phase = p;
      render();
    }, open, dark: () => themeBtn.click() };
    load(0);
  }
  Promise.allSettled([document.fonts.load('500 14px "Red Hat Text"'), document.fonts.load('700 20px "Red Hat Display"')]).then(main);
})();
