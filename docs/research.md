# StyleScan Ultra — Research Baseline

Source: the 28-page market, open-source, architecture, security, testing, licensing, and implementation research dated 2026-09-25.

This file contains only findings that are useful to implementation. It replaces the earlier provisional research notes.

## Product direction

Do not build a pixel-for-pixel clone of CSS Scan, CSS Peeper, or CSS Pro. Build an independent, free, local-first CSS inspector with this core workflow:

**hover → inspect → understand → copy**

The strongest positioning from the research is:

> Free, local-first CSS Inspector for developers and designers — applied rules, computed styles, selectors, design tokens and accessibility in one lightweight Chrome extension.

The product should combine:
- CSS Scan's fast applied-CSS workflow;
- CSS Peeper's grouped design-system information;
- a limited, deliberate subset of CSS Pro's editing workflow.

Do not make a full DevTools replacement the MVP.

## Competitive findings

### CSS Peeper
Strongest reference for designer-oriented information architecture:
- colors and semantic color groups;
- typography hierarchy/instances;
- assets;
- contrast;
- design-system inventory.

### CSS Scan
Strongest reference for the core interaction:
- hover to inspect;
- applied/source-like CSS rather than only computed CSS;
- one-click copy;
- original units where available;
- pseudo-classes/elements and media-query context;
- pinning, keyboard DOM navigation, live editing;
- component export.

### CSS Pro
Best treated as a later roadmap reference:
- visual editing;
- DOM navigation and manipulation;
- responsive mode;
- fonts/assets/colors/background tools;
- pseudo-state editing;
- change workflow;
- optional sharing/AI.

## Open-source references and licensing

### High-value references
- `painty/CSS-Used-ChromeExt` — MIT. Strongest reference for CSS rule collection/filtering and recursive rule traversal.
- `ankit/stylebot` — MIT. Strong reference for editing UX, persistence, state, testing, and release practices.
- `GoogleChromeLabs/ProjectVisBug` — Apache-2.0. Strong reference for in-page interaction, overlays, visual tools, and Shadow DOM awareness. Archived; do not inherit its old build stack wholesale.
- `node-projects/ProjectVisBug2` — Apache-2.0. Newer but immature; evaluate selectively.
- `preranah7/DevInspect` — MIT. Small modern reference for hover inspection, selector/accessibility/layout modules. Its selector generation and direct page UI insertion are not production-grade patterns to copy unchanged.
- `2019-02-18/SnapCSS` — MIT. Useful mainly as a modern WXT/TypeScript packaging reference; project maturity is low.

### Do not copy code from
- `kdzwinel/SnappySnippet` — README states GPL-3.0-or-later. Product ideas are useful, but direct code reuse creates licensing risk for an MIT/Apache-style project.
- CSS Peeper, CSS Scan, CSS Pro — proprietary. Do not copy code, assets, branding, text, or pixel-identical UI.

If third-party code is actually copied or substantially adapted, preserve the applicable license notices and document provenance. Prefer independent implementation of concepts where practical.

## Target architecture

Preferred long-term stack from the research:
- Manifest V3;
- TypeScript;
- WXT or a small Vite/CRXJS build;
- framework-independent picker/CSS engine;
- small UI layer only if useful;
- Shadow Root for inspector UI.

Recommended module boundaries:

```text
src/
  entrypoints/
    background.ts
    content.ts
    popup/
  inspector/
    controller.ts
    picker.ts
    overlay.ts
    selection.ts
    shadow-path.ts
    frame-context.ts
  css/
    stylesheets.ts
    collect-rules.ts
    match-rules.ts
    cascade.ts
    specificity.ts
    computed.ts
    diff.ts
    serialize.ts
    pseudo.ts
  export/
    css.ts
    json.ts
    component.ts
  accessibility/
    contrast.ts
    accessible-name.ts
    audit.ts
  ui/
    panel/
    components/
    keyboard.ts
  shared/
    messages.ts
    types.ts
    settings.ts
    constants.ts
tests/
  unit/
  fixtures/
  e2e/
```

This is a target architecture, not an instruction to rewrite the current repository immediately. Refactor incrementally when a roadmap task benefits from it.

## Permissions and privacy

Default mode should stay minimal:
- `activeTab`;
- `scripting`;
- `storage`;
- only other permissions that are demonstrably required.

Avoid permanent `<all_urls>` for the core inspector. Do not add `debugger` to the default build merely for deeper inspection. A future Advanced CDP mode may use `chrome.debugger`, but it has materially higher trust/store costs and should be an explicit product decision.

Local-first requirements:
- no silent DOM/CSS uploads;
- do not collect password/form values;
- do not sell browsing activity;
- no remote executable JavaScript/WASM;
- no `eval()` or `new Function()`;
- do not assign page-controlled strings to unsafe `innerHTML`;
- sanitize component export;
- keep external/AI functionality opt-in if ever added.

## CSS engine requirements

### Applied/Authored and Computed must be separate

**Applied/Authored CSS** should preserve, when readable:
- selector;
- authored declaration/value;
- `!important`;
- source order;
- source/provenance;
- media/supports/container/layer context;
- original units.

**Computed CSS** should come from `getComputedStyle()` and represent resolved browser values.

Never call computed values “original CSS”.

### Stylesheet indexing

Do not rescan all stylesheets on every pointer event. Index stylesheets/rules on activation and cache rule metadata. Traverse nested rules recursively. Account for relevant rule families such as media/supports/container/layer and retain context.

Inaccessible/cross-origin stylesheets must not abort inspection. Mark them unavailable/cross-origin and fall back to computed information where possible. Never invent unavailable authored selectors, values, units, or source locations.

### Specificity

