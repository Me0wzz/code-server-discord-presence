"use strict";

const DISCORD_API = "https://discord.com/api/v10";
const SESSION_REFRESH_ALARM = "refresh-headless-session";
const SESSION_REFRESH_MINUTES = 14;
const MIN_REPEAT_INTERVAL_MS = 5000;
const OAUTH_MAX_AGE_MS = 10 * 60 * 1000;

const PROGRAM_PRESETS = Object.freeze({
  "visual-studio-code": Object.freeze({ name: "Visual Studio Code", iconKey: "vscode" }),
  vscodium: Object.freeze({ name: "VSCodium", iconKey: "vscodium" }),
  "code-oss": Object.freeze({ name: "Code - OSS", iconKey: "vscode" }),
  "code-server": Object.freeze({ name: "code-server", iconKey: "vscode" }),
  cursor: Object.freeze({ name: "Cursor", iconKey: "cursor" }),
  antigravity: Object.freeze({ name: "Antigravity", iconKey: "antigravity" })
});
const PROGRAM_ICON_MODES = new Set([
  "auto", "vscode", "vscodium", "cursor", "antigravity", "custom-url"
]);

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  privacyMode: true,
  showFileName: true,
  showWorkspace: true,
  clientId: "",
  codeServerUrl: "",
  allowedOrigins: [],
  programPreset: "code-server",
  customProgramName: "My IDE",
  programIconMode: "auto",
  customProgramIconUrl: "",
  detailsTemplate: "",
  stateTemplate: ""
});

const DEFAULT_RUNTIME = Object.freeze({
  authenticated: false,
  connected: false,
  lastError: "",
  manualCallbackNeeded: false,
  user: null
});

let settings = { ...DEFAULT_SETTINGS };
let runtimeState = { ...DEFAULT_RUNTIME };
let authTokens = null;
let primaryHeadlessToken = "";
let knownHeadlessTokens = [];
let pendingDeletionTokens = [];
let sessionStartedAt = Date.now();
let currentPresence = null;
let activeCodeServerTabId = null;
let lastPresenceKey = "";
let lastPresenceSentAt = 0;
let presenceQueue = Promise.resolve();
let refreshPromise = null;

class DiscordRequestError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "DiscordRequestError";
    this.status = status;
    this.body = body;
  }
}

function redirectUri() {
  return browser.identity.getRedirectURL("discord");
}

function originFromUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
  } catch (_error) {
    return "";
  }
}

function normalizeCodeServerUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    url.search = "";
    url.hash = "";
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    return `${url.origin}${path}`;
  } catch (_error) {
    return "";
  }
}

function permissionPattern(origin) {
  return `${origin}/*`;
}

function isAllowedUrl(value) {
  const origin = originFromUrl(value);
  return Boolean(origin && settings.allowedOrigins.includes(origin));
}

function validClientId(value) {
  return /^\d{17,20}$/.test(String(value || "").trim());
}

function normalizeProgramSettings(source = {}) {
  const preset = source.programPreset === "custom" || PROGRAM_PRESETS[source.programPreset]
    ? source.programPreset
    : DEFAULT_SETTINGS.programPreset;
  const customProgramName = CodeServerPresence.cleanText(
    source.customProgramName || DEFAULT_SETTINGS.customProgramName,
    128
  ) || DEFAULT_SETTINGS.customProgramName;
  const legacyMode = CodeServerLanguageNames.isProgramIconKey(source.customProgramIcon)
    ? source.customProgramIcon
    : DEFAULT_SETTINGS.programIconMode;
  const requestedMode = source.programIconMode || legacyMode;
  const programIconMode = PROGRAM_ICON_MODES.has(requestedMode)
    ? requestedMode
    : DEFAULT_SETTINGS.programIconMode;
  const customProgramIconUrl = CodeServerPresence.safeHttpsImageUrl(source.customProgramIconUrl);
  return { programPreset: preset, customProgramName, programIconMode, customProgramIconUrl };
}

