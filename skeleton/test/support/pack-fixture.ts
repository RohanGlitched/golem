// A fixture Kiro pack for init tests, written into a memory file system.
import { createHash } from 'node:crypto';
import type { PackManifest } from '../../src/cli/init.js';
import type { MemoryKitFs } from './memory-fs.js';

export const MCP_TEMPLATE = '{\n  "mcpServers": {\n    "golem": {\n      "command": "golem",\n      "args": ["mcp"]\n    }\n  }\n}\n';

export const FIXTURE_FILES: Record<string, string> = {
  'hooks/golem.json': '{ "version": "v1", "hooks": [] }\n',
  'hooks/golem-guard-requirements.mjs': '#!/usr/bin/env node\n// guard\n',
  'steering/golem-ears.md': '---\ninclusion: fileMatch\n---\n# EARS\n',
  'agents/golem-tuner.json': '{ "name": "golem-tuner" }\n',
  [`settings/mcp.json`]: MCP_TEMPLATE,
};

export function installPack(fs: MemoryKitFs, packRoot = '/pack', files: Record<string, string | Uint8Array> = FIXTURE_FILES): PackManifest {
  const manifest: PackManifest = { files: [] };
  for (const [rel, data] of Object.entries(files)) {
    fs.put(`${packRoot}/${rel}`, data);
    manifest.files.push({ rel, sha256: createHash('sha256').update(data).digest('hex'), kind: rel === 'settings/mcp.json' ? 'merge-mcp' : 'copy' });
  }
  fs.put(`${packRoot}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
