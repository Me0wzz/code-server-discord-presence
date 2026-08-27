"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { build } = require("./build.js");

const root = path.resolve(__dirname, "..");
const packageDirectory = path.join(root, "dist", "packages");
const firefoxManifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const chromiumManifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.chromium.json"), "utf8"));

if (firefoxManifest.version !== chromiumManifest.version) {
  throw new Error("Firefox and Chromium versions must match.");
}

fs.mkdirSync(packageDirectory, { recursive: true });

for (const [target, extension] of [["firefox", "xpi"], ["chromium", "zip"]]) {
  const source = build(target);
  const output = path.join(
    packageDirectory,
    `code-server-discord-presence-${target}-${firefoxManifest.version}.${extension}`
  );
  fs.rmSync(output, { force: true });
  execFileSync("zip", ["-q", "-r", output, "."], { cwd: source, stdio: "inherit" });
  console.log(`${target} package created at ${output}`);
}
