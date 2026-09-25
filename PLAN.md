# StyleScan Ultra — plan and architecture

## Product goal

A free, local Chrome extension that delivers a strong CSS inspection and editing workflow inspired by CSS Scan and CSS Pro, implemented independently. Priority: useful output, fast interaction, clear provenance, and no remote service.

## Architecture

1. **Manifest V3 + activeTab.** The popup requests one-time injection through the service worker. The extension does not run in the background on every site.
2. **Extraction engine.** The engine combines matched CSSOM declarations with computed styles. It walks conditional rules and pseudo-elements, records provenance and warnings, and limits scanning to avoid freezing large pages.
3. **On-page inspector.** A Shadow DOM overlay avoids inheriting the site's CSS. Hover is throttled; a click pins an element. The UI exposes code, visual controls, DOM navigation, tokens, and change history.
4. **Local persistence.** Preferences use Chrome sync storage. Page edits remain local to the open document; CSS/JSON export lets the user save them.
5. **No backend.** The extension sends no page data to outside services. External integrations can be added later behind explicit opt-in.

## Release milestones

### 0.1 — usable Chrome extension

- Inspect on hover and click, pin, pause, DOM navigation, dimensions, guides.
- Show authored rules when readable, computed fallback, pseudo-elements, media conditions, source warnings.
- Copy CSS, sanitized HTML and a component; basic Tailwind conversion.
- Live code and visual edits, undo, change export.
- Popup, options, icons, local installation, smoke testing.

### 0.2.0 — cascade accuracy and editor reliability

- Cascade diagnostics for readable author rules, including specificity, source order, candidate/overridden/inactive/unknown status.
- Preserve in-progress edits during settings and viewport changes; validate CSS edits before recording them.
- Keep output honest when a visual edit removes an inline declaration.

### 0.2.x — deeper editing

- Better cascade diagnostics for browser origins, layer ordering, and active/inactive declarations.
- Dedicated `:hover`, `:focus`, and responsive editing controls.
- Richer visual editor for backgrounds, flex/grid, borders, shadows and transforms.
- Selective component export with less redundant CSS and stronger Shadow DOM handling.

### 0.3 — workflow

- Responsive viewport presets and comparison.
- Color palette/assets browser, contrast checks and persistent local snippets.
- Optional external export integrations and update channel.

## Practical limits

- A cross-origin stylesheet can deny CSSOM rule access. Computed style helps reproduce appearance but cannot reconstruct every authored unit, selector, condition or source file.
- Browser-internal pages and some embedded frames cannot be inspected with normal content-script permissions.
- A future optional DevTools-protocol mode could increase source accuracy, but `chrome.debugger` carries a prominent permission and browser debugging notice. It is excluded from the default build.

## Verification gates

- JavaScript parses and manifest validates.
- Engine fixture covers matched/computed/pseudo/media/fallback and HTML sanitation.
- Extension starts in Google Chrome for Testing, inspects a normal page, edits a property, copies output, and closes cleanly.
- Popup/options work on supported and restricted pages, and settings persist after reload.

## Primary references

- https://getcssscan.com/
- https://csspro.com/
- https://docs.csspro.com/editing/visual-editor
- https://developer.chrome.com/docs/extensions/reference/api/scripting
- https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet
