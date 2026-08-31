"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const presenceApi = require("../src/shared/presence.js");

const sensitiveCases = [
  ["secret-customer-list.py", "Editing Python file", "python"],
  ["internal-api-key-rotation.ts", "Editing TypeScript file", "ts"],
  ["private-engine.cpp", "Editing C++ file", "cpp"],
  ["private-app.cs", "Editing C# file", "csharp"],
  ["company-acquisition-plan.md", "Editing Markdown file", "markdown"],
  ["passwords.txt", "Editing Plain Text file", "text"],
  ["prod-database-credentials.json", "Editing JSON file", "json"]
];

test("Privacy Mode creates language-only details and a generic workspace state", () => {
  assert.deepEqual(
    { ...presenceApi.buildPresence(
      { fileName: "a.py", workspaceName: "private-project", hasEditor: true },
      { privacyMode: true }
    ), key: undefined },
    { details: "Editing Python file", state: "In Workspace", privacyMode: true, key: undefined }
  );
  assert.equal(
    presenceApi.buildPresence({ fileName: "index.ts", hasEditor: true }, { privacyMode: true }).details,
    "Editing TypeScript file"
  );
});

test("Privacy Mode runtime message and Discord payload contain no sensitive basenames", () => {
  for (const [fileName, expected, iconKey] of sensitiveCases) {
    const workspaceName = "secret-company-project";
    const presence = presenceApi.buildPresence(
      { fileName, workspaceName, hasEditor: true },
      { privacyMode: true, showFileName: true, showWorkspace: true }
    );
    const message = presenceApi.makeContentMessage(presence, 123);
    const body = presenceApi.makeHeadlessBody(message.presence, "123456789012345678", 1700000000000, "session-token");
    const serialized = JSON.stringify({ message, body });

    assert.equal(presence.details, expected);
    assert.equal(presence.state, "In Workspace");
    assert.equal(Object.hasOwn(message.presence, "fileName"), false);
    assert.equal(Object.hasOwn(message.presence, "workspaceName"), false);
    assert.equal(body.activities[0].assets.large_image.endsWith(`/${iconKey}.png`), true);
    assert.equal(serialized.includes(fileName), false);
    assert.equal(serialized.includes(fileName.replace(/\.[^.]+$/, "")), false);
    assert.equal(serialized.includes(workspaceName), false);
  }
});

test("unknown extensions fall back without revealing a name", () => {
  const result = presenceApi.buildPresence(
    { fileName: "takeover-plan.ultra-secret", hasEditor: true },
    { privacyMode: true }
  );
  const body = presenceApi.makeHeadlessBody(result, "123456789012345678", 1700000000000);
  assert.equal(result.details, "Editing file");
  assert.equal(body.activities[0].assets.large_image.endsWith("/text.png"), true);
  assert.equal(JSON.stringify({ result, body }).includes("takeover"), false);
});

test("normal mode uses the workspace directory display name", () => {
  const result = presenceApi.buildPresence(
    { fileName: "/srv/code/project/main.py", workspaceName: "/srv/code/project", hasEditor: true },
    { privacyMode: false, showFileName: true, showWorkspace: true }
  );
  assert.equal(result.details, "Editing main.py");
  assert.equal(result.state, "In project");
  assert.equal(JSON.stringify(result).includes("/srv/code"), false);
});

test("hidden or unavailable workspace names use In Workspace", () => {
  assert.equal(
    presenceApi.buildPresence(
      { fileName: "main.py", workspaceName: "private-project", hasEditor: true },
      { privacyMode: false, showWorkspace: false }
    ).state,
    "In Workspace"
  );
  assert.equal(
    presenceApi.buildPresence(
      { fileName: "main.py", workspaceName: "private-project", hasEditor: true },
      { privacyMode: true }
    ).state,
    "In Workspace"
  );
});

test("parses the common code-server window-title format", () => {
  assert.deepEqual(
    presenceApi.parseWindowTitle("index.ts - website - code-server"),
    { fileName: "index.ts", workspaceName: "website" }
  );
  assert.deepEqual(
    presenceApi.parseWindowTitle("Welcome - code-server"),
    { fileName: "", workspaceName: "" }
  );
});

test("headless activity uses a pinned VSCord icon and elapsed timestamp", () => {
  const privatePresence = presenceApi.buildPresence(
    { fileName: "/private/main.py", workspaceName: "/private/backend", hasEditor: true },
    { privacyMode: true }
  );
  const body = presenceApi.makeHeadlessBody(privatePresence, "123456789012345678", 1700000000123);
  assert.equal(body.activities[0].name, "code-server");
  assert.equal(body.activities[0].type, 0);
  assert.equal(body.activities[0].timestamps.start, "1700000000123");
  assert.equal(body.activities[0].assets.large_text, "Python");
  assert.equal(
    body.activities[0].assets.large_image,
    "https://raw.githubusercontent.com/LeonardSSH/vscord/e111b4329adf9182abc664aef79b5f594d285735/assets/icons/python.png"
  );
  assert.equal(JSON.stringify(body).includes("/private"), false);
});

test("privacy guard accepts generated data and rejects a raw filename or workspace", () => {
  const safe = presenceApi.buildPresence({ fileName: "a.py", hasEditor: true }, { privacyMode: true });
  assert.equal(presenceApi.isPrivacySafePresence(safe), true);
  assert.equal(presenceApi.isPrivacySafePresence({
    details: "Editing secret.py",
    state: "In Workspace",
    privacyMode: true
  }), false);
  assert.equal(presenceApi.isPrivacySafePresence({
    details: "Editing Python file",
    state: "In secret-company-project",
    privacyMode: true
  }), false);
});


test("hiding filenames keeps the language in the activity details", () => {
  const cases = [
    ["main.cpp", "Editing C++ file"],
    ["Program.cs", "Editing C# file"],
    ["app.js", "Editing JavaScript file"]
  ];
  for (const [fileName, expected] of cases) {
    const result = presenceApi.buildPresence(
      { fileName, workspaceName: "private-project", hasEditor: true },
      { privacyMode: false, showFileName: false }
    );
    assert.equal(result.details, expected);
  }
});

test("language icon hover text stays a language name with every text setting", () => {
  const cases = [
    ["main.cpp", { privacyMode: false, detailsTemplate: "Working privately" }, "C++"],
    ["Program.cs", { privacyMode: true, detailsTemplate: "Editing {language} file" }, "C#"],
    ["app.js", { privacyMode: false, showFileName: false, detailsTemplate: "Coding" }, "JavaScript"]
  ];
  for (const [fileName, options, expected] of cases) {
    const activity = presenceApi.makeActivity(
      presenceApi.buildPresence({ fileName, hasEditor: true }, options),
      "123456789012345678",
      1700000000000
    );
    assert.equal(activity.assets.large_text, expected);
  }
});
