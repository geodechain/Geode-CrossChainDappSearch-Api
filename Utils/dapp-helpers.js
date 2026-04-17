const crypto = require('crypto');

/**
 * Generate a deterministic integer dapp_id from a URL using MD5 hash.
 * This mirrors the logic already used by /api/dapps and keeps IDs stable.
 *
 * @param {string} url
 * @returns {number}
 */
function generateDappId(url) {
  const hash = crypto.createHash('md5').update(url).digest('hex');
  return parseInt(hash.substring(0, 8), 16) & 0x7FFFFFFF;
}

/**
 * Strip query parameters (UTM tracking, etc.) from a URL and normalize.
 * Keeps only the origin and pathname, with trailing slashes normalized.
 *
 * @param {string} raw
 * @returns {string|null}
 */
function cleanWebsiteUrl(raw) {
  if (!raw || raw.trim() === '') return null;

  try {
    const u = new URL(raw);
    let clean = u.origin + u.pathname;

    if (u.pathname === '/' || u.pathname === '') {
      clean = u.origin + '/';
    } else {
      clean = clean.replace(/\/\/+$/, '');
    }

    return clean;
  } catch {
    return raw.trim();
  }
}

module.exports = {
  generateDappId,
  cleanWebsiteUrl
};
