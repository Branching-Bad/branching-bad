import type { PgFinding } from './models.js';
import {
  findSlowQueries,
  findNPlusOne,
  findMissingIndexes,
  findUnusedIndexes,
  findVacuumNeeded,
} from './diagnostics.js';

// ── Client ──

export class PgClient {
  private client: any;

  private constructor(client: any) {
    this.client = client;
  }

  static async connect(config: Record<string, unknown>): Promise<PgClient> {
    // Dynamic import so the provider loads even without `pg` installed
    const pg = await import('pg');
    const Client = pg.default?.Client ?? pg.Client;

    const connString = config.connection_string as string | undefined;
    let clientConfig: any;

    if (connString && connString.trim() !== '') {
      clientConfig = { connectionString: normalizeConnectionString(connString) };
    } else {
      clientConfig = {
        host: String(config.host ?? 'localhost'),
        port: Number(config.port ?? 5432),
        database: String(config.dbname ?? 'postgres'),
        user: String(config.user ?? 'postgres'),
        password: String(config.password ?? ''),
      };
      const sslmode = config.sslmode as string | undefined;
      if (sslmode && sslmode !== 'disable') {
        clientConfig.ssl = sslmode === 'require' ? { rejectUnauthorized: false } : true;
      }
    }

    const client = new Client(clientConfig);
    await client.connect();
    return new PgClient(client);
  }

  async validate(): Promise<string> {
    const result = await this.client.query('SELECT version()');
    return result.rows[0].version;
  }

  async currentDatabase(): Promise<string> {
    const result = await this.client.query('SELECT current_database()');
    return result.rows[0].current_database;
  }

  async runDiagnostics(): Promise<PgFinding[]> {
    const findings: PgFinding[] = [];

    const hasPgStatStatements = await this.checkPgStatStatements();
    if (hasPgStatStatements) {
      await findSlowQueries(this.client, findings);
      await findNPlusOne(this.client, findings);
    }

    await findMissingIndexes(this.client, findings);
    await findUnusedIndexes(this.client, findings);
    await findVacuumNeeded(this.client, findings);

    await this.client.end();
    return findings;
  }

  private async checkPgStatStatements(): Promise<boolean> {
    try {
      await this.client.query(
        "SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'",
      );
      return true;
    } catch {
      return false;
    }
  }
}

// ── Helpers ──

export function normalizeConnectionString(cs: string): string {
  const trimmed = cs.trim();

  // Already a URI or libpq format
  if (
    trimmed.startsWith('postgresql://') ||
    trimmed.startsWith('postgres://') ||
    !trimmed.includes('=')
  ) {
    return trimmed;
  }

  // ADO.NET style: semicolons separate Key=Value pairs
  if (trimmed.includes(';')) {
    let host = 'localhost';
    let port = '5432';
    let dbname = 'postgres';
    let user = 'postgres';
    let password = '';
    let sslmode = '';

    for (const part of trimmed.split(';')) {
      const p = part.trim();
      if (!p) continue;
      const eqIdx = p.indexOf('=');
      if (eqIdx < 0) continue;
      const k = p.slice(0, eqIdx).trim().toLowerCase();
      const v = p.slice(eqIdx + 1).trim();
      switch (k) {
        case 'host':
        case 'server':
        case 'data source':
          host = v;
          break;
        case 'port':
          port = v;
          break;
        case 'database':
        case 'db':
        case 'initial catalog':
        case 'dbname':
          dbname = v;
          break;
        case 'username':
        case 'user':
        case 'user id':
        case 'uid':
          user = v;
          break;
        case 'password':
        case 'pwd':
          password = v;
          break;
        case 'sslmode':
        case 'ssl mode':
          sslmode = v;
          break;
      }
    }

    let result = `host=${host} port=${port} dbname=${dbname} user=${user}`;
    if (password) result += ` password=${password}`;
    if (sslmode) result += ` sslmode=${sslmode}`;
    return result;
  }

  // Assume libpq key=value (space-separated)
  return trimmed;
}

export function queryPreview(q: string): string {
  const trimmed = q.trim().replace(/\n/g, ' ');
  if (trimmed.length > 80) {
    return trimmed.slice(0, 77) + '...';
  }
  return trimmed;
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
