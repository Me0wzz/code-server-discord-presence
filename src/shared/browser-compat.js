(function attachBrowserCompat(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CodeServerBrowserCompat = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createBrowserCompat(root) {
  "use strict";

  const extensionApi = root.browser || root.chrome || null;
  if (extensionApi && !root.browser) root.browser = extensionApi;

  if (
    extensionApi?.tabs &&
    !extensionApi.tabs.executeScript &&
    extensionApi.scripting?.executeScript
  ) {
    extensionApi.tabs.executeScript = (tabId, details = {}) => {
      if (!details.file) return Promise.reject(new Error("A packaged script file is required."));
      return extensionApi.scripting.executeScript({
        target: { tabId },
        files: [details.file]
      });
    };
  }

  function addMessageListener(listener) {
    if (!extensionApi?.runtime?.onMessage) {
      throw new Error("WebExtension runtime messaging is unavailable.");
    }
    extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const result = listener(message, sender, sendResponse);
      if (!result || typeof result.then !== "function") return result;
      result.then(sendResponse).catch((error) => {
        console.error("WebExtension message handler failed:", error);
        sendResponse(null);
      });
      return true;
    });
  }

  return Object.freeze({ api: extensionApi, addMessageListener });
});
