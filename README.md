<p align="center">
  <img src="assets/icons/extension-128.png" width="112" height="112" alt="code-server Discord Presence icon">
</p>

<h1 align="center">code-server Discord Presence</h1>

<p align="center">
  Discord Rich Presence for code-server, implemented entirely as a Firefox and
  Chromium browser extension.
</p>

<p align="center">
  <img alt="Version 0.1.0" src="https://img.shields.io/badge/version-0.1.0-5865F2">
  <a href="https://addons.mozilla.org/ko/firefox/addon/code-server-discord-presence/"><img alt="Install for Firefox" src="https://img.shields.io/badge/Firefox-install-FF7139?logo=firefoxbrowser&logoColor=white"></a>
  <img alt="Chromium" src="https://img.shields.io/badge/Chromium-supported-4285F4?logo=googlechrome&logoColor=white">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-22c55e">
</p>

## What it does

The extension reads the active editor state from a code-server tab and
publishes it to Discord through OAuth PKCE and Discord headless sessions.

```text
code-server tab
    ↓ sanitized editor context
WebExtension background / service worker
    ↓ OAuth access token
Discord headless session API
```

There is no Discord desktop dependency and no native bridge.

## Features

- Firefox Manifest V2 and Chromium Manifest V3 builds from one codebase
- Discord OAuth with PKCE and the exact scopes
  `openid sdk.social_layer_presence`
- code-server URL permission requested only after user action
- Privacy Mode enabled by default
- language icons and configurable editor identity
- custom public HTTPS program icon
- VSCord-style activity text variables
- settings, permissions, OAuth tokens, and session state saved locally
- keeps the last active code-server Presence while browsing other tabs
- no Discord Social SDK, native binary, IPC, Native Messaging, or localhost
  callback server

## Browser support

| Browser | Manifest | Install |
| --- | --- | --- |
| Firefox 142+ | MV2 | [Firefox Add-ons](https://addons.mozilla.org/ko/firefox/addon/code-server-discord-presence/) |
| Chrome, Chromium, Edge 106+ | MV3 | Load `dist/chromium/` manually |

<sub>The Chromium version is not distributed through a browser store yet and must be installed manually.</sub>

Firefox and Chromium generate different OAuth redirect URIs. Always copy the
URI displayed by the installed browser's extension popup.

## Discord application setup

1. Create an application in the
   [Discord Developer Portal](https://discord.com/developers/applications).
2. Under **OAuth2**, enable **Public Client**.
3. Load the extension for your browser.
4. Open the extension popup and copy **OAuth redirect URI**.
5. Add that exact URI under **OAuth2 → Redirects**.
6. Copy the Discord Application ID into the extension and save it.
7. Press **Connect Discord**.

Typical callback formats:

```text
Firefox:  https://<generated-id>.extensions.allizom.org/discord
Chromium: https://<extension-id>.chromiumapp.org/discord
```

The Application ID is public configuration. Never put a Discord client secret
in this extension.

## Install from source

Requirements:

- Node.js 18+
- `zip`

```bash
npm install
npm run verify
```

### Firefox

Install the signed release from
[Firefox Add-ons](https://addons.mozilla.org/ko/firefox/addon/code-server-discord-presence/).

For development, open `about:debugging#/runtime/this-firefox`, select
**Load Temporary Add-on**, and open `dist/firefox/manifest.json`.

Release and Beta Firefox require an XPI signed by Mozilla for permanent
installation.

### Chromium

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the `dist/chromium/` directory.

The generated Chromium ZIP is ready for Chrome Web Store submission; it is not
a directly installable CRX.

## Build outputs

```text
dist/firefox/
dist/chromium/
dist/packages/code-server-discord-presence-firefox-0.1.0.xpi
dist/packages/code-server-discord-presence-chromium-0.1.0.zip
```

Individual builds are also available:

```bash
npm run build:firefox
npm run build:chromium
npm run package
```

## Privacy Mode

Privacy Mode sanitizes editor data inside the code-server tab before a message
reaches the extension background:

| Value | Privacy Mode result |
| --- | --- |
| `secret-plan.py` | `file.py` |
| `private-company` | `Workspace` |
| unknown extension | omitted |
| language | allow-listed display name |
| line and column | numeric value |

The background independently verifies the sanitized presentation before
sending it to Discord. Raw filenames and workspace names are not included in
the extension message or Discord payload while Privacy Mode is enabled.


## Custom activity text

Details and state support the following variables:

| Variable | Example |
| --- | --- |
| `{file_name}` | `index` |
| `{file_extension}` | `.ts` |
| `{language}` | `TypeScript` |
| `{workspace}` | `ee-study` |
| `{line_number}` | `42` |
| `{column_number}` | `7` |
| `{program_name}` | `Visual Studio Code` |

Example:

```text
Details: Editing {file_name}{file_extension} at line {line_number}
State:   In {workspace} · Col {column_number}
```

Blank template fields use the built-in defaults.

## Permissions

| Permission | Reason |
| --- | --- |
| `identity` | Capture the OAuth redirect |
| `storage` | Save settings and OAuth/session state |
| `tabs` / `activeTab` | Locate the active allowed code-server tab |
| `alarms` | Refresh an active headless session |
| `scripting` (Chromium) | Inject packaged observers after site permission |
| Discord HTTPS hosts | OAuth token exchange and headless session requests |
| optional site origin | Inspect only the code-server origin approved by the user |

The project never requests `nativeMessaging`.

## API status

Discord's headless-session endpoints are not documented as a supported public
API. They can change or stop working without notice:

```text
POST /api/v10/users/@me/headless-sessions
POST /api/v10/users/@me/headless-sessions/delete
```

This project is an independent, best-effort integration and is not affiliated
with Discord, Microsoft, VSCodium, or the code-server project.

## Credits

- [LeonardSSH/VSCord](https://github.com/LeonardSSH/vscord) — language and
  editor image assets referenced by pinned public HTTPS URLs
- [Sheathed/Neurobox](https://github.com/Sheathed/Neurobox) — technical
  interoperability reference for OAuth PKCE and headless sessions
- [code-server](https://github.com/coder/code-server) — browser-hosted editor

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for pinned revisions

## License

Project source code is available under the [MIT License](LICENSE).
