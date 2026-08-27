(function attachLanguageNames(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CodeServerLanguageNames = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createLanguageNames() {
  "use strict";

  const EXTENSIONS = Object.freeze({
    ".c": "C", ".cc": "C++", ".cpp": "C++", ".cxx": "C++", ".cs": "C#",
    ".css": "CSS", ".dart": "Dart", ".go": "Go", ".h": "C", ".hh": "C++",
    ".hpp": "C++", ".html": "HTML", ".htm": "HTML", ".java": "Java",
    ".js": "JavaScript", ".json": "JSON", ".jsonc": "JSON", ".jsx": "JavaScript React",
    ".kt": "Kotlin", ".kts": "Kotlin", ".lua": "Lua", ".md": "Markdown",
    ".mdx": "Markdown", ".php": "PHP", ".ps1": "PowerShell", ".py": "Python",
    ".rb": "Ruby", ".rs": "Rust", ".scss": "SCSS", ".sh": "Shell", ".sql": "SQL",
    ".swift": "Swift", ".toml": "TOML", ".ts": "TypeScript",
    ".tsx": "TypeScript React", ".txt": "Plain Text", ".vue": "Vue", ".xml": "XML",
    ".yaml": "YAML", ".yml": "YAML", ".zig": "Zig"
  });

  const SPECIAL_FILES = Object.freeze({
    ".dockerignore": "Docker", ".gitignore": "Git", ".gitmodules": "Git",
    "cmakelists.txt": "CMake", "containerfile": "Docker", "dockerfile": "Docker",
    "gemfile": "Ruby", "justfile": "Just", "makefile": "Makefile", "procfile": "Procfile"
  });

  const EXTENSION_ICONS = Object.freeze({
    ".c": "c", ".cc": "cpp", ".cpp": "cpp", ".cxx": "cpp", ".cs": "csharp",
    ".css": "css", ".dart": "dart", ".go": "go", ".h": "c", ".hh": "cpp",
    ".hpp": "cpp", ".html": "html", ".htm": "html", ".java": "java", ".js": "js",
    ".json": "json", ".jsonc": "json", ".jsx": "jsx", ".kt": "kotlin",
    ".kts": "kotlin", ".lua": "lua", ".md": "markdown", ".mdx": "markdownx",
    ".php": "php", ".ps1": "powershell", ".py": "python", ".rb": "ruby",
    ".rs": "rust", ".scss": "scss", ".sh": "shell", ".sql": "sql", ".swift": "swift",
    ".toml": "toml", ".ts": "ts", ".tsx": "tsx", ".txt": "text", ".vue": "vue",
    ".xml": "xml", ".yaml": "yaml", ".yml": "yaml", ".zig": "zig"
  });

  const SPECIAL_FILE_ICONS = Object.freeze({
    ".dockerignore": "docker", ".gitignore": "git", ".gitmodules": "git",
    "cmakelists.txt": "cmake", "containerfile": "docker", "dockerfile": "docker",
    "gemfile": "ruby", "justfile": "text", "makefile": "makefile", "procfile": "heroku"
  });

  const LANGUAGE_ICONS = Object.freeze({
    "C": "c", "C++": "cpp", "C#": "csharp", "CMake": "cmake", "CSS": "css",
    "Dart": "dart", "Docker": "docker", "Git": "git", "Go": "go", "HTML": "html",
    "Java": "java", "JavaScript": "js", "JavaScript React": "jsx", "JSON": "json",
    "Kotlin": "kotlin", "Lua": "lua", "Makefile": "makefile", "Markdown": "markdown",
    "PHP": "php", "Plain Text": "text", "PowerShell": "powershell", "Procfile": "heroku",
    "Python": "python", "Ruby": "ruby", "Rust": "rust", "SCSS": "scss", "SQL": "sql",
    "Shell": "shell", "Swift": "swift", "TOML": "toml", "TypeScript": "ts",
    "TypeScript React": "tsx", "Vue": "vue", "XML": "xml", "YAML": "yaml", "Zig": "zig"
  });

  const PROGRAM_ICON_KEYS = Object.freeze(["antigravity", "cursor", "vscode", "vscodium"]);
  const KNOWN_LANGUAGE_NAMES = new Set([...Object.values(EXTENSIONS), ...Object.values(SPECIAL_FILES)]);
  const KNOWN_ICON_KEYS = new Set([
    "idle-vscode", "text", ...PROGRAM_ICON_KEYS,
    ...Object.values(EXTENSION_ICONS), ...Object.values(SPECIAL_FILE_ICONS),
    ...Object.values(LANGUAGE_ICONS)
  ]);

  function basename(value) {
    const text = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (!text) return "";
    return text.split(/[\\/]/).filter(Boolean).pop() || "";
  }

  function extensionOf(fileName) {
    const name = basename(fileName);
    const index = name.lastIndexOf(".");
    if (index <= 0 || index === name.length - 1) return "";
    return name.slice(index).toLowerCase();
  }

  function languageForFile(fileName) {
    const name = basename(fileName);
    if (!name) return "";
    const lower = name.toLowerCase();
    if (SPECIAL_FILES[lower]) return SPECIAL_FILES[lower];
    if (/^untitled(?:-|\s|$)/i.test(name)) return "Plain Text";
    return EXTENSIONS[extensionOf(name)] || "";
  }

  function iconKeyForFile(fileName) {
    const name = basename(fileName);
    if (!name) return "idle-vscode";
    const lower = name.toLowerCase();
    return SPECIAL_FILE_ICONS[lower] || EXTENSION_ICONS[extensionOf(name)] || "text";
  }

  function iconKeyForLanguage(language) {
    return LANGUAGE_ICONS[String(language || "")] || "text";
  }

  function isKnownLanguageName(value) {
    return KNOWN_LANGUAGE_NAMES.has(String(value || ""));
  }

  function isKnownIconKey(value) {
    return KNOWN_ICON_KEYS.has(String(value || ""));
  }

  function isProgramIconKey(value) {
    return PROGRAM_ICON_KEYS.includes(String(value || ""));
  }

  return Object.freeze({
    EXTENSIONS, EXTENSION_ICONS, PROGRAM_ICON_KEYS, SPECIAL_FILES, SPECIAL_FILE_ICONS,
    basename, extensionOf, iconKeyForFile, iconKeyForLanguage, languageForFile,
    isKnownIconKey, isKnownLanguageName, isProgramIconKey
  });
});
