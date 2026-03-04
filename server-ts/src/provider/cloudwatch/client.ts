import type { CallerIdentity, LogGroup, QueryResult, ResultField } from './models.js';
import { signedAwsRequest } from './signing.js';

// ── AWS Client ──

export class AwsClient {
  private accessKey: string;
  private secretKey: string;
  private region: string;

  constructor(accessKey: string, secretKey: string, region: string) {
    this.accessKey = accessKey;
    this.secretKey = secretKey;
    this.region = region;
  }

  async getCallerIdentity(): Promise<CallerIdentity> {
    const body = 'Action=GetCallerIdentity&Version=2011-06-15';
    const host = `sts.${this.region}.amazonaws.com`;
    const url = `https://${host}/`;

    const resp = await this.request(
      'sts', 'POST', url, host, '/',
      Buffer.from(body), 'application/x-www-form-urlencoded', '',
    );

    const text = await resp.text();
    const account = extractXmlTag(text, 'Account');
    const arn = extractXmlTag(text, 'Arn');
    if (!account || !arn) {
      throw new Error('Cannot parse Account/Arn from STS response');
    }

    return { account, arn };
  }

  async describeLogGroups(prefix?: string): Promise<LogGroup[]> {
    const bodyObj: any = { limit: 50 };
    if (prefix) bodyObj.logGroupNamePrefix = prefix;

    const resp = await this.logsRequest(
      'Logs_20140328.DescribeLogGroups', bodyObj,
    );

    const status = resp.status;
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`DescribeLogGroups failed (${status}): ${text}`);
    }

    const parsed = JSON.parse(text);
    const groups = Array.isArray(parsed.logGroups) ? parsed.logGroups : [];
    return groups
      .filter((g: any) => g.logGroupName)
      .map((g: any) => ({ logGroupName: String(g.logGroupName) }));
  }

  async startQuery(
    logGroup: string,
    query: string,
    startTime: number,
    endTime: number,
  ): Promise<string> {
    const bodyObj = {
      logGroupNames: [logGroup],
      queryString: query,
      startTime,
      endTime,
    };

    const resp = await this.logsRequest('Logs_20140328.StartQuery', bodyObj);

    const status = resp.status;
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`StartQuery failed (${status}): ${text}`);
    }

    const parsed = JSON.parse(text);
    const queryId = parsed.queryId;
    if (!queryId) throw new Error('No queryId in StartQuery response');
    return String(queryId);
  }

  async getQueryResults(queryId: string): Promise<QueryResult> {
    const resp = await this.logsRequest(
      'Logs_20140328.GetQueryResults', { queryId },
    );

    const status = resp.status;
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`GetQueryResults failed (${status}): ${text}`);
    }

    const parsed = JSON.parse(text);
    const resultStatus = String(parsed.status ?? 'Unknown');

    const results: ResultField[][] = Array.isArray(parsed.results)
      ? parsed.results.map((row: any[]) =>
          Array.isArray(row)
            ? row
                .filter((f: any) => f.field && f.value)
                .map((f: any) => ({
                  field: String(f.field),
                  value: String(f.value),
                }))
            : [],
        )
      : [];

    return { status: resultStatus, results };
  }

  // ── Internal helpers ──

  private async logsRequest(target: string, bodyObj: any): Promise<Response> {
    const bodyBytes = Buffer.from(JSON.stringify(bodyObj));
    const host = `logs.${this.region}.amazonaws.com`;
    const url = `https://${host}/`;
    return this.request(
      'logs', 'POST', url, host, '/', bodyBytes,
      'application/x-amz-json-1.1', target,
    );
  }

  private async request(
    service: string, method: string, url: string, host: string,
    canonicalUri: string, body: Buffer, contentType: string, target: string,
  ): Promise<Response> {
    return signedAwsRequest(
      this.accessKey, this.secretKey, this.region,
      service, method, url, host, canonicalUri, body, contentType, target,
    );
  }
}

// ── Helpers ──

export function awsClientFromConfig(config: Record<string, unknown>): AwsClient {
  return new AwsClient(
    String(config.access_key_id ?? ''),
    String(config.secret_access_key ?? ''),
    String(config.region ?? ''),
  );
}

export function extractXmlTag(xml: string, tag: string): string | null {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const startIdx = xml.indexOf(open);
  if (startIdx < 0) return null;
  const valStart = startIdx + open.length;
  const endIdx = xml.indexOf(close, valStart);
  if (endIdx < 0) return null;
  return xml.slice(valStart, endIdx);
}