function resolvedProgram() {
  const base = settings.programPreset === "custom"
    ? { name: settings.customProgramName, iconKey: "vscode" }
    : (PROGRAM_PRESETS[settings.programPreset] || PROGRAM_PRESETS["code-server"]);
  if (settings.programIconMode === "custom-url" && settings.customProgramIconUrl) {
    return { ...base, iconUrl: settings.customProgramIconUrl };
  }
  if (CodeServerLanguageNames.isProgramIconKey(settings.programIconMode)) {
    return { ...base, iconKey: settings.programIconMode };
  }
  return base;
}

function contentPresentationSettings() {
  return {
    privacyMode: settings.privacyMode,
    showFileName: settings.showFileName,
    showWorkspace: settings.showWorkspace,
    detailsTemplate: settings.detailsTemplate,
    stateTemplate: settings.stateTemplate,
    programName: resolvedProgram().name
  };
}

async function saveSettings() {
  await browser.storage.local.set({ settings });
}

async function saveRuntime() {
  await browser.storage.local.set({ runtimeState });
}

async function saveAuthTokens() {
  if (authTokens) await browser.storage.local.set({ authTokens });
  else await browser.storage.local.remove("authTokens");
}

async function saveHeadlessSession() {
  await browser.storage.local.set({
    headlessSession: {
      primaryHeadlessToken, knownHeadlessTokens, pendingDeletionTokens, sessionStartedAt
    }
  });
}

function storedPresence(presence) {
  if (!presence) return null;
  const stored = {
    details: CodeServerPresence.cleanText(presence.details),
    state: CodeServerPresence.cleanText(presence.state),
    iconKey: CodeServerLanguageNames.isKnownIconKey(presence.iconKey) ? presence.iconKey : "text",
    privacyMode: Boolean(presence.privacyMode),
    updatedAt: Number(presence.updatedAt || Date.now())
  };
  if (stored.privacyMode) stored.safeContext = presence.safeContext || null;
  return stored;
}

async function savePresenceTracking() {
  const tabId = Number.isInteger(activeCodeServerTabId)
    ? activeCodeServerTabId
    : currentPresence?.tabId;
  const presence = storedPresence(currentPresence);
  if (!Number.isInteger(tabId) || !presence) {
    await browser.storage.session.remove("presenceTracking");
    return;
  }
  await browser.storage.session.set({ presenceTracking: { tabId, presence } });
}

function restorePresenceTracking(tracking) {
  const tabId = Number(tracking?.tabId);
  const source = tracking?.presence;
  if (!Number.isInteger(tabId) || tabId < 0 || !source) return null;
  const presence = {
    details: CodeServerPresence.cleanText(source.details),
    state: CodeServerPresence.cleanText(source.state),
    iconKey: CodeServerLanguageNames.isKnownIconKey(source.iconKey) ? source.iconKey : "text",
    privacyMode: Boolean(source.privacyMode),
    safeContext: source.safeContext || null,
    tabId,
    updatedAt: Number(source.updatedAt || Date.now())
  };
  if (presence.privacyMode !== settings.privacyMode) return null;
  if (presence.privacyMode && !CodeServerPresence.isPrivacySafePresence(
    presence, contentPresentationSettings()
  )) return null;
  presence.key = JSON.stringify({
    details: presence.details,
    state: presence.state,
    iconKey: presence.iconKey,
    privacyMode: presence.privacyMode
  });
  return Object.freeze(presence);
}

async function reconcilePresenceTracking() {
  if (!currentPresence || !Number.isInteger(activeCodeServerTabId)) {
    await clearPresence();
    return false;
  }
  const tab = await browser.tabs.get(activeCodeServerTabId).catch(() => null);
  const hasPermission = tab && isAllowedUrl(tab.url)
    ? await browser.permissions.contains({
      origins: [permissionPattern(originFromUrl(tab.url))]
    }).catch(() => false)
    : false;
  if (!hasPermission) {
    await clearPresence();
    return false;
  }
  return true;
}

