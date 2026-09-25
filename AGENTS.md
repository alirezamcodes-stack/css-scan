# AGENTS.md

## Required context

StyleScan Ultra is a free, local-first Manifest V3 Chrome CSS inspector/editor.

Before changing product behavior, read:

1. `PLAN.md`
2. `docs/research.md`
3. `docs/roadmap.md`
4. the relevant implementation and tests

The research/roadmap describe the target. The current repository is the source of truth for what is already implemented. Do not rewrite working features just because the target architecture differs.

## Non-negotiable engineering rules

- Keep the core inspector local-first and backend-free.
- Keep Chrome permissions minimal. Do not add permanent `<all_urls>` or `debugger` without an explicit scoped task.
- Keep Applied/Authored CSS separate from Computed CSS.
- Never fabricate CSS provenance, original units, selectors, conditions, or source files when CSSOM data is inaccessible.
- Cascade claims must be conservative. Prefer UNKNOWN/uncertain over an incorrect winner.
- Do not use regex-only specificity logic for Selectors Level 4.
- Do not rescan all stylesheets on every pointer event.
- Keep pointer/overlay work lightweight and frame-gated.
- Keep inspector UI isolated from host-page CSS and clean up all runtime artifacts on teardown.
- Use reversible edit transactions so undo/reset/export match actual page state.
- Use controlled generated rules for pseudo-state/responsive edits that cannot be represented correctly inline.
- Sanitize component export. Never export password/form values, page scripts, inline event handlers, cookies, storage, or authorization data.
- No remote executable code, `eval()`, `new Function()`, or unsafe page-controlled `innerHTML`.
- Do not copy proprietary code/assets/UI from CSS Peeper, CSS Scan, or CSS Pro.
- Do not copy SnappySnippet GPL code into this project.
- If third-party MIT/Apache code is actually reused, preserve required license/provenance notices.

## Scope discipline

For a roadmap task such as `P0-06`:

1. Read the task and relevant research section.
2. Inspect current code/tests first.
3. Identify what is already implemented.
4. Make the smallest architecture-compatible change that closes the actual gap.
5. Add regression tests where practical.
6. Run verification.
7. Report changed files, test results, and remaining limitations.
8. Do not mark unrelated roadmap items complete.

## Verification

For normal changes:

```bash
npm run check
npm test
```

For changes dependent on real Chrome behavior:

```bash
npm run test:chrome
```

When the documented Chrome-for-Testing environment is unavailable, report that fact; do not claim the browser test passed.

## Product order

Unless a scoped task says otherwise, prioritize:

**Picker → Applied CSS → Computed CSS → Selector/Specificity → Copy → Accessibility → Export → Design-system analysis → Visual editing → optional CDP/AI**

The highest-risk core area is accurate Applied CSS/cascade reasoning.
