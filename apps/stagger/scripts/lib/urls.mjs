// Download URLs for the upstream repository. Every URL is built from one pinned commit.

/** unitree_rl_gym at the commit pinned in .kiro/steering/interfaces.md. */
export const PINNED_COMMIT = '276801e46c5d433564f24658bac64f254b7d2d4b';

const UPSTREAM = 'unitreerobotics/unitree_rl_gym';
const ALLOWED_HOSTS = new Set(['raw.githubusercontent.com', 'github.com']);

/**
 * @param {string} commit 40 lowercase hexadecimal characters
 * @param {string} path path inside the repository, no leading slash, no `..`, `?` or `#`
 * @returns {string}
 */
export function upstreamUrl(commit, path) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`commit "${commit}" is not 40 lowercase hex characters`);
  if (path === '' || path.startsWith('/') || /[?#]/.test(path) || path.split('/').includes('..')) {
    throw new Error(`upstream path "${path}" is not a plain repository path`);
  }
  return `https://raw.githubusercontent.com/${UPSTREAM}/${commit}/${path}`;
}

/** @param {string} url @returns {boolean} true for https URLs on raw.githubusercontent.com or github.com */
export function isAllowedHost(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname);
}