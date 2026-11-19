#!/usr/bin/env node
// Bin wrapper: builds CliIo and KitDeps from Node and runs `main`.
import { createDefaultDeps } from './deps.js';
import { main } from './run.js';
import { createNodeIo } from './node-io.js';

process.exitCode = await main(process.argv.slice(2), createNodeIo(), createDefaultDeps());
