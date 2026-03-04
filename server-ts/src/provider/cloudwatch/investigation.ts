// ---------------------------------------------------------------------------
// CloudWatch Investigation — runPhase1 (query generation + log fetching)
// ---------------------------------------------------------------------------

import { parseJsonFromAgent } from '../utils.js';
import type { AwsClient } from './client.js';
import type {
  InvestigationRequest,
  InvestigationResult,
  LogEntry,
  QueryResult,
} from './models.js';

export async function runPhase1(
  req: InvestigationRequest,
  aws: AwsClient,
  invokeAgentCli: (cmd: string, prompt: string, cwd: string, progress: any, sessionId: string | null) => Promise<{ text: string; session_id: string | null }>,
): Promise<InvestigationResult> {
  const prompt = `You are a CloudWatch Logs investigator. The user reported this problem:
"${req.question}"

Target log group: ${req.logGroup}
Time range: last ${req.timeRangeMinutes} minutes

Your tasks:
1. Analyze this codebase to find the relevant endpoint/service/function
2. Understand the logging patterns (what fields exist, how errors are logged)
3. Generate a CloudWatch Insights query that will find ERROR/EXCEPTION logs related to this issue
4. The query MUST be narrow and targeted -- do not fetch thousands of irrelevant logs

CRITICAL: This is a READ-ONLY investigation task. Do NOT modify, edit, create, or delete any files.

IMPORTANT: Respond ONLY with this JSON (no other text):
{
  "query": "fields @timestamp, @message, @logStream | filter ...",
  "reasoning": "Brief explanation of what you found in the codebase",
  "relevant_files": ["path/to/file1.ts", "path/to/file2.ts"],
  "correlation_id_field": "the field name used for request correlation or null"
}`;

  const agentOutput = await invokeAgentCli(req.agentCommand, prompt, req.repoPath, null, null);

  interface Phase1Response {
    query: string;
    reasoning: string;
    relevant_files: string[];
    correlation_id_field: string | null;
  }

  const phase1 = parseJsonFromAgent<Phase1Response>(agentOutput.text);

  // Execute the CW Insights query
  const now = Math.floor(Date.now() / 1000);
  const start = now - req.timeRangeMinutes * 60;

  const queryId = await aws.startQuery(req.logGroup, phase1.query, start, now);
  const result = await pollQueryResults(aws, queryId);

  const correlationIdField = phase1.correlation_id_field ?? '';
  const errorLogs: LogEntry[] = [];
  const correlationIds: string[] = [];

  for (const row of result.results) {
    const entry: LogEntry = { timestamp: '', message: '', logStream: '' };
    for (const field of row) {
      switch (field.field) {
        case '@timestamp': entry.timestamp = field.value; break;
        case '@message': entry.message = field.value; break;
        case '@logStream': entry.logStream = field.value; break;
      }
    }

    if (correlationIdField) {
      const cid = extractCorrelationId(entry.message, correlationIdField);
      if (cid && !correlationIds.includes(cid)) {
        correlationIds.push(cid);
      }
    }

    errorLogs.push(entry);
  }

  // Fetch trace logs for each unique correlation ID
  const traceLogs: Record<string, LogEntry[]> = {};
  for (const cid of correlationIds) {
    const traceQuery = `fields @timestamp, @message, @logStream | filter @message like /${cid}/ | sort @timestamp asc | limit 100`;
    try {
      const tid = await aws.startQuery(req.logGroup, traceQuery, start, now);
      const traceResult = await pollQueryResults(aws, tid);
      traceLogs[cid] = traceResult.results.map((row) => {
        const entry: LogEntry = { timestamp: '', message: '', logStream: '' };
        for (const field of row) {
          switch (field.field) {
            case '@timestamp': entry.timestamp = field.value; break;
            case '@message': entry.message = field.value; break;
            case '@logStream': entry.logStream = field.value; break;
          }
        }
        return entry;
      });
    } catch (e) {
      console.error(`CloudWatch: trace query for ${cid} failed: ${e}`);
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

async function pollQueryResults(
  aws: AwsClient,
  queryId: string,
): Promise<QueryResult> {
  const maxWaitMs = 120_000;
  const startTime = Date.now();

  for (;;) {
    const result = await aws.getQueryResults(queryId);
    switch (result.status) {
      case 'Complete':
        return result;
      case 'Failed':
      case 'Cancelled':
      case 'Timeout':
        throw new Error(`CW query status: ${result.status}`);
      default:
        if (Date.now() - startTime > maxWaitMs) {
          throw new Error('CW query timed out');
        }
        await sleep(2000);
    }
  }
}

function extractCorrelationId(message: string, fieldName: string): string | null {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