async function setError(error) {
  runtimeState = {
    ...runtimeState,
    connected: false,
    lastError: CodeServerPresence.cleanText(error?.message || error || "Unknown error", 240)
  };
  await saveRuntime();
}

async function initialize() {
  const [stored, sessionStored] = await Promise.all([
    browser.storage.local.get(["settings", "runtimeState", "authTokens", "headlessSession"]),
    browser.storage.session.get("presenceTracking")
  ]);
  settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  settings = { ...settings, ...normalizeProgramSettings(settings) };
  settings.codeServerUrl = normalizeCodeServerUrl(settings.codeServerUrl);
  settings.detailsTemplate = CodeServerPresence.cleanText(settings.detailsTemplate, 256);
  settings.stateTemplate = CodeServerPresence.cleanText(settings.stateTemplate, 256);
  settings.allowedOrigins = Array.from(new Set(settings.allowedOrigins || []))
    .map(originFromUrl)
    .filter(Boolean);
  runtimeState = { ...DEFAULT_RUNTIME, ...(stored.runtimeState || {}) };
  authTokens = stored.authTokens || null;
  primaryHeadlessToken = stored.headlessSession?.primaryHeadlessToken || "";
  knownHeadlessTokens = stored.headlessSession?.knownHeadlessTokens ||
    (primaryHeadlessToken ? [primaryHeadlessToken] : []);
  pendingDeletionTokens = stored.headlessSession?.pendingDeletionTokens || [];
  sessionStartedAt = stored.headlessSession?.sessionStartedAt || Date.now();
  currentPresence = restorePresenceTracking(sessionStored.presenceTracking);
  activeCodeServerTabId = currentPresence?.tabId ?? null;
  runtimeState.authenticated = Boolean(authTokens?.accessToken);
  runtimeState.connected = Boolean(primaryHeadlessToken && authTokens?.accessToken);
  browser.alarms.create(SESSION_REFRESH_ALARM, { periodInMinutes: SESSION_REFRESH_MINUTES });
  await Promise.all([saveSettings(), saveRuntime(), saveHeadlessSession()]);
  await reconcilePresenceTracking();
  setTimeout(() => restoreSavedSites().catch(setError), 0);
}

const initialized = initialize();

async function publicState() {
  let activeTab = null;
  try {
    [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  } catch (_error) {
    // State remains useful if no browser window is focused.
  }
  const activeOrigin = originFromUrl(activeTab?.url);
  let sitePermissionGranted = false;
  if (activeOrigin && settings.allowedOrigins.includes(activeOrigin)) {
    sitePermissionGranted = await browser.permissions.contains({
      origins: [permissionPattern(activeOrigin)]
    }).catch(() => false);
  }
  return {
    settings: { ...settings, allowedOrigins: [...settings.allowedOrigins] },
    resolvedProgram: resolvedProgram(),
    authenticated: Boolean(authTokens?.accessToken),
    connected: Boolean(primaryHeadlessToken && authTokens?.accessToken),
    lastError: runtimeState.lastError,
    manualCallbackNeeded: runtimeState.manualCallbackNeeded,
    user: runtimeState.user,
    redirectUri: redirectUri(),
    currentPresence: currentPresence
      ? { details: currentPresence.details, state: currentPresence.state, privacyMode: currentPresence.privacyMode }
      : null,
    activeSite: activeOrigin ? { origin: activeOrigin, enabled: sitePermissionGranted } : null
  };
}

async function exchangeToken(parameters) {
  if (!validClientId(settings.clientId)) throw new Error("Save a valid Discord Application ID first.");
  const form = CodeServerDiscordOAuth.buildTokenForm({
    clientId: settings.clientId,
    redirectUri: redirectUri(),
    ...parameters
  });
  const response = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new DiscordRequestError(
      data.error_description || data.message || `Discord OAuth error ${response.status}`,
      response.status,
      data
    );
  }
  if (!CodeServerDiscordOAuth.hasRequiredScopes(data.scope)) {
    throw new Error("Discord did not grant the required presence scopes.");
  }
  authTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || authTokens?.refreshToken || "",
    expiresAt: Date.now() + Math.max(Number(data.expires_in || 3600) - 60, 60) * 1000,
    scope: data.scope
  };
  await saveAuthTokens();
  return authTokens.accessToken;
}

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;
  if (!authTokens?.refreshToken) throw new Error("Discord login expired. Connect again.");
  refreshPromise = exchangeToken({
    grantType: "refresh_token",
    refreshToken: authTokens.refreshToken
  }).finally(() => { refreshPromise = null; });
  return refreshPromise;
}

