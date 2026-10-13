---
name: isolated-change-workflow
description: Make code changes safely in an isolated git worktree and only touch the user's branch after explicit approval. Use when asked to implement a change, fix a bug or refactor in a git repository and the user wants to review before anything lands, or when working autonomously. Follows plan, implement, review, verify, present diff, approve, and gives a non-destructive rollback.
---

# Isolated change workflow

Goal: the user's working tree and branch stay untouched until they approve a specific, verified commit. Every step is reversible without rewriting history.

## 0. Preconditions
- The project is a git repository with at least one commit. If not, stop and ask the user to `git init` and commit.
- Note the user's branch and HEAD: `git symbolic-ref --short HEAD`, `git rev-parse HEAD`.
- Note uncommitted changes (`git status --porcelain`). They will **not** be visible in the isolated copy. Tell the user if any exist.

## 1. Plan (read-only)
Read the relevant code. Write a short plan: the change, ordered steps, **objectively checkable acceptance criteria**, risks, and the files likely to be touched. If the user wants to approve plans first, stop here and ask.

## 2. Isolate
```
git worktree add -b work/<short-name> ../<repo>-<short-name> HEAD
```
Do all edits inside that worktree directory. Never edit the user's original checkout.

## 3. Implement
Make the smallest change that satisfies the plan. Add or update tests that prove it. Commit in the worktree with a clear message. Do not push and do not touch other branches.

## 4. Review
Review the diff (`git diff <base>...HEAD`) critically, ideally with a different agent (see the `independent-code-review` skill). Fix blocker and major findings. **Bound the loop**: at most two fix rounds; then stop and report what is still open.

## 5. Verify
Run the project's real checks **in the worktree** and record exit codes against the commit (see the `evidence-based-verification` skill). Optionally run the same checks on the base commit to show what changed (failing → passing) and that nothing regressed.

## 6. Present for approval
Show the user:
- the diff summary (files, +/− lines) and the full diff on request
- the plan's acceptance criteria and whether each is met
- the verification evidence (commands, exit codes, commit SHA)
- open findings, risks, and anything that was **not** verified
- warnings: modified existing tests, changed build/CI/dependency files

Ask explicitly: **accept, request changes, or reject?** Do nothing to the user's branch until they answer.

## 7. Apply (only on "accept")
- Refuse if the user's tree has uncommitted changes. Ask them to commit or stash; never stash for them.
- If their branch has not moved: `git merge --ff-only work/<short-name>`.
- If it moved: merge their branch into the work branch **in the worktree**, re-run verification, and show the result again before applying. A combined tree nobody has verified must not land.
- Record the SHAs before and after.

## 8. Roll back (if asked later)
Never reset or force-push. Create a revert commit: `git revert --no-edit <before>..<after>` (fast-forward) or `git revert -m 1 <merge-commit>`. If it conflicts, `git revert --abort` and explain.

## 9. Clean up
After accept or reject: `git worktree remove <path>`, and delete the work branch if it was merged or rejected. Keep it if the user wants to merge manually.
