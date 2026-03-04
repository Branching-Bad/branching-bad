// ---------------------------------------------------------------------------
// SonarQube Helpers — utility functions for issue data transformation
// ---------------------------------------------------------------------------

import type { SqIssue } from './models.js';

export function issuesToItemTuples(
  issues: SqIssue[],
): Array<[string, string, string]> {
  return issues.map((issue) => {
    const title = `[${issue.severity}] ${issue.message}`;
    const data = {
      key: issue.key,
      rule: issue.rule,
      severity: issue.severity,
      message: issue.message,
      component: issue.component,
      line: issue.line,
      type: issue.typeField,
      effort: issue.effort,
    };
    return [issue.key, title, JSON.stringify(data)];
  });
}
