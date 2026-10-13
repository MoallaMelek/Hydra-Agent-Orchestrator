---
name: evidence-based-verification
description: Verify code changes with real, observed evidence instead of claims. Use when finishing a change, before saying "tests pass", when asked to verify or validate work, or when reviewing another agent's claim that something works. Detects the project's real build/test/lint commands across Node, Python, Go, Rust, Java and C/C++, runs them, and reports exit codes against the exact commit.
---

# Evidence-based verification

A change is verified only when you have **observed** the project's own checks succeed on the exact code you are reporting about. "It should work", "the tests would pass", or another agent's summary are not evidence.

## Rules
1. **Never state that tests, builds or linters pass unless you ran them in this session and saw exit code 0.** If you could not run them, say so explicitly and say why.
2. Run checks against the **current, committed or clearly identified state** of the code. Record the commit (`git rev-parse HEAD`) and whether the working tree had uncommitted changes (`git status --porcelain`).
3. Use the **project's own** commands. Do not invent substitutes (for example, do not replace `npm test` with running one test file) unless you report the substitution.
4. A check that **modified tracked files** while running (`git status --porcelain --untracked-files=no` is non-empty afterwards) is not trustworthy evidence. Report it.
5. Do not weaken, skip or delete tests to make them pass. If a test is wrong, say so and explain; let the user decide.

## Step 1: find the real checks
Read the project files. Use the first matching source, in this order:
- `.hydra/checks.json` or another documented project check list: use exactly what it declares.
- **Node/TS/JS** (`package.json`): scripts named `typecheck`, `lint`, `build`, `test`. The package manager comes from the lockfile (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lock[b]` → bun, otherwise npm). Ignore the npm placeholder `echo "Error: no test specified"`. Run with `CI=1` so watch-mode runners exit.
- **Python**: `pytest` if configured (pytest.ini, conftest.py, `[tool.pytest]`, or pytest in requirements), otherwise `python -m unittest discover`. Use the project's virtualenv interpreter (`.venv`/`venv`) if present. Add `ruff`/`mypy` only if configured.
- **Go** (`go.mod`): `go build ./...`, `go vet ./...`, `go test ./...`
- **Rust** (`Cargo.toml`): `cargo build`, `cargo test`
- **Java**: Maven wrapper `./mvnw -B test` (or `mvn`), Gradle wrapper `./gradlew test` (or `gradle`)
- **C/C++**: CMake configure, build and `ctest` in a separate build directory; or `make test` if the Makefile has a `test` target

The helper `scripts/detect-checks.mjs` prints these commands for a directory without running anything: `node scripts/detect-checks.mjs <project-dir>`.

## Step 2: run each check and record evidence
For each command, record:

| Field | How |
|---|---|
| command | exactly as run |
| commit | `git rev-parse HEAD` (+ "dirty" if `git status --porcelain` is non-empty) |
| exit code | the process's real exit code |
| duration | wall time |
| key output | the failing test names or error lines (short tail) |
| tree mutated? | `git status --porcelain --untracked-files=no` after the run |

If a tool is not installed, record "not run: <tool> missing". That is not a pass.

## Step 3: report
Use this format, and nothing more optimistic than the evidence supports:

```
Verification at <commit> (<clean|dirty>):
- <command>: PASS (exit 0, 4.2s)
- <command>: FAIL (exit 1): <one-line reason>
- <command>: NOT RUN: <reason>
Verdict: VERIFIED | NOT VERIFIED (<n> failing, <m> not run)
```

If anything failed or was not run, the verdict is **NOT VERIFIED**, even if you believe the change is correct.

## Optional: prove the change made a difference
Run the same checks on the commit before the change in a temporary worktree (`git worktree add --detach <tmp> <base-commit>`; avoid `git stash`, which can collide with other tools or sessions sharing the stash) and show which checks went from failing to passing and whether anything regressed. Remove the temporary worktree afterwards.
