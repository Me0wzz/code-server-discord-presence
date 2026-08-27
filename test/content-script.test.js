"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../src/content-code-server.js"), "utf8");

test("presence observation does not require page focus", () => {
  assert.equal(source.includes("document.hasFocus()"), false);
  assert.equal(source.includes('document.visibilityState === "hidden"'), false);
});

test("content script has a versioned reinjection guard and broad editor markers", () => {
  assert.equal(source.includes('const SCRIPT_VERSION = "0.1.1"'), true);
  assert.equal(source.includes('document.querySelector(".part.editor")'), true);
  assert.equal(source.includes('document.querySelector(".editor-group-container")'), true);
});

test("content script reads VS Code resource, workspace, and cursor context", () => {
  assert.equal(source.includes('tab.getAttribute("data-resource-name")'), true);
  assert.equal(source.includes("workspaceNameFromUrl(location.href)"), true);
  assert.equal(source.includes("explorerWorkspaceName()"), true);
  assert.equal(source.includes("status.editor.selection"), true);
  assert.equal(source.includes('document.addEventListener("keyup"'), true);
});
