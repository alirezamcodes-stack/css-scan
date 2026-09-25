"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const engineSource = fs.readFileSync(path.resolve(__dirname, "../src/engine.js"), "utf8");

function declaration(values = {}) {
  const names = Object.keys(values);
  const entry = (name) => {
    const item = values[name];
    return typeof item === "string" ? { value: item, important: false } : item;
  };
  return {
    length: names.length,
    item: (index) => names[index] || "",
    getPropertyValue: (name) => entry(name)?.value || "",
    getPropertyPriority: (name) => entry(name)?.important ? "important" : "",
    cssText: names.map((name) => `${name}: ${entry(name).value};`).join(" "),
  };
}

function textNode(value) {
  return { nodeType: 3, nodeValue: value };
}

function elementNode(tag, attributes = {}, children = []) {
  const node = {
    nodeType: 1,
    localName: tag,
    tagName: tag.toUpperCase(),
    id: attributes.id || "",
    classList: (attributes.class || "").split(/\s+/).filter(Boolean),
    attributes: Object.entries(attributes).map(([name, value]) => ({ name, value })),
    childNodes: children,
    parentNode: null,
    parentElement: null,
    previousElementSibling: null,
    style: declaration(),
    clientWidth: 120,
    clientHeight: 36,
    offsetWidth: 120,
    offsetHeight: 36,
    scrollWidth: 120,
    scrollHeight: 36,
    getAttribute(name) {
      return this.attributes.find((attribute) => attribute.name === name)?.value ?? null;
    },
    getRootNode() { return this.ownerDocument; },
    getBoundingClientRect() {
      return { x: 10, y: 20, top: 20, right: 130, bottom: 56, left: 10, width: 120, height: 36 };
    },
    matches(selector) {
      const value = selector.trim();
      return value === "*" || value === this.localName ||
        (this.id && value === `#${this.id}`) ||
        (value.startsWith(".") && this.classList.includes(value.slice(1)));
    },
  };
  let previous = null;
  for (const child of children) {
    child.parentNode = node;
    if (child.nodeType === 1) {
      child.parentElement = node;
      child.previousElementSibling = previous;
      previous = child;
    }
  }
  return node;
}

function cssRule(selectorText, values) {
  const style = declaration(values);
  return {
    type: 1,
    selectorText,
    style,
    cssText: `${selectorText} { ${style.cssText} }`,
  };
}

function fixture({ accessible = true, blocked = true, mediaMatches = true } = {}) {
  const span = elementNode("span", {}, [textNode("Buy now")]);
  const anchor = elementNode("a", {
    href: "javascript:alert(1)",
    onclick: "alert(2)",
  }, [textNode("Details")]);
  const input = elementNode("input", { type: "password", value: "secret-token", checked: "" });
  const script = elementNode("script", { type: "application/json" }, [textNode("secret-script")]);
  const frame = elementNode("iframe", { srcdoc: "<script>alert(1)</script>" });
  const target = elementNode("button", {
    id: "target",
    class: "primary",
    onclick: "alert(3)",
    style: "background-color: blue;",
  }, [span, anchor, input, script, frame]);

  const authored = cssRule("#target", {
    padding: { value: "1.5rem", important: true },
    "background-color": "var(--brand)",
    "row-gap": "",
  });
  const media = {
    type: 4,
    conditionText: "(min-width: 600px)",
    cssRules: [cssRule("#target", { width: "50vw" })],
  };
  const pseudo = cssRule("#target::before", { content: '"x"', color: "red" });
  const sheets = [];
  if (accessible) {
    sheets.push({
      href: null,
      ownerNode: { localName: "style", id: "" },
      media: { mediaText: "" },
      cssRules: [authored, media, pseudo],
    });
  }
  if (blocked) {
    const crossOrigin = {
      href: "https://cdn.example.test/theme.css",
      ownerNode: { localName: "link", id: "" },
      media: { mediaText: "" },
    };
    Object.defineProperty(crossOrigin, "cssRules", {
      get() {
        const error = new Error("CSSOM access denied");
        error.name = "SecurityError";
        throw error;
      },
    });
    sheets.push(crossOrigin);
  }

  const document = {
    nodeType: 9,
    styleSheets: sheets,
    adoptedStyleSheets: [],
    location: { href: "https://example.test/product" },
    querySelectorAll: (selector) => selector === "#target" ? [target] : [],
    elementsFromPoint: () => [target],
  };
  function setDocument(node) {
    if (node.nodeType !== 1) return;
    node.ownerDocument = document;
    for (const child of node.childNodes) setDocument(child);
  }
  setDocument(target);
  target.parentNode = document;

  const window = {
    document,
    CSS: { escape: (value) => value },
    matchMedia: () => ({ matches: mediaMatches }),
    getComputedStyle(node, pseudoName) {
      if (pseudoName === "::before") {
        return declaration({ content: '"x"', display: "inline", color: "rgb(255, 0, 0)" });
      }
      if (pseudoName === "::after") return declaration({ content: "none", display: "none" });
      if (node === target) {
        return declaration({
          display: "inline-block",
          padding: "24px",
          width: "400px",
          color: "rgb(1, 2, 3)",
          "background-color": "rgb(36, 104, 172)",
          "--brand": "#2468ac",
        });
      }
      return declaration({ display: "inline", color: "rgb(1, 2, 3)" });
    },
  };

  const context = vm.createContext({ window, CSS: window.CSS });
  vm.runInContext(engineSource, context, { filename: "src/engine.js" });
  return { engine: window.StyleScanEngine, target, document, context };
}

