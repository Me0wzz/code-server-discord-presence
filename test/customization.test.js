"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const presence = require("../src/shared/presence.js");

test("parses English and Korean VS Code cursor status text", () => {
  assert.deepEqual(
    presence.parseCursorPosition("Ln 42, Col 7"),
    { lineNumber: 42, columnNumber: 7 }
  );
  assert.deepEqual(
    presence.parseCursorPosition("Line 9, Column 3 (2 selected)"),
    { lineNumber: 9, columnNumber: 3 }
  );
  assert.deepEqual(
    presence.parseCursorPosition("줄 15, 열 2"),
    { lineNumber: 15, columnNumber: 2 }
  );
});

test("normal mode renders VSCord-style custom text variables", () => {
  const result = presence.buildPresence(
    {
      fileName: "/srv/project/index.ts",
      workspaceName: "/srv/project/ee-study",
      lineNumber: 42,
      columnNumber: 7,
      hasEditor: true
    },
    {
      privacyMode: false,
      programName: "Visual Studio Code",
      detailsTemplate: "Editing {file_name}{file_extension} at line {line_number}",
      stateTemplate: "In {workspace} · Col {column_number} · {program_name}"
    }
  );
  assert.equal(result.details, "Editing index.ts at line 42");
  assert.equal(result.state, "In ee-study · Col 7 · Visual Studio Code");
});

test("Privacy Mode anonymizes template filename and workspace before messaging", () => {
  const options = {
    privacyMode: true,
    programName: "VSCodium",
    detailsTemplate: "Editing {file_name}{file_extension} · line {line_number}",
    stateTemplate: "In {workspace} · {language} · {program_name}"
  };
  const result = presence.buildPresence(
    {
      fileName: "secret-acquisition-plan.py",
      workspaceName: "confidential-company",
      lineNumber: 88,
      columnNumber: 4,
      hasEditor: true
    },
    options
  );
  const message = presence.makeContentMessage(result, 123);
  const serialized = JSON.stringify(message);
  assert.equal(result.details, "Editing file.py · line 88");
  assert.equal(result.state, "In Workspace · Python · VSCodium");
  assert.equal(presence.isPrivacySafePresence(message.presence, options), true);
  assert.equal(serialized.includes("secret-acquisition-plan"), false);
  assert.equal(serialized.includes("confidential-company"), false);
});

test("unknown extensions are not exposed through Privacy template variables", () => {
  const result = presence.buildPresence(
    { fileName: "secret.ultra-private", workspaceName: "hidden", lineNumber: 3, hasEditor: true },
    { privacyMode: true, detailsTemplate: "Editing {file_name}{file_extension}" }
  );
  assert.equal(result.details, "Editing file");
  assert.equal(JSON.stringify(presence.makeContentMessage(result)).includes("ultra-private"), false);
});

test("custom program icon accepts only public HTTPS URLs", () => {
  assert.equal(
    presence.safeHttpsImageUrl("https://cdn.example.com/icons/my-ide.png#preview"),
    "https://cdn.example.com/icons/my-ide.png"
  );
  assert.equal(presence.safeHttpsImageUrl("http://example.com/icon.png"), "");
  assert.equal(presence.safeHttpsImageUrl("data:image/png;base64,abc"), "");
  assert.equal(presence.safeHttpsImageUrl("https://user:pass@example.com/icon.png"), "");

  const activity = presence.makeActivity(
    presence.buildPresence({ fileName: "a.py", hasEditor: true }, { privacyMode: true }),
    "123456789012345678",
    1700000000000,
    { name: "My IDE", iconKey: "vscode", iconUrl: "https://cdn.example.com/my-ide.png" }
  );
  assert.equal(activity.assets.small_image, "https://cdn.example.com/my-ide.png");
});

test("code-server URL defaults blank and settings handlers are present", () => {
  const background = fs.readFileSync(path.resolve(__dirname, "../src/background.js"), "utf8");
  assert.match(background, /codeServerUrl: ""/);
  assert.match(background, /save-code-server-url/);
  assert.match(background, /clear-code-server-url/);
  assert.match(background, /detailsTemplate: ""/);
  assert.match(background, /stateTemplate: ""/);
});

test("manifest declares every supplied extension icon size", () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../manifest.json"), "utf8"));
  for (const size of ["16", "32", "48", "96", "128"]) {
    assert.equal(manifest.icons[size], `assets/icons/extension-${size}.png`);
    assert.equal(fs.existsSync(path.resolve(__dirname, `../${manifest.icons[size]}`)), true);
  }
});
