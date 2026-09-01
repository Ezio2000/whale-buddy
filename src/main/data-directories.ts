import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  hardenPrivateDirectory,
  PRIVATE_DIRECTORY_MODE,
  PRIVATE_FILE_MODE,
} from './filesystem-security';

export function prepareDataDirectories(userDataRoot: string): {
  sidecarHome: string;
  codexHome: string;
  uiStateRoot: string;
  attachmentsRoot: string;
  artifactsRoot: string;
  logsRoot: string;
} {
  const sidecarHome = path.join(userDataRoot, 'sidecar-home');
  const codexHome = path.join(userDataRoot, 'codex-home');
  const uiStateRoot = path.join(userDataRoot, 'ui-state');
  const attachmentsRoot = path.join(uiStateRoot, 'attachments');
  const artifactsRoot = path.join(uiStateRoot, 'artifacts');
  const logsRoot = path.join(userDataRoot, 'logs');
  const privateDirectories = [
    sidecarHome,
    path.join(sidecarHome, '.agents', 'skills'),
    path.join(sidecarHome, '.agents', 'plugins'),
    path.join(sidecarHome, '.cache'),
    path.join(sidecarHome, '.config'),
    path.join(sidecarHome, '.local', 'share'),
    path.join(sidecarHome, '.local', 'state'),
    codexHome,
    uiStateRoot,
    attachmentsRoot,
    artifactsRoot,
    logsRoot,
  ];
  for (const directory of privateDirectories) {
    mkdirSync(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
    hardenPrivateDirectory(directory);
  }
  sanitizeStandaloneMcpConfig(codexHome);
  return { sidecarHome, codexHome, uiStateRoot, attachmentsRoot, artifactsRoot, logsRoot };
}

/** Whale only accepts MCP servers contributed by installed plugins. */
export function sanitizeStandaloneMcpConfig(codexHome: string): void {
  const configPath = path.join(codexHome, 'config.toml');
  if (!existsSync(configPath)) return;
  const original = readFileSync(configPath, 'utf8');
  const output: string[] = [];
  let skippingMcpTable = false;
  for (const line of original.split(/(?<=\n)/)) {
    const trimmed = line.trim();
    if (/^\[\[?/.test(trimmed)) {
      skippingMcpTable = /^\[\[?mcp_servers(?:[.\]])/.test(trimmed);
      if (skippingMcpTable) continue;
    }
    if (skippingMcpTable || /^mcp_servers\s*=/.test(trimmed)) continue;
    output.push(line);
  }
  const sanitized = output.join('').replace(/\n{3,}/g, '\n\n');
  if (sanitized === original) return;
  const temporaryPath = `${configPath}.tmp`;
  writeFileSync(temporaryPath, sanitized, { encoding: 'utf8', mode: PRIVATE_FILE_MODE });
  renameSync(temporaryPath, configPath);
}
