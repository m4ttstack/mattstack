(function (root) {
  // Mirrors rt's invite-crypto.ts decodeCode contract: 16 id bytes + 32 key
  // bytes, Crockford base32 (no I/L/O/U), always 77 chars once normalized.
  var CODE_LENGTH = 77;
  var CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

  function normalizeCode(code) {
    return code
      .replace(/[\s-]/g, "")
      .toUpperCase()
      .replace(/O/g, "0")
      .replace(/[IL]/g, "1");
  }

  function isValidCode(code) {
    var normalized = normalizeCode(code);
    if (normalized.length !== CODE_LENGTH) return false;
    for (var i = 0; i < normalized.length; i++) {
      if (CROCKFORD_ALPHABET.indexOf(normalized[i]) === -1) return false;
    }
    return true;
  }

  // Ruling 3a (MAT-396): the code lives only in the URL fragment and must
  // never reach a server, so this reads location.hash exclusively -- never
  // the query string. A malformed code is treated as absent: it can't be
  // joined with anyway, and copying a broken deep link would be worse than
  // no link at all.
  function extractInviteCode(hash) {
    if (!hash || !hash.startsWith("#")) return null;
    var code = hash.slice(1);
    if (!code || !isValidCode(code)) return null;
    return normalizeCode(code);
  }

  function buildDeepLink(code) {
    return "mattstack://join/" + code;
  }

  // The deep-link attempt on load is fire-and-forget (no callback tells us
  // whether an installed app claimed it), so the clipboard copy always
  // happens alongside it rather than only after a detected failure.
  function resolveJoinState(hash) {
    var code = extractInviteCode(hash);
    if (!code) {
      return { hasCode: false, deepLink: null, clipboardText: null };
    }
    var deepLink = buildDeepLink(code);
    return { hasCode: true, deepLink: deepLink, clipboardText: deepLink };
  }

  const api = { extractInviteCode, isValidCode, buildDeepLink, resolveJoinState };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.JoinPage = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
