# AWH Canonical Operator Source Contract

## Purpose

AWH must never choose a production source from a convenient local folder, a stale remote-tracking ref, a historical worktree, or dated Project Memory. The live GitHub branch `awh/api-independence` is the canonical source authority and must be resolved from the remote at mutation time.

This contract fixes the class of failure where several valid-looking AWH worktrees coexist while `origin/awh/api-independence` in one clone is older than the actual GitHub branch.

## Authority order

For source mutation and release decisions:

1. live `git ls-remote origin refs/heads/awh/api-independence`;
2. exact local `HEAD` only when it equals that live SHA;
3. clean working-tree state;
4. exact approved release SHA when a release approval exists;
5. local remote-tracking refs only as diagnostics;
6. historical worktrees and dated documents as evidence only.

A stale `refs/remotes/origin/awh/api-independence` must never override the live remote SHA.

## Mutation-ready definition

A workspace is mutation-ready only when all of these are true:

- `origin` resolves to the reviewed `theartzkk/lnwjud-readme` repository;
- the canonical branch can be resolved live;
- local `HEAD` equals the live canonical SHA;
- an explicit release SHA, when supplied, also equals the live canonical SHA;
- the target worktree is clean.

The current branch may be attached or detached. Exact content identity matters more than branch cosmetics, which allows a clean dedicated operator worktree while protecting dirty feature/evidence worktrees.

## Tool

`scripts/ops/canonical-source-preflight.mjs` performs the read-only proof. It reports:

- live canonical SHA;
- local HEAD;
- cached remote-tracking SHA and whether it is stale;
- worktree count;
- clean/dirty state;
- repository identity;
- a bounded reason code.

With `--require-mutation-ready`, any mismatch exits non-zero. Remote unavailability is a mutation blocker, not permission to fall back to cached refs.

## Operator rule

Production wrappers must run the canonical source preflight before credential access, artifact build, backup naming, migration, pointer movement, Nginx changes, or other production mutation. A failure is terminal for that attempt. Do not encode around it, manually replay the deployment, or substitute another checkout.

The owner-auth activation wrapper now applies this rule. Other production entrypoints should converge on the same preflight instead of implementing their own source checks.

## Worktree roles

Multiple worktrees are allowed when their role is explicit:

- **operator** — clean, exact live canonical, used for reviewed mutation only;
- **candidate** — feature/repair work that may advance through PR/CI;
- **evidence** — detached or historical proof, never a mutation source;
- **protected dirty** — user/agent work that must not be reset, merged, removed, or repurposed without proving ownership and recoverability.

AWH should not delete historical worktrees merely to make the list shorter. The permanent fix is classification plus a hard mutation gate, not destructive cleanup.

## Block-resistant behavior

If GitHub, a remote worker, ChatGPT transport, or another external channel is temporarily unavailable:

- preserve the accepted durable task;
- continue unrelated eligible work;
- keep the exact source/release identity;
- classify the blocker truthfully;
- retry only through bounded policy when the same authority becomes available.

Transport failure must not turn a stale local ref into Source of Truth.
