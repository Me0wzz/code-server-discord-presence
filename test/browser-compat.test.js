"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.resolve(__dirname, "../src/shared/browser-compat.js"),
  "utf8"
);

function chromiumContext() {
  let messageListener = null;
  const scriptCalls = [];
  const chrome = {
    tabs: {},
    scripting: {
      async executeScript(details) {
        scriptCalls.push(details);
        return [];
      }
    },
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        }
      }
    }
  };
  const context = vm.createContext({ chrome, console });
  vm.runInContext(source, context);
  return { context, chrome, scriptCalls, getMessageListener: () => messageListener };
}

test("Chromium namespace and scripting API are adapted to shared browser calls", async () => {
  const { context, chrome, scriptCalls } = chromiumContext();
  assert.equal(context.browser, chrome);
  await context.browser.tabs.executeScript(7, {
    file: "src/content-code-server.js",
    runAt: "document_idle"
  });
  assert.equal(scriptCalls.length, 1);
  assert.equal(scriptCalls[0].target.tabId, 7);
  assert.deepEqual(Array.from(scriptCalls[0].files), ["src/content-code-server.js"]);
});

test("Promise message handlers use callback-compatible async responses", async () => {
  const { context, getMessageListener } = chromiumContext();
  context.CodeServerBrowserCompat.addMessageListener(async (message) => ({ echoed: message.value }));
  const listener = getMessageListener();
  const response = new Promise((resolve) => {
    assert.equal(listener({ value: 42 }, {}, resolve), true);
  });
  assert.deepEqual(await response, { echoed: 42 });
});