async function getAccessToken() {
  if (!authTokens?.accessToken) throw new Error("Connect Discord first.");
  if (Date.now() < Number(authTokens.expiresAt || 0)) return authTokens.accessToken;
  return refreshAccessToken();
}

async function discordRequest(path, options = {}, retryAuthentication = true) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${DISCORD_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (response.status === 401 && retryAuthentication && authTokens?.refreshToken) {
    await refreshAccessToken();
    return discordRequest(path, options, false);
  }
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const retryAfter = Number(body.retry_after || 0);
    const suffix = response.status === 429 && retryAfter
      ? ` Retry after ${Math.ceil(retryAfter)} seconds.`
      : "";
    throw new DiscordRequestError(
      `${body.message || `Discord API error ${response.status}`}${suffix}`,
      response.status,
      body
    );
  }
  return body;
}

async function rememberHeadlessToken(token) {
  if (!token) return;
  primaryHeadlessToken = token;
  knownHeadlessTokens = Array.from(new Set([...knownHeadlessTokens, token])).slice(-8);
  pendingDeletionTokens = pendingDeletionTokens.filter((item) => item !== token);
  await saveHeadlessSession();
}

function enqueue(operation) {
  presenceQueue = presenceQueue.catch(() => {}).then(operation);
  return presenceQueue;
}

async function writePresence(presence, force = false) {
  if (!settings.enabled || !authTokens?.accessToken || !validClientId(settings.clientId)) return;
  const now = Date.now();
  if (!force && presence.key === lastPresenceKey && now - lastPresenceSentAt < MIN_REPEAT_INTERVAL_MS) return;
  const program = resolvedProgram();
  let body = CodeServerPresence.makeHeadlessBody(
    presence, settings.clientId, sessionStartedAt, primaryHeadlessToken, program
  );
  let result;
  try {
    result = await discordRequest("/users/@me/headless-sessions", {
      method: "POST",
      body: JSON.stringify(body)
    });
  } catch (error) {
    if (!primaryHeadlessToken || !(error instanceof DiscordRequestError) || ![400, 404].includes(error.status)) {
      throw error;
    }
    primaryHeadlessToken = "";
    knownHeadlessTokens = [];
    await saveHeadlessSession();
    body = CodeServerPresence.makeHeadlessBody(presence, settings.clientId, sessionStartedAt, "", program);
    result = await discordRequest("/users/@me/headless-sessions", {
      method: "POST",
      body: JSON.stringify(body)
    });
  }
  await rememberHeadlessToken(result?.token || primaryHeadlessToken);
  lastPresenceKey = presence.key;
  lastPresenceSentAt = now;
  runtimeState = { ...runtimeState, authenticated: true, connected: true, lastError: "" };
  await saveRuntime();
}

function queuePresence(presence, force = false) {
  return enqueue(() => writePresence(presence, force));
}

