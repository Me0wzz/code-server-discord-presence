"use strict";

const elements = Object.fromEntries([
  "enabled", "statusDot", "statusText", "presenceDetails", "presenceState",
  "clientId", "saveClientId", "redirectUri", "copyRedirect", "connect", "disconnect",
  "codeServerUrl", "saveCodeServerUrl", "clearCodeServerUrl", "siteOrigin", "enableSite", "disableSite",
  "programPreset", "customProgramNameFields", "customProgramName", "programIconMode",
  "customProgramIconFields", "customProgramIconUrl", "saveProgram", "programPreview",
  "detailsTemplate", "stateTemplate", "saveTemplates", "privacyMode", "showFileName",
  "showWorkspace", "callbackForm", "callbackUrl", "error", "clearPresence"
].map((id) => [id, document.getElementById(id)]));

let latestState = null;
let programDirty = false;
let urlDirty = false;
let templatesDirty = false;

async function send(type, values = {}) {
  return browser.runtime.sendMessage({ type, ...values });
}

function patternForOrigin(origin) {
  return `${origin}/*`;
}

function parsedHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch (_error) {
    return null;
  }
}

function updateConditionalFields() {
  elements.customProgramNameFields.hidden = elements.programPreset.value !== "custom";
  elements.customProgramIconFields.hidden = elements.programIconMode.value !== "custom-url";
}

function render(state) {
  if (!state) return;
  latestState = state;
  const settings = state.settings;
  elements.enabled.checked = settings.enabled !== false;
  elements.privacyMode.checked = settings.privacyMode !== false;
  elements.showFileName.checked = settings.showFileName !== false;
  elements.showWorkspace.checked = settings.showWorkspace !== false;
  if (document.activeElement !== elements.clientId) elements.clientId.value = settings.clientId || "";
  elements.redirectUri.value = state.redirectUri || "";

  if (!urlDirty) elements.codeServerUrl.value = settings.codeServerUrl || "";
  elements.clearCodeServerUrl.disabled = !settings.codeServerUrl;
  if (!programDirty) {
    elements.programPreset.value = settings.programPreset || "code-server";
    elements.customProgramName.value = settings.customProgramName || "My IDE";
    elements.programIconMode.value = settings.programIconMode || "auto";
    elements.customProgramIconUrl.value = settings.customProgramIconUrl || "";
  }
  if (!templatesDirty) {
    elements.detailsTemplate.value = settings.detailsTemplate || "";
    elements.stateTemplate.value = settings.stateTemplate || "";
  }
  updateConditionalFields();
  elements.programPreview.textContent = state.resolvedProgram
    ? `Discord title: ${state.resolvedProgram.name} · icon: ${state.resolvedProgram.iconUrl || state.resolvedProgram.iconKey}`
    : "";

  const connected = Boolean(state.connected);
  elements.statusDot.classList.toggle("connected", connected);
  elements.statusText.textContent = state.authenticated
    ? `${connected ? "Presence active" : "Discord connected · waiting for code-server"}${state.user?.username ? ` · ${state.user.username}` : ""}`
    : "Discord not connected";
  elements.connect.disabled = Boolean(state.authenticated);
  elements.disconnect.disabled = !state.authenticated;
  elements.presenceDetails.textContent = state.currentPresence?.details ||
    (state.authenticated ? "Waiting for code-server activity" : "No activity");
  elements.presenceState.textContent = state.currentPresence?.state ||
    (state.authenticated ? "Open or focus an enabled code-server tab" : "");

  const activeSite = state.activeSite;
  elements.siteOrigin.textContent = activeSite?.origin || "Open a code-server tab first.";
  elements.enableSite.disabled = !activeSite || activeSite.enabled;
  elements.disableSite.disabled = !activeSite?.enabled;
  elements.callbackForm.classList.toggle("visible", Boolean(state.manualCallbackNeeded));
  elements.error.textContent = state.lastError || "";
  document.body.classList.toggle("privacy-enabled", settings.privacyMode !== false);
  elements.showFileName.disabled = settings.privacyMode !== false;
  elements.showWorkspace.disabled = settings.privacyMode !== false;
}

