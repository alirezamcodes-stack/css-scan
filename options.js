(() => {
  "use strict";

  const KEY = "stylescanSettings";
  const DEFAULTS = Object.freeze({
    theme: "dark",
    showDimensions: true,
    showGuides: false,
    includePseudo: true,
    includeMedia: true,
    copyMode: "matched",
    autoCopy: false,
    maxDescendants: 120
  });
  const form = document.getElementById("settings-form");
  const status = document.getElementById("save-status");
  const descendantValue = document.getElementById("descendant-value");
  let current = { ...DEFAULTS };
  let saveTimer;
  let revision = 0;

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle("error", error);
  }

  function sanitize(raw) {
    const value = raw && typeof raw === "object" ? raw : {};
    const max = Number(value.maxDescendants);
    return {
      ...DEFAULTS,
      theme: ["dark", "light"].includes(value.theme) ? value.theme : DEFAULTS.theme,
      showDimensions: typeof value.showDimensions === "boolean" ? value.showDimensions : DEFAULTS.showDimensions,
      showGuides: typeof value.showGuides === "boolean" ? value.showGuides : DEFAULTS.showGuides,
      includePseudo: typeof value.includePseudo === "boolean" ? value.includePseudo : DEFAULTS.includePseudo,
      includeMedia: typeof value.includeMedia === "boolean" ? value.includeMedia : DEFAULTS.includeMedia,
      copyMode: ["matched", "computed"].includes(value.copyMode) ? value.copyMode : DEFAULTS.copyMode,
      autoCopy: typeof value.autoCopy === "boolean" ? value.autoCopy : DEFAULTS.autoCopy,
      maxDescendants: Number.isFinite(max) ? Math.max(0, Math.min(500, Math.round(max / 10) * 10)) : DEFAULTS.maxDescendants
    };
  }

  function render() {
    for (const [key, value] of Object.entries(current)) {
      const control = form.elements.namedItem(key);
      if (!control) continue;
      if (control.type === "checkbox") control.checked = value;
      else control.value = String(value);
    }
    descendantValue.value = String(current.maxDescendants);
    document.body.dataset.theme = current.theme;
  }

  function persist() {
    clearTimeout(saveTimer);
    const pendingRevision = ++revision;
    setStatus("Saving…");
    saveTimer = setTimeout(() => {
      chrome.storage.sync.set({ [KEY]: current }, () => {
        if (pendingRevision !== revision) return;
        const error = chrome.runtime.lastError;
        setStatus(error ? `Could not save settings: ${error.message}` : "All settings saved", Boolean(error));
      });
    }, 180);
  }

  form.addEventListener("change", (event) => {
    const control = event.target;
    if (!Object.hasOwn(DEFAULTS, control.name)) return;
    current = {
      ...current,
      [control.name]: control.type === "checkbox" ? control.checked : control.type === "range" ? Number(control.value) : control.value
    };
    current = sanitize(current);
    render();
    persist();
  });

  form.elements.namedItem("maxDescendants").addEventListener("input", (event) => {
    descendantValue.value = event.target.value;
  });

  document.getElementById("reset-settings").addEventListener("click", () => {
    current = { ...DEFAULTS };
    render();
    persist();
  });

  chrome.storage.sync.get(KEY, (result) => {
    const error = chrome.runtime.lastError;
    if (error) {
      setStatus(`Could not load settings: ${error.message}`, true);
      render();
      return;
    }
    current = sanitize(result?.[KEY]);
    render();
    setStatus("All settings saved");
  });
})();
