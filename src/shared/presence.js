(function attachPresence(root, factory) {
  const languageNames = typeof module === "object" && module.exports
    ? require("./language-names.js")
    : root.CodeServerLanguageNames;
  const api = factory(languageNames);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CodeServerPresence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createPresence(languageNames) {
  "use strict";

  const VSCORD_ICON_BASE =
    "https://raw.githubusercontent.com/LeonardSSH/vscord/e111b4329adf9182abc664aef79b5f594d285735/assets/icons";
  const NON_FILE_TABS = new Set([
    "extensions", "keyboard shortcuts", "new file", "release notes", "settings", "welcome"
  ]);
  const TEMPLATE_VARIABLES = Object.freeze([
    "file_name", "file_extension", "language", "workspace",
    "line_number", "column_number", "program_name"
  ]);

  function cleanText(value, maxLength = 128) {
    const text = String(value || "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
  }

  function safeBasename(value) {
    return cleanText(languageNames.basename(value), 96);
  }

  function safeWorkspaceName(value) {
    let name = safeBasename(value);
    if (!name || /^(https?|vscode(?:-remote)?):/i.test(name)) return "";
    name = name
      .replace(/\.code-workspace$/i, "")
      .replace(/\s+\((?:workspace|worktree)\)$/i, "")
      .replace(/\s+\[(?:ssh|wsl|dev container|code server|codespaces)[^\]]*\]$/i, "")
      .trim();
    return cleanText(name, 96);
  }

  function looksLikeEditorName(value) {
    const name = safeBasename(value);
    return Boolean(name && !NON_FILE_TABS.has(name.toLowerCase()));
  }

  function removeProductSuffix(title) {
    return title.replace(
      /\s(?:—|–|-|·)\s(?:code-server|visual studio code|vscodium|code\s-\soss|vscode|cursor|antigravity)(?:\s*\[[^\]]+\])?$/i,
      ""
    ).trim();
  }

  function parseWindowTitle(title) {
    const cleaned = removeProductSuffix(cleanText(title, 300).replace(/^[●•*]\s*/, ""));
    if (!cleaned) return { fileName: "", workspaceName: "" };
    const parts = cleaned.split(/\s(?:—|–|-|·)\s/).map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return { fileName: "", workspaceName: "" };
    if (parts.length === 1) {
      if (NON_FILE_TABS.has(parts[0].toLowerCase())) return { fileName: "", workspaceName: "" };
      const isFile = Boolean(languageNames.languageForFile(parts[0]) || /\.[^.\s]+$/.test(parts[0]));
      return isFile
        ? { fileName: safeBasename(parts[0]), workspaceName: "" }
        : { fileName: "", workspaceName: safeWorkspaceName(parts[0]) };
    }
    return {
      fileName: looksLikeEditorName(parts[0]) ? safeBasename(parts[0]) : "",
      workspaceName: safeWorkspaceName(parts[1])
    };
  }

  function workspaceNameFromUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return safeWorkspaceName(url.searchParams.get("folder") || url.searchParams.get("workspace") || "");
    } catch (_error) {
      return "";
    }
  }

  function positiveInteger(value) {
    const number = Number.parseInt(String(value || ""), 10);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function parseCursorPosition(value) {
    const text = cleanText(value, 300);
    const patterns = [
      /(?:Ln|Line)\s*(\d+)[^\d]+(?:Col|Column)\s*(\d+)/i,
      /줄\s*(\d+)[^\d]+열\s*(\d+)/i
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (match) {
        return { lineNumber: positiveInteger(match[1]), columnNumber: positiveInteger(match[2]) };
      }
    }
    return { lineNumber: null, columnNumber: null };
  }

  function fileNameParts(fileName) {
    const name = safeBasename(fileName);
    const extension = languageNames.extensionOf(name);
    return {
      stem: extension ? name.slice(0, -extension.length) : name,
      extension
    };
  }

  function renderTemplate(template, variables, fallback) {
    const source = cleanText(template, 256);
    if (!source) return cleanText(fallback);
    const rendered = source.replace(/\{([a-z_]+)\}/gi, (token, rawName) => {
      const name = String(rawName).toLowerCase();
      return Object.hasOwn(variables, name) ? variables[name] : token;
    });
    return cleanText(rendered) || cleanText(fallback);
  }

  function presentationFromContext(context, options, privacyMode) {
    const fileName = safeBasename(context.fileName);
    const workspaceName = safeWorkspaceName(context.workspaceName);
    const hasEditor = context.hasEditor !== false && looksLikeEditorName(fileName);
    const language = hasEditor ? languageNames.languageForFile(fileName) : "";
    const parts = fileNameParts(fileName);
    const lineNumber = positiveInteger(context.lineNumber);
    const columnNumber = positiveInteger(context.columnNumber);
    const showFileName = options.showFileName !== false;
    const showWorkspace = options.showWorkspace !== false;
    const programName = cleanText(options.programName || "code-server");

    let defaultDetails;
    let defaultState;
    if (privacyMode) {
      defaultDetails = hasEditor ? `Editing${language ? ` ${language}` : ""} file` : "Browsing code-server";
      defaultState = "In Workspace";
    } else if (hasEditor) {
      defaultDetails = showFileName ? `Editing ${fileName}` : `Editing${language ? ` ${language}` : ""} file`;
      defaultState = showWorkspace && workspaceName ? `In ${workspaceName}` : "In Workspace";
    } else {
      defaultDetails = "Browsing project";
      defaultState = showWorkspace && workspaceName ? `In ${workspaceName}` : "In Workspace";
    }

    const knownExtension = language ? parts.extension : "";
    const variables = {
      file_name: privacyMode ? (hasEditor ? "file" : "code-server") : parts.stem,
      file_extension: privacyMode ? knownExtension : parts.extension,
      language: language || "Code",
      workspace: privacyMode ? "Workspace" : (workspaceName || "Workspace"),
      line_number: lineNumber ? String(lineNumber) : "?",
      column_number: columnNumber ? String(columnNumber) : "?",
      program_name: programName
    };
    return {
      details: renderTemplate(options.detailsTemplate, variables, defaultDetails),
      language,
      state: renderTemplate(options.stateTemplate, variables, defaultState),
      iconKey: hasEditor ? languageNames.iconKeyForFile(fileName) : "idle-vscode",
      safeContext: privacyMode ? {
        hasEditor,
        language,
        fileExtension: knownExtension,
        lineNumber,
        columnNumber
      } : null
    };
  }

  function buildPresence(context, options = {}) {
    const privacyMode = options.privacyMode !== false;
    const presentation = presentationFromContext(context, options, privacyMode);
    const result = {
      details: presentation.details,
      state: presentation.state,
      privacyMode
    };
    result.key = JSON.stringify(result);
    Object.defineProperties(result, {
      iconKey: { value: presentation.iconKey, enumerable: false },
      language: { value: presentation.language, enumerable: false },
      safeContext: { value: presentation.safeContext, enumerable: false }
    });
    return Object.freeze(result);
  }

  function makeContentMessage(presence, observedAt = Date.now()) {
    const messagePresence = {
      details: cleanText(presence.details),
      state: cleanText(presence.state),
      iconKey: languageNames.isKnownIconKey(presence.iconKey) ? presence.iconKey : "text",
      language: languageNames.isKnownLanguageName(presence.language) ? presence.language : "",
      privacyMode: Boolean(presence.privacyMode),
      key: cleanText(presence.key, 512)
    };
    if (presence.privacyMode) messagePresence.safeContext = presence.safeContext;
    return { type: "editor-presence", presence: messagePresence, observedAt };
  }

  function privacyPresentationFromSafeContext(safeContext = {}, options = {}) {
    const hasEditor = safeContext.hasEditor === true;
    const language = languageNames.isKnownLanguageName(safeContext.language) ? safeContext.language : "";
    const candidateExtension = String(safeContext.fileExtension || "").toLowerCase();
    const extensionMatchesLanguage = Boolean(
      candidateExtension && languageNames.EXTENSIONS[candidateExtension] === language
    );
    const fileExtension = extensionMatchesLanguage ? candidateExtension : "";
    const lineNumber = positiveInteger(safeContext.lineNumber);
    const columnNumber = positiveInteger(safeContext.columnNumber);
    const variables = {
      file_name: hasEditor ? "file" : "code-server",
      file_extension: fileExtension,
      language: language || "Code",
      workspace: "Workspace",
      line_number: lineNumber ? String(lineNumber) : "?",
      column_number: columnNumber ? String(columnNumber) : "?",
      program_name: cleanText(options.programName || "code-server")
    };
    const defaultDetails = hasEditor
      ? `Editing${language ? ` ${language}` : ""} file`
      : "Browsing code-server";
    return {
      details: renderTemplate(options.detailsTemplate, variables, defaultDetails),
      language,
      state: renderTemplate(options.stateTemplate, variables, "In Workspace"),
      iconKey: hasEditor ? languageNames.iconKeyForLanguage(language) : "idle-vscode"
    };
  }

  function isPrivacySafePresence(presence, options = {}) {
    if (!presence || presence.privacyMode !== true || !presence.safeContext) return false;
    const expected = privacyPresentationFromSafeContext(presence.safeContext, options);
    return presence.details === expected.details &&
      languageForPresence(presence) === expected.language &&
      presence.state === expected.state &&
      presence.iconKey === expected.iconKey;
  }

  function languageForPresence(presence) {
    if (languageNames.isKnownLanguageName(presence?.language)) return presence.language;
    const safeLanguage = presence?.safeContext?.language;
    return languageNames.isKnownLanguageName(safeLanguage) ? safeLanguage : "";
  }

  function iconKeyForPresence(presence) {
    if (languageNames.isKnownIconKey(presence?.iconKey)) return presence.iconKey;
    const details = cleanText(presence?.details);
    if (!details || details === "Browsing code-server" || details === "Browsing project") return "idle-vscode";
    if (details === "Editing file") return "text";
    if (presence?.privacyMode) return languageNames.iconKeyForLanguage(/^Editing (.+) file$/.exec(details)?.[1]);
    return languageNames.iconKeyForFile(/^Editing (.+)$/.exec(details)?.[1] || "");
  }

  function vscordIconUrl(iconKey) {
    const safeKey = languageNames.isKnownIconKey(iconKey) ? iconKey : "text";
    return `${VSCORD_ICON_BASE}/${safeKey}.png`;
  }

  function safeHttpsImageUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      if (url.protocol !== "https:" || url.username || url.password || url.href.length > 2048) return "";
      url.hash = "";
      return url.href;
    } catch (_error) {
      return "";
    }
  }

  function normalizeProgram(program = {}) {
    const name = cleanText(program.name || "code-server", 128) || "code-server";
    const iconKey = languageNames.isProgramIconKey(program.iconKey) ? program.iconKey : "vscode";
    return { name, iconKey, iconUrl: safeHttpsImageUrl(program.iconUrl) };
  }

  function makeActivity(presence, applicationId, startedAt, program = {}) {
    const resolvedProgram = normalizeProgram(program);
    return {
      application_id: String(applicationId),
      platform: "desktop",
      supported_platforms: ["desktop"],
      type: 0,
      name: resolvedProgram.name,
      details: cleanText(presence.details),
      state: cleanText(presence.state),
      assets: {
        large_image: vscordIconUrl(iconKeyForPresence(presence)),
        large_text: languageForPresence(presence) || "Code",
        small_image: resolvedProgram.iconUrl || vscordIconUrl(resolvedProgram.iconKey),
        small_text: resolvedProgram.name
      },
      timestamps: { start: String(Math.floor(Number(startedAt) || Date.now())) }
    };
  }

  function makeHeadlessBody(presence, applicationId, startedAt, headlessToken = "", program = {}) {
    const body = { activities: [makeActivity(presence, applicationId, startedAt, program)] };
    if (headlessToken) body.token = headlessToken;
    return body;
  }

  return Object.freeze({
    TEMPLATE_VARIABLES, buildPresence, cleanText, iconKeyForPresence, isPrivacySafePresence,
    looksLikeEditorName, makeActivity, makeContentMessage, makeHeadlessBody, normalizeProgram,
    parseCursorPosition, parseWindowTitle, renderTemplate, safeBasename, safeHttpsImageUrl,
    safeWorkspaceName, vscordIconUrl, workspaceNameFromUrl
  });
});