async function refresh() {
  try { render(await send("get-state")); }
  catch (error) { elements.error.textContent = error.message; }
}

async function saveClientId() {
  render(await send("save-client-id", { clientId: elements.clientId.value.trim() }));
}

elements.saveClientId.addEventListener("click", () => saveClientId().catch(refresh));
elements.copyRedirect.addEventListener("click", async () => {
  await navigator.clipboard.writeText(elements.redirectUri.value);
  elements.copyRedirect.textContent = "Copied";
  setTimeout(() => { elements.copyRedirect.textContent = "Copy"; }, 1000);
});
elements.connect.addEventListener("click", async () => {
  try {
    await saveClientId();
    render(await send("connect-discord"));
  } catch (_error) { await refresh(); }
});
elements.disconnect.addEventListener("click", async () => render(await send("disconnect-discord")));
elements.clearPresence.addEventListener("click", async () => render(await send("clear-presence")));

elements.codeServerUrl.addEventListener("input", () => { urlDirty = true; });
elements.saveCodeServerUrl.addEventListener("click", async () => {
  const url = parsedHttpUrl(elements.codeServerUrl.value);
  if (!url) {
    elements.error.textContent = "Enter a valid HTTP or HTTPS code-server URL.";
    return;
  }
  const granted = await browser.permissions.request({ origins: [patternForOrigin(url.origin)] });
  if (!granted) {
    elements.error.textContent = "Browser site permission was not granted.";
    return;
  }
  const state = await send("save-code-server-url", { codeServerUrl: url.href });
  urlDirty = false;
  render(state);
});
elements.clearCodeServerUrl.addEventListener("click", async () => {
  const oldUrl = parsedHttpUrl(latestState?.settings?.codeServerUrl);
  const state = await send("clear-code-server-url");
  if (oldUrl) await browser.permissions.remove({ origins: [patternForOrigin(oldUrl.origin)] });
  urlDirty = false;
  render(state);
});

for (const element of [
  elements.programPreset, elements.customProgramName, elements.programIconMode, elements.customProgramIconUrl
]) {
  element.addEventListener(element === elements.customProgramName || element === elements.customProgramIconUrl ? "input" : "change", () => {
    programDirty = true;
    updateConditionalFields();
  });
}
elements.saveProgram.addEventListener("click", async () => {
  const state = await send("save-program", {
    programPreset: elements.programPreset.value,
    customProgramName: elements.customProgramName.value.trim(),
    programIconMode: elements.programIconMode.value,
    customProgramIconUrl: elements.customProgramIconUrl.value.trim()
  });
  programDirty = false;
  render(state);
});

for (const element of [elements.detailsTemplate, elements.stateTemplate]) {
  element.addEventListener("input", () => { templatesDirty = true; });
}
elements.saveTemplates.addEventListener("click", async () => {
  const state = await send("save-templates", {
    detailsTemplate: elements.detailsTemplate.value,
    stateTemplate: elements.stateTemplate.value
  });
  templatesDirty = false;
  render(state);
});

elements.enableSite.addEventListener("click", async () => {
  const origin = latestState?.activeSite?.origin;
  if (!origin) return;
  const granted = await browser.permissions.request({ origins: [patternForOrigin(origin)] });
  if (!granted) {
    elements.error.textContent = "Browser site permission was not granted.";
    return;
  }
  render(await send("register-site", { origin }));
});
elements.disableSite.addEventListener("click", async () => {
  const origin = latestState?.activeSite?.origin;
  if (!origin) return;
  render(await send("unregister-site", { origin }));
  await browser.permissions.remove({ origins: [patternForOrigin(origin)] });
  await refresh();
});

for (const [element, type] of [
  [elements.enabled, "set-enabled"], [elements.privacyMode, "set-privacy-mode"],
  [elements.showFileName, "set-show-file-name"], [elements.showWorkspace, "set-show-workspace"]
]) {
  element.addEventListener("change", async () => render(await send(type, { value: element.checked })));
}

elements.callbackForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = elements.callbackUrl.value.trim();
  if (!url) return;
  render(await send("complete-oauth-callback", { url }));
  elements.callbackUrl.value = "";
});

refresh();
setInterval(refresh, 1500);
