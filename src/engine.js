/*
 * Style Scan inspection engine.
 *
 * This file is injected into a page as a classic content script. It has no
 * extension API dependency, makes no network requests, and leaves the page
 * DOM unchanged. CSSOM rules are best-effort: browsers intentionally deny
 * cssRules access for many cross-origin stylesheets. Computed styles remain
 * available in that case, and the report says what could not be inspected.
 */
(() => {
  "use strict";

  const VERSION = "0.2.0";
  if (window.StyleScanEngine?.version === VERSION) return;

  const DEFAULT_LIMITS = Object.freeze({
    maxStylesheets: 300,
    maxRules: 15000,
    maxMatchedRules: 600,
    maxProperties: 700,
    maxDescendants: 250,
    maxDepth: 20,
    maxTextLength: 50000,
  });

  // These are the properties that most directly control a copied component's
  // appearance. Full computed declarations are available through inspect().
  const COMPONENT_PROPERTIES = Object.freeze([
    "display", "visibility", "position", "inset", "top", "right", "bottom", "left",
    "z-index", "box-sizing", "width", "height", "min-width", "min-height",
    "max-width", "max-height", "margin", "margin-top", "margin-right",
    "margin-bottom", "margin-left", "padding", "padding-top", "padding-right",
    "padding-bottom", "padding-left", "overflow", "overflow-x", "overflow-y",
    "aspect-ratio", "float", "clear", "vertical-align", "contain",
    "flex", "flex-basis", "flex-direction", "flex-flow", "flex-grow", "flex-shrink",
    "flex-wrap", "align-content", "align-items", "align-self", "justify-content",
    "justify-items", "justify-self", "order", "gap", "row-gap", "column-gap",
    "grid", "grid-template-columns", "grid-template-rows", "grid-auto-columns",
    "grid-auto-rows", "grid-auto-flow", "grid-column", "grid-row", "place-items",
    "place-content", "place-self", "background", "background-color",
    "background-image", "background-position", "background-size", "background-repeat",
    "background-clip", "background-origin", "background-blend-mode", "color",
    "font", "font-family", "font-size", "font-style", "font-weight", "font-stretch",
    "font-variant", "line-height", "letter-spacing", "word-spacing", "text-align",
    "text-align-last", "text-decoration", "text-decoration-color",
    "text-decoration-line", "text-decoration-style", "text-decoration-thickness",
    "text-transform", "text-shadow", "text-overflow", "text-indent", "white-space",
    "word-break", "overflow-wrap", "hyphens", "direction", "writing-mode",
    "border", "border-top", "border-right", "border-bottom", "border-left",
    "border-color", "border-style", "border-width", "border-radius",
    "border-top-left-radius", "border-top-right-radius",
    "border-bottom-right-radius", "border-bottom-left-radius", "outline",
    "outline-offset", "box-shadow", "opacity", "transform", "transform-origin",
    "filter", "backdrop-filter", "mix-blend-mode", "isolation", "clip-path",
    "object-fit", "object-position", "content", "cursor", "pointer-events",
    "user-select", "appearance", "list-style", "list-style-type",
  ]);

  const VOID_ELEMENTS = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
  ]);
  const UNSAFE_ELEMENTS = new Set([
    "script", "noscript", "iframe", "frame", "frameset", "object", "embed",
    "applet", "base", "link", "meta", "template", "style",
  ]);
  const URL_ATTRIBUTES = new Set([
    "href", "src", "xlink:href", "action", "formaction", "poster", "cite",
    "data", "background",
  ]);

  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const clampLimit = (value, fallback, ceiling = 100000) =>
    Number.isFinite(value) ? Math.max(0, Math.min(Math.floor(value), ceiling)) : fallback;

  function warn(state, message) {
    if (!state.warningSet.has(message)) {
      state.warningSet.add(message);
      state.warnings.push(message);
    }
  }

  function escapeIdentifier(value) {
    if (window.CSS?.escape) return CSS.escape(String(value));
    // CSS.escape is supported in current Chrome. This fallback keeps the
    // selector usable in older Chromium builds and test DOMs.
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) =>
      `\\${character.codePointAt(0).toString(16)} `);
  }

  function rootFor(element) {
    return element.getRootNode?.() || element.ownerDocument;
  }

  function queryCount(root, selector) {
    try {
      return root.querySelectorAll(selector).length;
    } catch {
      return Infinity;
    }
  }

  /** Return a selector unique inside the element's document or shadow root. */
  function getUniqueSelector(element) {
    if (!element || element.nodeType !== 1) return "";
    const root = rootFor(element);
    const segments = [];
    let current = element;

    while (current?.nodeType === 1) {
      const tag = current.localName || current.tagName.toLowerCase();
      if (current.id) {
        const idSelector = `#${escapeIdentifier(current.id)}`;
        if (queryCount(root, idSelector) === 1) {
          segments.unshift(idSelector);
          break;
        }
      }

      let segment = tag;
      const parent = current.parentElement;
      if (current.parentNode?.nodeType === 1 || current.parentNode?.nodeType === 11) {
        let nth = 1;
        let sibling = current.previousElementSibling;
        while (sibling) {
          if (sibling.localName === current.localName) nth += 1;
          sibling = sibling.previousElementSibling;
        }
        segment += `:nth-of-type(${nth})`;
      }
      segments.unshift(segment);
      const candidate = segments.join(" > ");
      if (queryCount(root, candidate) === 1) break;
      current = parent;
    }

    return segments.join(" > ");
  }

  function shouldIgnore(candidate, ignore) {
    if (!ignore) return false;
    if (typeof ignore === "function") {
      try { return Boolean(ignore(candidate)); } catch { return false; }
    }
    const elements = Array.isArray(ignore) ? ignore : [ignore];
    return elements.some((item) => item === candidate || item?.contains?.(candidate));
  }

  /** Find the underlying page element even if a supplied overlay is on top. */
  function getElementAtPoint(x, y, { ignore } = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const doc = window.document;
    const stack = doc.elementsFromPoint?.(x, y) || [doc.elementFromPoint(x, y)];
    for (const entry of stack) {
      if (!entry || shouldIgnore(entry, ignore)) continue;
      let candidate = entry;
      while (candidate.shadowRoot?.elementFromPoint) {
        const inner = candidate.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === candidate || shouldIgnore(inner, ignore)) break;
        candidate = inner;
      }
      return candidate;
    }
    return null;
  }

  function computedMap(element, pseudo, maxProperties, properties) {
    let declaration;
    try {
      declaration = window.getComputedStyle(element, pseudo || null);
    } catch {
      return {};
    }
    const result = {};
    const requested = Array.isArray(properties) && properties.length ? properties : null;
    if (requested) {
      for (const property of requested.slice(0, maxProperties)) {
        const value = declaration.getPropertyValue(property);
        if (value) result[property] = value.trim();
      }
    } else {
      const count = Math.min(declaration.length, maxProperties);
      for (let index = 0; index < count; index += 1) {
        const property = declaration.item(index);
        if (property) result[property] = declaration.getPropertyValue(property).trim();
      }
    }
    return result;
  }

  function declarationData(style) {
    const declarations = {};
    const declarationList = [];
    for (let index = 0; index < style.length; index += 1) {
      const property = style.item(index);
      const value = style.getPropertyValue(property).trim();
      const important = style.getPropertyPriority(property) === "important";
      declarations[property] = { value, important };
      declarationList.push({ property, value, important });
    }
    return { declarations, declarationList };
  }

  // A comma in :is(), :not(), an attribute value, or a string is not a
  // selector separator. Matching the complete selector list would lose which
  // branch applies and would fail for pseudo-element branches.
  function splitSelectorList(value) {
    const result = [];
    let start = 0;
    let parentheses = 0;
    let brackets = 0;
    let quote = "";
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      if (character === "\\") { index += 1; continue; }
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === "'" || character === '"') {
        quote = character;
      } else if (character === "(") {
        parentheses += 1;
      } else if (character === ")") {
        parentheses = Math.max(0, parentheses - 1);
      } else if (character === "[") {
        brackets += 1;
      } else if (character === "]") {
        brackets = Math.max(0, brackets - 1);
      } else if (character === "," && parentheses === 0 && brackets === 0) {
        result.push(value.slice(start, index).trim());
        start = index + 1;
      }
    }
    result.push(value.slice(start).trim());
    return result.filter(Boolean);
  }

  function matchingSelectors(element, selectorText) {
    const found = { element: [], before: [], after: [] };
    for (const selector of splitSelectorList(selectorText)) {
      const pseudo = selector.match(/::?(before|after)\s*$/i);
      const target = pseudo ? pseudo[1].toLowerCase() : "element";
      const testSelector = pseudo ? selector.slice(0, pseudo.index).trim() || "*" : selector;
      try {
        if (element.matches(testSelector)) found[target].push(selector);
      } catch {
        // Nonstandard selectors (and selectors unsupported by the current
        // Chromium build) cannot be evaluated with Element.matches().
      }
    }
    return found;
  }

  // Specificity is calculated only for selector syntax we can parse without
  // guessing. An unknown value deliberately prevents a false cascade verdict.
  function specificityForSelector(selector, depth = 0) {
    if (depth > 24 || selector.length > 10000) return null;
    const score = [0, 0, 0];
    const text = selector.replace(/\/\*[\s\S]*?\*\//g, "");
    let index = 0;

    function identifier() {
      const start = index;
      while (index < text.length) {
        const character = text[index];
        if (character === "\\") {
          index += 1;
          if (/[0-9a-fA-F]/.test(text[index] || "")) {
            let count = 0;
            while (count < 6 && /[0-9a-fA-F]/.test(text[index] || "")) { index += 1; count += 1; }
            if (/\s/.test(text[index] || "")) index += 1;
          } else if (index < text.length) {
            index += 1;
          } else {
            return false;
          }
        } else if (/[\w-]/.test(character) || character.codePointAt(0) >= 0x80) {
          index += 1;
        } else {
          break;
        }
      }
      return index > start;
    }

    function balanced(open, close) {
      if (text[index] !== open) return null;
      const start = ++index;
      let depth = 1;
      let quote = "";
      while (index < text.length) {
        const character = text[index];
        if (character === "\\") { index += 2; continue; }
        if (quote) {
          if (character === quote) quote = "";
        } else if (character === "'" || character === '"') {
          quote = character;
        } else if (character === open) {
          depth += 1;
        } else if (character === close) {
          depth -= 1;
          if (depth === 0) return text.slice(start, index++);
        }
        index += 1;
      }
      return null;
    }

    function maxArgumentSpecificity(argument) {
      const branches = splitSelectorList(argument);
      if (!branches.length) return null;
      let greatest = [0, 0, 0];
      for (const branch of branches) {
        const candidate = specificityForSelector(branch, depth + 1);
        if (!candidate) return null;
        if (compareSpecificity(candidate, greatest) > 0) greatest = candidate;
      }
      return greatest;
    }

    while (index < text.length) {
      const character = text[index];
      if (/\s/.test(character) || ">+~*".includes(character)) { index += 1; continue; }
      if (character === "#" || character === ".") {
        index += 1;
        if (!identifier()) return null;
        score[character === "#" ? 0 : 1] += 1;
      } else if (character === "[") {
        if (balanced("[", "]") === null) return null;
        score[1] += 1;
      } else if (character === ":") {
        const pseudoElement = text[index + 1] === ":";
        index += pseudoElement ? 2 : 1;
        const nameStart = index;
        if (!identifier()) return null;
        const name = text.slice(nameStart, index).toLowerCase();
        if (pseudoElement || name === "before" || name === "after" || name === "first-line" || name === "first-letter") {
          if (text[index] === "(") return null; // ::part()/::slotted() have special rules.
          score[2] += 1;
        } else if (text[index] === "(") {
          const argument = balanced("(", ")");
          if (argument === null) return null;
          if (name === "where") continue;
          if (name === "is" || name === "not" || name === "has") {
            const nested = maxArgumentSpecificity(argument);
            if (!nested) return null;
            for (let part = 0; part < 3; part += 1) score[part] += nested[part];
          } else if (name === "nth-child" || name === "nth-last-child") {
            score[1] += 1;
            const of = argument.match(/\bof\s+([\s\S]+)$/i);
            if (of) {
              const nested = maxArgumentSpecificity(of[1]);
              if (!nested) return null;
              for (let part = 0; part < 3; part += 1) score[part] += nested[part];
            }
          } else if (name === "host" || name === "host-context") {
            return null;
          } else {
            score[1] += 1;
          }
        } else {
          score[1] += 1;
        }
      } else if (character === "&" || character === "|" || character === ",") {
        return null;
      } else {
        if (!identifier()) return null;
        score[2] += 1;
      }
    }
    return score;
  }

  function compareSpecificity(left, right) {
    for (let part = 0; part < 3; part += 1) {
      if (left[part] !== right[part]) return left[part] - right[part];
    }
    return 0;
  }

  function strongestMatchedSelector(selectors) {
    let selector = null;
    let specificity = null;
    for (const candidate of selectors) {
      const score = specificityForSelector(candidate);
      if (!score) return { selector: null, specificity: null };
      if (!specificity || compareSpecificity(score, specificity) > 0) {
        selector = candidate;
        specificity = score;
      }
    }
    return { selector, specificity };
  }

  function condition(kind, text, active) {
    return { kind, text, active };
  }

  function mediaActive(text) {
    try { return window.matchMedia(text).matches; } catch { return null; }
  }

  function supportsActive(text) {
    try { return window.CSS?.supports ? CSS.supports(text) : null; } catch { return null; }
  }

  function combinedActive(conditions, disabled) {
    if (disabled || conditions.some((item) => item.active === false)) return false;
    if (conditions.some((item) => item.active === null)) return null;
    return true;
  }

  function ruleKind(rule) {
    const name = rule.constructor?.name || "";
    if (name === "CSSMediaRule" || rule.type === 4) return "media";
    if (name === "CSSSupportsRule" || rule.type === 12) return "supports";
    if (name === "CSSContainerRule") return "container";
    if (name === "CSSLayerBlockRule") return "layer";
    if (name === "CSSScopeRule") return "scope";
    if (name === "CSSImportRule" || rule.type === 3) return "import";
    if (/KeyframesRule$/.test(name) || rule.type === 7) return "keyframes";
    return "group";
  }

  function conditionForRule(rule, kind) {
    if (kind === "media") {
      const text = rule.conditionText || rule.media?.mediaText || "all";
      return condition("media", text, mediaActive(text));
    }
    if (kind === "supports") {
      const text = rule.conditionText || "";
      return condition("supports", text, supportsActive(text));
    }
    if (kind === "container") {
      return condition("container", rule.conditionText || rule.name || "", null);
    }
    if (kind === "layer") {
      return condition("layer", rule.name || "(anonymous)", true);
    }
    if (kind === "scope") {
      return condition("scope", rule.cssText?.split("{")[0] || "@scope", null);
    }
    if (kind === "group" && /^\s*@/.test(rule.cssText || "")) {
      return condition("unknown", rule.cssText.split("{")[0].trim(), null);
    }
    return null;
  }

  function stylesheetOwner(sheet) {
    const node = sheet.ownerNode;
    if (!node) return "adopted/imported";
    const tag = node.localName || node.nodeName?.toLowerCase() || "unknown";
    return node.id ? `${tag}#${node.id}` : tag;
  }

  function collectStylesheets(element, state) {
    const root = rootFor(element);
    const sheets = [];
    // Styles inside a shadow root are scoped there. Document sheets do not
    // style shadow descendants; adopted sheets are included where supported.
    if (root.styleSheets) sheets.push(...Array.from(root.styleSheets));
    if (root.adoptedStyleSheets) sheets.push(...Array.from(root.adoptedStyleSheets));
    if (root !== element.ownerDocument && root.mode === "closed") {
      warn(state, "Closed shadow-root styles cannot be inspected from outside their root.");
    }
    return sheets;
  }

  const PREFIX_SHORTHANDS = new Set([
    "animation", "background", "background-position", "border", "border-block",
    "border-bottom", "border-image", "border-inline", "border-left", "border-radius",
    "border-right", "border-top", "flex",
    "flex-flow", "font", "grid", "grid-column", "grid-row", "grid-template",
    "inset", "inset-block", "inset-inline", "list-style", "margin",
    "margin-block", "margin-inline", "mask", "outline", "overflow", "padding",
    "padding-block", "padding-inline", "text-decoration", "transition",
  ]);

  function shorthandOverlap(left, right) {
    if (left === "all" || right === "all") return true;
    if (left.startsWith("--") || right.startsWith("--")) return false;
    for (const [short, long] of [[left, right], [right, left]]) {
      if (PREFIX_SHORTHANDS.has(short) && long.startsWith(`${short}-`)) return true;
      if (short === "gap" && /^(?:row|column)-gap$/.test(long)) return true;
      if (short === "font" && long === "line-height") return true;
      if (short === "columns" && /^column-(?:count|width)$/.test(long)) return true;
      if (short === "inset" && /^(?:top|right|bottom|left)$/.test(long)) return true;
      if (/^border-(?:color|style|width)$/.test(short) &&
          new RegExp(`^border-(?:top|right|bottom|left)-${short.slice(7)}$`).test(long)) return true;
      if (short === "border-radius" && /^border-(?:top|bottom)-(?:left|right)-radius$/.test(long)) return true;
      if (short === "place-content" && /^(?:align|justify)-content$/.test(long)) return true;
      if (short === "place-items" && /^(?:align|justify)-items$/.test(long)) return true;
      if (short === "place-self" && /^(?:align|justify)-self$/.test(long)) return true;
    }
    return false;
  }

  function compareCascadePriority(left, right) {
    if (left.entry.important !== right.entry.important) return Number(left.entry.important) - Number(right.entry.important);
    const leftInline = left.rule.source.kind === "inline";
    const rightInline = right.rule.source.kind === "inline";
    if (leftInline !== rightInline) return Number(leftInline) - Number(rightInline);
    if (!leftInline) {
      const specificity = compareSpecificity(left.rule.specificity, right.rule.specificity);
      if (specificity) return specificity;
    }
    return left.rule.source.order - right.rule.source.order;
  }

  function annotateCascade(groups) {
    for (const rules of groups) {
      const byProperty = new Map();
      const entries = [];
      for (const rule of rules) {
        for (const entry of rule.declarationList) {
          const item = { rule, entry };
          entries.push(item);
          if (!byProperty.has(entry.property)) byProperty.set(entry.property, []);
          byProperty.get(entry.property).push(item);
          if (!entry.value) {
            entry.cascade = { status: "unknown", reason: "The declaration has no usable value." };
          } else if (rule.active === false) {
            entry.cascade = { status: "inactive", reason: "Its stylesheet or conditional rule is inactive." };
          } else if (rule.active === null) {
            entry.cascade = { status: "unknown", reason: "A container or scope condition could not be evaluated." };
          } else if (rule.conditions.some((part) => part.kind === "layer" || part.kind === "scope")) {
            entry.cascade = { status: "unknown", reason: "Layer or scope precedence is not resolved." };
          } else if (rule.source.kind !== "inline" && !rule.specificity) {
            entry.cascade = { status: "unknown", reason: "Selector specificity could not be determined." };
          } else if (entry.property === "all" || /^(?:revert|revert-layer)$/i.test(entry.value)) {
            entry.cascade = { status: "unknown", reason: "The all or revert keyword changes cascade resolution." };
          } else {
            entry.cascade = { status: "candidate" };
          }
        }
      }

      for (const [property, contenders] of byProperty) {
        const active = contenders.filter((item) => item.entry.cascade.status !== "inactive");
        if (!active.length) continue;
        const ambiguousShorthand = entries.some((item) =>
          item.entry.property !== property && item.entry.cascade.status !== "inactive" &&
          shorthandOverlap(property, item.entry.property));
        if (ambiguousShorthand || active.some((item) => item.entry.cascade.status === "unknown")) {
          for (const item of active) {
            if (item.entry.cascade.status === "candidate") {
              item.entry.cascade = {
                status: "unknown",
                reason: ambiguousShorthand
                  ? "A related shorthand or longhand may affect this property."
                  : "Another matching declaration has unresolved precedence.",
              };
            }
          }
          continue;
        }

        let strongest = active[0];
        for (const item of active.slice(1)) {
          if (compareCascadePriority(item, strongest) > 0) strongest = item;
        }
        for (const item of active) {
          if (item === strongest) continue;
          item.entry.cascade = {
            status: "overridden",
            overriddenBy: {
              selector: strongest.rule.selector,
              sourceOrder: strongest.rule.source.order,
              property,
            },
          };
        }
      }

      for (const rule of rules) {
        for (const entry of rule.declarationList) {
          rule.declarations[entry.property].cascade = entry.cascade;
        }
      }
    }
  }

  function scanRules(element, state, options) {
    const sheets = collectStylesheets(element, state);
    const maxStylesheets = clampLimit(options.maxStylesheets, DEFAULT_LIMITS.maxStylesheets, 2000);
    const maxRules = clampLimit(options.maxRules, DEFAULT_LIMITS.maxRules, 100000);
    const maxMatched = clampLimit(options.maxMatchedRules, DEFAULT_LIMITS.maxMatchedRules, 10000);
    const matched = [];
    const pseudoMatched = { before: [], after: [] };
    const mediaRules = [];
    const sheetCounts = new WeakMap();
    let rulesVisited = 0;
    let sheetsScanned = 0;
    let sheetsBlocked = 0;
    let truncated = false;

    function addMatch(rule, selectors, pseudo, source, conditions, disabled) {
      if (!selectors.length) return;
      if (matched.length + pseudoMatched.before.length + pseudoMatched.after.length >= maxMatched) {
        truncated = true;
        return;
      }
      const declarations = declarationData(rule.style);
      const strongest = strongestMatchedSelector(selectors);
      const record = {
        selector: rule.selectorText,
        matchedSelectors: selectors,
        matchedSelector: strongest.selector,
        specificity: strongest.specificity,
        cssText: rule.cssText,
        declarations: declarations.declarations,
        declarationList: declarations.declarationList,
        conditions: conditions.map((item) => ({ ...item })),
        active: combinedActive(conditions, disabled),
        disabled,
        pseudo,
        source: { ...source },
      };
      if (pseudo === "element") matched.push(record);
      else pseudoMatched[pseudo].push(record);
      if (conditions.some((item) => item.kind === "media")) mediaRules.push(record);
    }

    function visitSheet(sheet, inheritedConditions = [], ancestors = new Set(), inheritedDisabled = false) {
      if (!sheet || rulesVisited >= maxRules || sheetsScanned >= maxStylesheets) {
        truncated = true;
        return;
      }
      if (ancestors.has(sheet)) return;
      const timesSeen = sheetCounts.get(sheet) || 0;
      if (timesSeen >= 3) return;
      sheetCounts.set(sheet, timesSeen + 1);
      sheetsScanned += 1;

      const conditions = [...inheritedConditions];
      const sheetMedia = sheet.media?.mediaText?.trim();
      if (sheetMedia && sheetMedia !== "all") {
        conditions.push(condition("media", sheetMedia, mediaActive(sheetMedia)));
      }
      const disabled = inheritedDisabled || Boolean(sheet.disabled);
      let rules;
      try {
        rules = sheet.cssRules;
      } catch (error) {
        sheetsBlocked += 1;
        warn(state, `Cannot read rules from ${sheet.href || stylesheetOwner(sheet)} (${error?.name || "browser restriction"}). Computed styles are still available.`);
        return;
      }
      if (!rules) return;
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(sheet);
      const sourceBase = {
        href: sheet.href || null,
        owner: stylesheetOwner(sheet),
        kind: sheet.href ? "external" : "embedded",
      };

      function walk(ruleList, path, context, depth = 0) {
        if (depth > 24) {
          truncated = true;
          return;
        }
        for (let index = 0; index < ruleList.length; index += 1) {
          if (rulesVisited >= maxRules) { truncated = true; return; }
          rulesVisited += 1;
          const rule = ruleList[index];
          if (!rule) continue;
          const rulePath = [...path, index];
          const kind = ruleKind(rule);

          if (kind === "import") {
            const importConditions = [...context];
            const media = rule.media?.mediaText?.trim();
            if (media && media !== "all") {
              importConditions.push(condition("media", media, mediaActive(media)));
            }
            if (rule.supportsText) {
              importConditions.push(condition("supports", rule.supportsText, supportsActive(rule.supportsText)));
            }
            if (rule.layerName !== undefined && rule.layerName !== null) {
              importConditions.push(condition("layer", rule.layerName || "(anonymous)", true));
            }
            try { visitSheet(rule.styleSheet, importConditions, nextAncestors, disabled); } catch { /* unavailable import */ }
            continue;
          }

          if (rule.selectorText && rule.style) {
            const matches = matchingSelectors(element, rule.selectorText);
            const source = { ...sourceBase, rulePath, order: rulesVisited };
            addMatch(rule, matches.element, "element", source, context, disabled);
            addMatch(rule, matches.before, "before", source, context, disabled);
            addMatch(rule, matches.after, "after", source, context, disabled);
            continue;
          }

          if (kind === "keyframes") continue;
          let childRules;
          try { childRules = rule.cssRules; } catch { childRules = null; }
          if (childRules?.length) {
            const nextCondition = conditionForRule(rule, kind);
            walk(childRules, rulePath, nextCondition ? [...context, nextCondition] : context, depth + 1);
          }
        }
      }

      walk(rules, [], conditions);
    }

    for (const sheet of sheets) visitSheet(sheet);
    if (truncated) warn(state, "Stylesheet inspection reached its safety limit; the matched rule list may be incomplete.");

    if (element.style?.length) {
      const inline = declarationData(element.style);
      matched.push({
        selector: "<inline style>",
        matchedSelectors: ["<inline style>"],
        matchedSelector: "<inline style>",
        specificity: null,
        cssText: element.getAttribute("style") || element.style.cssText,
        declarations: inline.declarations,
        declarationList: inline.declarationList,
        conditions: [],
        active: true,
        disabled: false,
        pseudo: "element",
        source: { href: null, owner: "style attribute", kind: "inline", rulePath: [], order: rulesVisited + 1 },
      });
    }

    annotateCascade([matched, pseudoMatched.before, pseudoMatched.after]);

    return { matched, pseudoMatched, mediaRules, sheetsScanned, sheetsBlocked, rulesVisited, truncated };
  }

  function rectData(element) {
    const rect = element.getBoundingClientRect();
    const number = (value) => Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
    return {
      x: number(rect.x), y: number(rect.y), top: number(rect.top), right: number(rect.right),
      bottom: number(rect.bottom), left: number(rect.left),
      width: number(rect.width), height: number(rect.height),
    };
  }

  function pseudoData(element, pseudo, maxProperties, matchedRules) {
    const computed = computedMap(element, `::${pseudo}`, maxProperties);
    const content = computed.content || "";
    return {
      exists: Boolean(content && content !== "none" && content !== "normal" && computed.display !== "none"),
      computed,
      matchedRules,
    };
  }

  /** Inspect one element. Authored declarations and computed values stay separate. */
  function inspect(element, options = {}) {
    if (!element || element.nodeType !== 1) throw new TypeError("inspect() expects an Element");
    const state = { warnings: [], warningSet: new Set() };
    const maxProperties = clampLimit(options.maxProperties, DEFAULT_LIMITS.maxProperties, 2000);
    const computed = computedMap(element, null, maxProperties, options.properties);
    const scan = scanRules(element, state, options);
    const root = rootFor(element);
    const rect = rectData(element);
    const cssVariables = {};
    for (const [property, value] of Object.entries(computed)) {
      if (property.startsWith("--")) cssVariables[property] = value;
    }

    if (Object.keys(computed).length >= maxProperties) {
      warn(state, "Computed declaration output reached its property limit.");
    }
    if (root !== element.ownerDocument) {
      warn(state, "The selector is relative to this shadow root, not the outer document.");
    }

    return {
      version: VERSION,
      selector: getUniqueSelector(element),
      tag: element.localName || element.tagName.toLowerCase(),
      id: element.id || "",
      classes: Array.from(element.classList || []),
      dimensions: {
        width: rect.width,
        height: rect.height,
        clientWidth: element.clientWidth ?? null,
        clientHeight: element.clientHeight ?? null,
        offsetWidth: element.offsetWidth ?? null,
        offsetHeight: element.offsetHeight ?? null,
        scrollWidth: element.scrollWidth ?? null,
        scrollHeight: element.scrollHeight ?? null,
      },
      rect,
      computed,
      matchedRules: scan.matched,
      pseudo: {
        before: pseudoData(element, "before", maxProperties, scan.pseudoMatched.before),
        after: pseudoData(element, "after", maxProperties, scan.pseudoMatched.after),
      },
      cssVariables,
      mediaRules: scan.mediaRules,
      warnings: state.warnings,
      source: {
        pageUrl: element.ownerDocument.location?.href || "",
        rootType: root === element.ownerDocument ? "document" : "shadow",
        shadowHost: root.host ? getUniqueSelector(root.host) : null,
        stylesheetsScanned: scan.sheetsScanned,
        stylesheetsBlocked: scan.sheetsBlocked,
        rulesVisited: scan.rulesVisited,
        matchedRulesTruncated: scan.truncated,
        capturedAt: new Date().toISOString(),
      },
    };
  }

  function cssDeclarations(map, properties, indent = "  ") {
    const lines = [];
    const keys = properties || Object.keys(map || {});
    for (const property of keys) {
      if (!own(map || {}, property)) continue;
      const value = map[property];
      if (typeof value !== "string" || !value) continue;
      lines.push(`${indent}${property}: ${value};`);
    }
    return lines;
  }

  function cssBlock(selector, lines) {
    return `${selector} {\n${lines.join("\n")}\n}`;
  }

  function wrapConditions(css, conditions) {
    let result = css;
    for (const item of [...(conditions || [])].reverse()) {
      let heading = "";
      if (item.kind === "media") heading = `@media ${item.text}`;
      else if (item.kind === "supports") heading = `@supports ${item.text}`;
      else if (item.kind === "container") heading = `@container ${item.text}`;
      else if (item.kind === "layer") heading = item.text === "(anonymous)" ? "@layer" : `@layer ${item.text}`;
      else if (item.kind === "scope") heading = item.text.startsWith("@scope") ? item.text : `@scope ${item.text}`;
      if (heading) result = `${heading} {\n${result.split("\n").map((line) => `  ${line}`).join("\n")}\n}`;
    }
    return result;
  }

  function matchedBlocks(rules, selector, includeMedia) {
    const blocks = [];
    for (const rule of rules || []) {
      if (rule.disabled || (!includeMedia && rule.active === false)) continue;
      const lines = (rule.declarationList || [])
        .filter((item) => typeof item.value === "string" && item.value.trim())
        .map((item) => `  ${item.property}: ${item.value}${item.important ? " !important" : ""};`);
      if (!lines.length) continue;
      const block = cssBlock(selector, lines);
      blocks.push(includeMedia ? wrapConditions(block, rule.conditions) : block);
    }
    return blocks;
  }

  /**
   * Build copyable CSS. "computed" (default) is a visual snapshot; "matched"
   * (also accepted as "authored") preserves source units and conditions when
   * the CSSOM is readable. includeMedia emits matching conditional rules.
   */
  function buildCss(report, options = {}) {
    if (!report || typeof report !== "object") throw new TypeError("buildCss() expects an inspection report");
    const selector = options.selector || report.selector || ".style-scan-element";
    const mode = options.mode === "authored" || options.mode === "matched" ? "matched" : "computed";
    const includeMedia = options.includeMedia === true;
    const properties = Array.isArray(options.properties) ? options.properties : null;
    const blocks = [];
    if (mode === "matched") {
      const mainMatched = matchedBlocks(report.matchedRules, selector, includeMedia);
      const pseudoMatched = [];
      if (options.includePseudo !== false) {
        for (const name of ["before", "after"]) {
          pseudoMatched.push(...matchedBlocks(report.pseudo?.[name]?.matchedRules, `${selector}::${name}`, includeMedia));
        }
      }
      // A page may expose no CSSOM rules (for example, cross-origin sheets).
      if (!mainMatched.length && !pseudoMatched.length) {
        return buildCss(report, { ...options, mode: "computed" });
      }
      if (options.includeVariables !== false) {
        const variableLines = cssDeclarations(report.cssVariables || {});
        if (variableLines.length) blocks.push(cssBlock(selector, variableLines));
      }
      blocks.push(...mainMatched, ...pseudoMatched);
    } else {
      const lines = cssDeclarations(report.computed || {}, properties);
      if (lines.length) blocks.push(cssBlock(selector, lines));
      if (options.includePseudo !== false) {
        for (const name of ["before", "after"]) {
          const pseudo = report.pseudo?.[name];
          if (!pseudo?.exists) continue;
          const pseudoLines = cssDeclarations(pseudo.computed || {}, properties);
          if (pseudoLines.length) blocks.push(cssBlock(`${selector}::${name}`, pseudoLines));
        }
      }
      if (includeMedia) {
        for (const rule of report.mediaRules || []) {
          if (rule.pseudo !== "element" && options.includePseudo === false) continue;
          const target = rule.pseudo === "element" ? selector : `${selector}::${rule.pseudo}`;
          blocks.push(...matchedBlocks([rule], target, true));
        }
      }
    }
    return blocks.join("\n\n");
  }

  function escapeHtml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function safeAttribute(name, value, tag) {
    const lower = name.toLowerCase();
    if (/^on[a-z]/i.test(lower) || lower === "srcdoc" || lower === "nonce") return false;
    if (tag === "input" && (lower === "value" || lower === "checked")) return false;
    if (lower === "style" && /expression\s*\(|url\s*\(\s*['"]?\s*(?:javascript|vbscript):/i.test(value)) return false;
    if (URL_ATTRIBUTES.has(lower) && /^\s*(?:javascript|vbscript|data:text\/html)/i.test(value)) return false;
    if (lower === "srcset" && /(?:javascript|vbscript|data:text\/html)\s*:/i.test(value)) return false;
    return true;
  }

  function serializeInternal(element, options = {}, annotate = false) {
    if (!element || element.nodeType !== 1) throw new TypeError("serializeHtml() expects an Element");
    const maxDescendants = clampLimit(options.maxDescendants, DEFAULT_LIMITS.maxDescendants, 5000);
    const maxDepth = clampLimit(options.maxDepth, DEFAULT_LIMITS.maxDepth, 100);
    const maxTextLength = clampLimit(options.maxTextLength, DEFAULT_LIMITS.maxTextLength, 1000000);
    const warnings = [];
    const elements = [];
    let descendantCount = 0;
    let textLength = 0;
    let truncatedNodes = false;
    let truncatedText = false;

    function visit(node, depth, root = false) {
      if (node.nodeType === 3) {
        const remaining = Math.max(0, maxTextLength - textLength);
        const raw = node.nodeValue || "";
        if (raw.length > remaining) truncatedText = true;
        const value = raw.slice(0, remaining);
        textLength += value.length;
        return escapeHtml(value);
      }
      if (node.nodeType !== 1) return "";
      const tag = (node.localName || node.tagName).toLowerCase();
      if (UNSAFE_ELEMENTS.has(tag)) return "";
      if (!root) {
        if (descendantCount >= maxDescendants || depth > maxDepth) {
          truncatedNodes = true;
          return "";
        }
        descendantCount += 1;
      }

      const marker = annotate ? String(elements.length) : null;
      if (annotate) elements.push({ element: node, marker });
      let result = `<${tag}`;
      for (const attribute of Array.from(node.attributes || [])) {
        const name = attribute.name;
        if (annotate && name.toLowerCase() === "data-style-scan-id") continue;
        if (!safeAttribute(name, attribute.value, tag)) continue;
        result += ` ${name}="${escapeHtml(attribute.value)}"`;
      }
      if (annotate) result += ` data-style-scan-id="${marker}"`;
      result += ">";
      if (VOID_ELEMENTS.has(tag)) return result;
      if (tag === "textarea") {
        // Export markup text, never live form input entered by the user.
        result += escapeHtml(node.textContent || "");
      } else {
        for (const child of Array.from(node.childNodes || [])) {
          result += visit(child, depth + 1);
        }
      }
      result += `</${tag}>`;
      return result;
    }

    const html = visit(element, 0, true);
    if (truncatedNodes) warnings.push("HTML export was truncated at the descendant or depth limit.");
    if (truncatedText) warnings.push("HTML export text was truncated at its character limit.");
    if (element.shadowRoot) warnings.push("Shadow DOM content is not included in the HTML export.");
    return { html, elements, warnings };
  }

  /** Produce sanitized, bounded HTML without changing the live page. */
  function serializeHtml(element, options = {}) {
    return serializeInternal(element, options).html;
  }

  /**
   * Export a visual snapshot of an element and its descendants. Generated
   * data-style-scan-id attributes scope the CSS to this exported HTML alone.
   */
  function buildComponent(element, options = {}) {
    const serialized = serializeInternal(element, options, true);
    const warnings = [...serialized.warnings];
    const matchedMode = options.mode === "matched" || options.mode === "authored";
    const properties = Array.isArray(options.properties) && options.properties.length
      ? options.properties : COMPONENT_PROPERTIES;
    const blocks = [];
    const maxProperties = clampLimit(options.maxProperties, properties.length, 2000);
    const rootReport = matchedMode || options.includeMedia === true
      ? inspect(element, {
        maxProperties: Math.max(300, maxProperties),
        maxRules: options.maxRules,
        maxMatchedRules: options.maxMatchedRules,
      }) : null;
    for (const { element: node, marker } of serialized.elements) {
      const selector = `[data-style-scan-id="${marker}"]`;
      if (marker === "0" && matchedMode) {
        blocks.push(buildCss(rootReport, {
          mode: "matched", selector,
          includePseudo: options.includePseudo,
          includeMedia: options.includeMedia,
        }));
        continue;
      }
      const computed = computedMap(node, null, maxProperties, properties);
      const lines = cssDeclarations(computed, properties);
      if (lines.length) blocks.push(cssBlock(selector, lines));
      if (options.includePseudo !== false) {
        for (const name of ["before", "after"]) {
          const pseudo = computedMap(node, `::${name}`, maxProperties, properties);
          if (!pseudo.content || pseudo.content === "none" || pseudo.content === "normal" || pseudo.display === "none") continue;
          const pseudoLines = cssDeclarations(pseudo, properties);
          if (pseudoLines.length) blocks.push(cssBlock(`${selector}::${name}`, pseudoLines));
        }
      }
    }
    if (!matchedMode && options.includeMedia === true && rootReport) {
      for (const rule of rootReport.mediaRules) {
        if (rule.pseudo !== "element" && options.includePseudo === false) continue;
        const selector = `[data-style-scan-id="0"]${rule.pseudo === "element" ? "" : `::${rule.pseudo}`}`;
        blocks.push(...matchedBlocks([rule], selector, true));
      }
    }
    if (rootReport) warnings.push(...rootReport.warnings);
    warnings.push(matchedMode
      ? "The root uses matching source rules; descendants use computed snapshots. Unavailable source styles cannot be reconstructed."
      : "Component CSS is a computed visual snapshot; responsive rules and inaccessible source rules may be incomplete.");
    if (options.includeMedia === true && serialized.elements.length > 1) {
      warnings.push("Responsive source rules are included for the root only; descendant styles are captured at the current viewport.");
    }
    return { html: serialized.html, css: blocks.join("\n\n"), warnings };
  }

  window.StyleScanEngine = Object.freeze({
    version: VERSION,
    inspect,
    buildCss,
    serializeHtml,
    buildComponent,
    getUniqueSelector,
    getElementAtPoint,
  });
})();
