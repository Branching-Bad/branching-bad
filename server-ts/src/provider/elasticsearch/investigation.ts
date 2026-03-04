// ---------------------------------------------------------------------------
// Elasticsearch Investigation — runPhase1 (query generation + log fetching)
// ---------------------------------------------------------------------------

import { parseJsonFromAgent } from '../utils.js';
import { EsClient, logEntryFromHit } from './client.js';
import type {
  InvestigationRequest,
  InvestigationResult,
  LogEntry,
} from './models.js';

export async function runPhase1(
  req: InvestigationRequest,
  es: EsClient,
  invokeAgentCli: (cmd: string, prompt: string, cwd: string, progress: any, sessionId: string | null) => Promise<{ text: string; session_id: string | null }>,
): Promise<InvestigationResult> {
  const prompt = `You are an Elasticsearch logs investigator. The user reported this problem:
"${req.question}"

Target index: ${req.indexPattern}
Time range: last ${req.timeRangeMinutes} minutes

Your tasks:
1. Analyze this codebase to find the relevant endpoint/service/function
2. Understand the logging patterns (what fields exist, how errors are logged)
3. Generate an Elasticsearch query DSL (JSON) that will find ERROR/EXCEPTION logs
4. The query MUST use a time range filter on @timestamp for the last ${req.timeRangeMinutes} minutes
5. The query MUST be narrow and targeted

CRITICAL: This is a READ-ONLY investigation task. Do NOT modify any files.

IMPORTANT: Respond ONLY with this JSON (no other text):
{
  "query": { <ES query DSL object> },
  "reasoning": "Brief explanation of what you found in the codebase",
  "relevant_files": ["path/to/file1.ts", "path/to/file2.ts"],
  "correlation_id_field": "field name for request correlation or null"
}`;

  const agentOutput = await invokeAgentCli(req.agentCommand, prompt, req.repoPath, null, null);

  interface Phase1Response {
    query: any;
    reasoning: string;
    relevant_files: string[];
    correlation_id_field: string | null;
  }

  const phase1 = parseJsonFromAgent<Phase1Response>(agentOutput.text);

  const result = await es.search(req.indexPattern, phase1.query, 200);
  const correlationIdField = phase1.correlation_id_field ?? '';

  const errorLogs: LogEntry[] = [];
  const correlationIds: string[] = [];

  for (const hit of result.hits) {
    const entry = logEntryFromHit(hit);

    if (correlationIdField) {
      const cid = extractCorrelationId(entry.source, correlationIdField);
      if (cid && !correlationIds.includes(cid)) {
        correlationIds.push(cid);
      }
    }

    errorLogs.push(entry);
  }

  // Fetch trace logs for each correlation ID
  const traceLogs: Record<string, LogEntry[]> = {};
  const nowMs = Date.now();
  const startMs = nowMs - req.timeRangeMinutes * 60 * 1000;

  for (const cid of correlationIds) {
    const traceQuery = {
      bool: {
        must: [
          { term: { [correlationIdField]: cid } },
          {
            range: {
              '@timestamp': { gte: startMs, lte: nowMs, format: 'epoch_millis' },
            },
          },
        ],
      },
    };

    try {
      const traceResult = await es.search(req.indexPattern, traceQuery, 100);
      traceLogs[cid] = traceResult.hits.map(logEntryFromHit);
    } catch (e) {
      console.error(`Elasticsearch: trace query for ${cid} failed: ${e}`);
    }
  }

  return {
    phase1Query: phase1.query,
    phase1Reasoning: phase1.reasoning,
    relevantFiles: phase1.relevant_files,
    correlationIdField,
    errorLogs,
    correlationIds,
    traceLogs,
  };
}

// ── Helpers ──

function extractCorrelationId(source: any, fieldName: string): string | null {
  // Direct field access
  const directVal = source[fieldName];
  if (typeof directVal === 'string' && directVal.length > 0 && directVal.length < 128) {
    return directVal;
  }

  // Nested path (e.g. "trace.id")
  const parts = fieldName.split('.');
  if (parts.length > 1) {
    let current = source;
    for (const part of parts) {
      current = current?.[part];
      if (current === undefined) break;
    }
    if (typeof current === 'string' && current.length > 0 && current.length < 128) {
      return current;
    }
  }

  // Fallback: extract from message field
  const message = String(source?.message ?? '');
  const patterns = [
    `"${fieldName}":"`,
    `"${fieldName}": "`,
    `${fieldName}=`,
  ];

  for (const pattern of patterns) {
    const start = message.indexOf(pattern);
    if (start >= 0) {
      const valStart = start + pattern.length;
      const rest = message.slice(valStart);
      const endIdx = rest.search(/[",\s}]/);
      const val = rest.slice(0, endIdx >= 0 ? endIdx : rest.length);
      if (val && val.length < 128) return val;
    }
  }

  return null;
}
