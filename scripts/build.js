"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const targets = Object.freeze({
  firefox: Object.freeze({
    manifest: "manifest.json",
    extraFiles: []
  }),
  chromium: Object.freeze({
    manifest: "manifest.chromium.json",
    extraFiles: ["src/background-chromium.js"]
  })
});

const commonFiles = Object.freeze([
  "assets/icons/extension-16.png",
  "assets/icons/extension-32.png",
  "assets/icons/extension-48.png",
  "assets/icons/extension-96.png",
  "assets/icons/extension-128.png",
  "src/background.js",
  "src/content-code-server.js",
  "src/popup.html",
  "src/popup.css",
  "src/popup.js",
  "src/shared/browser-compat.js",
  "src/shared/language-names.js",
  "src/shared/presence.js",
  "src/shared/oauth.js"
]);

function copy(output, source, destination = source) {
  const sourcePath = path.join(root, source);
  const destinationPath = path.join(output, destination);
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
}

function build(targetName) {
  const target = targets[targetName];
  if (!target) throw new Error(`Unknown browser target: ${targetName}`);
  const output = path.join(root, "dist", targetName);
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  copy(output, target.manifest, "manifest.json");
  for (const file of [...commonFiles, ...target.extraFiles]) copy(output, file);
  console.log(`${targetName} extension built at ${output}`);
  return output;
}

if (require.main === module) {
  const requestedTarget = process.argv[2];
  if (requestedTarget) build(requestedTarget);
  else for (const targetName of Object.keys(targets)) build(targetName);
}

module.exports = Object.freeze({ build, targets });