async function deleteKnownHeadlessSessions() {
  return enqueue(async () => {
    const tokens = Array.from(new Set([
      primaryHeadlessToken, ...knownHeadlessTokens, ...pendingDeletionTokens
    ].filter(Boolean)));
    primaryHeadlessToken = "";
    knownHeadlessTokens = [];
    pendingDeletionTokens = tokens;
    lastPresenceKey = "";
    lastPresenceSentAt = 0;
    await saveHeadlessSession();
    if (!authTokens?.accessToken || !tokens.length) return;
    const outcomes = await Promise.all(tokens.map(async (token) => {
      try {
        await discordRequest("/users/@me/headless-sessions/delete", {
          method: "POST",
          body: JSON.stringify({ token })
        });
        return null;
      } catch (error) {
        if (error instanceof DiscordRequestError && [400, 404].includes(error.status)) return null;
        return token;
      }
    }));
    pendingDeletionTokens = outcomes.filter(Boolean);
    await saveHeadlessSession();
  });
}

async function clearPresence({ forgetContext = true } = {}) {
  if (forgetContext) {
    currentPresence = null;
    activeCodeServerTabId = null;
    await savePresenceTracking();
  }
  await deleteKnownHeadlessSessions();
  runtimeState = { ...runtimeState, connected: false, lastError: "" };
  await saveRuntime();
}

async function startOAuth() {
  if (!validClientId(settings.clientId)) throw new Error("Save a valid Discord Application ID first.");
  const verifier = CodeServerDiscordOAuth.randomBase64Url(64);
  const challenge = await CodeServerDiscordOAuth.sha256Base64Url(verifier);
  const state = CodeServerDiscordOAuth.randomBase64Url(24);
  await browser.storage.local.set({ oauthPending: { verifier, state, createdAt: Date.now() } });
  const authorizationUrl = CodeServerDiscordOAuth.buildAuthorizationUrl({
    clientId: settings.clientId,
    redirectUri: redirectUri(),
    state,
    codeChallenge: challenge
  });
  try {
    const redirectedTo = await browser.identity.launchWebAuthFlow({ url: authorizationUrl, interactive: true });
    await completeOAuth(redirectedTo);
  } catch (error) {
    runtimeState = {
      ...runtimeState,
      manualCallbackNeeded: true,
      lastError: "The browser did not capture the OAuth redirect. Paste the failed callback URL below."
    };
    await saveRuntime();
    throw error;
  }
}

async function completeOAuth(redirectedTo) {
  const { oauthPending } = await browser.storage.local.get("oauthPending");
  if (!oauthPending || Date.now() - oauthPending.createdAt > OAUTH_MAX_AGE_MS) {
    throw new Error("Start Discord connection again before completing the callback.");
  }
  const actual = new URL(String(redirectedTo || ""));
  const expected = new URL(redirectUri());
  if (actual.origin !== expected.origin || actual.pathname !== expected.pathname) {
    throw new Error("The pasted URL is not this extension's Discord callback URL.");
  }
  if (actual.searchParams.get("state") !== oauthPending.state) throw new Error("Discord OAuth state mismatch.");
  const code = actual.searchParams.get("code");
  if (!code) throw new Error(actual.searchParams.get("error_description") || "Discord did not return an authorization code.");
  await exchangeToken({ grantType: "authorization_code", code, codeVerifier: oauthPending.verifier });
  await browser.storage.local.remove("oauthPending");
  const profile = await discordRequest("/oauth2/userinfo");
  runtimeState = {
    ...runtimeState,
    authenticated: true,
    connected: false,
    manualCallbackNeeded: false,
    user: { id: profile.sub, username: profile.preferred_username || profile.nickname || profile.sub },
    lastError: ""
  };
  sessionStartedAt = Date.now();
  await Promise.all([saveRuntime(), saveHeadlessSession()]);
  if (currentPresence && settings.enabled) await queuePresence(currentPresence, true);
  await notifyActiveCodeServerTabs();
}

async function logout() {
  await clearPresence();
  authTokens = null;
  await browser.storage.local.remove(["authTokens", "oauthPending"]);
  runtimeState = { ...DEFAULT_RUNTIME };
  await saveRuntime();
}

