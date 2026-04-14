import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import which from 'which';
import type { DiscoveredProfile } from './models.js';

interface ModelEntry {
  id: string;
  name: string;
  description: string;
}

interface ProviderEntry {
  id: string;
  name: string;
  binary: string;
  model_flag: string;
  models: ModelEntry[];
}

interface ProviderModelsFile {
  providers: ProviderEntry[];
}

function loadProviderModels(): ProviderModelsFile {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const jsonPath = path.join(thisDir, 'provider-models.json');
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  return JSON.parse(raw) as ProviderModelsFile;
}

export function discoverAgentProfiles(): DiscoveredProfile[] {
  const profiles: DiscoveredProfile[] = [];
  const catalog = loadProviderModels();

  for (const provider of catalog.providers) {
    const binaryPath = resolveWhich(provider.binary);
    if (!binaryPath) continue;

    // Try to read configured model from config files
    const configModel = readConfigModel(provider.id);

    for (const model of provider.models) {
      profiles.push({
        provider: provider.id,
        agent_name: provider.name,
        model: model.id,
        command: binaryPath,
        source: binaryPath,
        discovery_kind: 'binary',
        metadata: {
          hint: `Detected ${provider.binary} binary in PATH`,
          model_name: model.name,
          model_description: model.description,
        },
      });
    }

    // Add user's configured model if not already in the catalog
    if (configModel && !provider.models.some((m) => m.id === configModel)) {
      profiles.push({
        provider: provider.id,
        agent_name: provider.name,
        model: configModel,
        command: binaryPath,
        source: binaryPath,
        discovery_kind: 'binary',
        metadata: {
          hint: 'Model read from user config file',
          model_name: configModel,
          model_description: 'User-configured model',
        },
      });
    }
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
      model: 'gpt-5.4',
      command: 'codex',
      source: 'inferred',
      discovery_kind: 'inferred',
      metadata: { hint: 'No known binaries found. Using inferred defaults.' },
    });
  }

  return profiles;
}

/** Read the user's currently configured model from CLI config files. */
function readConfigModel(providerId: string): string | null {
  switch (providerId) {
    case 'claude-code':
      return readModelFromJsonConfigPaths(
        configPaths('.claude/settings.json', 'Claude/settings.json'),
      );
    case 'codex':
      return readModelFromTextConfigPaths(
        configPaths('.codex/config.toml', 'codex/config.toml'),
        ['model = "', 'model="'],
      );
    default:
      return null;
  }
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
