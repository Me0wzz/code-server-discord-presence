(function attachOAuth(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CodeServerDiscordOAuth = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createOAuth() {
  "use strict";

  const SCOPES = Object.freeze(["openid", "sdk.social_layer_presence"]);

  function bytesToBase64Url(bytes) {
    let base64;
    if (typeof btoa === "function") {
      base64 = btoa(String.fromCharCode(...bytes));
    } else {
      base64 = Buffer.from(bytes).toString("base64");
    }
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function randomBase64Url(byteCount, cryptoApi = globalThis.crypto) {
    const bytes = new Uint8Array(byteCount);
    cryptoApi.getRandomValues(bytes);
    return bytesToBase64Url(bytes);
  }

  async function sha256Base64Url(value, cryptoApi = globalThis.crypto) {
    const bytes = new TextEncoder().encode(String(value));
    const digest = await cryptoApi.subtle.digest("SHA-256", bytes);
    return bytesToBase64Url(new Uint8Array(digest));
  }

  function buildAuthorizationUrl({ clientId, redirectUri, state, codeChallenge }) {
    const url = new URL("https://discord.com/oauth2/authorize");
    url.searchParams.set("client_id", String(clientId));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", String(redirectUri));
    url.searchParams.set("scope", SCOPES.join(" "));
    url.searchParams.set("state", String(state));
    url.searchParams.set("code_challenge", String(codeChallenge));
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  function buildTokenForm({ clientId, redirectUri, grantType, code, codeVerifier, refreshToken }) {
    const body = new URLSearchParams({
      client_id: String(clientId),
      redirect_uri: String(redirectUri),
      grant_type: String(grantType)
    });
    if (code) body.set("code", String(code));
    if (codeVerifier) body.set("code_verifier", String(codeVerifier));
    if (refreshToken) body.set("refresh_token", String(refreshToken));
    return body;
  }

  function hasRequiredScopes(scopeText) {
    const granted = new Set(String(scopeText || "").split(/\s+/).filter(Boolean));
    return SCOPES.every((scope) => granted.has(scope));
  }

  return Object.freeze({
    SCOPES,
    buildAuthorizationUrl,
    buildTokenForm,
    hasRequiredScopes,
    randomBase64Url,
    sha256Base64Url
  });
});

