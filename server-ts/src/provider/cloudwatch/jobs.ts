import type { Db } from '../../db/index.js';
import { invokeAgentCli } from '../../planner/index.js';
import {
  AwsClient,
  runAnalysis,
  runPhase1,
} from './index.js';
import type { InvestigationResult, LogEntry } from './index.js';

export interface InvestigateParams {
  id: string;
  question: string;
  logGroup: string;
  timeRangeMinutes: number;
  repoPath: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export function startInvestigation(db: Db, params: InvestigateParams): void {
  const { id, question, logGroup, timeRangeMinutes, repoPath, accessKeyId, secretAccessKey, region } = params;

  setImmediate(async () => {
    try {
      const aws = new AwsClient(accessKeyId, secretAccessKey, region);
      const req = {
        question, logGroup, timeRangeMinutes,
        repoPath, agentCommand: '',
      };

      const result = await runPhase1(req, aws, invokeAgentCli);
      const status = result.errorLogs.length === 0 ? 'no_results' : 'logs_ready';
      db.updateInvestigationStatus(id, status, result, result.phase1Query, undefined);
    } catch (e: any) {
      db.updateInvestigationStatus(id, 'failed', undefined, undefined, e.message);
    }
  });
}

export function startAnalysis(
  db: Db,
  id: string,
  question: string,
  invResult: InvestigationResult,
  repoPath: string,
): void {
  setImmediate(async () => {
    try {
      const analysis = await runAnalysis(
        question, invResult, '', repoPath, invokeAgentCli,
      );
      const updated = { ...invResult, analysis };
      db.updateInvestigationStatus(id, 'completed', updated, undefined, undefined);
    } catch (e: any) {
      db.updateInvestigationStatus(id, 'failed', undefined, undefined, e.message);
    }
  });
}

export function startSavedQueryRun(
  db: Db,
  params: {
    invId: string;
    logGroup: string;
    queryTemplate: string;
    timeRangeMinutes: number;
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
  },
): void {
  const { invId, logGroup, queryTemplate, timeRangeMinutes, accessKeyId, secretAccessKey, region } = params;

  setImmediate(async () => {
    const aws = new AwsClient(accessKeyId, secretAccessKey, region);
    const now = Math.floor(Date.now() / 1000);
    const start = now - timeRangeMinutes * 60;

    try {
      const queryId = await aws.startQuery(logGroup, queryTemplate, start, now);
      const maxWaitMs = 120_000;
      const pollStart = Date.now();

      for (;;) {
        const result = await aws.getQueryResults(queryId);
        switch (result.status) {
          case 'Complete': {
            const errorLogs: LogEntry[] = result.results.map((row) => {
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

            const invResult: InvestigationResult = {
              phase1Query: queryTemplate,
              phase1Reasoning: 'Saved query (agent skipped)',
              relevantFiles: [],
              correlationIdField: '',
              errorLogs,
              correlationIds: [],
              traceLogs: {},
            };

            const status = errorLogs.length === 0 ? 'no_results' : 'logs_ready';
            db.updateInvestigationStatus(invId, status, invResult, queryTemplate, undefined);
            return;
          }
          case 'Failed':
          case 'Cancelled':
          case 'Timeout':
            db.updateInvestigationStatus(invId, 'failed', undefined, undefined, `CW query status: ${result.status}`);
            return;
          default:
            if (Date.now() - pollStart > maxWaitMs) {
              db.updateInvestigationStatus(invId, 'failed', undefined, undefined, 'CW query timed out');
              return;
            }
            await new Promise((r) => setTimeout(r, 2000));
        }
      }
    } catch (e: any) {
      db.updateInvestigationStatus(invId, 'failed', undefined, undefined, e.message);
    }
  });
}
