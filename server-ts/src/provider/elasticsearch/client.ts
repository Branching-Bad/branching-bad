import type { ClusterHealth, EsAuth, IndexInfo, LogEntry, SearchResult } from './models.js';

// ── Client ──

export class EsClient {
  private baseUrl: string;
  private auth: EsAuth;

  static fromConfig(config: Record<string, unknown>): EsClient {
    const url = String(config.url ?? '');
    const username = config.username as string | undefined;
    const password = config.password as string | undefined;
    const apiKey = config.api_key as string | undefined;
    return new EsClient(url, username, password, apiKey);
  }

  constructor(
    baseUrl: string,
    username?: string,
    password?: string,
    apiKey?: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    if (apiKey && apiKey.trim() !== '') {
      this.auth = { kind: 'apiKey', key: apiKey };
    } else if (username && username.trim() !== '') {
      this.auth = { kind: 'basic', user: username, pass: password ?? '' };
    } else {
      this.auth = { kind: 'none' };
    }
  }

  private applyAuth(headers: Record<string, string>): Record<string, string> {
    switch (this.auth.kind) {
      case 'basic': {
        const b64 = Buffer.from(
          `${this.auth.user}:${this.auth.pass}`,
        ).toString('base64');
        return { ...headers, Authorization: `Basic ${b64}` };
      }
      case 'apiKey':
        return { ...headers, Authorization: `ApiKey ${this.auth.key}` };
      default:
        return headers;
    }
  }

  async clusterHealth(): Promise<ClusterHealth> {
    const url = `${this.baseUrl}/_cluster/health`;
    const resp = await fetch(url, {
      headers: this.applyAuth({ Accept: 'application/json' }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Cluster health failed (${resp.status}): ${text}`);
    }
    const data: any = await resp.json();
    return {
      clusterName: String(data.cluster_name ?? ''),
      status: String(data.status ?? ''),
      numberOfNodes: Number(data.number_of_nodes ?? 0),
    };
  }

  async listIndices(): Promise<IndexInfo[]> {
    const url = `${this.baseUrl}/_cat/indices?format=json&h=index,health,docs.count,store.size`;
    const resp = await fetch(url, {
      headers: this.applyAuth({ Accept: 'application/json' }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`List indices failed (${resp.status}): ${text}`);
    }
    const data: any[] = await resp.json();
    return data
      .filter((item) => !String(item.index ?? '').startsWith('.'))
      .map((item) => ({
        index: String(item.index ?? ''),
        health: String(item.health ?? ''),
        docsCount: item['docs.count'] ?? null,
        storeSize: item['store.size'] ?? null,
      }))
      .sort((a, b) => a.index.localeCompare(b.index));
  }

  async search(index: string, queryJson: any, size: number): Promise<SearchResult> {
    const url = `${this.baseUrl}/${index}/_search`;
    const body = JSON.stringify({
      query: queryJson,
      size,
      sort: [{ '@timestamp': { order: 'desc' } }],
    });

    const resp = await fetch(url, {
      method: 'POST',
      headers: this.applyAuth({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`ES search failed (${resp.status}): ${text}`);
    }

    const parsed: any = await resp.json();
    const total =
      parsed.hits?.total?.value ?? parsed.hits?.total ?? 0;
    const hits = Array.isArray(parsed.hits?.hits) ? parsed.hits.hits : [];

    return { total: Number(total), hits };
  }
}

// ── LogEntry from ES hit ──

export function logEntryFromHit(hit: any): LogEntry {
  const source = hit._source ?? {};
  const timestamp = String(
    source['@timestamp'] ?? source.timestamp ?? '',
  );
  const message = String(source.message ?? source.msg ?? '');
  return { timestamp, message, source };
}
