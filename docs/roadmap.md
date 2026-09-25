# StyleScan Ultra — Research-Based Roadmap

This roadmap is derived from the 2026-09-25 research report. It replaces the earlier provisional roadmap.

The repository already implements parts of several items. Before coding, inspect current behavior and tests; do not rebuild working features solely because they appear below.

## P0 — professional core / MVP

### P0-01 — Repository and architecture audit
- Map current JavaScript modules to the target boundaries in `docs/research.md`.
- Refactor only where it reduces coupling or enables later tests/features.
- Evaluate TypeScript + WXT or Vite/CRXJS migration separately; do not perform a wholesale toolchain rewrite without a scoped task.

### P0-02 — High-performance picker and overlay
- Use a `requestAnimationFrame`-gated pointer path.
- Cache the last target.
- Keep rect/layout reads bounded.
- Defer expensive CSS analysis.
- Ensure activation/deactivation cleans up all listeners, observers, highlights, timers, and generated styles.

### P0-03 — Production selector generator
- Generate stable candidates and verify uniqueness.
- Use `CSS.escape()`.
- Penalize unstable/hash-like classes.
- Use `:nth-of-type()` only as fallback.
- Represent Shadow DOM with root-by-root selector paths instead of fake cross-root selectors.
- Add selector fixtures.

### P0-04 — Separate Applied/Authored and Computed models
- Keep authored CSS and `getComputedStyle()` snapshots as separate data models and UI concepts.
- Preserve source/provenance and original authored values where accessible.
- Mark cross-origin/inaccessible stylesheet data explicitly.
- Never label computed fallback as original/authored CSS.

### P0-05 — CSSOM rule index and condition model
- Index stylesheets once per activation/cache lifecycle.
- Recursively traverse relevant nested rules.
- Preserve media/supports/container/layer context.
- Add targeted cache invalidation for dynamic styles.
- Do not abort when one stylesheet is inaccessible.

### P0-06 — Selectors Level 4 specificity
- Replace/avoid regex-only specificity logic.
- Correctly cover `:is()`, `:not()`, `:has()`, `:where()`, and `:nth-child(... of S)`.
- Store specificity as a tuple.
- Add direct regression fixtures.

### P0-07 — Conservative cascade diagnostics
- Model importance/origin, layer where available, conditions, specificity, source order, inline declarations, and relevant shorthand/longhand interactions.
- Expose clear states such as APPLIED, OVERRIDDEN, INACTIVE CONDITION, INLINE, COMPUTED, and UNKNOWN.
- Use UNKNOWN whenever the implementation cannot prove the result.

### P0-08 — Inspector information architecture
- Keep fast hover/pin workflow.
- Provide grouped views for Applied, Computed, Layout, and Accessibility.
- Keep typography/colors/box-model information grouped instead of dumping hundreds of properties.
- Preserve keyboard navigation and visible focus.
- Keep inspector UI isolated in Shadow DOM.

### P0-09 — Copy and local export
- Copy selector, declaration, and full rule.
- Export CSS and JSON locally.
- Give concise copy feedback.
- Do not introduce cloud dependency.

### P0-10 — Contrast and basic accessibility
- Show element-level contrast where it can be computed reliably.
- Use WCAG 2.2 thresholds as documented in `docs/research.md`.
- Present results as automated findings, never as a claim of full WCAG conformance.
- Test keyboard-only operation, focus order/visibility, zoom, and reduced motion.

### P0-11 — Editing transaction reliability
- Route live edits through reversible transactions.
- Track previous/requested/accepted/removal state.
- Do not record rejected CSS as successful.
- Keep undo/reset/Changes/export synchronized with actual page state.

### P0-12 — Performance and edge-case benchmarks
- Cache stylesheet/rule metadata and repeated element analysis.
- Add large-DOM and many-rule fixtures.
- Add dynamic-style invalidation tests.
- Avoid full stylesheet parsing on pointer movement.

### P0-13 — Test foundation
- Expand unit fixtures for selector, specificity, cascade, computed diff, serializer, contrast, export sanitization, Shadow DOM, and failure cases.
- Expand Chrome/browser E2E fixtures listed in `docs/research.md`.
- Keep existing `npm run check`, `npm test`, and browser smoke verification working.

### P0-14 — Store/privacy/release readiness
- Audit permissions and keep them minimal.
- Audit built artifacts for remote executable code and unsafe constructs.
- Add/maintain privacy, license, provenance, and store documentation as needed before publication.
- Test clean install, upgrade, Chrome Stable, and complex pages.
- Produce reproducible release ZIP/checksum when release automation is introduced.

## P1 — differentiation after the core is reliable

### P1-01 — Safe HTML+CSS component export
- Sanitize scripts, inline event handlers, form/password values, and runtime-sensitive data.
- Export only the structure/CSS needed for the selected component where practical.
- Clearly state reconstruction limitations.

### P1-02 — Pseudo-elements, pseudo-states, and condition explorer
- Improve authored/computed `::before` and `::after` mapping.
- Preserve pseudo selectors and conditions.
- Add `:hover`/`:focus`/`:active` editing only through a controlled rule/state model.
- Add media/container-condition exploration.

### P1-03 — Design-system analysis
- Build global/local color inventory.
- Build typography inventory.
- Extract CSS custom properties/design tokens.
- Reuse stylesheet/DOM indexes rather than rescanning unnecessarily.

### P1-04 — Shadow DOM and iframe hardening
- Improve open Shadow Root traversal and explicit limitation reporting.
- Add same-origin and cross-origin frame fixtures.
- Keep permission/messaging implications explicit.

### P1-05 — Responsive presets
- Add viewport presets/comparison without claiming full device emulation.
- Preserve responsive/media context in inspection and export.

### P1-06 — Asset browser
- Add local analysis of page images/icons/SVGs/assets.
- Keep resource analysis separate from CSS rule matching.

### P1-07 — Automated release pipeline
- Add license/provenance checks, build, E2E, dist security scan, ZIP artifact, checksum, version tag, and release workflow.

## P2 — advanced mode

### P2-01 — Optional CDP/debugger mode
- Evaluate a separately explained Advanced mode using `chrome.debugger`.
- Do not add the permission to the default product without an explicit product/security decision.
- Use it only for capabilities that materially require CDP.

### P2-02 — True device emulation
- If Advanced CDP mode is accepted, implement DPR/touch/UA/media/device emulation through the appropriate CDP domains.
- Do not market viewport resizing alone as full device emulation.

### P2-03 — Deeper forced pseudo-state inspection
- Prefer browser/CDP support for robust forced pseudo states rather than fragile DOM hacks.

### P2-04 — Extended accessibility audits
- Expand beyond contrast/basic metadata while retaining clear automated-check limitations.

### P2-05 — Firefox/Edge hardening
- Start after Chrome behavior and packaging are stable.
- Re-evaluate WXT/cross-browser packaging at this point if not already adopted.

### P2-06 — Optional AI
- Only after the local product is mature.
- Must be explicit opt-in.
- Show what DOM/CSS data leaves the browser.
- Define redaction, privacy, and cost model before implementation.

## Required verification for agent tasks

For normal code changes:

```bash
npm run check
npm test
```

When real Chrome behavior is affected:

```bash
npm run test:chrome
```

Also:
- add regression coverage for engine/cascade/editing fixes;
- verify no secrets, local profiles, credentials, or machine-specific paths are committed;
- report any browser/security limitation rather than hiding it.

## Recommended next task

Start by auditing **P0-04 through P0-07** against the current engine. The research identifies accurate Applied CSS/cascade reasoning as the largest technical differentiator and risk.
