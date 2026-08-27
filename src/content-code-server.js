(function startCodeServerPresence() {
  "use strict";

  const SCRIPT_VERSION = "0.1.0";
  if (globalThis.__codeServerDiscordPresenceLoaded === SCRIPT_VERSION) return;
  globalThis.__codeServerDiscordPresenceLoaded = SCRIPT_VERSION;

  let settings = {
    privacyMode: true,
    showFileName: true,
    showWorkspace: true,
    detailsTemplate: "",
    stateTemplate: "",
    programName: "code-server"
  };
  let lastMessageKey = "";
  let timer = null;

  function codeServerUiPresent() {
    return Boolean(
      document.querySelector(".monaco-workbench") || document.querySelector(".monaco-editor") ||
      document.querySelector(".part.editor") || document.querySelector(".editor-group-container") ||
      /(?:code-server|visual studio code|code - oss|vscodium)/i.test(document.title)
    );
  }

  function visibleActiveTab() {
    const selectors = [
      ".editor-group-container.active .tabs-container .tab.active",
      ".part.editor .editor-group-container.active .tab.active",
      ".tabs-container .tab.active[role='tab']", ".tabs-container .tab.active",
      "[role='tab'][aria-selected='true']"
    ];
    for (const selector of selectors) {
      for (const candidate of document.querySelectorAll(selector)) {
        const box = candidate.getBoundingClientRect();
        if (box.width > 0 && box.height > 0) return candidate;
      }
    }
    return null;
  }

  function activeFileName() {
    const tab = visibleActiveTab();
    if (!tab) return "";
    const label = tab.querySelector(
      ".label-name, .monaco-icon-label-container > .monaco-icon-name-container, .monaco-icon-name-container"
    );
    return CodeServerPresence.safeBasename(
      tab.getAttribute("data-resource-name") || label?.textContent ||
      tab.getAttribute("aria-label") || tab.textContent || ""
    );
  }

  function explorerWorkspaceName() {
    const ignored = /^(explorer|open editors|outline|timeline|no folder opened)$/i;
    for (const view of document.querySelectorAll(".explorer-folders-view")) {
      const pane = view.closest(".pane");
      const title = pane?.querySelector(".pane-header .title, .pane-header .title-name");
      const value = CodeServerPresence.safeWorkspaceName(title?.textContent || "");
      if (value && !ignored.test(value)) return value;
    }
    return "";
  }

  function cursorPosition() {
    const selectors = [
      ".statusbar-item[id='status.editor.selection']",
      ".statusbar-item[id*='editor.selection']",
      "[aria-label*='Line'][aria-label*='Column']",
      "[aria-label*='Ln'][aria-label*='Col']",
      "[aria-label*='줄'][aria-label*='열']"
    ];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        for (const value of [element.textContent, element.getAttribute("aria-label"), element.title]) {
          const parsed = CodeServerPresence.parseCursorPosition(value);
          if (parsed.lineNumber) return parsed;
        }
      }
    }
    return { lineNumber: null, columnNumber: null };
  }

  function readEditorContext() {
    const titleContext = CodeServerPresence.parseWindowTitle(document.title);
    const fileName = activeFileName() || titleContext.fileName;
    const workspaceName = CodeServerPresence.workspaceNameFromUrl(location.href) ||
      titleContext.workspaceName || explorerWorkspaceName();
    const position = cursorPosition();
    return {
      fileName,
      workspaceName,
      lineNumber: position.lineNumber,
      columnNumber: position.columnNumber,
      hasEditor: CodeServerPresence.looksLikeEditorName(fileName)
    };
  }

  async function refreshSettings() {
    const response = await browser.runtime.sendMessage({ type: "get-content-settings" }).catch(() => null);
    if (response) settings = { ...settings, ...response };
  }

  async function publish(force = false) {
    if (!codeServerUiPresent()) return;
    const message = CodeServerPresence.makeContentMessage(
      CodeServerPresence.buildPresence(readEditorContext(), settings)
    );
    const messageKey = JSON.stringify(message.presence);
    if (!force && messageKey === lastMessageKey) return;
    lastMessageKey = messageKey;
    await browser.runtime.sendMessage(message).catch(() => {});
  }

  function schedule(force = false) {
    clearTimeout(timer);
    timer = setTimeout(() => publish(force), 250);
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === "presence-settings-changed") {
      settings = { ...settings, ...(message.settings || {}) };
      lastMessageKey = "";
      schedule(true);
    } else if (message?.type === "request-editor-presence") schedule(true);
  });

  for (const observed of [document.querySelector("title"), document.querySelector(".part.statusbar")]) {
    if (observed) {
      new MutationObserver(() => schedule()).observe(observed, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
  }
  document.addEventListener("click", () => schedule(), true);
  document.addEventListener("keyup", () => schedule(), true);
  document.addEventListener("visibilitychange", () => schedule(true));
  window.addEventListener("focus", () => schedule(true));
  window.addEventListener("popstate", () => schedule(true));
  setInterval(() => schedule(), 2000);
  refreshSettings().then(() => publish(true));
})();
