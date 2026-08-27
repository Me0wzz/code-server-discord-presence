"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const oauth = require("../src/shared/oauth.js");

test("PKCE S256 matches the RFC 7636 example", async () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(
    await oauth.sha256Base64Url(verifier, webcrypto),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
  );
});

test("authorization URL requests only the requested presence scopes", () => {
  const url = new URL(oauth.buildAuthorizationUrl({
    clientId: "123456789012345678",
    redirectUri: "https://example.extensions.allizom.org/discord",
    state: "state-value",
    codeChallenge: "challenge-value"
  }));
  assert.equal(url.origin + url.pathname, "https://discord.com/oauth2/authorize");
  assert.equal(url.searchParams.get("scope"), "openid sdk.social_layer_presence");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), "state-value");
});

test("token exchange form uses PKCE and never contains a client secret", () => {
  const form = oauth.buildTokenForm({
    clientId: "123456789012345678",
    redirectUri: "https://example.extensions.allizom.org/discord",
    grantType: "authorization_code",
    code: "authorization-code",
    codeVerifier: "verifier"
  });
  assert.equal(form.get("client_id"), "123456789012345678");
  assert.equal(form.get("code_verifier"), "verifier");
  assert.equal(form.has("client_secret"), false);
});

test("required scope validation rejects incomplete grants", () => {
  assert.equal(oauth.hasRequiredScopes("openid sdk.social_layer_presence"), true);
  assert.equal(oauth.hasRequiredScopes("openid"), false);
});

