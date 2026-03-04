// ---------------------------------------------------------------------------
// Sentry Provider — type definitions
// ---------------------------------------------------------------------------

export interface SentryOrg {
  slug: string;
  name: string;
}

export interface SentryProjectInfo {
  slug: string;
  name: string;
  id: string;
}

export interface SentryIssue {
  id: string;
  title: string;
  culprit: string | null;
  level: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  count: number;
  metadata: unknown;
}
