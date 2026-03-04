import fs from 'fs';
import os from 'os';
import path from 'path';
import which from 'which';
import type { DiscoveredProfile } from './models.js';

export function discoverAgentProfiles(): DiscoveredProfile[] {
  const profiles: DiscoveredProfile[] = [];

  // Codex
  const codexModel = readModelFromTextConfigPaths(
    configPaths('.codex/config.toml', 'codex/config.toml'),
    ['model = "', 'model="'],
  );
  const codexPath = resolveWhich('codex');
  if (codexPath) {
    profiles.push({
      provider: 'codex',
      agent_name: 'Codex CLI',
      model: codexModel ?? 'gpt-5-codex',
      command: codexPath,
      source: codexPath,
      discovery_kind: 'binary',
      metadata: { hint: 'Detected codex binary in PATH' },
    });
  }

  // Claude Code
  const claudeConfigModel = readModelFromJsonConfigPaths(
    configPaths('.claude/settings.json', 'Claude/settings.json'),
  );
  const claudePath = resolveWhich('claude');
  if (claudePath) {
    const models = new Set<string>();
    if (claudeConfigModel) {
      models.add(claudeConfigModel);
    }
    models.add('sonnet');
    models.add('haiku');
    models.add('opus');

    const sorted = [...models].sort();
    for (const model of sorted) {
      profiles.push({
        provider: 'claude-code',
        agent_name: 'Claude Code',
        model,
        command: claudePath,
        source: claudePath,
        discovery_kind: 'binary',
        metadata: { hint: 'Detected claude binary in PATH' },
      });
    }
  }

  // Gemini CLI
  const geminiPath = resolveWhich('gemini');
  if (geminiPath) {
    profiles.push({
      provider: 'gemini-cli',
      agent_name: 'Gemini CLI',
      model: 'gemini-2.5-pro',
      command: geminiPath,
      source: geminiPath,
      discovery_kind: 'binary',
      metadata: { hint: 'Detected gemini binary in PATH' },
    });
  }

  // OpenCode
  const opencodePath = resolveWhich('opencode');
  if (opencodePath) {
    profiles.push({
      provider: 'opencode',
      agent_name: 'OpenCode',
      model: 'default',
      command: opencodePath,
      source: opencodePath,
      discovery_kind: 'binary',
      metadata: { hint: 'Detected opencode binary in PATH' },
    });
  }

  // Cursor
  const cursorPath = resolveWhich('cursor');
  if (cursorPath) {
    profiles.push({
      provider: 'cursor',
      agent_name: 'Cursor',
      model: 'default',
      command: cursorPath,
      source: cursorPath,
      discovery_kind: 'binary',
      metadata: { hint: 'Detected cursor binary in PATH' },
    });
  }

  // Inferred fallbacks when no binaries are found
  if (profiles.length === 0) {
    profiles.push({
      provider: 'claude-code',
      agent_name: 'Claude Code',
      model: 'sonnet',
      command: 'claude',
      source: 'inferred',
      discovery_kind: 'inferred',
      metadata: { hint: 'No known binaries found. Using inferred defaults.' },
    });
    profiles.push({
      provider: 'codex',
      agent_name: 'Codex CLI',
      model: 'gpt-5-codex',
      command: 'codex',
      source: 'inferred',
      discovery_kind: 'inferred',
      metadata: { hint: 'No known binaries found. Using inferred defaults.' },
    });
  }

  return profiles;
}

function resolveWhich(name: string): string | null {
  try {
    return which.sync(name);
  } catch {
    return null;
  }
}

/**
 * Returns candidate config file paths. On all platforms the home-relative path
 * is included. On Windows, an additional %APPDATA%-relative path is checked.
 */
function configPaths(homePosix: string, windowsAppData?: string): string[] {
  const paths: string[] = [];
  const home = os.homedir();
  if (home) paths.push(path.join(home, homePosix));
  if (process.platform === 'win32' && windowsAppData) {
    const appData = process.env.APPDATA;
    if (appData) paths.push(path.join(appData, windowsAppData));
  }
  return paths;
}

function readModelFromTextConfigPaths(
  paths: string[],
  prefixes: string[],
): string | null {
  for (const filePath of paths) {
    const result = readModelFromTextConfig(filePath, prefixes);
    if (result) return result;
  }
  return null;
}

function readModelFromTextConfig(
  filePath: string,
  prefixes: string[],
): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    for (const prefix of prefixes) {
      if (trimmed.startsWith(prefix)) {
        const rest = trimmed.slice(prefix.length);
        if (rest.endsWith('"')) {
          const model = rest.slice(0, -1).trim();
          if (model.length > 0) {
            return model;
          }
        }
      }
    }
  }

  return null;
}

function readModelFromJsonConfigPaths(paths: string[]): string | null {
  for (const filePath of paths) {
    const result = readModelFromJsonConfig(filePath);
    if (result) return result;
  }
  return null;
}

function readModelFromJsonConfig(filePath: string): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }

  for (const key of ['model', 'defaultModel', 'activeModel']) {
    const value = json[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}