async function injectCodeServerScripts(tabId, url) {
  if (!isAllowedUrl(url)) return false;
  const origin = originFromUrl(url);
  const hasPermission = await browser.permissions.contains({ origins: [permissionPattern(origin)] });
  if (!hasPermission) return false;
  try {
    for (const file of [
      "src/shared/browser-compat.js", "src/shared/language-names.js", "src/shared/presence.js", "src/content-code-server.js"
    ]) {
      await browser.tabs.executeScript(tabId, { file, runAt: "document_idle" });
    }
    await browser.tabs.sendMessage(tabId, { type: "request-editor-presence" }).catch(() => {});
    return true;
  } catch (error) {
    await setError(new Error(`Could not inspect this code-server tab: ${error.message}`));
    return false;
  }
}

async function restoreSavedSites() {
  const candidates = new Set(settings.allowedOrigins);
  const configuredOrigin = originFromUrl(settings.codeServerUrl);
  if (configuredOrigin) candidates.add(configuredOrigin);
  const restored = [];
  for (const origin of candidates) {
    const granted = await browser.permissions.contains({ origins: [permissionPattern(origin)] }).catch(() => false);
    if (granted) restored.push(origin);
  }
  if (configuredOrigin && !restored.includes(configuredOrigin)) settings.codeServerUrl = "";
  settings = { ...settings, allowedOrigins: restored };
  await saveSettings();
  const tabs = await browser.tabs.query({}).catch(() => []);
  await Promise.all(tabs.filter((tab) => isAllowedUrl(tab.url)).map((tab) =>
    injectCodeServerScripts(tab.id, tab.url)
  ));
}

async function notifyActiveCodeServerTabs() {
  const tabs = await browser.tabs.query({ active: true });
  const contentSettings = contentPresentationSettings();
  await Promise.all(tabs.map(async (tab) => {
    if (!isAllowedUrl(tab.url)) return;
    await injectCodeServerScripts(tab.id, tab.url);
    await browser.tabs.sendMessage(tab.id, {
      type: "presence-settings-changed",
      settings: contentSettings
    }).catch(() => {});
  }));
}

async function handleEditorPresence(message, sender) {
  const tab = sender.tab;
  if (!tab?.id || !isAllowedUrl(tab.url || sender.url)) return { ignored: true };
  if (activeCodeServerTabId && tab.id !== activeCodeServerTabId) return { ignored: true };
  if (!activeCodeServerTabId) activeCodeServerTabId = tab.id;
  const presence = message.presence;
  if (!presence || Boolean(presence.privacyMode) !== settings.privacyMode) return { ignored: true };
  if (settings.privacyMode && !CodeServerPresence.isPrivacySafePresence(
    presence,
    contentPresentationSettings()
  )) {
    throw new Error("Blocked an unsafe Privacy Mode presence before it reached Discord.");
  }
  const iconKey = CodeServerLanguageNames.isKnownIconKey(presence.iconKey) ? presence.iconKey : "text";
  currentPresence = Object.freeze({
    details: CodeServerPresence.cleanText(presence.details),
    state: CodeServerPresence.cleanText(presence.state),
    iconKey,
    privacyMode: Boolean(presence.privacyMode),
    safeContext: presence.privacyMode ? presence.safeContext : null,
    key: JSON.stringify({
      details: CodeServerPresence.cleanText(presence.details),
      state: CodeServerPresence.cleanText(presence.state),
      iconKey,
      privacyMode: Boolean(presence.privacyMode)
    }),
    tabId: tab.id,
    updatedAt: Number(message.observedAt || Date.now())
  });
  activeCodeServerTabId = tab.id;
  await savePresenceTracking();
  if (settings.enabled && authTokens?.accessToken) await queuePresence(currentPresence);
  return { ok: true };
}

