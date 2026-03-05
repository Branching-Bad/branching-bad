// ---------------------------------------------------------------------------
// SonarQube Client — REST API client for token-based authentication
// ---------------------------------------------------------------------------

import type { SqIssue, SqQualityGate, SqQualityProfile, SqProject } from './models.js';

// ── Client ──

export class SonarClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
  }

  async validate(): Promise<string> {
    const body = await this.getJson('/api/system/status', {});
    const status = String(body.status ?? 'UNKNOWN');
    if (status !== 'UP') {
      throw new Error(`SonarQube server status is '${status}', expected 'UP'`);
    }
    // Verify token is valid by calling an authenticated endpoint
    const authBody = await this.getJson('/api/authentication/validate', {});
    if (!authBody.valid) {
      throw new Error('Invalid SonarQube token. Authentication failed.');
    }
    return `SonarQube (${this.baseUrl})`;
  }

  async listProjects(): Promise<SqProject[]> {
    const all: SqProject[] = [];
    let page = 1;

    for (;;) {
      const body = await this.getJson('/api/projects/search', {
        ps: '500',
        p: String(page),
      });

      const components = Array.isArray(body.components) ? body.components : [];
      if (components.length === 0) break;

      for (const item of components) {
        const key = String(item.key ?? '');
        const name = String(item.name ?? key);
        if (key) all.push({ key, name });
      }

      const total = Number(body.paging?.total ?? 0);
      if (page * 500 >= total) break;
      page++;
    }

    return all;
  }

  async searchIssues(projectKey: string): Promise<SqIssue[]> {
    const body = await this.getJson('/api/issues/search', {
      componentKeys: projectKey,
      resolved: 'false',
      ps: '500',
      statuses: 'OPEN,CONFIRMED,REOPENED',
    });

    const issues = Array.isArray(body.issues) ? body.issues : [];
    const result: SqIssue[] = [];

    for (const issue of issues) {
      const key = String(issue.key ?? '');
      if (!key) continue;
      result.push({
        key,
        rule: String(issue.rule ?? ''),
        severity: String(issue.severity ?? 'MAJOR'),
        message: String(issue.message ?? ''),
        component: String(issue.component ?? ''),
        line: issue.line != null ? Number(issue.line) : null,
        typeField: String(issue.type ?? 'CODE_SMELL'),
        effort: issue.effort ? String(issue.effort) : null,
      });
    }

    return result;
  }

  async listQualityProfiles(): Promise<SqQualityProfile[]> {
    const body = await this.getJson('/api/qualityprofiles/search', {});
    const profiles = Array.isArray(body.profiles) ? body.profiles : [];
    const result: SqQualityProfile[] = [];
    for (const p of profiles) {
      const key = String(p.key ?? '');
      if (!key) continue;
      result.push({
        key,
        name: String(p.name ?? ''),
        language: String(p.language ?? ''),
        languageName: String(p.languageName ?? ''),
        isDefault: Boolean(p.isDefault),
      });
    }
    return result;
  }

  async listQualityGates(): Promise<SqQualityGate[]> {
    const body = await this.getJson('/api/qualitygates/list', {});
    const gates = Array.isArray(body.qualitygates) ? body.qualitygates : [];
    const result: SqQualityGate[] = [];
    for (const g of gates) {
      const id =
        typeof g.id === 'number' ? String(g.id) : String(g.id ?? '');
      if (!id) continue;
      result.push({
        id,
        name: String(g.name ?? ''),
        isDefault: Boolean(g.isDefault),
        isBuiltIn: Boolean(g.isBuiltIn),
      });
    }
    return result;
  }

  async setQualityGate(projectKey: string, gateName: string): Promise<void> {
    // Find gate ID by name — the API requires gateName (SQ 10+) or gateId (older)
    const gates = await this.listQualityGates();
    const gate = gates.find((g) => g.name === gateName);
    if (!gate) throw new Error(`Quality gate '${gateName}' not found`);
    await this.postForm('/api/qualitygates/select', {
      projectKey,
      gateName: gate.name,
      gateId: gate.id,
    });
  }

  async setQualityProfile(
    projectKey: string,
    profileName: string,
    language: string,
  ): Promise<void> {
    await this.postForm('/api/qualityprofiles/add_project', {
      project: projectKey,
      qualityProfile: profileName,
      language,
    });
  }

  private async getJson(
    endpoint: string,
    query: Record<string, string>,
  ): Promise<any> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }

    const resp = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(
        `SonarQube request failed (${resp.status}): ${body.slice(0, 300)}`,
      );
    }

    return resp.json();
  }

  private async postForm(
    endpoint: string,
    params: Record<string, string>,
  ): Promise<void> {
    const url = `${this.baseUrl}${endpoint}`;
    const body = new URLSearchParams(params);

    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(
        `SonarQube POST failed (${resp.status}): ${text.slice(0, 300)}`,
      );
    }
  }
}

// ── Factory ──

export function sonarClientFromConfig(config: Record<string, unknown>): SonarClient {
  const baseUrl = String(config.base_url ?? '');
  const token = String(config.token ?? '');
  return new SonarClient(baseUrl, token);
}
