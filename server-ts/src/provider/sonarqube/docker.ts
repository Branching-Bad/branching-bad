import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

import type { ContainerStatus, ScanConfig } from './models.js';
import { DEFAULT_EXCLUSIONS } from './models.js';

const execFileAsync = promisify(execFile);

const CONTAINER_NAME = 'idea-sonarqube';
const VOLUME_NAME = 'idea-sonarqube-data';

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

export async function startSonarqubeContainer(port: number): Promise<void> {
  const status = await getSonarqubeContainerStatus();
  if (status === 'running') return;

  if (status === 'exited' || (status !== 'not_found' && status !== 'running')) {
    const { stderr } = await execFileAsync('docker', ['start', CONTAINER_NAME]);
    if (stderr && stderr.includes('Error')) {
      throw new Error(`Failed to start container: ${stderr}`);
    }
    return;
  }

  // not_found — create new
  await execFileAsync('docker', [
    'run',
    '-d',
    '--name',
    CONTAINER_NAME,
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
  const allExclusions = mergeExclusions(config.exclusions);
  const exclusionStr = allExclusions.join(',');
  const props: Array<[string, string]> = [
    ['sonar.projectKey', projectKey],
    ['sonar.exclusions', exclusionStr],
    ['sonar.javascript.exclusions', exclusionStr],
    ['sonar.typescript.exclusions', exclusionStr],
  ];

  if (config.cpdExclusions.length > 0) {
    props.push(['sonar.cpd.exclusions', config.cpdExclusions.join(',')]);
  }
  if (config.sources) props.push(['sonar.sources', config.sources]);
  if (config.sourceEncoding) {
    props.push(['sonar.sourceEncoding', config.sourceEncoding]);
  }
  props.push(['sonar.python.version', config.pythonVersion ?? '3']);
  if (config.scmDisabled) {
    props.push(['sonar.scm.disabled', 'true']);
  }
  for (const [k, v] of Object.entries(config.extraProperties)) {
    props.push([k, v]);
  }
  return props;
}

function rewriteUrlForDocker(url: string): string {
  return url
    .replace('://localhost:', '://host.docker.internal:')
    .replace('://127.0.0.1:', '://host.docker.internal:');
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

  // Optionally write sonar-project.properties
  if (config.generatePropertiesFile) {
    const lines = buildSonarProperties(projectKey, config).map(
      ([k, v]) => `${k}=${v}`,
    );
    const propsPath = path.join(repoPath, 'sonar-project.properties');
    fs.writeFileSync(propsPath, lines.join('\n'));
  }

  const dockerSonarUrl = rewriteUrlForDocker(sonarUrl);
  const scannerArgs = buildSonarProperties(projectKey, config).map(
    ([k, v]) => `-D${k}=${v}`,
  );

  const cmdArgs = [
    'run',
    '--rm',
    '-v',
    `${toDockerPath(repoPath)}:/usr/src`,
    '-e',
    `SONAR_HOST_URL=${dockerSonarUrl}`,
    '-e',
    `SONAR_TOKEN=${sonarToken}`,
  ];

  // host.docker.internal is automatic on macOS/Windows Docker Desktop
  if (process.platform === 'linux') {
    cmdArgs.push('--add-host', 'host.docker.internal:host-gateway');
  }

  cmdArgs.push('sonarsource/sonar-scanner-cli', ...scannerArgs);

  try {
    const { stdout, stderr } = await execFileAsync('docker', cmdArgs);

    // Clean up properties file
    if (config.generatePropertiesFile) {
      const propsPath = path.join(repoPath, 'sonar-project.properties');
      try { fs.unlinkSync(propsPath); } catch { /* ignore */ }
    }

    return `${stdout}${stderr}`;
  } catch (e: any) {
    // Clean up properties file on error too
    if (config.generatePropertiesFile) {
      const propsPath = path.join(repoPath, 'sonar-project.properties');
      try { fs.unlinkSync(propsPath); } catch { /* ignore */ }
    }
    throw new Error(`Sonar scan failed: ${e.message}`);
  }
}
