"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const firefox = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const chromium = JSON.parse(fs.readFileSync(path.join(root, "manifest.chromium.json"), "utf8"));

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

if (firefox.manifest_version !== 2) throw new Error("Firefox build must use Manifest V2.");
if (!firefox.permissions.includes("identity")) throw new Error("Missing Firefox identity permission.");
if (!firefox.optional_permissions.includes("<all_urls>")) {
  throw new Error("Missing Firefox optional site permission.");
}
if (firefox.background.scripts[0] !== "src/shared/browser-compat.js") {
  throw new Error("Firefox background must load browser compatibility first.");
}

if (chromium.manifest_version !== 3) throw new Error("Chromium build must use Manifest V3.");
if (chromium.background?.service_worker !== "src/background-chromium.js") {
  throw new Error("Missing Chromium service worker.");
}
if (!chromium.permissions.includes("identity") || !chromium.permissions.includes("scripting")) {
  throw new Error("Missing Chromium identity or scripting permission.");
}
if (!chromium.optional_host_permissions.includes("<all_urls>")) {
  throw new Error("Missing Chromium optional host permission.");
}
if (firefox.version !== chromium.version) throw new Error("Browser manifest versions differ.");

const forbiddenPermissions = ["nativeMessaging", "geckoProfiler", "proxy"];
for (const manifest of [firefox, chromium]) {
  const permissions = [...(manifest.permissions || []), ...(manifest.optional_permissions || [])];
  for (const permission of forbiddenPermissions) {
    if (permissions.includes(permission)) throw new Error(`Forbidden permission: ${permission}`);
  }
}

for (const file of walk(path.join(root, "src")).filter((file) => file.endsWith(".js"))) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
  console.log(`syntax ok: ${path.relative(root, file)}`);
}

const sourceText = walk(path.join(root, "src"))
  .filter((file) => file.endsWith(".js"))
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");

for (const forbidden of ["connectNative", "sendNativeMessage", "discord-ipc", "127.0.0.1", "localhost"]) {
  if (sourceText.includes(forbidden)) throw new Error(`Forbidden implementation marker found: ${forbidden}`);
}

for (const required of [
  "/users/@me/headless-sessions",
  "/users/@me/headless-sessions/delete",
  "sdk.social_layer_presence"
]) {
  if (!sourceText.includes(required)) throw new Error(`Required Discord integration marker missing: ${required}`);
}

console.log("dual-browser manifests and architecture checks passed");
