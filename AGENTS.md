# AGENTS.md

## Project context

StyleScan Ultra is a local-first Manifest V3 Chrome extension for CSS inspection and editing.

Before implementing or changing product behavior, read:

1. `PLAN.md`
2. `docs/research.md`
3. `docs/roadmap.md`
4. Relevant source files and tests

Treat these documents as project context, not as a substitute for inspecting the current code.

## Working rules

- Prefer small, reviewable changes over broad rewrites.
- Preserve the local-only/no-backend architecture unless the task explicitly changes that decision.
- Keep Chrome permissions minimal and justified.
- Do not fabricate CSS provenance. If CSSOM access is unavailable, use computed fallback with an explicit limitation/warning.
- Cascade diagnostics must be conservative: use an unknown/uncertain state when the engine cannot prove a result.
- Route live edits through a reversible mutation/history model so undo, reset, and export stay consistent.
- Use a controlled stylesheet/rule layer for pseudo-state or responsive edits that cannot be represented correctly with inline styles.
- Keep the inspector isolated from host-page CSS and clean up listeners, observers, style nodes, highlights, and timers on teardown.
- Avoid expensive full-document work on pointer movement.

## Verification

For normal code changes run:

```bash
npm run check
npm test
```

When behavior depends on real Chrome execution, also run:

```bash
npm run test:chrome
```

The Chrome integration test requires the repository's documented Chrome for Testing setup.

When fixing engine/cascade/editing bugs, add a regression test whenever practical.

## Scope discipline

When given a roadmap item such as `P0-03`:

1. Locate that item in `docs/roadmap.md`.
2. Inspect the relevant implementation and tests.
3. State a short implementation plan.
4. Implement only the necessary supporting changes.
5. Run the relevant verification commands.
6. Report changed files, test results, and any remaining technical limitation.

Do not mark unrelated roadmap work complete.