async function registerSite(originValue) {
  const origin = originFromUrl(originValue);
  if (!origin) throw new Error("Only HTTP or HTTPS code-server sites can be enabled.");
  const granted = await browser.permissions.contains({ origins: [permissionPattern(origin)] });
  if (!granted) throw new Error("Browser site permission was not granted.");
  settings = { ...settings, allowedOrigins: Array.from(new Set([...settings.allowedOrigins, origin])) };
  await saveSettings();
  const tabs = await browser.tabs.query({ url: permissionPattern(origin) }).catch(() => []);
  await Promise.all(tabs.map((tab) => injectCodeServerScripts(tab.id, tab.url)));
}

async function saveConfiguredCodeServerUrl(value) {
  const codeServerUrl = normalizeCodeServerUrl(value);
  if (!codeServerUrl) throw new Error("Enter a valid HTTP or HTTPS code-server URL.");
  const origin = originFromUrl(codeServerUrl);
  const granted = await browser.permissions.contains({ origins: [permissionPattern(origin)] });
  if (!granted) throw new Error("Browser site permission was not granted for that URL.");
  settings = {
    ...settings,
    codeServerUrl,
    allowedOrigins: Array.from(new Set([...settings.allowedOrigins, origin]))
  };
  await saveSettings();
  const tabs = await browser.tabs.query({ url: permissionPattern(origin) }).catch(() => []);
  await Promise.all(tabs.map((tab) => injectCodeServerScripts(tab.id, tab.url)));
}

async function clearConfiguredCodeServerUrl() {
  const origin = originFromUrl(settings.codeServerUrl);
  settings = {
    ...settings,
    codeServerUrl: "",
    allowedOrigins: origin ? settings.allowedOrigins.filter((item) => item !== origin) : settings.allowedOrigins
  };
  await saveSettings();
  if (origin && currentPresence && originFromUrl((await browser.tabs.get(currentPresence.tabId).catch(() => null))?.url) === origin) {
    await clearPresence();
  }
}

async function unregisterSite(originValue) {
  const origin = originFromUrl(originValue);
  settings = {
    ...settings,
    codeServerUrl: originFromUrl(settings.codeServerUrl) === origin ? "" : settings.codeServerUrl,
    allowedOrigins: settings.allowedOrigins.filter((item) => item !== origin)
  };
  await saveSettings();
  if (currentPresence?.tabId === activeCodeServerTabId) {
    activeCodeServerTabId = null;
    await clearPresence();
  }
}

async function updateSetting(name, value) {
  const oldPrivacyMode = settings.privacyMode;
  settings = { ...settings, [name]: Boolean(value) };
  await saveSettings();
  if (name === "enabled") {
    if (!settings.enabled) await clearPresence({ forgetContext: false });
    else {
      sessionStartedAt = Date.now();
      await saveHeadlessSession();
      if (currentPresence && authTokens?.accessToken) await queuePresence(currentPresence, true);
    }
  }
  if (name === "privacyMode" && settings.privacyMode && !oldPrivacyMode) await clearPresence();
  await notifyActiveCodeServerTabs();
}

async function updateProgram(message) {
  const normalized = normalizeProgramSettings({
    programPreset: message.programPreset,
    customProgramName: message.customProgramName,
    programIconMode: message.programIconMode,
    customProgramIconUrl: message.customProgramIconUrl
  });
  if (normalized.programIconMode === "custom-url" && !normalized.customProgramIconUrl) {
    throw new Error("Custom program icons must use a valid public HTTPS image URL.");
  }
  settings = { ...settings, ...normalized };
  await saveSettings();
  await notifyActiveCodeServerTabs();
  if (settings.enabled && currentPresence && authTokens?.accessToken) await queuePresence(currentPresence, true);
}

async function updateTemplates(message) {
  settings = {
    ...settings,
    detailsTemplate: CodeServerPresence.cleanText(message.detailsTemplate, 256),
    stateTemplate: CodeServerPresence.cleanText(message.stateTemplate, 256)
  };
  await saveSettings();
  await notifyActiveCodeServerTabs();
}

