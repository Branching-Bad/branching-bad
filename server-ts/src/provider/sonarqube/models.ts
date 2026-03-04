export interface SqProject {
  key: string;
  name: string;
}

export interface SqIssue {
  key: string;
  rule: string;
  severity: string;
  message: string;
  component: string;
  line: number | null;
  typeField: string;
  effort: string | null;
}

export interface SqQualityProfile {
  key: string;
  name: string;
  language: string;
  languageName: string;
  isDefault: boolean;
}

export interface SqQualityGate {
  id: string;
  name: string;
  isDefault: boolean;
  isBuiltIn: boolean;
}

export interface ScanConfig {
  exclusions: string[];
  cpdExclusions: string[];
  sources: string | null;
  sourceEncoding: string | null;
  pythonVersion: string | null;
  scmDisabled: boolean | null;
  generatePropertiesFile: boolean;
  extraProperties: Record<string, string>;
  qualityGateName: string | null;
  qualityProfileKey: string | null;
  language: string | null;
}

export const DEFAULT_EXCLUSIONS: string[] = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.branching-bad/**',
  '**/bin/Debug/**',
  '**/bin/Release/**',
  '**/obj/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/vendor/**',
  '**/target/**',
  '**/.venv/**',
  '**/venv/**',
  '**/__pycache__/**',
  '**/coverage/**',
];

export function defaultScanConfig(): ScanConfig {
  return {
    exclusions: [],
    cpdExclusions: [],
    sources: null,
    sourceEncoding: null,
    pythonVersion: null,
    scmDisabled: null,
    generatePropertiesFile: false,
    extraProperties: {},
    qualityGateName: null,
    qualityProfileKey: null,
    language: null,
  };
}

export type ContainerStatus = 'running' | 'exited' | 'not_found' | string;

// ── DB Models (moved from models.ts) ──

export interface SonarScan {
  id: string;
  repo_id: string;
  account_id: string;
  project_key: string;
  status: string;
  issues_found: number | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}
