// ---------------------------------------------------------------------------
// Elasticsearch Analysis — runAnalysis, buildTaskDescription
// ---------------------------------------------------------------------------

import { parseJsonFromAgent } from '../utils.js';
import type { AnalysisResult, InvestigationResult } from './models.js';

export async function runAnalysis(
  question: string,
  result: InvestigationResult,
  agentCommand: string,
  repoPath: string,
  invokeAgentCli: (cmd: string, prompt: string, cwd: string, progress: any, sessionId: string | null) => Promise<{ text: string; session_id: string | null }>,
): Promise<AnalysisResult> {
  const errorLogsText = result.errorLogs
    .slice(0, 30)
    .map((e) => `[${e.timestamp}] ${e.message}`)
    .join('\n');

  const traceText = Object.entries(result.traceLogs)
    .slice(0, 3)
    .map(([cid, entries]) => {
      const lines = entries
        .slice(0, 50)
        .map((e) => `  [${e.timestamp}] ${e.message}`)
        .join('\n');
      return `--- Trace ${cid} ---\n${lines}`;
    })
    .join('\n\n');

  const prompt = `You are analyzing Elasticsearch logs for this user question:
"${question}"

Error logs found:
${errorLogsText}

Request traces:
${traceText}

Relevant codebase files: ${result.relevantFiles.join(', ')}

CRITICAL: This is a READ-ONLY analysis task. Do NOT modify any files.

Analyze these logs and respond ONLY with this JSON:
{
  "summary": "One paragraph summary of what happened",
  "root_cause": "The specific root cause identified",
  "suggestion": "What code change would fix this",
  "severity": "critical|high|medium|low"
}`;

  const agentOutput = await invokeAgentCli(agentCommand, prompt, repoPath, null, null);

  interface RawAnalysis {
    summary: string;
    root_cause: string;
    suggestion: string;
    severity: string;
  }

  const raw = parseJsonFromAgent<RawAnalysis>(agentOutput.text);
  return {
    summary: raw.summary,
    rootCause: raw.root_cause,
    suggestion: raw.suggestion,
    severity: raw.severity,
  };
}

export function buildTaskDescription(
  question: string,
  result: InvestigationResult,
): string {
  let desc = `## Elasticsearch Investigation\n\n**Question:** ${question}\n\n`;

  if (result.analysis) {
    desc += `### Root Cause\n${result.analysis.rootCause}\n\n`;
    desc += `### Summary\n${result.analysis.summary}\n\n`;
    desc += `### Suggestion\n${result.analysis.suggestion}\n\n`;
    desc += `### Severity\n${result.analysis.severity}\n\n`;
  }

  if (result.relevantFiles.length > 0) {
    desc += '### Relevant Files\n';
    for (const f of result.relevantFiles) {
      desc += `- \`${f}\`\n`;
    }
    desc += '\n';
  }

  if (result.errorLogs.length > 0) {
    desc += `### Error Logs (${result.errorLogs.length} found)\n\`\`\`\n`;
    for (const entry of result.errorLogs.slice(0, 10)) {
      desc += `[${entry.timestamp}] ${entry.message}\n`;
    }
    desc += '```\n\n';
  }

  desc += `### ES Query DSL\n\`\`\`json\n${JSON.stringify(result.phase1Query, null, 2)}\n\`\`\`\n`;
  return desc;
}
