import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AppState } from '../state.js';
import { ApiError } from '../errors.js';
import { loadCatalog } from '../mcp/catalog.js';
import { resolveMcpServer } from '../mcp/resolver.js';
import { testMcpConnection } from '../mcp/testConnection.js';

export function mcpRoutes(state: AppState): Router {
  const r = Router();

  r.get('/api/mcp/catalog', async (_req, res, next) => {
    try {
      const cat = await loadCatalog();
      res.json(cat);
    } catch (e) { next(e); }
  });

  r.get('/api/mcp/servers', (_req, res, next) => {
    try { res.json(state.db.listMcpServers()); }
    catch (e) { next(e); }
  });

  r.post('/api/mcp/servers', async (req, res, next) => {
    try {
      const { catalogId, name, configJson, secrets } = req.body as {
        catalogId: string; name: string;
        configJson: Record<string, unknown>;
        secrets?: Record<string, string>;
      };
      if (!catalogId || !name || !configJson) throw new ApiError(400, 'catalogId, name, configJson required');
      const id = randomUUID();
      const { cleanedConfig, secretMap } = extractSecrets(configJson, secrets);
      for (const [envKey, value] of Object.entries(secretMap)) {
        await state.secretStore.set(id, envKey, value);
      }
      const server = state.db.createMcpServer(id, catalogId, name, cleanedConfig);
      res.status(201).json(server);
    } catch (e) { next(e); }
  });

  r.get('/api/mcp/servers/:id', (req, res, next) => {
    try {
      const s = state.db.getMcpServer(req.params.id);
      if (!s) throw new ApiError(404, 'not found');
      res.json(s);
    } catch (e) { next(e); }
  });

  r.put('/api/mcp/servers/:id', async (req, res, next) => {
    try {
      const { name, configJson, enabled, secrets } = req.body as {
        name?: string; configJson?: Record<string, unknown>;
        enabled?: boolean; secrets?: Record<string, string>;
      };
      const id = req.params.id;
      if (configJson) {
        const { cleanedConfig, secretMap } = extractSecrets(configJson, secrets);
        for (const [envKey, value] of Object.entries(secretMap)) {
          await state.secretStore.set(id, envKey, value);
        }
        state.db.updateMcpServer(id, { name, configJson: cleanedConfig, enabled });
      } else {
        state.db.updateMcpServer(id, { name, enabled });
      }
      res.json(state.db.getMcpServer(id));
    } catch (e) { next(e); }
  });

  r.delete('/api/mcp/servers/:id', async (req, res, next) => {
    try {
      await state.secretStore.deleteAll(req.params.id);
      state.db.deleteMcpServer(req.params.id);
      res.status(204).end();
    } catch (e) { next(e); }
  });

  r.post('/api/mcp/servers/:id/test', async (req, res, next) => {
    try {
      const server = state.db.getMcpServer(req.params.id);
      if (!server) throw new ApiError(404, 'not found');
      const cat = await loadCatalog();
      const resolved = await resolveMcpServer(server, cat, state.secretStore);
      const result = await testMcpConnection(resolved);
      res.json(result);
    } catch (e) { next(e); }
  });

  r.get('/api/agent-profiles/:id/mcp', (req, res, next) => {
    try { res.json(state.db.listMcpsForProfile(req.params.id)); }
    catch (e) { next(e); }
  });

  r.put('/api/agent-profiles/:id/mcp', (req, res, next) => {
    try {
      const { mcpServerIds } = req.body as { mcpServerIds: string[] };
      if (!Array.isArray(mcpServerIds)) throw new ApiError(400, 'mcpServerIds must be array');
      state.db.setAgentProfileMcps(req.params.id, mcpServerIds);
      res.json(state.db.listMcpsForProfile(req.params.id));
    } catch (e) { next(e); }
  });

  return r;
}

function extractSecrets(
  configJson: Record<string, unknown>,
  secrets?: Record<string, string>,
): { cleanedConfig: Record<string, unknown>; secretMap: Record<string, string> } {
  const cleaned: Record<string, unknown> = { ...configJson };
  const secretMap: Record<string, string> = {};
  if (secrets) {
    for (const [envKey, value] of Object.entries(secrets)) {
      cleaned[envKey] = `$secret:${envKey}`;
      secretMap[envKey] = value;
    }
  }
  return { cleanedConfig: cleaned, secretMap };
}
