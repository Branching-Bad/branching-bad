// ---------------------------------------------------------------------------
// Jira Client — REST API client + helpers
// ---------------------------------------------------------------------------

// ── Models ──

export interface JiraMe {
  accountId: string;
  displayName: string;
  emailAddress: string | null;
}

export interface JiraIssueForTask {
  jiraIssueKey: string;
  title: string;
  description: string | null;
  assignee: string | null;
  status: string;
  priority: string | null;
  payload: unknown;
}

// ── Client ──

export class JiraClient {
  private baseUrl: string;
  private email: string;
  private apiToken: string;

  constructor(baseUrl: string, email: string, apiToken: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.email = email;
    this.apiToken = apiToken;
  }

  async validateCredentials(): Promise<JiraMe> {
    const payload = await this.getJson('/rest/api/3/myself', {});
    return {
      accountId: String(payload.accountId ?? ''),
      displayName: String(payload.displayName ?? ''),
      emailAddress: payload.emailAddress ? String(payload.emailAddress) : null,
    };
  }

  async fetchBoards(): Promise<Array<[string, string]>> {
    const all: Array<[string, string]> = [];
    const maxResults = 50;
    let startAt = 0;

    for (;;) {
      const payload = await this.getJson('/rest/agile/1.0/board', {
        startAt: String(startAt),
        maxResults: String(maxResults),
      });
      const values = Array.isArray(payload.values) ? payload.values : [];
      for (const item of values) {
        const id = item.id != null ? String(item.id) : '';
        const name = String(item.name ?? 'Unnamed board');
        if (id) {
          all.push([id, name]);
        }
      }

      const isLast = payload.isLast ?? values.length < maxResults;
      if (isLast || values.length < maxResults) break;
      startAt += maxResults;
    }

    return all;
  }

  async fetchAssignedBoardIssues(
    boardId: string,
    jql?: string,
  ): Promise<JiraIssueForTask[]> {
    const defaultJql =
      'assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC, updated DESC';
    const payload = await this.getJson(
      `/rest/agile/1.0/board/${boardId}/issue`,
      {
        maxResults: '100',
        fields: 'summary,description,status,priority,assignee,updated',
        jql: jql ?? defaultJql,
      },
    );
    const issues = Array.isArray(payload.issues) ? payload.issues : [];

    return issues.map((issue: any) => {
      const key = String(issue.key ?? '');
      const fields = issue.fields ?? {};

      const title = String(fields.summary ?? key);
      const description = mapDescription(fields.description);
      const assignee =
        fields.assignee?.displayName ??
        fields.assignee?.emailAddress ??
        null;
      const status = mapStatus(fields.status);
      const priority = fields.priority?.name ?? null;

      return {
        jiraIssueKey: key,
        title,
        description,
        assignee: assignee ? String(assignee) : null,
        status,
        priority: priority ? String(priority) : null,
        payload: issue,
      };
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

    const auth = Buffer.from(`${this.email}:${this.apiToken}`).toString(
      'base64',
    );
    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${auth}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Jira request failed (${response.status}): ${body.slice(0, 300)}`,
      );
    }

    return response.json();
  }
}

// ── Helpers ──

export function clientFromConfig(config: Record<string, unknown>): JiraClient {
  const baseUrl = String(config.base_url ?? '');
  const email = String(config.email ?? '');
  const apiToken = String(config.api_token ?? '');
  return new JiraClient(baseUrl, email, apiToken);
}

function mapStatus(raw: any): string {
  const category = raw?.statusCategory?.key;
  switch (category) {
    case 'done':
      return 'done';
    case 'indeterminate':
      return 'inprogress';
    case 'new':
      return 'todo';
    default: {
      const name = raw?.name;
      if (typeof name === 'string') {
        return name.toLowerCase().replace(/ /g, '_');
      }
      return 'unknown';
    }
  }
}

function mapDescription(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw;
  return JSON.stringify(raw);
}
