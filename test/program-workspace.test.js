"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const presence = require("../src/shared/presence.js");

test("Code - OSS suffix is not mistaken for a workspace", () => {
  assert.deepEqual(
    presence.parseWindowTitle("main.cpp - ee-study - Code - OSS"),
    { fileName: "main.cpp", workspaceName: "ee-study" }
  );
  assert.deepEqual(
    presence.parseWindowTitle("ee-study - Code - OSS"),
    { fileName: "", workspaceName: "ee-study" }
  );
});

test("workspace directory is extracted from code-server folder and workspace URLs", () => {
  assert.equal(
    presence.workspaceNameFromUrl("https://ide.example.test/?folder=%2Fconfig%2Fworkspace%2Fee-study"),
    "ee-study"
  );
  assert.equal(
    presence.workspaceNameFromUrl("https://ide.example.test/?workspace=%2Fsrv%2Fteam.code-workspace"),
    "team"
  );
});

test("activity uses configurable program title and a round small program icon", () => {
  const privatePresence = presence.buildPresence(
    { fileName: "main.cpp", workspaceName: "secret-workspace", hasEditor: true },
    { privacyMode: true }
  );
  const activity = presence.makeActivity(
    privatePresence,
    "123456789012345678",
    1700000000000,
    { name: "VSCodium", iconKey: "vscodium" }
  );
  assert.equal(activity.name, "VSCodium");
  assert.equal(activity.assets.large_image.endsWith("/cpp.png"), true);
  assert.equal(activity.assets.small_image.endsWith("/vscodium.png"), true);
  assert.equal(activity.assets.small_text, "VSCodium");
  assert.equal(JSON.stringify(activity).includes("secret-workspace"), false);
});

test("application ID, origins, and program identity are persisted and restored", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../src/background.js"), "utf8");
  assert.match(source, /browser\.storage\.local\.set\(\{ settings \}\)/);
  assert.match(source, /restoreSavedSites\(\)/);
  assert.match(source, /programPreset/);
  assert.match(source, /customProgramName/);
});
