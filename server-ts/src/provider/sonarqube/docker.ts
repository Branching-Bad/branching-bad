import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

import type { ContainerStatus, ScanConfig } from './models.js';
import { DEFAULT_EXCLUSIONS } from './models.js';

const execFileAsync = promisify(execFile);

const CONTAINER_NAME = 'idea-sonarqube';
const VOLUME_NAME = 'idea-sonarqube-data';
const NETWORK_NAME = 'idea-sonarqube-net';

/**
 * Convert a Windows path to Docker-compatible mount path.
 * e.g. `C:\Users\foo` becomes `/c/Users/foo` for Docker Desktop on Windows.
 */
function toDockerPath(p: string): string {
  if (process.platform !== 'win32') return p;
  return p
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`);
}

export async function checkDockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['info']);
    return true;
  } catch {
    return false;
  }
}

export async function getSonarqubeContainerStatus(): Promise<ContainerStatus> {
  try {
    const { stdout } = await execFileAsync('docker', [
      'inspect',
      '--format',
      '{{.State.Status}}',
      CONTAINER_NAME,
    ]);
    const status = stdout.trim();
    if (status === 'running') return 'running';
    if (status === 'exited' || status === 'created') return 'exited';
    return status;
  } catch {
    return 'not_found';
  }
}

async function ensureNetwork(): Promise<void> {
  try {
    await execFileAsync('docker', ['network', 'inspect', NETWORK_NAME]);
  } catch {
    await execFileAsync('docker', ['network', 'create', NETWORK_NAME]);
  }
}

async function connectToNetwork(container: string): Promise<void> {
  try {
    await execFileAsync('docker', [
      'network', 'connect', NETWORK_NAME, container,
    ]);
  } catch {
    // Already connected — ignore
  }
}

export async function startSonarqubeContainer(port: number): Promise<void> {
  await ensureNetwork();
  const status = await getSonarqubeContainerStatus();
  if (status === 'running') {
    await connectToNetwork(CONTAINER_NAME);
    return;
  }

  if (status === 'exited' || (status !== 'not_found' && status !== 'running')) {
    await execFileAsync('docker', ['start', CONTAINER_NAME]);
    await connectToNetwork(CONTAINER_NAME);
    return;
  }

  // not_found — create new
  await execFileAsync('docker', [
    'run',
    '-d',
    '--name',
    CONTAINER_NAME,
    '--network',
    NETWORK_NAME,
    '-p',
    `${port}:9000`,
    '-v',
    `${VOLUME_NAME}:/opt/sonarqube/data`,
    'sonarqube:community',
  ]);
}

export async function waitForSonarqubeReady(
  baseUrl: string,
  timeoutSecs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutSecs * 1000;
  const statusUrl = `${baseUrl.replace(/\/+$/, '')}/api/system/status`;

  while (Date.now() < deadline) {
    try {
      const resp = await fetch(statusUrl);
      if (resp.ok) {
        const body: any = await resp.json();
        if (body.status === 'UP') return;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  throw new Error(
    `SonarQube did not become ready within ${timeoutSecs} seconds`,
  );
}

export function mergeExclusions(userExclusions: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const s of [...DEFAULT_EXCLUSIONS, ...userExclusions]) {
    if (!seen.has(s)) {
      seen.add(s);
      result.push(s);
    }
  }
  return result;
}

export function buildSonarProperties(
  projectKey: string,
  config: ScanConfig,
): Array<[string, string]> {
  const allExclusions = mergeExclusions(config.exclusions ?? []);
  const exclusionStr = allExclusions.join(',');
  const props: Array<[string, string]> = [
    ['sonar.projectKey', projectKey],
    ['sonar.exclusions', exclusionStr],
  ];

  const cpdExcl = config.cpdExclusions ?? [];
  if (cpdExcl.length > 0) {
    props.push(['sonar.cpd.exclusions', cpdExcl.join(',')]);
  }
  props.push(['sonar.sources', config.sources ?? '.']);
  if (config.sourceEncoding) {
    props.push(['sonar.sourceEncoding', config.sourceEncoding]);
  }
  props.push(['sonar.python.version', config.pythonVersion ?? '3']);
  if (config.scmDisabled) {
    props.push(['sonar.scm.disabled', 'true']);
  }
  const extraProps = config.extraProperties ?? {};
  for (const [k, v] of Object.entries(extraProps)) {
    props.push([k, v]);
  }
  return props;
}

/**
 * Rewrite a localhost URL so the scanner container can reach SonarQube.
 * Uses the SonarQube container name on the shared Docker network — this is
 * more reliable than host.docker.internal (which can fail under amd64
 * emulation on ARM hosts).
 */
function rewriteUrlForDocker(url: string): string {
  return url
    .replace(/:\/\/(localhost|127\.0\.0\.1):(\d+)/, `://${CONTAINER_NAME}:9000`);
}

