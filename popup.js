(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const hero = $(".hero");
  const toggle = $("#power-toggle");
  const copyCss = $("#copy-css");
  const copyComponent = $("#copy-component");
  const description = $("#inspector-description");
  const siteName = $("#site-name");
  const siteState = $("#site-state");
  const feedback = $("#feedback");
  let tabId = null;
  let enabled = false;
  let busy = false;
  let feedbackTimer;

  function showFeedback(message, error = false) {
    clearTimeout(feedbackTimer);
    feedback.textContent = message;
    feedback.classList.toggle("error", error);
    if (!error) feedbackTimer = setTimeout(() => { feedback.textContent = ""; }, 3500);
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    toggle.setAttribute("aria-checked", String(enabled));
    toggle.setAttribute("aria-label", enabled ? "Disable inspector for this tab" : "Enable inspector for this tab");
    hero.classList.toggle("is-active", enabled);
    siteState.textContent = enabled ? "Active" : "Off";
    description.textContent = enabled ? "Click any element to inspect its styles." : "Turn on to inspect elements on this page.";
    copyCss.disabled = !enabled || busy;
    copyComponent.disabled = !enabled || busy;
  }

  function setUnavailable(message) {
    toggle.disabled = true;
    copyCss.disabled = true;
    copyComponent.disabled = true;
    siteState.textContent = "Unavailable";
    description.textContent = message;
    showFeedback(message, true);
  }

  function queryActiveTab() {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const error = chrome.runtime.lastError;
        if (error) return reject(new Error(error.message));
        if (!tabs || !tabs[0] || typeof tabs[0].id !== "number") return reject(new Error("No active tab found."));
        resolve(tabs[0]);
      });
    });
  }

  function runtimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) return reject(new Error(error.message));
        if (response && (response.ok === false || response.success === false)) return reject(new Error(response.error || "The inspector could not start on this page."));
        resolve(response);
      });
    });
  }

  function tabMessage(type) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { type }, (response) => {
        const error = chrome.runtime.lastError;
        if (error) return reject(new Error(error.message));
        if (response && (response.ok === false || response.success === false)) return reject(new Error(response.error || "The action could not be completed."));
        resolve(response);
      });
    });
  }

  function extractEnabled(response, fallback) {
    if (typeof response === "boolean") return response;
    if (typeof response?.enabled === "boolean") return response.enabled;
    if (typeof response?.active === "boolean") return response.active;
    if (typeof response?.state?.enabled === "boolean") return response.state.enabled;
    return fallback;
  }

  async function initialize() {
    try {
      const tab = await queryActiveTab();
      tabId = tab.id;
      try { siteName.textContent = new URL(tab.url).hostname || "Current tab"; }
      catch { siteName.textContent = tab.title || "Current tab"; }
      await runtimeMessage({ type: "STYLSCAN_ENSURE", tabId });
      const state = await tabMessage("STYLSCAN_GET_STATE");
      toggle.disabled = false;
      setEnabled(extractEnabled(state, false));
    } catch (error) {
      setUnavailable("This page cannot be inspected. Try a regular website tab.");
    }
  }

  toggle.addEventListener("click", async () => {
    if (busy || tabId === null) return;
    busy = true;
    toggle.disabled = true;
    try {
      const response = await tabMessage("STYLSCAN_TOGGLE");
      setEnabled(extractEnabled(response, !enabled));
      showFeedback(enabled ? "Inspector enabled. Select an element on the page." : "Inspector disabled.");
    } catch (error) {
      showFeedback(error.message || "Could not toggle the inspector.", true);
    } finally {
      busy = false;
      toggle.disabled = false;
      setEnabled(enabled);
    }
  });

  async function copy(type, successMessage) {
    if (busy || !enabled) return;
    busy = true;
    copyCss.disabled = true;
    copyComponent.disabled = true;
    try {
      const response = await tabMessage(type);
      if (response?.copied === false) throw new Error(response.error || "Select an element on the page first.");
      showFeedback(successMessage);
    } catch (error) {
      showFeedback(error.message || "Select an element on the page first.", true);
    } finally {
      busy = false;
      setEnabled(enabled);
    }
  }

  copyCss.addEventListener("click", () => copy("STYLSCAN_COPY_CSS", "CSS copied to clipboard."));
  copyComponent.addEventListener("click", () => copy("STYLSCAN_COPY_COMPONENT", "Component copied to clipboard."));
  $("#open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

  initialize();
})();