test("keeps authored declarations distinct from computed values", () => {
  const { engine, target } = fixture({ blocked: false });
  const report = engine.inspect(target);

  assert.equal(report.selector, "#target");
  assert.equal(report.computed.padding, "24px");
  assert.equal(report.matchedRules[0].declarations.padding.value, "1.5rem");
  assert.equal(report.matchedRules[0].declarations.padding.important, true);
  assert.match(engine.buildCss(report, { mode: "matched" }), /padding: 1\.5rem !important;/);
  assert.doesNotMatch(engine.buildCss(report, { mode: "matched" }), /row-gap:\s*;/);
  assert.match(engine.buildCss(report, { mode: "computed" }), /padding: 24px;/);
  assert.doesNotThrow(() => JSON.stringify(report));
});

test("reports blocked stylesheets and falls back to computed CSS", () => {
  const { engine, target } = fixture({ accessible: false });
  const report = engine.inspect(target);

  assert.equal(report.source.stylesheetsBlocked, 1);
  assert.equal(report.matchedRules.length, 0);
  assert.ok(report.warnings.some((warning) => warning.includes("SecurityError")));
  assert.equal(report.computed.color, "rgb(1, 2, 3)");
  assert.match(engine.buildCss(report, { mode: "matched" }), /color: rgb\(1, 2, 3\);/);
});

