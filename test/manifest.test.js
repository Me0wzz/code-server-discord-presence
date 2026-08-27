"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const firefox = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const chromium = JSON.parse(fs.readFileSync(path.join(root, "manifest.chromium.json"), "utf8"));

test("Firefox and Chromium use native manifest formats without native integration", () => {
  assert.equal(firefox.manifest_version, 2);
  assert.equal(Boolean(firefox.browser_specific_settings?.gecko?.id), true);
  assert.deepEqual(firefox.optional_permissions, ["<all_urls>"]);
  assert.equal(firefox.background.scripts[0], "src/shared/browser-compat.js");

  assert.equal(chromium.manifest_version, 3);
  assert.equal(chromium.background.service_worker, "src/background-chromium.js");
  assert.equal(chromium.permissions.includes("scripting"), true);
  assert.deepEqual(chromium.optional_host_permissions, ["<all_urls>"]);

  for (const manifest of [firefox, chromium]) {
    assert.equal(manifest.permissions.includes("nativeMessaging"), false);
  }
  assert.equal(firefox.version, chromium.version);
});

test("code-server origins remain opt-in on both browsers", () => {
  assert.equal(firefox.permissions.includes("<all_urls>"), false);
  assert.equal(chromium.host_permissions.includes("<all_urls>"), false);
  assert.equal(Object.hasOwn(firefox, "content_scripts"), false);
  assert.equal(Object.hasOwn(chromium, "content_scripts"), false);
});
