"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const presenceApi = require("../src/shared/presence.js");
const languageApi = require("../src/shared/language-names.js");
const oauthApi = require("../src/shared/oauth.js");

const background = fs.readFileSync(
  path.resolve(__dirname, "../src/background.js"),
  "utf8"
);
const content = fs.readFileSync(
  path.resolve(__dirname, "../src/content-code-server.js"),
  "utf8"
);

test("switching to another browser tab keeps the last code-server presence", () => {
  const start = background.indexOf("browser.tabs.onActivated.addListener");
  const end = background.indexOf("browser.tabs.onUpdated.addListener", start);
  const activationHandler = background.slice(start, end);
  assert.equal(activationHandler.includes("clearPresence"), false);
  assert.match(background, /activeCodeServerTabId && tab\.id !== activeCodeServerTabId/);
});

test("the tracked code-server tab can report while hidden", () => {
  assert.equal(content.includes('document.visibilityState === "hidden"'), false);
  assert.match(content, /visibilitychange", \(\) => schedule\(true\)/);
});

test("closing or navigating the tracked code-server tab still clears presence", () => {
  const updatedStart = background.indexOf("browser.tabs.onUpdated.addListener");
  const removedStart = background.indexOf("browser.tabs.onRemoved.addListener");
  const alarmStart = background.indexOf("browser.alarms.onAlarm.addListener");
  assert.match(background.slice(updatedStart, removedStart), /await clearPresence\(\)/);
  assert.match(background.slice(removedStart, alarmStart), /await clearPresence\(\)/);
});

test("tracked Presence state uses session-scoped storage", () => {
  assert.match(background, /browser\.storage\.session\.set\(\{ presenceTracking/);
  assert.equal(background.includes("browser.storage.local.set({ presenceTracking"), false);
});

function listenerEvent() {
  let listener = null;
  return {
    addListener(value) { listener = value; },
    fire(...args) { return listener?.(...args); }
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultLifecycleStorage() {
  return {
    settings: {
      enabled: true,
      privacyMode: true,
      clientId: "123456789012345678",
      allowedOrigins: ["https://code.example.test"]
    },
    runtimeState: { authenticated: true, connected: true },
    authTokens: { accessToken: "access-token", expiresAt: Date.now() + 60000 },
    headlessSession: {
      primaryHeadlessToken: "headless-token",
      knownHeadlessTokens: ["headless-token"],
      pendingDeletionTokens: [],
      sessionStartedAt: 1700000000000
    },
    presenceTracking: {
      tabId: 7,
      presence: {
        details: "Editing Python file",
        state: "In Workspace",
        iconKey: "python",
        privacyMode: true,
        safeContext: {
          hasEditor: true,
          language: "Python",
          fileExtension: ".py",
          lineNumber: 42,
          columnNumber: 7
        },
        updatedAt: 1700000000000
      }
    }
  };
}

function lifecycleHarness({ initialStorage, tabExists = true, deleteSucceeds = true } = {}) {
  const storage = clone(initialStorage || defaultLifecycleStorage());
  let releaseStorage;
  const storageReady = new Promise((resolve) => {
    releaseStorage = () => resolve(clone(storage));
  });
  const events = {
    activated: listenerEvent(),
    updated: listenerEvent(),
    removed: listenerEvent(),
    alarm: listenerEvent(),
    permissionRemoved: listenerEvent(),
    windowRemoved: listenerEvent()
  };
  const deletedTokens = [];
  let normalWindows = [{ id: 1 }];
  const browser = {
    storage: {
      local: {
        get: async () => storageReady,
        async set(value) { Object.assign(storage, clone(value)); },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key];
        }
      },
      session: {
        get: async () => storageReady,
        async set(value) { Object.assign(storage, clone(value)); },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key];
        }
      }
    },
    identity: { getRedirectURL: () => "https://example.extensions.allizom.org/discord" },
    alarms: { create() {}, onAlarm: events.alarm },
    permissions: {
      contains: async () => true,
      onRemoved: events.permissionRemoved
    },
    tabs: {
      get: async (tabId) => {
        if (!tabExists) throw new Error("Missing tab");
        return { id: tabId, url: "https://code.example.test/editor" };
      },
      query: async () => [],
      executeScript: async () => [],
      sendMessage: async () => null,
      onActivated: events.activated,
      onUpdated: events.updated,
      onRemoved: events.removed
    },
    windows: {
      getAll: async () => normalWindows,
      onRemoved: events.windowRemoved
    }
  };
  const context = vm.createContext({
    browser,
    CodeServerBrowserCompat: { addMessageListener() {} },
    CodeServerDiscordOAuth: oauthApi,
    CodeServerLanguageNames: languageApi,
    CodeServerPresence: presenceApi,
    URL,
    console,
    setTimeout: () => 1,
    clearTimeout() {},
    fetch: async (url, options) => {
      if (String(url).endsWith("/users/@me/headless-sessions/delete")) {
        deletedTokens.push(JSON.parse(options.body).token);
        if (!deleteSucceeds) throw new Error("Browser stopped before deletion completed");
        return { status: 204, ok: true, json: async () => ({}) };
      }
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  vm.runInContext(background, context);
  return {
    storage,
    events,
    deletedTokens,
    releaseStorage,
    setNormalWindows(value) { normalWindows = value; }
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for background lifecycle work");
}

test("tab removal waits for non-persistent background state restoration", async () => {
  const harness = lifecycleHarness();
  harness.events.removed.fire(7);
  harness.releaseStorage();

  await waitFor(() => harness.deletedTokens.includes("headless-token"));
  await waitFor(() => harness.storage.headlessSession.pendingDeletionTokens.length === 0);
  assert.equal(Object.hasOwn(harness.storage, "presenceTracking"), false);
  assert.equal(harness.storage.headlessSession.primaryHeadlessToken, "");
});

test("startup removes an orphaned session when its tracked tab is gone", async () => {
  const harness = lifecycleHarness({ tabExists: false });
  harness.releaseStorage();

  await waitFor(() => harness.deletedTokens.includes("headless-token"));
  assert.equal(Object.hasOwn(harness.storage, "presenceTracking"), false);
});

test("failed shutdown deletion remains queued and retries on the next start", async () => {
  const first = lifecycleHarness({ tabExists: false, deleteSucceeds: false });
  first.releaseStorage();
  await waitFor(() => first.deletedTokens.includes("headless-token"));
  await waitFor(() => first.storage.headlessSession.pendingDeletionTokens.includes("headless-token"));

  const restartedStorage = clone(first.storage);
  delete restartedStorage.presenceTracking;
  const second = lifecycleHarness({ initialStorage: restartedStorage, tabExists: false });
  second.releaseStorage();
  await waitFor(() => second.deletedTokens.includes("headless-token"));
  await waitFor(() => second.storage.headlessSession.pendingDeletionTokens.length === 0);
});

test("closing the final normal browser window requests Presence deletion", async () => {
  const harness = lifecycleHarness();
  harness.releaseStorage();
  await new Promise((resolve) => setImmediate(resolve));
  harness.setNormalWindows([]);
  harness.events.windowRemoved.fire(1);

  await waitFor(() => harness.deletedTokens.includes("headless-token"));
});