Do not use regex-only specificity calculation. Selectors Level 4 has special behavior including:
- `:is()`;
- `:not()`;
- `:has()`;
- `:where()`;
- `:nth-child(... of S)`.

Use a parser and model specificity as a three-part tuple. Escape generated identifiers with `CSS.escape()`.

### Cascade

Specificity alone is insufficient. The model should account for, at minimum:
- origin/importance;
- cascade layers where supported;
- active/inactive conditions;
- specificity;
- source order;
- inline styles;
- shorthand/longhand interactions where relevant.

UI states should be conservative, e.g.:
- APPLIED;
- OVERRIDDEN;
- INACTIVE CONDITION;
- INLINE;
- COMPUTED;
- UNKNOWN when the engine cannot prove the outcome.

Prefer `UNKNOWN` to a false claim of exactness.

### Pseudo elements and states

`getComputedStyle(element, "::before")` and `::after` can provide computed pseudo-element values. Authored pseudo selectors should be preserved during parsing.

Forced `:hover`/`:focus`/`:active` behavior is a later advanced problem. Do not implement it with misleading inline-style hacks. A controlled generated-rule layer is appropriate for normal editing; a future CDP mode can provide deeper browser-state control.

## Picker and performance

Pointer movement must stay on a fast path:
- use `pointermove`;
- gate work with `requestAnimationFrame`;
- cache the last target;
- call `getBoundingClientRect()` at most as needed per target/frame;
- update highlight/mini-tooltip first;
- defer expensive rule analysis.

Performance strategy:
- index stylesheets once;
- invalidate caches selectively when dynamic styles change;
- consider `MutationObserver` for targeted invalidation;
- cache element analysis with `WeakMap<Element, AnalysisResult>`;
- update only the active/pinned overlay on scroll/resize;
- avoid expensive export work until the user explicitly exports;
- benchmark large DOM/rule fixtures.

## Selector generation and Shadow DOM

A production selector generator must verify uniqueness. Candidate priority should roughly be:
1. unique stable ID;
2. stable attributes such as `data-testid`;
3. useful class combinations;
4. tag + class;
5. `:nth-of-type()` fallback.

Dynamically generated/hash-like classes should receive a lower stability score.

Do not invent a CSS selector that pretends to cross a Shadow DOM boundary. Represent open Shadow DOM traversal as a root-by-root selector path. Closed/inaccessible roots must be reported as limited rather than fully supported.

## Editing and history

All edits should use a reversible state model:
- previous value;
- requested value;
- accepted value;
- removal state;
- source/target context where needed.

Undo/reset/export must agree with actual page state. Invalid CSS must not be recorded as a successful mutation.

Pseudo-state/responsive edits that cannot be represented correctly as inline styles should use a controlled generated stylesheet/rule layer.

## Export

Component export is inherently lossy and must be described honestly. It may reproduce appearance without reconstructing original selectors, variables, inheritance, conditions, or authoring structure.

Default component export must not include:
- `input.value`;
- `textarea.value`;
- password values;
- cookies;
- local/session storage;
- authorization headers;
- page scripts;
- inline event handlers such as `onclick`/`onerror`.

Prefer sanitized structure, required attributes/classes, CSS, and explicit provenance/limitations.

## Accessibility

MVP should include useful element-level accessibility information, especially contrast, but must not claim full WCAG conformance from automated checks.

The research uses WCAG 2.2 as the baseline:
- normal text AA contrast: generally 4.5:1;
- large text AA contrast: generally 3:1;
- extension UI should support keyboard operation, visible focus, sensible focus order, zoom, and reduced motion;
- automated results should be presented as findings requiring possible manual review.

## Testing baseline

Unit coverage should include:
- selectors: IDs, classes, special characters, hash-like classes, `:nth-of-type`, SVG;
- specificity: IDs, attributes, pseudo selectors, `:is`, `:where`, `:not`, `:has`, `:nth-child(... of ...)`;
- matching/cascade: `!important`, source order, media, supports, inline;
- computed diff: added/changed/removed;
- serialization: custom properties, URLs, quotes, escaping;
- contrast including alpha/background composition;
- export sanitization;
- normal and open Shadow Roots;
- invalid selectors, inaccessible stylesheets, removed nodes.

E2E fixture targets:
```text
basic.html
specificity.html
media-queries.html
container-queries.html
css-variables.html
pseudo-elements.html
pseudo-states.html
inline-important.html
huge-dom.html
many-rules.html
iframe-same-origin.html
iframe-cross-origin.html
shadow-open.html
shadow-closed.html
adopted-stylesheets.html
svg.html
hostile-page-css.html
```

Long-term CI target:
```text
install
→ license/provenance check
→ format/lint
→ typecheck
→ unit tests
→ extension build
→ browser E2E
→ dist security scan
→ package ZIP
→ artifact/checksum
```

## Chrome Web Store readiness

Before store submission, verify:
- Manifest V3;
- minimal permissions;
- narrow single purpose;
- no remote executable code;
- no debug logging of page content;
- privacy policy;
- license and third-party notices;
- screenshots/listing assets;
- clean-install and upgrade testing;
- Chrome Stable testing;
- large/complex-page testing;
- reproducible release ZIP and checksum.

Suggested single-purpose description from the research:

> Inspect, understand and export the CSS and visual properties of elements on the webpage explicitly selected by the user.

## Implementation order

Keep this order unless repository evidence justifies changing it:

**Picker → Applied CSS → Computed CSS → Selector/Specificity → Copy → Accessibility → Export → Design-system analysis → Visual editing → optional CDP/AI**

The highest-risk technical area is accurate Applied CSS/cascade reasoning, not the overlay.
