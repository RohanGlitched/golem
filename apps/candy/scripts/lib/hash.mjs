// Content hashing for the asset script.
import { createHash } from 'node:crypto';

/** @param {Uint8Array | string} bytes @returns {string} lower-case hex sha256 */
export function sha256(bytes) {
  return createHash('sha256').update(typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes).digest('hex');
}

/**
 * Hash of text with Windows line endings folded to \n, so a checkout with CRLF hashes like one with LF.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function sha256Text(bytes) {
  return sha256(new TextDecoder().decode(bytes).replace(/\r\n/g, '\n'));
}
