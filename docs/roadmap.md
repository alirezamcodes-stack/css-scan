# StyleScan Ultra — Agent Roadmap

This roadmap converts `PLAN.md` and `docs/research.md` into implementation-oriented work. Agents should work on one scoped item at a time and verify the repository before marking an item complete.

## P0 — correctness and reliability

### P0-01 — Cascade regression coverage
- Expand engine fixtures for specificity, source order, `!important`, inactive conditional rules, inheritance, and shorthand/longhand interactions.
- Assert conservative `unknown` behavior where the engine cannot prove the winner.
- Do not change UI labels merely to make tests pass.

### P0-02 — Cross-origin/computed fallback audit
- Audit every fallback path from CSSOM to computed styles.
- Ensure provenance/warnings remain visible in returned data.
- Ensure computed values are never labeled as authored declarations.

### P0-03 — Edit transaction model
- Review live edit/history code as a transaction: previous value, requested value, accepted value, and removal state.
- Reject invalid CSS values before committing history where possible.
- Ensure undo/reset and exported Changes agree with the actual page state.

### P0-04 — Inspector lifecycle cleanup
- Audit activation/deactivation for event listeners, observers, temporary style nodes, highlights, and timers.
- Ensure repeated open/close cycles do not duplicate handlers or UI.
- Add a regression test where practical.

## P1 — deeper editing

### P1-01 — Controlled rule layer
- Introduce or formalize a dedicated generated stylesheet/rule layer for edits that cannot be represented safely as inline styles.
- Keep generated rules attributable and removable.

### P1-02 — Pseudo-state editing
- Add explicit editing for `:hover` and `:focus` first.
- Build on the controlled rule layer rather than mutating unrelated inline styles.
- Make reset/export behavior deterministic.

### P1-03 — Responsive editing
- Represent viewport/media-specific edits explicitly.
- Preserve the media condition in exported CSS.
- Avoid pretending responsive edits are global inline changes.

### P1-04 — Visual editor depth
- Improve backgrounds, borders, shadows, transforms, flex, and grid controls.
- Reuse the same validated mutation/history path as code edits.

## P2 — export and workflow

### P2-01 — Component export minimization
- Reduce redundant computed declarations.
- Preserve useful CSS variables where they are available and safe.
- Keep an explicit warning when exact authored source cannot be reconstructed.

### P2-02 — Shadow DOM/export edge cases
- Add fixtures for open Shadow DOM where supported by the current architecture.
- Fail clearly for inaccessible structures rather than producing misleading output.

### P2-03 — Responsive comparison workflow
- Add viewport presets/comparison only after responsive editing state is stable.
- Keep inspection performance acceptable during viewport changes.

### P2-04 — Local snippets and design tokens
- Improve reusable local snippets and token browsing without introducing a backend.
- Keep storage schema versioned if persisted data shape changes.

## Verification gate for every task

Before completion:

1. `npm run check`
2. `npm test`
3. `npm run test:chrome` when the change depends on actual Chrome behavior
4. Update tests and documentation affected by the change
5. Confirm no secrets, credentials, generated profiles, or local machine paths were added

## Task execution format

For agent-driven work, use a narrow instruction such as:

> Implement P0-03 from `docs/roadmap.md`. Read `AGENTS.md`, `PLAN.md`, and `docs/research.md` first. Inspect the current implementation, make the smallest architecture-compatible change, run the relevant verification gates, and summarize changed files plus remaining limitations.
