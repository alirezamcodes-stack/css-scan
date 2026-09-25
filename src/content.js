/* StyleScan Ultra's isolated, page-local interface. No page data leaves the tab. */
(() => {
  "use strict";

  if (window.__STYLESCAN_ULTRA_CONTENT__) return;
  const engine = window.StyleScanEngine;
  if (!engine) return;

  const DEFAULT_SETTINGS = Object.freeze({
    theme: "dark", showDimensions: true, showGuides: false,
    includePseudo: true, includeMedia: true, copyMode: "matched",
    autoCopy: false, maxDescendants: 120,
  });
  const VISUAL_GROUPS = [
    ["Size & layout", ["width", "height", "min-width", "max-width", "display", "opacity"]],
    ["Spacing", ["margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left", "gap"]],
    ["Typography", ["font-family", "font-size", "font-weight", "line-height", "letter-spacing", "color", "text-align"]],
    ["Surface", ["background-color", "background-image", "border", "border-radius", "box-shadow"]],
    ["Position & effects", ["position", "top", "right", "bottom", "left", "z-index", "transform", "filter"]],
    ["Flex", ["flex-direction", "flex-wrap", "justify-content", "align-items"]],
  ];
  const TAILWIND_PROPERTIES = [
    "display", "position", "width", "height", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "gap", "color", "background-color",
    "font-size", "font-weight", "line-height", "border-radius", "opacity", "box-shadow", "text-align", "justify-content", "align-items",
  ];

  const state = {
    active: false, paused: false, pinned: false, collapsed: false, side: "right", tab: "inspect",
    settings: { ...DEFAULT_SETTINGS }, mode: "matched", hover: null, selected: null, report: null,
    reportElement: null, cssDraft: "", changes: [], nextChangeId: 1, navElements: [], tokenValues: [],
    host: null, shadow: null, root: null, hoverTimer: 0, toastTimer: 0, resizeTimer: 0, visualStart: new Map(),
  };

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
  const $ = (selector) => state.shadow?.querySelector(selector);
  const $$ = (selector) => Array.from(state.shadow?.querySelectorAll(selector) || []);
  const currentElement = () => state.pinned ? state.selected : state.hover;
  const isOwnEvent = (event) => event.composedPath?.().includes(state.host) || event.target === state.host;
  const isEditable = (target) => target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || "");
  const isEditingInspector = () => state.shadow?.activeElement?.matches?.("input, textarea, select, [contenteditable='true']") || false;

  function labelFor(element) {
    if (!element) return "No element selected";
    const name = element.localName || element.tagName?.toLowerCase() || "element";
    const id = element.id ? `#${element.id}` : "";
    const classes = Array.from(element.classList || []).slice(0, 3).map((name) => `.${name}`).join("");
    return `${name}${id}${classes}`;
  }

  function settingsOptions(extra = {}) {
    return {
      mode: state.mode,
      includePseudo: state.settings.includePseudo,
      includeMedia: state.settings.includeMedia,
      maxDescendants: state.settings.maxDescendants,
      ...extra,
    };
  }

  function showToast(message, error = false) {
    const node = $(".ss-toast");
    if (!node) return;
    clearTimeout(state.toastTimer);
    node.textContent = message;
    node.classList.toggle("error", error);
    node.hidden = false;
    state.toastTimer = setTimeout(() => { node.hidden = true; }, 3300);
  }

  async function copyText(value) {
    const text = String(value ?? "");
    if (!text) throw new Error("Nothing to copy. Select an element first.");
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // The popup can send a command after the page has lost transient focus.
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      state.shadow.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) throw new Error("Clipboard access failed. Use the panel's copy button.");
    }
  }

  function componentText(element) {
    const result = engine.buildComponent(element, settingsOptions());
    if (result.warnings?.length) showToast(result.warnings[0]);
    return `${result.html}\n\n<style>\n${result.css}\n</style>`;
  }

  async function copySelection(kind) {
    const element = currentElement();
    if (!state.active || !element) return { ok: false, copied: false, error: "Select an element on the page first." };
    try {
      let value;
      if (kind === "component") value = componentText(element);
      else if (kind === "html") value = engine.serializeHtml(element, { maxDescendants: state.settings.maxDescendants });
      else if (kind === "tailwind") value = buildTailwind(element);
      else {
        const report = reportFor(element);
        value = state.tab === "inspect" && state.cssDraft ? state.cssDraft : engine.buildCss(report, settingsOptions());
      }
      await copyText(value);
      showToast(`${kind === "component" ? "Component" : kind.toUpperCase()} copied`);
      return { ok: true, copied: true, active: state.active, enabled: state.active };
    } catch (error) {
      const message = error?.message || "Copy failed.";
      showToast(message, true);
      return { ok: false, copied: false, error: message, active: state.active, enabled: state.active };
    }
  }

  function reportFor(element) {
    if (!element) return null;
    if (state.reportElement === element && state.report) return state.report;
    if (state.reportElement && state.reportElement !== element) state.cssDraft = "";
    state.report = engine.inspect(element);
    state.reportElement = element;
    return state.report;
  }

  function refreshReport() {
    state.report = null;
    state.reportElement = null;
    const element = currentElement();
    if (element) reportFor(element);
    render();
  }

  function updateOutline() {
    const element = state.pinned ? state.selected : (state.hover || state.selected);
    const outline = $(".ss-outline");
    const label = $(".ss-label");
    const guides = $(".ss-guides");
    if (!outline || !label || !guides) return;
    if (!state.active || !element?.isConnected) {
      outline.classList.remove("active");
      label.classList.remove("active");
      guides.classList.remove("active");
      return;
    }
    const rect = element.getBoundingClientRect();
    outline.style.left = `${rect.left}px`;
    outline.style.top = `${rect.top}px`;
    outline.style.width = `${rect.width}px`;
    outline.style.height = `${rect.height}px`;
    outline.classList.add("active");
    outline.classList.toggle("selected", state.pinned && element === state.selected);
    const dimensions = state.settings.showDimensions ? ` · ${Math.round(rect.width)} × ${Math.round(rect.height)}` : "";
    label.textContent = `${labelFor(element)}${dimensions}`;
    label.style.left = `${Math.max(4, Math.min(rect.left, innerWidth - 230))}px`;
    label.style.top = `${Math.max(4, rect.top > 28 ? rect.top - 25 : rect.bottom + 4)}px`;
    label.classList.add("active");
    guides.classList.toggle("active", Boolean(state.settings.showGuides));
    if (state.settings.showGuides) {
      $(".ss-guide.h").style.top = `${rect.top}px`;
      $(".ss-guide.v").style.left = `${rect.left}px`;
    }
  }

  function inspectHover() {
    state.hoverTimer = 0;
    if (!state.active || state.paused || state.pinned || !state.hover) return;
    try { reportFor(state.hover); render(); }
    catch (error) { showToast(error?.message || "Inspection failed", true); }
  }

  function onPointerMove(event) {
    if (!state.active || state.paused || isOwnEvent(event)) return;
    if (state.pinned) return;
    const element = engine.getElementAtPoint(event.clientX, event.clientY, { ignore: state.host });
    if (!element || element === state.host || state.host.contains(element) || element === state.hover) return;
    state.hover = element;
    updateOutline();
    if (!state.pinned) {
      clearTimeout(state.hoverTimer);
      state.hoverTimer = setTimeout(inspectHover, 110);
    }
  }

  function selectElement(element, pinned = true) {
    if (!element || element === state.host || state.host.contains(element)) return;
    state.selected = element;
    state.hover = element;
    state.pinned = pinned;
    state.paused = false;
    state.cssDraft = "";
    clearTimeout(state.hoverTimer);
    refreshReport();
    updateOutline();
  }

  function onPageClick(event) {
    if (!state.active || state.paused || isOwnEvent(event)) return;
    const element = engine.getElementAtPoint(event.clientX, event.clientY, { ignore: state.host });
    if (!element) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selectElement(element, true);
    if (state.settings.autoCopy) void copySelection("css");
  }

  function navigate(direction) {
    const element = currentElement();
    if (!element) return;
    const root = element.getRootNode?.();
    const parent = element.parentElement || (root?.host && root.host !== state.host ? root.host : null);
    const next = direction === "parent" ? parent
      : direction === "child" ? element.firstElementChild
        : direction === "previous" ? element.previousElementSibling : element.nextElementSibling;
    if (!next || next === state.host || state.host.contains(next)) return;
    selectElement(next, true);
    next.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  function onKeyDown(event) {
    if (!state.active || isOwnEvent(event) || isEditable(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape") {
      if (state.pinned) { state.pinned = false; state.selected = null; refreshReport(); }
      else setActive(false);
      event.preventDefault();
      return;
    }
    if (event.code === "Space" && state.hover) {
      selectElement(state.hover, true);
      event.preventDefault();
      return;
    }
    if (!currentElement()) return;
    const directions = { ArrowUp: "parent", ArrowDown: "child", ArrowLeft: "previous", ArrowRight: "next" };
    if (directions[event.key]) {
      navigate(directions[event.key]);
      event.preventDefault();
    }
  }

  function setActive(active) {
    state.active = Boolean(active);
    if (!state.active) {
      state.hover = null;
      state.selected = null;
      state.pinned = false;
      state.report = null;
      state.reportElement = null;
      clearTimeout(state.hoverTimer);
    }
    if (state.root) state.root.hidden = !state.active;
    render();
    updateOutline();
    return { ok: true, active: state.active, enabled: state.active };
  }

  function setSide() {
    const panel = $(".ss-panel");
    const toolbar = $(".ss-toolbar");
    if (!panel || !toolbar) return;
    if (innerWidth <= 700) {
      panel.style.left = ""; panel.style.right = "";
      toolbar.style.left = ""; toolbar.style.right = "";
    } else if (state.side === "left") {
      panel.style.left = "16px"; panel.style.right = "auto";
      toolbar.style.left = "16px"; toolbar.style.right = "auto";
    } else {
      panel.style.left = "auto"; panel.style.right = "16px";
      toolbar.style.left = "auto"; toolbar.style.right = "16px";
    }
  }

  function renderHeader() {
    const panel = $(".ss-panel");
    const element = currentElement();
    panel.hidden = !element;
    panel.classList.toggle("collapsed", state.collapsed);
    $(".ss-selector").textContent = element ? labelFor(element) : "Select an element";
    const subline = $(".ss-subline");
    subline.replaceChildren();
    if (element) {
      const report = state.report;
      const fragments = [
        state.pinned ? "Pinned" : "Live",
        report?.dimensions ? `${Math.round(report.dimensions.width)} × ${Math.round(report.dimensions.height)}` : "",
        report?.source?.stylesheetsBlocked ? `${report.source.stylesheetsBlocked} sheet${report.source.stylesheetsBlocked === 1 ? "" : "s"} blocked` : "",
      ].filter(Boolean);
      fragments.forEach((value, index) => {
        const span = document.createElement("span");
        span.className = `ss-pill ${index === 0 ? "good" : ""}`;
        span.textContent = value;
        subline.appendChild(span);
      });
    }
    $("[data-action='pause']").setAttribute("aria-pressed", String(state.paused));
    $("[data-action='guides']").setAttribute("aria-pressed", String(Boolean(state.settings.showGuides)));
    $("[data-action='pause']").textContent = state.paused ? "Resume" : "Pause";
    $("[data-action='collapse']").textContent = state.collapsed ? "+" : "−";
    $("[data-action='side']").title = state.side === "right" ? "Move panel left" : "Move panel right";
    $$(".ss-tab").forEach((tab) => {
      const selected = tab.dataset.tab === state.tab;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    const footer = $(".ss-footer");
    footer.firstElementChild.textContent = state.pinned ? "↑ parent · ↓ child · ←/→ siblings" : "Click to pin · Space to pin";
    footer.lastElementChild.textContent = reportSummary(state.report);
  }

  function reportSummary(report) {
    if (!report) return "Waiting for a page element";
    return `${report.matchedRules.length} matched · ${report.source.stylesheetsScanned} sheets`;
  }

  function cascadeSourceLabel(source = {}) {
    if (source.kind === "inline") return "Inline style";
    if (source.href) {
      try {
        const url = new URL(source.href, location.href);
        return `${url.hostname}/${url.pathname.split("/").filter(Boolean).pop() || ""}`;
      } catch { return source.href; }
    }
    return source.owner || "Stylesheet";
  }

  function renderCascade(report) {
    const rules = report.matchedRules || [];
    if (!rules.length) return `<details class="ss-cascade"><summary>Cascade diagnostics · no readable source rules</summary><p class="ss-note">The computed snapshot is still available above.</p></details>`;
    const counts = { candidate: 0, overridden: 0, inactive: 0, unknown: 0 };
    for (const rule of rules) {
      for (const declaration of rule.declarationList || []) {
        const status = declaration.cascade?.status;
        counts[Object.hasOwn(counts, status) ? status : "unknown"] += 1;
      }
    }
    const shown = rules.slice(-32).reverse();
    const cards = shown.map((rule) => {
      const specificity = Array.isArray(rule.specificity) ? rule.specificity.join(",") : "?";
      const conditions = (rule.conditions || []).map((item) => `@${item.kind} ${item.text}`).join(" · ");
      const declarations = (rule.declarationList || []).slice(0, 30).map((declaration) => {
        const status = declaration.cascade?.status;
        const safeStatus = Object.hasOwn(counts, status) ? status : "unknown";
        const reason = declaration.cascade?.reason || safeStatus;
        return `<div class="ss-cascade-decl ${safeStatus}" title="${escapeHtml(reason)}"><span class="ss-cascade-property">${escapeHtml(declaration.property)}: ${escapeHtml(declaration.value)}${declaration.important ? " !important" : ""};</span><span class="ss-cascade-status ${safeStatus}">${safeStatus}</span></div>`;
      }).join("");
      const omitted = (rule.declarationList?.length || 0) - 30;
      return `<div class="ss-cascade-rule"><div class="ss-cascade-selector">${escapeHtml(rule.matchedSelector || rule.selector)}</div><div class="ss-cascade-source">${escapeHtml(cascadeSourceLabel(rule.source))} · specificity ${escapeHtml(specificity)} · order ${escapeHtml(rule.source?.order ?? "?")}${conditions ? ` · ${escapeHtml(conditions)}` : ""}</div>${declarations}${omitted > 0 ? `<p class="ss-note">${omitted} more declarations in this rule.</p>` : ""}</div>`;
    }).join("");
    return `<details class="ss-cascade"><summary>Cascade diagnostics · ${counts.candidate} candidates · ${counts.overridden} overridden</summary><p class="ss-note">Candidates are strongest among readable author declarations. Browser origins, inaccessible stylesheets, and some conditional rules can change the final result.</p>${shown.length < rules.length ? `<p class="ss-note">Showing the latest ${shown.length} of ${rules.length} rules.</p>` : ""}${cards}</details>`;
  }

  function renderInspect(report) {
    const content = $(".ss-content");
    const code = state.cssDraft || engine.buildCss(report, settingsOptions());
    const warnings = report.warnings.slice(0, 3).map((warning) => `<div class="ss-warning">${escapeHtml(warning)}</div>`).join("");
    content.innerHTML = `
      <div class="ss-section-title"><span>Applied CSS</span><select class="ss-select" id="ss-mode" aria-label="CSS copy mode">
        <option value="matched" ${state.mode === "matched" ? "selected" : ""}>Matched source rules</option>
        <option value="computed" ${state.mode === "computed" ? "selected" : ""}>Computed snapshot</option>
      </select></div>
      <textarea class="ss-code" id="ss-code" spellcheck="false" aria-label="Editable CSS">${escapeHtml(code)}</textarea>
      <div class="ss-actions">
        <button class="primary" data-action="copy-css">Copy CSS</button>
        <button data-action="apply-css">Apply edit</button>
        <button data-action="copy-html">Copy HTML</button>
        <button data-action="copy-component">Copy component</button>
        <button data-action="copy-tailwind">Tailwind beta</button>
      </div>
      <p class="ss-note">Matched mode preserves readable authored values and conditions. Computed mode captures the current appearance. Edits apply only in this tab.</p>
      ${warnings}
      ${renderCascade(report)}`;
  }

  function boxModel(report) {
    const c = report.computed;
    const fmt = (prefix) => ["top", "right", "bottom", "left"].map((side) => c[`${prefix}-${side}`] || "0").join(" · ");
    return `<div class="ss-box"><span class="ss-box-name">Margin</span><span class="ss-box-values">${escapeHtml(fmt("margin"))}</span>
      <div class="ss-box border"><span class="ss-box-name">Border</span><span class="ss-box-values">${escapeHtml(c["border-width"] || "0")}</span>
        <div class="ss-box padding"><span class="ss-box-name">Padding</span><span class="ss-box-values">${escapeHtml(fmt("padding"))}</span>
          <div class="ss-box content">${escapeHtml(`${Math.round(report.dimensions.width)} × ${Math.round(report.dimensions.height)}`)}</div>
        </div>
      </div>
    </div>`;
  }

  function renderVisual(report) {
    const controls = VISUAL_GROUPS.map(([name, properties]) => `<section><h3 class="ss-section-title">${escapeHtml(name)}</h3><div class="ss-grid">${properties.map((property) => `
      <div class="ss-control"><label for="ss-field-${property}">${escapeHtml(property)}</label>
      <input id="ss-field-${property}" data-property="${escapeHtml(property)}" value="${escapeHtml(currentElement().style.getPropertyValue(property) || report.computed[property] || "")}" autocomplete="off" spellcheck="false"></div>`).join("")}</div></section>`).join("");
    const element = currentElement();
    const textField = element?.childElementCount === 0 ? `<div class="ss-control full"><label for="ss-text-edit">Text content</label><input id="ss-text-edit" data-text-edit="true" value="${escapeHtml(element.textContent || "")}"></div>` : "";
    $(".ss-content").innerHTML = `<h3 class="ss-section-title">Box model</h3>${boxModel(report)}<p class="ss-note">Edit any value to preview it immediately. Changes are kept in the Changes tab and can be undone.</p>${controls}<section><h3 class="ss-section-title">Content</h3><div class="ss-grid">${textField || '<p class="ss-note">Select a text-only element to edit its text.</p>'}</div></section>`;
  }

  function renderDom(element) {
    state.navElements = [];
    const add = (node, prefix) => {
      if (!node || node === state.host || state.host.contains(node)) return "";
      const index = state.navElements.push(node) - 1;
      const isCurrent = node === element;
      return `<button class="ss-dom-item ${isCurrent ? "current" : ""}" data-nav-index="${index}" title="Select ${escapeHtml(labelFor(node))}">${escapeHtml(prefix)}${escapeHtml(labelFor(node))}</button>`;
    };
    const ancestors = [];
    let node = element;
    for (let depth = 0; node && depth < 8; depth += 1) {
      ancestors.unshift(node);
      const root = node.getRootNode?.();
      node = node.parentElement || (root?.host && root.host !== state.host ? root.host : null);
    }
    const children = Array.from(element.children || []).filter((child) => child !== state.host).slice(0, 40);
    $(".ss-content").innerHTML = `<div class="ss-nav">
      <button data-nav="parent">↑ Parent</button><button data-nav="child">↓ Child</button>
      <button data-nav="previous">← Previous</button><button data-nav="next">Next →</button>
    </div><h3 class="ss-section-title">DOM path</h3><div class="ss-dom-list">${ancestors.map((item, index) => add(item, `${"  ".repeat(index)}↳ `)).join("")}</div>
    <h3 class="ss-section-title" style="margin-top:14px">Children</h3><div class="ss-dom-list">${children.length ? children.map((item) => add(item, "↳ ")).join("") : '<p class="ss-note">This element has no child elements.</p>'}</div>
    <div class="ss-actions"><button data-action="copy-selector">Copy selector</button><button data-action="hide-element">Hide element</button></div>`;
  }

  function collectTokens(element, report) {
    const colors = new Set();
    const fonts = new Set();
    const assets = new Set();
    const variables = new Map(Object.entries(report.cssVariables || {}));
    const rootStyle = getComputedStyle(document.documentElement);
    for (let index = 0; index < rootStyle.length; index += 1) {
      const property = rootStyle.item(index);
      if (property?.startsWith("--") && variables.size < 120) variables.set(property, rootStyle.getPropertyValue(property).trim());
    }
    const nodes = [element];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
    while (nodes.length < 100 && walker.nextNode()) {
      if (walker.currentNode !== state.host && !state.host.contains(walker.currentNode)) nodes.push(walker.currentNode);
    }
    for (const node of nodes) {
      const style = getComputedStyle(node);
      for (const property of ["color", "background-color", "border-top-color"]) {
        const value = style.getPropertyValue(property).trim();
        if (value && value !== "rgba(0, 0, 0, 0)" && value !== "transparent") colors.add(value);
      }
      const font = style.fontFamily?.trim();
      if (font) fonts.add(font);
      if (node.localName === "img" && node.currentSrc) assets.add(node.currentSrc);
      const image = style.backgroundImage || "";
      for (const match of image.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        try { assets.add(new URL(match[1], document.baseURI).href); } catch { /* malformed URL */ }
      }
    }
    return { colors: [...colors].slice(0, 80), fonts: [...fonts].slice(0, 50), variables: [...variables].slice(0, 120), assets: [...assets].slice(0, 80) };
  }

  function renderTokens(element, report) {
    const tokens = collectTokens(element, report);
    state.tokenValues = [];
    const row = (label, value, color = false) => {
      const index = state.tokenValues.push(String(value)) - 1;
      return `<div class="ss-token">${color ? `<span class="ss-swatch" data-swatch="${index}"></span>` : ""}<span class="ss-token-name" title="${escapeHtml(label)}">${escapeHtml(label)}</span><span class="ss-token-value" title="${escapeHtml(value)}">${escapeHtml(value)}</span><button data-token-index="${index}">Copy</button></div>`;
    };
    const group = (title, entries) => `<section><h3 class="ss-section-title">${escapeHtml(title)} <span>${entries.length}</span></h3><div class="ss-token-list">${entries.length ? entries.join("") : '<p class="ss-note">None found in the inspected subtree.</p>'}</div></section>`;
    $(".ss-content").innerHTML = `${group("Colors", tokens.colors.map((value) => row("Color", value, true)))}${group("Fonts", tokens.fonts.map((value) => row("Font family", value)))}${group("CSS variables", tokens.variables.map(([name, value]) => row(name, value)))}${group("Assets", tokens.assets.map((value) => row("Asset URL", value)))}`;
    $$("[data-swatch]").forEach((swatch) => {
      const value = state.tokenValues[Number(swatch.dataset.swatch)];
      if (CSS.supports("color", value)) swatch.style.backgroundColor = value;
    });
  }

  function changeDescription(change) {
    if (change.type === "css") return `CSS edit · ${change.selector}`;
    if (change.type === "text") return `Text · ${change.selector}`;
    return `${change.property}: ${change.previous || "(unset)"} → ${change.value || "(unset)"}`;
  }

  function renderChanges() {
    const items = state.changes.slice().reverse().map((change) => `<div class="ss-history-item"><div>${escapeHtml(changeDescription(change))}</div><div class="ss-history-time">${escapeHtml(new Date(change.createdAt).toLocaleTimeString())}</div></div>`).join("");
    $(".ss-content").innerHTML = `<div class="ss-actions"><button data-action="undo" ${state.changes.length ? "" : "disabled"}>Undo last</button><button data-action="export-css" ${state.changes.length ? "" : "disabled"}>Export CSS</button><button data-action="export-json" ${state.changes.length ? "" : "disabled"}>Export JSON</button></div>
    <p class="ss-note">Changes affect only this tab. Export them before reloading the page.</p><div class="ss-history">${items || '<p class="ss-empty">No edits yet.</p>'}</div>`;
  }

  function render() {
    if (!state.root || !state.active) return;
    const element = currentElement();
    if (element && !element.isConnected) {
      if (state.pinned) { state.selected = null; state.pinned = false; }
      if (state.hover === element) state.hover = null;
    }
    const target = currentElement();
    if (target && !state.report) {
      try { reportFor(target); } catch (error) { showToast(error?.message || "Inspection failed", true); }
    }
    renderHeader();
    if (!target || !state.report) return;
    if (state.tab === "inspect") renderInspect(state.report);
    else if (state.tab === "visual") renderVisual(state.report);
    else if (state.tab === "dom") renderDom(target);
    else if (state.tab === "tokens") renderTokens(target, state.report);
    else renderChanges();
    setSide();
  }

  function addChange(change) {
    state.changes.push({ id: state.nextChangeId++, createdAt: Date.now(), ...change });
    if (state.changes.length > 250) state.changes.shift();
  }

  function hasCssDeclarations(rules) {
    if (!rules) return false;
    for (const rule of rules) {
      if (rule.style?.length) return true;
      let nested;
      try { nested = rule.cssRules; } catch { nested = null; }
      if (hasCssDeclarations(nested)) return true;
    }
    return false;
  }

  function applyCss() {
    const element = currentElement();
    const textarea = $("#ss-code");
    if (!element || !textarea) return;
    const css = textarea.value.trim();
    if (!css) return showToast("Enter CSS before applying.", true);
    const root = element.getRootNode?.();
    const scope = root instanceof ShadowRoot ? root : document;
    let sheet = null;
    let style = null;
    try {
      // Constructed sheets work on CSP-protected pages. A regular style node
      // remains the fallback for CSS that replaceSync cannot parse.
      if (typeof CSSStyleSheet === "function" && Array.isArray(scope.adoptedStyleSheets)) {
        try {
          sheet = new CSSStyleSheet();
          sheet.replaceSync(css);
          scope.adoptedStyleSheets = [...scope.adoptedStyleSheets, sheet];
        } catch { sheet = null; }
      }
      if (!sheet) {
        style = document.createElement("style");
        style.setAttribute("data-stylescan-edit", "");
        style.textContent = css;
        (scope instanceof ShadowRoot ? scope : document.head || document.documentElement).appendChild(style);
      }
      if (!hasCssDeclarations(sheet?.cssRules || style?.sheet?.cssRules)) {
        throw new Error("Enter a valid CSS rule with at least one declaration.");
      }
      addChange({ type: "css", selector: engine.getUniqueSelector(element), css, node: style, sheet, scope, element });
      state.cssDraft = css;
      showToast("CSS edit applied. Undo from Changes.");
      updateOutline();
    } catch (error) {
      style?.remove();
      if (sheet) scope.adoptedStyleSheets = scope.adoptedStyleSheets.filter((item) => item !== sheet);
      showToast(error?.message || "CSS could not be applied.", true);
    }
  }

  function beginVisualEdit(input) {
    const element = currentElement();
    if (!element) return;
    const property = input.dataset.property;
    const key = property || "__text__";
    if (state.visualStart.has(key)) return;
    state.visualStart.set(key, property ? {
      value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property), element,
    } : { value: element.textContent || "", element });
  }

  function applyVisualInput(input) {
    const element = currentElement();
    if (!element) return;
    beginVisualEdit(input);
    if (input.dataset.textEdit) {
      if (element.childElementCount === 0) element.textContent = input.value;
      return;
    }
    const property = input.dataset.property;
    if (!property) return;
    const value = input.value.trim();
    if (value && !CSS.supports(property, value)) {
      input.setAttribute("aria-invalid", "true");
      return;
    }
    input.removeAttribute("aria-invalid");
    if (value) element.style.setProperty(property, value);
    else element.style.removeProperty(property);
    updateOutline();
  }

  function commitVisualInput(input) {
    const property = input.dataset.property;
    const key = property || "__text__";
    const start = state.visualStart.get(key);
    state.visualStart.delete(key);
    if (!start) return;
    const element = start.element;
    const value = property ? element.style.getPropertyValue(property) : element.textContent || "";
    if (value !== start.value) {
      addChange({ type: property ? "style" : "text", selector: engine.getUniqueSelector(element), element,
        property, previous: start.value, previousPriority: start.priority || "", value });
      showToast("Change applied");
    }
    state.report = null;
    state.reportElement = null;
    if (state.tab === "visual") {
      // Refresh the box model without replacing the focused control.
      const report = reportFor(currentElement());
      const box = $(".ss-box");
      if (box) box.outerHTML = boxModel(report);
      renderHeader();
    }
  }

  function undoLast() {
    const change = state.changes.pop();
    if (!change) return showToast("Nothing to undo.");
    if (change.type === "css") {
      change.node?.remove();
      if (change.sheet && change.scope) {
        change.scope.adoptedStyleSheets = change.scope.adoptedStyleSheets.filter((item) => item !== change.sheet);
      }
    }
    else if (change.type === "text") {
      if (change.element?.isConnected) change.element.textContent = change.previous;
    } else if (change.element?.isConnected) {
      if (change.previous) change.element.style.setProperty(change.property, change.previous, change.previousPriority);
      else change.element.style.removeProperty(change.property);
    }
    state.cssDraft = "";
    refreshReport();
    updateOutline();
    showToast("Last change undone");
  }

  function cssForChanges() {
    const blocks = [];
    const styles = new Map();
    for (const change of state.changes) {
      if (change.type === "css") blocks.push(change.css);
      if (change.type === "style") {
        const selector = change.selector || ".selected-element";
        if (!styles.has(selector)) styles.set(selector, new Map());
        styles.get(selector).set(change.property, change);
      }
    }
    for (const [selector, declarations] of styles) {
      const removed = [...declarations].filter(([, change]) => !change.value).map(([property]) => property);
      if (removed.length) blocks.push(`/* Remove inline ${removed.join(", ")} from ${selector.replace(/\*\//g, "* /")}. */`);
      const lines = [...declarations].filter(([, change]) => change.value).map(([property, change]) => `  ${property}: ${change.value};`);
      if (lines.length) blocks.push(`${selector} {\n${lines.join("\n")}\n}`);
    }
    return blocks.join("\n\n");
  }

  function downloadText(filename, value, mime) {
    const url = URL.createObjectURL(new Blob([value], { type: mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    state.shadow.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    showToast(`${filename} downloaded`);
  }

  function buildTailwind(element) {
    const computed = reportFor(element).computed;
    const classes = [];
    const named = { display: { flex: "flex", grid: "grid", block: "block", inline: "inline", "inline-block": "inline-block", none: "hidden" }, position: { absolute: "absolute", relative: "relative", fixed: "fixed", sticky: "sticky" }, "text-align": { center: "text-center", left: "text-left", right: "text-right", justify: "text-justify" } };
    for (const property of TAILWIND_PROPERTIES) {
      const value = computed[property]?.trim();
      if (!value || value === "normal" || value === "auto" || value === "none") continue;
      const standard = named[property]?.[value];
      if (standard) { classes.push(standard); continue; }
      // Tailwind arbitrary-property syntax covers values without needing a
      // version-specific spacing or palette table. Complex values are skipped.
      if (/^[\w\s.,#%()+\-\/]+$/.test(value) && !/[\[\]"']/.test(value)) {
        classes.push(`[${property}:${value.replace(/\s+/g, "_")}]`);
      }
    }
    showToast("Tailwind beta captures this element at the current viewport.");
    return classes.join(" ");
  }

  function onUiClick(event) {
    const button = event.target.closest?.("button");
    if (!button) return;
    const action = button.dataset.action;
    if (button.dataset.tab) {
      state.tab = button.dataset.tab;
      render();
      return;
    }
    if (button.dataset.nav) return navigate(button.dataset.nav);
    if (button.dataset.navIndex !== undefined) return selectElement(state.navElements[Number(button.dataset.navIndex)], true);
    if (button.dataset.tokenIndex !== undefined) {
      void copyText(state.tokenValues[Number(button.dataset.tokenIndex)]).then(() => showToast("Token copied"), (error) => showToast(error.message, true));
      return;
    }
    if (action === "pause") { state.paused = !state.paused; render(); showToast(state.paused ? "Hover paused" : "Hover resumed"); }
    else if (action === "guides") {
      state.settings.showGuides = !state.settings.showGuides;
      chrome.storage.sync.set({ stylescanSettings: state.settings });
      updateOutline(); renderHeader();
    }
    else if (action === "side") { state.side = state.side === "right" ? "left" : "right"; setSide(); renderHeader(); }
    else if (action === "close") setActive(false);
    else if (action === "collapse") { state.collapsed = !state.collapsed; renderHeader(); }
    else if (action === "refresh") { refreshReport(); updateOutline(); showToast("Inspection refreshed"); }
    else if (action === "pin") { state.pinned = !state.pinned; if (state.pinned) state.selected = state.hover; refreshReport(); }
    else if (action === "copy-css") { state.cssDraft = $("#ss-code")?.value || ""; void copySelection("css"); }
    else if (action === "copy-html") void copySelection("html");
    else if (action === "copy-component") void copySelection("component");
    else if (action === "copy-tailwind") void copySelection("tailwind");
    else if (action === "apply-css") applyCss();
    else if (action === "copy-selector") void copyText(engine.getUniqueSelector(currentElement())).then(() => showToast("Selector copied"), (error) => showToast(error.message, true));
    else if (action === "hide-element") {
      const element = currentElement();
      const previous = element.style.getPropertyValue("display");
      const previousPriority = element.style.getPropertyPriority("display");
      element.style.setProperty("display", "none", "important");
      addChange({ type: "style", selector: engine.getUniqueSelector(element), element, property: "display", previous, previousPriority, value: "none" });
      showToast("Element hidden. Undo from Changes.");
      refreshReport();
    }
    else if (action === "undo") undoLast();
    else if (action === "export-css") downloadText("stylescan-changes.css", cssForChanges(), "text/css");
    else if (action === "export-json") downloadText("stylescan-changes.json", JSON.stringify({
      version: 1, page: location.href, exportedAt: new Date().toISOString(),
      changes: state.changes.map(({ element, node, sheet, scope, ...data }) => data),
    }, null, 2), "application/json");
  }

  function onUiChange(event) {
    const input = event.target;
    if (input.id === "ss-mode") {
      state.mode = input.value === "computed" ? "computed" : "matched";
      state.cssDraft = "";
      render();
    } else if (input.dataset.property || input.dataset.textEdit) commitVisualInput(input);
  }

  function onUiInput(event) {
    const input = event.target;
    if (input.id === "ss-code") state.cssDraft = input.value;
    else if (input.dataset.property || input.dataset.textEdit) applyVisualInput(input);
  }

  function mount() {
    if (state.host) return;
    const host = document.createElement("div");
    host.id = "stylescan-ultra-root";
    host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    const shadow = host.attachShadow({ mode: "open" });
    state.host = host;
    state.shadow = shadow;
    const style = document.createElement("style");
    shadow.appendChild(style);
    const root = document.createElement("div");
    root.className = "ss-root";
    root.hidden = true;
    root.innerHTML = `
      <div class="ss-outline"></div><div class="ss-label"></div>
      <div class="ss-guides"><div class="ss-guide h"></div><div class="ss-guide v"></div></div>
      <div class="ss-toolbar" role="toolbar" aria-label="StyleScan toolbar">
        <span class="ss-brand"><span class="ss-brand-mark">S</span>StyleScan <span class="ss-pill good">ULTRA</span></span>
        <button data-action="pause" aria-pressed="false" title="Pause hover inspection">Pause</button>
        <button data-action="guides" aria-pressed="false" title="Show alignment guides">Guides</button>
        <button data-action="side" title="Move panel left">⇄</button>
        <button data-action="close" title="Close inspector" aria-label="Close inspector">×</button>
      </div>
      <section class="ss-panel" hidden aria-label="StyleScan inspector">
        <div class="ss-panel-header"><div class="ss-identity"><div class="ss-selector"></div><div class="ss-subline"></div></div>
          <div class="ss-header-actions"><button data-action="pin" title="Pin or unpin element">⌖</button><button data-action="refresh" title="Refresh CSS inspection">↻</button><button data-action="collapse" title="Collapse panel">−</button></div>
        </div>
        <div class="ss-tabs" role="tablist" aria-label="Inspector sections">
          <button class="ss-tab active" data-tab="inspect" role="tab">Inspect</button>
          <button class="ss-tab" data-tab="visual" role="tab">Visual</button>
          <button class="ss-tab" data-tab="dom" role="tab">DOM</button>
          <button class="ss-tab" data-tab="tokens" role="tab">Tokens</button>
          <button class="ss-tab" data-tab="changes" role="tab">Changes</button>
        </div>
        <div class="ss-content"></div>
        <div class="ss-footer"><span></span><span></span></div>
      </section>
      <div class="ss-toast" role="status" aria-live="polite" hidden></div>`;
    shadow.appendChild(root);
    state.root = root;
    shadow.addEventListener("click", onUiClick);
    shadow.addEventListener("change", onUiChange);
    shadow.addEventListener("input", onUiInput);
    shadow.addEventListener("focusin", (event) => {
      if (isEditable(event.target) && currentElement() && !state.pinned) {
        state.selected = currentElement();
        state.pinned = true;
        updateOutline();
        renderHeader();
      }
      if (event.target.dataset.property || event.target.dataset.textEdit) beginVisualEdit(event.target);
    });
    document.documentElement.appendChild(host);
    setSide();
    fetch(chrome.runtime.getURL("src/overlay.css"))
      .then((response) => { if (!response.ok) throw new Error("Overlay stylesheet unavailable"); return response.text(); })
      .then((css) => { style.textContent = css; })
      .catch(() => { style.textContent = ":host{all:initial}.ss-root{position:fixed;inset:0;z-index:2147483647;pointer-events:none}.ss-toolbar,.ss-panel{pointer-events:auto;position:fixed;right:16px;background:#111;color:#fff;padding:12px}.ss-panel{top:60px;width:400px;max-height:80vh;overflow:auto}.ss-toolbar{top:12px}"; });
  }

  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("click", onPageClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  addEventListener("scroll", updateOutline, true);
  addEventListener("resize", () => {
    updateOutline(); setSide();
    clearTimeout(state.resizeTimer);
    state.resizeTimer = setTimeout(() => { if (state.active && currentElement() && !isEditingInspector()) refreshReport(); }, 150);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = message?.type;
    if (type === "STYLSCAN_GET_STATE") { sendResponse({ ok: true, active: state.active, enabled: state.active }); return false; }
    if (type === "STYLSCAN_TOGGLE") { sendResponse(setActive(!state.active)); return false; }
    if (type === "STYLSCAN_COPY_CSS" || type === "STYLSCAN_COPY_COMPONENT") {
      void copySelection(type === "STYLSCAN_COPY_CSS" ? "css" : "component").then(sendResponse);
      return true;
    }
    return false;
  });

  window.__STYLESCAN_ULTRA_CONTENT__ = Object.freeze({ getState: () => ({ active: state.active }), toggle: () => setActive(!state.active) });
  mount();
  chrome.storage.sync.get("stylescanSettings").then((data) => {
    state.settings = { ...DEFAULT_SETTINGS, ...(data?.stylescanSettings || {}) };
    state.mode = state.settings.copyMode === "computed" ? "computed" : "matched";
    state.host.dataset.theme = state.settings.theme === "light" ? "light" : "dark";
    updateOutline();
    render();
  }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.stylescanSettings) return;
    state.settings = { ...DEFAULT_SETTINGS, ...(changes.stylescanSettings.newValue || {}) };
    state.mode = state.settings.copyMode === "computed" ? "computed" : "matched";
    state.host.dataset.theme = state.settings.theme === "light" ? "light" : "dark";
    updateOutline();
    render();
  });
})();