/**
 * Check if a URL points to the local SonarQube container (localhost/127.0.0.1).
 */
function isLocalSonarUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url);
}

/**
 * Extract port number from a URL, defaulting to 9000.
 */
function extractPort(url: string): number {
  const match = url.match(/:(\d+)/);
  return match ? parseInt(match[1], 10) : 9000;
}

async function ensureLocalSonarRunning(sonarUrl: string): Promise<void> {
  if (!isLocalSonarUrl(sonarUrl)) return;
  const status = await getSonarqubeContainerStatus();
  if (status !== 'running') {
    const port = extractPort(sonarUrl);
    await startSonarqubeContainer(port);
    await waitForSonarqubeReady(sonarUrl, 120);
  }
}

function writePropertiesFile(repoPath: string, projectKey: string, config: ScanConfig): void {
  const lines = buildSonarProperties(projectKey, config).map(
    ([k, v]) => `${k}=${v}`,
  );
  fs.writeFileSync(path.join(repoPath, 'sonar-project.properties'), lines.join('\n'));
}

function cleanupPropertiesFile(repoPath: string): void {
  try { fs.unlinkSync(path.join(repoPath, 'sonar-project.properties')); } catch { /* ignore */ }
}

async function runScanCli(
  repoPath: string,
  projectKey: string,
  sonarUrl: string,
  sonarToken: string,
  config: ScanConfig,
): Promise<string> {
  const isLocal = isLocalSonarUrl(sonarUrl);
  const dockerSonarUrl = isLocal ? rewriteUrlForDocker(sonarUrl) : sonarUrl;
  const scannerArgs = buildSonarProperties(projectKey, config).map(
    ([k, v]) => `-D${k}=${v}`,
  );

  const cmdArgs = ['run', '--rm', '--platform', 'linux/amd64'];

  if (isLocal) {
    await ensureNetwork();
    await connectToNetwork(CONTAINER_NAME);
    cmdArgs.push('--network', NETWORK_NAME);
  }

  cmdArgs.push(
    '-v', `${toDockerPath(repoPath)}:/usr/src`,
    '-e', 'LANG=C.UTF-8',
    '-e', `SONAR_HOST_URL=${dockerSonarUrl}`,
    '-e', `SONAR_TOKEN=${sonarToken}`,
    'sonarsource/sonar-scanner-cli',
    ...scannerArgs,
  );

  const { stdout, stderr } = await execFileAsync('docker', cmdArgs, {
    timeout: 10 * 60 * 1000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return `${stdout}${stderr}`;
}

async function runScanDotnet(
  repoPath: string,
  projectKey: string,
  sonarUrl: string,
  sonarToken: string,
  config: ScanConfig,
): Promise<string> {
  const isLocal = isLocalSonarUrl(sonarUrl);
  const dockerSonarUrl = isLocal ? rewriteUrlForDocker(sonarUrl) : sonarUrl;

  // Filter out props not supported or already handled by dotnet sonarscanner
  const skipKeys = new Set([
    'sonar.projectKey',   // handled by /k:
    'sonar.host.url',     // passed explicitly
    'sonar.token',        // passed explicitly
    'sonar.sources',      // not supported by dotnet scanner (auto-computed)
    'sonar.python.version', // irrelevant for dotnet
  ]);
  const props = buildSonarProperties(projectKey, config)
    .filter(([k]) => !skipKeys.has(k));
  // Single-quote values to prevent bash glob expansion on patterns like **/node_modules/**
  const beginArgs = props.map(([k, v]) => `/d:${k}='${v}'`).join(' ');

  // Auto-find .sln or .csproj — dotnet build needs it if not in root
  // Single docker run: install tool, begin, build, end
  const script = [
    'set -e',
    'echo "=== Installing dotnet-sonarscanner ==="',
    'dotnet tool install --global dotnet-sonarscanner || true',
    'export PATH="$PATH:/root/.dotnet/tools"',
    // Find the solution or project file
    'SLN=$(find . -maxdepth 3 -name "*.sln" | head -1)',
    'if [ -z "$SLN" ]; then SLN=$(find . -maxdepth 3 -name "*.csproj" | head -1); fi',
    'if [ -z "$SLN" ]; then echo "ERROR: No .sln or .csproj file found"; exit 1; fi',
    'echo "=== Found project: $SLN ==="',
    'echo "=== SonarScanner begin ==="',
    `dotnet sonarscanner begin /k:'${projectKey}' /d:sonar.host.url='${dockerSonarUrl}' /d:sonar.token='${sonarToken}' ${beginArgs}`,
    'echo "=== dotnet build ==="',
    'dotnet build "$SLN"',
    'echo "=== SonarScanner end ==="',
    `dotnet sonarscanner end /d:sonar.token='${sonarToken}'`,
  ].join('\n');

  // No --platform linux/amd64: dotnet SDK has native ARM support
  const cmdArgs = ['run', '--rm'];

  if (isLocal) {
    await ensureNetwork();
    await connectToNetwork(CONTAINER_NAME);
    cmdArgs.push('--network', NETWORK_NAME);
  }

  cmdArgs.push(
    '-v', `${toDockerPath(repoPath)}:/usr/src`,
    '-w', '/usr/src',
    '-e', 'LANG=C.UTF-8',
    '-e', 'DOTNET_NUGET_SIGNATURE_VERIFICATION=false',
    `mcr.microsoft.com/dotnet/sdk:${config.dotnetSdkVersion ?? '8.0'}`,
    'bash', '-c', script,
  );

  const { stdout, stderr } = await execFileAsync('docker', cmdArgs, {
    timeout: 15 * 60 * 1000, // 15 minutes — dotnet restore can be slow
    maxBuffer: 10 * 1024 * 1024,
  });
  return `${stdout}${stderr}`;
}

export async function runScan(
  repoPath: string,
  projectKey: string,
  sonarUrl: string,
  sonarToken: string,
  config: ScanConfig,
): Promise<string> {
  if (!(await checkDockerAvailable())) {
    throw new Error(
      'Docker is not available. Please install and start Docker to use local scanning.',
    );
  }

  await ensureLocalSonarRunning(sonarUrl);

  const isDotnet = config.scannerType === 'dotnet';

  // Dotnet scanner does not support sonar-project.properties — remove if present
  if (isDotnet) {
    cleanupPropertiesFile(repoPath);
  } else if (config.generatePropertiesFile) {
    writePropertiesFile(repoPath, projectKey, config);
  }

  try {
    const runner = isDotnet ? runScanDotnet : runScanCli;
    const output = await runner(repoPath, projectKey, sonarUrl, sonarToken, config);

    if (!isDotnet && config.generatePropertiesFile) cleanupPropertiesFile(repoPath);
    return output;
  } catch (e: any) {
    if (!isDotnet && config.generatePropertiesFile) cleanupPropertiesFile(repoPath);
    const output = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n');
    throw new Error(`Sonar scan failed: ${output}`);
  }
}
