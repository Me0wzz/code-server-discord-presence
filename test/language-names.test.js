"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const languages = require("../src/shared/language-names.js");

test("maps common code-server filenames to friendly languages", () => {
  const examples = {
    "a.py": "Python",
    "index.ts": "TypeScript",
    "component.tsx": "TypeScript React",
    "main.cpp": "C++",
    "app.rs": "Rust",
    "Dockerfile": "Docker",
    "Makefile": "Makefile",
    "notes.txt": "Plain Text"
  };
  for (const [fileName, expected] of Object.entries(examples)) {
    assert.equal(languages.languageForFile(fileName), expected);
  }
});

test("maps file extensions to VSCord icon keys", () => {
  const examples = {
    "a.py": "python",
    "index.ts": "ts",
    "component.tsx": "tsx",
    "main.cpp": "cpp",
    "Dockerfile": "docker",
    "README.md": "markdown"
  };
  for (const [fileName, expected] of Object.entries(examples)) {
    assert.equal(languages.iconKeyForFile(fileName), expected);
    assert.equal(languages.isKnownIconKey(expected), true);
  }
});

test("unknown extensions do not become a privacy-visible language", () => {
  assert.equal(languages.languageForFile("merger-plan.secretcodename"), "");
  assert.equal(languages.iconKeyForFile("merger-plan.secretcodename"), "text");
});

test("basename removes paths from both operating-system styles", () => {
  assert.equal(languages.basename("/srv/private/main.py"), "main.py");
  assert.equal(languages.basename("C:\\private\\index.ts"), "index.ts");
});