async function handleMessage(message, sender) {
  if (!message?.type) return null;
  if (message.type === "get-state") return publicState();
  if (message.type === "get-content-settings") {
    if (!isAllowedUrl(sender.tab?.url || sender.url)) return null;
    return contentPresentationSettings();
  }
  if (message.type === "editor-presence") return handleEditorPresence(message, sender);

  if (message.type === "register-site") await registerSite(message.origin);
  else if (message.type === "unregister-site") await unregisterSite(message.origin);
  else if (message.type === "save-code-server-url") await saveConfiguredCodeServerUrl(message.codeServerUrl);
  else if (message.type === "clear-code-server-url") await clearConfiguredCodeServerUrl();
  else if (message.type === "set-enabled") await updateSetting("enabled", message.value);
  else if (message.type === "set-privacy-mode") await updateSetting("privacyMode", message.value);
  else if (message.type === "set-show-file-name") await updateSetting("showFileName", message.value);
  else if (message.type === "set-show-workspace") await updateSetting("showWorkspace", message.value);
  else if (message.type === "save-program") await updateProgram(message);
  else if (message.type === "save-templates") await updateTemplates(message);
  else if (message.type === "save-client-id") {
    const clientId = String(message.clientId || "").trim();
    if (!validClientId(clientId)) throw new Error("Discord Application ID must be a 17–20 digit number.");
    if (settings.clientId && settings.clientId !== clientId && authTokens) await logout();
    settings = { ...settings, clientId };
    await saveSettings();
  } else if (message.type === "connect-discord") await startOAuth();
  else if (message.type === "complete-oauth-callback") await completeOAuth(message.url);
  else if (message.type === "disconnect-discord") await logout();
  else if (message.type === "clear-presence") await clearPresence({ forgetContext: false });
  else return null;
  return publicState();
}

CodeServerBrowserCompat.addMessageListener((message, sender) =>
  initialized.then(() => handleMessage(message, sender)).catch(async (error) => {
    await setError(error);
    return publicState();
  })
);

browser.tabs.onActivated.addListener(({ tabId }) => {
  initialized.then(async () => {
    const tab = await browser.tabs.get(tabId);
    if (isAllowedUrl(tab.url)) {
      activeCodeServerTabId = tabId;
      await injectCodeServerScripts(tabId, tab.url);
    }
  }).catch(setError);
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== "complete") return;
  initialized.then(async () => {
    if (isAllowedUrl(tab.url)) {
      if (tab.active) activeCodeServerTabId = tabId;
      if (tab.active || activeCodeServerTabId === tabId) {
        await injectCodeServerScripts(tabId, tab.url);
      }
    } else if (activeCodeServerTabId === tabId) {
      activeCodeServerTabId = null;
      await clearPresence();
    }
  }).catch(setError);
});

browser.tabs.onRemoved.addListener((tabId) => {
  initialized.then(async () => {
    if (activeCodeServerTabId !== tabId && currentPresence?.tabId !== tabId) return;
    await clearPresence();
  }).catch(setError);
});

if (browser.windows?.onRemoved) {
  browser.windows.onRemoved.addListener(() => {
    initialized.then(async () => {
      const windows = await browser.windows.getAll({ windowTypes: ["normal"] }).catch(() => null);
      if (Array.isArray(windows) && windows.length === 0) await clearPresence();
    }).catch(setError);
  });
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== SESSION_REFRESH_ALARM) return;
  initialized.then(async () => {
    if (settings.enabled && currentPresence && authTokens?.accessToken) {
      await queuePresence(currentPresence, true);
    }
  }).catch(setError);
});

browser.permissions.onRemoved.addListener((permissions) => {
  const removedOrigins = (permissions.origins || []).map(originFromUrl).filter(Boolean);
  if (!removedOrigins.length) return;
  initialized.then(async () => {
    settings = {
      ...settings,
      codeServerUrl: removedOrigins.includes(originFromUrl(settings.codeServerUrl)) ? "" : settings.codeServerUrl,
      allowedOrigins: settings.allowedOrigins.filter((origin) => !removedOrigins.includes(origin))
    };
    await saveSettings();
  }).catch(setError);
});
