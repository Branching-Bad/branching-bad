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

export type ScannerType = 'cli' | 'dotnet';

export const DOTNET_SDK_VERSIONS = ['6.0', '7.0', '8.0', '9.0', '10.0'] as const;

export interface ScanConfig {
  scannerType: ScannerType | null;
  dotnetSdkVersion: string | null;
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
    scannerType: null,
    dotnetSdkVersion: null,
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

/**
 * Normalize a scan config from DB — handles both old snake_case
 * and new camelCase keys, filling in defaults for missing fields.
 */
export function normalizeScanConfig(raw: Record<string, unknown>): ScanConfig {
  const def = defaultScanConfig();
  const rawScanner = raw.scannerType ?? raw.scanner_type;
  return {
    scannerType: rawScanner === 'cli' || rawScanner === 'dotnet' ? rawScanner : null,
    dotnetSdkVersion: asStringOrNull(raw.dotnetSdkVersion ?? raw.dotnet_sdk_version),
    exclusions: asArray(raw.exclusions) ?? def.exclusions,
    cpdExclusions: asArray(raw.cpdExclusions ?? raw.cpd_exclusions) ?? def.cpdExclusions,
    sources: asStringOrNull(raw.sources),
    sourceEncoding: asStringOrNull(raw.sourceEncoding ?? raw.source_encoding),
    pythonVersion: asStringOrNull(raw.pythonVersion ?? raw.python_version),
    scmDisabled: asBoolOrNull(raw.scmDisabled ?? raw.scm_disabled),
    generatePropertiesFile: Boolean(raw.generatePropertiesFile ?? raw.generate_properties_file ?? false),
    extraProperties: asRecord(raw.extraProperties ?? raw.extra_properties) ?? def.extraProperties,
    qualityGateName: asStringOrNull(raw.qualityGateName ?? raw.quality_gate_name),
    qualityProfileKey: asStringOrNull(raw.qualityProfileKey ?? raw.quality_profile_key),
    language: asStringOrNull(raw.language),
  };
}

function asArray(v: unknown): string[] | null {
  return Array.isArray(v) ? v : null;
}
function asStringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}
function asBoolOrNull(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}
function asRecord(v: unknown): Record<string, string> | null {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, string>)
    : null;
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
