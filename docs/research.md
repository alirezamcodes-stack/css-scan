# StyleScan Ultra — Engineering Research

## Purpose

This document gives coding agents durable technical context for developing StyleScan Ultra. It complements `PLAN.md`: the plan defines product direction; this file records engineering findings, constraints, and implementation guidance.

## Current product

StyleScan Ultra is a Manifest V3 Chrome extension for inspecting, copying, and editing CSS directly on supported web pages. It is intentionally local-first and does not require a backend.

Current architecture:

- `background.js`: active-tab injection through the service worker.
- `src/engine.js`: CSS extraction, computed-style fallback, pseudo-elements, media/conditional rule handling, and safe HTML.
- `src/content.js` + `src/overlay.css`: on-page inspector and Shadow DOM UI.
- `popup.*`: quick controls.
- `options.*`: persisted settings.
- `tests/`: engine and Chrome smoke tests.

## Engineering findings

### 1. Authored CSS and computed CSS are different data sources

The browser's CSSOM is the preferred source when the product needs selectors, authored values, conditions, source provenance, and source order. `getComputedStyle()` is a fallback for final rendered values, not a reconstruction of authored CSS.

Do not present computed values as if they were the original source declaration.

### 2. Cross-origin CSS is an unavoidable accuracy boundary

Some stylesheets cannot expose `cssRules` because of browser security restrictions. When this occurs:

- continue inspection using computed values where possible;
- preserve a clear warning/provenance marker;
- never fabricate selector, source file, authored unit, or condition information.

This limitation should be treated as expected browser behavior rather than an extraction bug.

### 3. Cascade diagnostics require conservative claims

A declaration can be affected by specificity, source order, `!important`, conditional rules, inheritance, cascade layers, scopes, origins, shorthands/longhands, and other browser behavior.

The existing `candidate` concept should remain explicitly approximate unless the engine can prove the result. Prefer an `unknown` state over a confident but incorrect cascade claim.

### 4. Inspector UI must remain isolated from inspected pages

The on-page interface should remain inside Shadow DOM and avoid relying on page-global CSS. Event listeners and temporary DOM markers must be cleaned up when the inspector closes.

Hover work should be throttled/debounced where appropriate. Avoid full-document rescans on every pointer movement.

### 5. Live edits need reversible state

Every edit should have enough information to support:

- undo/reset;
- accurate Changes output;
- CSS/JSON export;
- removal of a property without leaving stale state.

Validate editable values before recording a successful mutation. Do not record a change that the browser rejected.

### 6. Pseudo-state editing is not equivalent to inline-style editing

Features for `:hover`, `:focus`, `:active`, responsive states, or pseudo-elements generally require generated stylesheet rules or another controlled rule layer. Do not simulate these states by silently rewriting unrelated inline declarations.

### 7. Component export is necessarily lossy

Exported HTML/CSS should be useful and portable, but exact source reconstruction is not always possible. Child computed-style snapshots can reproduce appearance while losing original selectors, variables, conditions, inheritance intent, and authoring structure.

Prefer minimal, explainable output and avoid claiming byte-for-byte/source equivalence.

### 8. Permissions should remain minimal

The default product should continue to favor `activeTab`, `scripting`, storage, and narrowly justified permissions. Powerful debugging permissions should not be added merely to improve extraction accuracy without a separate explicit product decision and UX review.

### 9. Testing must target both engine logic and browser behavior

Before considering an implementation complete:

- run `npm run check`;
- run `npm test`;
- when browser behavior changed, run `npm run test:chrome` with Chrome for Testing.

Add regression fixtures for cascade/extraction bugs instead of fixing them only through UI code.

## Development priorities

The highest-value engineering work is:

1. Improve extraction and cascade correctness without overstating certainty.
2. Make editing reliable and fully reversible.
3. Add explicit pseudo-state/responsive editing using controlled rules.
4. Improve component export while reducing redundant generated CSS.
5. Expand visual editing only after the underlying mutation/history model is reliable.

## Agent rules derived from this research

When implementing a feature:

1. Read `AGENTS.md`, `PLAN.md`, and this file first.
2. Inspect the existing implementation before proposing a rewrite.
3. Prefer the smallest change that fits the current architecture.
4. Preserve local-only behavior unless the task explicitly changes that product decision.
5. Preserve provenance and warnings when CSS source information is incomplete.
6. Add or update tests for extraction, cascade, or mutation logic.
7. Do not describe an approximation as exact browser cascade/source reconstruction.