test("preserves pseudo rules and media conditions in matched CSS", () => {
  const { engine, target } = fixture({ blocked: false, mediaMatches: false });
  const report = engine.inspect(target);
  const css = engine.buildCss(report, { mode: "matched", includeMedia: true });

  assert.equal(report.pseudo.before.exists, true);
  assert.equal(report.pseudo.before.matchedRules[0].selector, "#target::before");
  assert.equal(report.mediaRules[0].active, false);
  assert.match(css, /@media \(min-width: 600px\)/);
  assert.match(css, /\[?\#target::before \{/);
  assert.match(css, /width: 50vw;/);
  assert.doesNotMatch(engine.buildCss(report, { mode: "matched", includeMedia: false }), /width: 50vw;/);
});

test("annotates author declarations by importance, specificity, inline precedence, and source order", () => {
  const { engine, target, document } = fixture({ blocked: false });
  const rules = document.styleSheets[0].cssRules;
  rules.push(cssRule(".primary", { color: "red", "background-color": "pink" }));
  rules.push(cssRule(".primary", { color: "blue" }));
  rules.push(cssRule("#target", { color: "green", "background-color": "green" }));
  rules.push(cssRule(".primary", { color: { value: "purple", important: true } }));
  target.style = declaration({ color: "orange", "background-color": "yellow" });

  const report = engine.inspect(target);
  const bySelector = (selector) => report.matchedRules.filter((rule) => rule.selector === selector);
  const status = (rule, property) => rule.declarations[property].cascade.status;
  const inline = bySelector("<inline style>")[0];
  const low = bySelector(".primary");
  const high = bySelector("#target").at(-1);

  assert.equal(status(low[0], "color"), "overridden");
  assert.equal(status(low[1], "color"), "overridden");
  assert.equal(status(high, "color"), "overridden");
  assert.equal(status(inline, "color"), "overridden");
  assert.equal(status(low[2], "color"), "candidate");
  assert.equal(status(inline, "background-color"), "candidate");
  assert.equal(status(high, "background-color"), "overridden");
  assert.equal(inline.source.kind, "inline");
  assert.ok(inline.source.order > high.source.order);
  assert.equal(low[0].declarationList.find((item) => item.property === "color").cascade.status, "overridden");
  assert.equal(low[0].declarations.color.cascade.overriddenBy.selector, ".primary");
  assert.equal(report.pseudo.before.matchedRules[0].declarations.color.cascade.status, "candidate");
  assert.equal(JSON.stringify(high.specificity), JSON.stringify([1, 0, 0]));
});

test("uses the most specific matching selector and respects :is() and :where()", () => {
  const { engine, target, document } = fixture({ blocked: false });
  target.matches = (selector) => ["#target", ".primary", ":is(.primary, #unmatched)", ":where(#target)"].includes(selector);
  document.styleSheets[0].cssRules.push(cssRule(".primary, #target", { opacity: "0.4" }));
  document.styleSheets[0].cssRules.push(cssRule(":is(.primary, #unmatched)", { opacity: "0.6" }));
  document.styleSheets[0].cssRules.push(cssRule(":where(#target)", { opacity: "0.8" }));

  const report = engine.inspect(target);
  const listRule = report.matchedRules.find((rule) => rule.selector === ".primary, #target");
  const isRule = report.matchedRules.find((rule) => rule.selector === ":is(.primary, #unmatched)");
  const whereRule = report.matchedRules.find((rule) => rule.selector === ":where(#target)");
  assert.equal(listRule.matchedSelector, "#target");
  assert.equal(JSON.stringify(listRule.specificity), JSON.stringify([1, 0, 0]));
  assert.equal(JSON.stringify(isRule.specificity), JSON.stringify([1, 0, 0]));
  assert.equal(JSON.stringify(whereRule.specificity), JSON.stringify([0, 0, 0]));
  assert.equal(listRule.declarations.opacity.cascade.status, "overridden");
  assert.equal(isRule.declarations.opacity.cascade.status, "candidate");
  assert.equal(whereRule.declarations.opacity.cascade.status, "overridden");
});

test("prefers specificity over later source order and later rules at equal specificity", () => {
  const { engine, target, document } = fixture({ blocked: false });
  const rules = document.styleSheets[0].cssRules;
  rules.push(cssRule(".primary", { opacity: "0.2", "z-index": "1" }));
  rules.push(cssRule("#target", { opacity: "0.4" }));
  rules.push(cssRule(".primary", { opacity: "0.9", "z-index": "2" }));

  const report = engine.inspect(target);
  const opacity = report.matchedRules.filter((rule) => rule.declarations.opacity);
  const zIndex = report.matchedRules.filter((rule) => rule.declarations["z-index"]);
  assert.equal(opacity[0].declarations.opacity.cascade.status, "overridden");
  assert.equal(opacity[1].declarations.opacity.cascade.status, "candidate");
  assert.equal(opacity[2].declarations.opacity.cascade.status, "overridden");
  assert.equal(zIndex[0].declarations["z-index"].cascade.status, "overridden");
  assert.equal(zIndex[1].declarations["z-index"].cascade.status, "candidate");
  assert.equal(zIndex[0].declarations["z-index"].cascade.overriddenBy.sourceOrder, zIndex[1].source.order);
});

test("marks inactive and unresolved cascade conditions without guessing a winner", () => {
  const { engine, target, document } = fixture({ blocked: false, mediaMatches: false });
  const rules = document.styleSheets[0].cssRules;
  rules.push(cssRule("#target", {
    width: "300px", padding: "8px", "padding-top": "4px",
    "font-size": "14px", "font-weight": "700",
  }));
  class CSSContainerRule {
    constructor() {
      this.conditionText = "(min-width: 20rem)";
      this.cssRules = [cssRule("#target", { width: "400px" })];
      this.cssText = "@container (min-width: 20rem) { #target { width: 400px; } }";
    }
  }
  class CSSLayerBlockRule {
    constructor() {
      this.name = "theme";
      this.cssRules = [cssRule("#target", { color: "red" })];
      this.cssText = "@layer theme { #target { color: red; } }";
    }
  }
  rules.push(new CSSContainerRule(), new CSSLayerBlockRule());
  rules.push(cssRule("#target", { color: "blue" }));

  const report = engine.inspect(target);
  const inactive = report.mediaRules[0];
  const plain = report.matchedRules.find((rule) => rule.selector === "#target" && rule.declarations.width?.value === "300px");
  const container = report.matchedRules.find((rule) => rule.declarations.width?.value === "400px");
  const layered = report.matchedRules.find((rule) => rule.declarations.color?.value === "red");
  const unlayered = report.matchedRules.find((rule) => rule.declarations.color?.value === "blue");
  assert.equal(inactive.declarations.width.cascade.status, "inactive");
  assert.equal(container.active, null);
  assert.equal(container.declarations.width.cascade.status, "unknown");
  assert.equal(plain.declarations.width.cascade.status, "unknown");
  assert.equal(plain.declarations.padding.cascade.status, "unknown");
  assert.equal(plain.declarations["padding-top"].cascade.status, "unknown");
  assert.equal(plain.declarations["font-size"].cascade.status, "candidate");
  assert.equal(plain.declarations["font-weight"].cascade.status, "candidate");
  assert.equal(layered.declarations.color.cascade.status, "unknown");
  assert.equal(unlayered.declarations.color.cascade.status, "unknown");
  assert.ok(layered.conditions.some((part) => part.kind === "layer"));
});

test("sanitizes exported HTML and leaves the source DOM untouched", () => {
  const { engine, target } = fixture();
  const originalAttributeCount = target.attributes.length;
  const html = engine.serializeHtml(target);

  assert.match(html, /<button id="target"/);
  assert.doesNotMatch(html, /onclick|javascript:|secret-token|secret-script|<script|<iframe/);
  assert.match(html, /<span>Buy now<\/span>/);
  assert.equal(target.attributes.length, originalAttributeCount);
  assert.equal(target.getAttribute("onclick"), "alert(3)");
});

test("exports a bounded component with scoped CSS and no DOM mutation", () => {
  const { engine, target } = fixture({ blocked: false });
  const component = engine.buildComponent(target, { maxDescendants: 2, includePseudo: true });

  assert.match(component.html, /data-style-scan-id="0"/);
  assert.match(component.html, /data-style-scan-id="1"/);
  assert.match(component.html, /data-style-scan-id="2"/);
  assert.doesNotMatch(component.html, /data-style-scan-id="3"/);
  assert.match(component.css, /\[data-style-scan-id="0"\] \{/);
  assert.match(component.css, /\[data-style-scan-id="0"\]::before \{/);
  assert.ok(component.warnings.some((warning) => warning.includes("truncated")));
  assert.equal(target.getAttribute("data-style-scan-id"), null);

  const authored = engine.buildComponent(target, { maxDescendants: 1, mode: "matched", includeMedia: true });
  assert.match(authored.css, /padding: 1\.5rem !important;/);
  assert.match(authored.css, /@media \(min-width: 600px\)/);
});

test("is safe to inject into the same page more than once", () => {
  const { engine, context } = fixture();
  vm.runInContext(engineSource, context, { filename: "src/engine.js" });
  assert.equal(context.window.StyleScanEngine, engine);
});
