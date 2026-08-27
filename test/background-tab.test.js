"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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
