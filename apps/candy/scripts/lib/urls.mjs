// Download URLs for MuJoCo Menagerie. Every URL is built from one pinned commit.

const REPO = 'google-deepmind/mujoco_menagerie';
const DIR = 'franka_emika_panda';
const ALLOWED_HOSTS = new Set(['raw.githubusercontent.com', 'api.github.com']);

/**
 * @param {string} commit 40 lowercase hexadecimal characters
 * @param {string} path path inside franka_emika_panda, no leading slash, no `..`, `?` or `#`
 * @returns {string}
 */
export function pandaUrl(commit, path) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`commit "${commit}" is not 40 lowercase hex characters`);
  if (path === '' || path.startsWith('/') || /[?#]/.test(path) || path.split('/').includes('..')) {
    throw new Error(`upstream path "${path}" is not a plain repository path`);
  }
  return `https://raw.githubusercontent.com/${REPO}/${commit}/${DIR}/${path}`;
}

/** URL of the commit API, used only by `--resolve --head`. @returns {string} */
export function headUrl() {
  return `https://api.github.com/repos/${REPO}/commits/main`;
}

/** @param {string} url @returns {boolean} true for https URLs on the two GitHub hosts that the script uses */
export function isAllowedHost(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname);
}
