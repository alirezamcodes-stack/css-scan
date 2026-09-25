"use strict";

// An action click grants activeTab access. Inject only into that tab, rather
// than requesting permanent access to every site the user visits.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "STYLSCAN_ENSURE") return false;

  const tabId = message.tabId;
  if (!Number.isInteger(tabId)) {
    sendResponse({ ok: false, error: "No active tab was supplied." });
    return false;
  }

  (async () => {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!/^https?:\/\//i.test(tab.url || "")) {
        throw new Error("This page does not allow browser extensions. Open a normal http or https page.");
      }
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        files: ["src/engine.js"]
      });
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        files: ["src/content.js"]
      });
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || String(error) });
    }
  })();
  return true;
});
