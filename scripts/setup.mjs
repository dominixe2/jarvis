#!/usr/bin/env node
// JARVIS preflight — checks prerequisites and explains the current one-command launcher.
// This is advisory: it never changes credentials, installs packages, or edits config.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const tick = '  ok  ';
const warn = ' note ';
const info = '  ·   ';
function line(tag, msg) { console.log(`[${tag}] ${msg}`); }

console.log('');
console.log('JARVIS preflight — checking your machine (nothing is changed)');
console.log('------------------------------------------------------------');

const major = Number(process.versions.node.split('.')[0]);
if (Number.isFinite(major) && major >= 20) line(tick, `Node.js ${process.versions.node} (20+ required).`);
else line(warn, `Node.js ${process.versions.node} is below 20. Upgrade Node.js before starting JARVIS.`);

let claudeFound = false;
try {
  const res = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 10000 });
  if (res.status === 0 && res.stdout) {
    claudeFound = true;
    line(tick, `Claude CLI found: ${res.stdout.trim()}`);
  }
} catch { /* explained below */ }

if (!claudeFound) {
  line(info, 'Claude CLI not found. That is okay if you plan to use Gemini Flash.');
  line(info, 'For the bridge backend, install Claude Code and sign in once.');
}

const claudeJsonPath = join(homedir(), '.claude.json');
try {
  const parsed = JSON.parse(readFileSync(claudeJsonPath, 'utf8'));
  const servers = parsed && typeof parsed.mcpServers === 'object' && parsed.mcpServers ? parsed.mcpServers : {};
  const count = Object.keys(servers).length;
  line(count ? tick : info, count ? `Found ${count} configured MCP server(s).` : 'No MCP servers configured yet; basic chat can still work.');
} catch {
  line(info, 'No Claude MCP configuration found yet; this is optional for Gemini mode.');
}

console.log('');
console.log('Start JARVIS with: npm start');
console.log('The launcher starts the local Gemini settings/proxy service automatically.');
console.log('Use Settings in the app to store your Gemini 3.8 Flash API key, then restart JARVIS. Gemini is the default.');
console.log('For advanced MCP integrations, switch to bridge mode and sign in to Claude Code first.');
console.log('The optional bridge write tools stay disabled unless explicitly enabled.');
console.log('');
process.exit(0);
