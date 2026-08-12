import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import which from 'which';
import type { DiscoveredProfile } from './models.js';

export type ModelTier = 'low' | 'medium' | 'high';

export type CanonicalEffort = 'minimal' | 'low' | 'medium' | 'high' | 'max';

export const CANONICAL_EFFORTS: CanonicalEffort[] = ['minimal', 'low', 'medium', 'high', 'max'];

export type EffortCapability =
  | { supported: false }
  | {
      supported: true;
      default: CanonicalEffort;
      arg_template: string;
      canonical_to_native: Record<CanonicalEffort, string>;
    };

export interface ModelEntry {
  id: string;
  name: string;
  description: string;
  tier?: ModelTier;
}

export interface ProviderEntry {
  id: string;
  name: string;
  binary: string;
  model_flag: string;
  effort?: EffortCapability;
  models: ModelEntry[];
}

export interface ProviderModelsFile {
  providers: ProviderEntry[];
}

let providerCatalogCache: ProviderModelsFile | null = null;

function loadProviderModels(): ProviderModelsFile {
  if (providerCatalogCache) return providerCatalogCache;
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const jsonPath = path.join(thisDir, 'provider-models.json');
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  providerCatalogCache = JSON.parse(raw) as ProviderModelsFile;
  return providerCatalogCache;
}

/** Public access to the full provider/model catalog (cached). */
export function getProviderCatalog(): ProviderModelsFile {
  return loadProviderModels();
}

/** Look up a provider entry by id. Returns null if not in the catalog. */
export function getProviderEntry(providerId: string): ProviderEntry | null {
  const catalog = loadProviderModels();
  return catalog.providers.find((p) => p.id === providerId) ?? null;
}

/**
 * Effort capability for the given provider id, or null if unknown.
 * Callers should check `.supported` before using template / mapping.
 */
export function getEffortCapability(providerId: string): EffortCapability | null {
  const provider = getProviderEntry(providerId);
  return provider?.effort ?? null;
}

/**
 * Translate a canonical effort level into the provider's native CLI arg
 * fragment, or null if the provider doesn't support effort or the canonical
 * value is missing from its mapping. The returned string is ready to be
 * tokenised by `splitCommand` before spawning.
 */
export function renderEffortArg(
  providerId: string,
  canonical: CanonicalEffort | null | undefined,
): string | null {
  if (!canonical) return null;
  const cap = getEffortCapability(providerId);
  if (!cap || !cap.supported) return null;
  const native = cap.canonical_to_native[canonical];
  if (!native) return null;
  return cap.arg_template.replace('{native}', native);
}

/**
 * For a given provider, return the model id at each tier. Falls back to the
 * first model in the list if a tier is missing. Used by the planner prompt
 * so the agent suggests model ids the user's CLI can actually accept.
 */
export function getTierModelMap(
  providerId: string,
): { low: string; medium: string; high: string; all: string[] } | null {
  const provider = getProviderEntry(providerId);
  if (!provider || provider.models.length === 0) return null;

  const byTier = (tier: ModelTier): string | null => {
    const match = provider.models.find((m) => m.tier === tier);
    return match ? match.id : null;
  };

  const fallback = provider.models[0].id;
  return {
    low: byTier('low') ?? fallback,
    medium: byTier('medium') ?? fallback,
    high: byTier('high') ?? fallback,
    all: provider.models.map((m) => m.id),
  };
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
      model: 'gpt-5.6-terra',
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
