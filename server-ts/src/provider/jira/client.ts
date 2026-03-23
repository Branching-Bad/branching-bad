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

export interface JiraSprint {
  id: string;
  name: string;
  state: string;
  startDate: string | null;
  endDate: string | null;
  goal: string | null;
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
    return this.fetchIssuesPaginated(
      `/rest/agile/1.0/board/${boardId}/issue`,
      jql ?? defaultJql,
    );
  }

  async fetchBoardSprints(boardId: string): Promise<JiraSprint[]> {
    const all: JiraSprint[] = [];
    const maxResults = 50;
    let startAt = 0;

    for (;;) {
      const payload = await this.getJson(
        `/rest/agile/1.0/board/${boardId}/sprint`,
        {
          startAt: String(startAt),
          maxResults: String(maxResults),
          state: 'active,future',
        },
      );
      const values = Array.isArray(payload.values) ? payload.values : [];
      for (const item of values) {
        const id = item.id != null ? String(item.id) : '';
        if (!id) continue;
        all.push({
          id,
          name: String(item.name ?? 'Unnamed sprint'),
          state: String(item.state ?? 'unknown'),
          startDate: item.startDate ? String(item.startDate) : null,
          endDate: item.endDate ? String(item.endDate) : null,
          goal: item.goal ? String(item.goal) : null,
        });
      }

      const isLast = payload.isLast ?? values.length < maxResults;
      if (isLast || values.length < maxResults) break;
      startAt += maxResults;
    }

    return all;
  }

  async fetchAssignedSprintIssues(
    boardId: string,
    sprintId: string,
    jql?: string,
  ): Promise<JiraIssueForTask[]> {
    const defaultJql =
      'assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC, updated DESC';
    return this.fetchIssuesPaginated(
      `/rest/agile/1.0/board/${boardId}/sprint/${sprintId}/issue`,
      jql ?? defaultJql,
    );
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

  private async fetchIssuesPaginated(
    endpoint: string,
    jql: string,
  ): Promise<JiraIssueForTask[]> {
    const all: JiraIssueForTask[] = [];
    const maxResults = 100;
    let startAt = 0;

    for (;;) {
      const payload = await this.getJson(endpoint, {
        startAt: String(startAt),
        maxResults: String(maxResults),
        fields: 'summary,description,status,priority,assignee,updated',
        jql,
      });
      const issues = Array.isArray(payload.issues) ? payload.issues : [];
      all.push(...issues.map(mapIssue));

      if (issues.length < maxResults) break;
      startAt += maxResults;
    }

    return all;
  }
}

// ── Helpers ──

export function clientFromConfig(config: Record<string, unknown>): JiraClient {
  const baseUrl = String(config.base_url ?? '');
  const email = String(config.email ?? '');
  const apiToken = String(config.api_token ?? '');
  return new JiraClient(baseUrl, email, apiToken);
}

function mapIssue(issue: any): JiraIssueForTask {
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
}

function mapStatus(raw: any): string {
  const category = raw?.statusCategory?.key;
  const name = typeof raw?.name === 'string' ? raw.name : '';
  const normalizedName = name.toLowerCase().replace(/ /g, '_');
  switch (category) {
    case 'done':
      return 'done';
    case 'new':
      return 'todo';
    case 'indeterminate':
      return normalizedName || 'inprogress';
    default: {
      if (normalizedName) {
        return normalizedName;
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
