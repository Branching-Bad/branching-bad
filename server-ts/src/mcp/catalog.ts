import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpCatalog, McpCatalogEntry } from './model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.resolve(__dirname, '../../mcp-catalog.json');

let cached: McpCatalog | null = null;

export async function loadCatalog(): Promise<McpCatalog> {
  if (cached) return cached;
  const raw = await fs.promises.readFile(CATALOG_PATH, 'utf8');
  const parsed = JSON.parse(raw) as McpCatalog;
  if (typeof parsed.version !== 'number' || !parsed.entries) {
    throw new Error('invalid mcp-catalog.json shape');
  }
  cached = parsed;
  return parsed;
}

export function getEntry(catalog: McpCatalog, id: string): McpCatalogEntry | undefined {
  return catalog.entries[id];
}
