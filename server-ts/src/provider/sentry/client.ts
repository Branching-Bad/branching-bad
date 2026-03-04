// ---------------------------------------------------------------------------
// Sentry Client — REST API client + helpers
// ---------------------------------------------------------------------------

import type { SentryIssue, SentryOrg, SentryProjectInfo } from './models.js';

// ── Client ──

export class SentryClient {
  private baseUrl: string;
  private orgSlug: string;
  private authToken: string;

  constructor(baseUrl: string, orgSlug: string, authToken: string) {
    this.baseUrl = normalizeSentryUrl(baseUrl);
    this.orgSlug = orgSlug;
    this.authToken = authToken;
  }

  async validateCredentials(): Promise<SentryOrg> {
    const payload = await this.getJson(
      `/api/0/organizations/${this.orgSlug}/`,
      {},
    );
    return {
      slug: String(payload.slug ?? ''),
      name: String(payload.name ?? ''),
    };
  }

  async listProjects(): Promise<SentryProjectInfo[]> {
    const all: SentryProjectInfo[] = [];
    let cursor: string | null = null;

    for (;;) {
      const query: Record<string, string> = {};
      if (cursor) query.cursor = cursor;

      const response = await this.getWithHeaders(
        `/api/0/organizations/${this.orgSlug}/projects/`,
        query,
      );

      const nextCursor = parseLinkCursor(response.headers);
      const items = Array.isArray(response.body) ? response.body : [];
      if (items.length === 0) break;

      for (const item of items) {
        const slug = String(item.slug ?? '');
        const name = String(item.name ?? slug);
        const id = String(item.id ?? '');
        if (slug) {
          all.push({ slug, name, id });
        }
      }

      if (!nextCursor) break;
      cursor = nextCursor;
    }

    return all;
  }

  async fetchNewIssues(
    projectSlug: string,
    since: string | null,
  ): Promise<SentryIssue[]> {
    let queryStr = `is:unresolved project:${projectSlug}`;
    if (since) {
      const cleaned = since.replace(/\+00:00$/, '').replace(/Z$/, '');
      queryStr += ` lastSeen:>${cleaned}`;
    }

    const payload = await this.getJson(
      `/api/0/organizations/${this.orgSlug}/issues/`,
      {
        query: queryStr,
        sort: 'date',
        limit: '100',
      },
    );

    const items = Array.isArray(payload) ? payload : [];
    const issues: SentryIssue[] = [];

    for (const item of items) {
      const id = String(item.id ?? '');
      if (!id) continue;

      const countRaw = item.count;
      let count = 1;
      if (typeof countRaw === 'number') {
        count = countRaw;
      } else if (typeof countRaw === 'string') {
        const parsed = parseInt(countRaw, 10);
        if (!isNaN(parsed)) count = parsed;
      }

      issues.push({
        id,
        title: String(item.title ?? 'Untitled'),
        culprit: item.culprit && String(item.culprit) !== '' ? String(item.culprit) : null,
        level: item.level ? String(item.level) : null,
        firstSeen: item.firstSeen ? String(item.firstSeen) : null,
        lastSeen: item.lastSeen ? String(item.lastSeen) : null,
        count,
        metadata: item.metadata ?? null,
      });
    }

    return issues;
  }

  async fetchLatestEvent(issueId: string): Promise<unknown> {
    return this.getJson(
      `/api/0/organizations/${this.orgSlug}/issues/${issueId}/events/latest/`,
      {},
    );
  }

  private async getJson(
    endpoint: string,
    query: Record<string, string>,
  ): Promise<any> {
    const response = await this.getWithHeaders(endpoint, query);
    return response.body;
  }

  private async getWithHeaders(
    endpoint: string,
    query: Record<string, string>,
  ): Promise<{ headers: Headers; body: any }> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.authToken}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Sentry request failed (${response.status}): ${body.slice(0, 300)}`,
      );
    }

    const body = await response.json();
    return { headers: response.headers, body };
  }
}

// ── Helpers ──

export function clientFromConfig(config: Record<string, unknown>): SentryClient {
  const baseUrl = String(config.base_url ?? '');
  const orgSlug = String(config.org_slug ?? '');
  const authToken = String(config.auth_token ?? '');
  return new SentryClient(baseUrl, orgSlug, authToken);
}

function normalizeSentryUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, '');
  const match = trimmed.match(/^https?:\/\/(.+)$/);
  if (match) {
    const host = match[1];
    if (host.endsWith('.sentry.io') && host !== 'sentry.io') {
      return 'https://sentry.io';
    }
  }
  return trimmed;
}

function parseLinkCursor(headers: Headers): string | null {
  const link = headers.get('link');
  if (!link) return null;

  for (const part of link.split(',')) {
    if (part.includes('rel="next"') && part.includes('results="true"')) {
      for (const segment of part.split(';')) {
        const trimmed = segment.trim();
        if (trimmed.startsWith('cursor="')) {
          return trimmed.slice('cursor="'.length).replace(/"$/, '');
        }
      }
    }
  }

  return null;
}
