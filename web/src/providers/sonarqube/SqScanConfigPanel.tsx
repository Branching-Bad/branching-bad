import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { api } from "../../api";
import { inputClass, selectClass, btnPrimary, btnSecondary } from "../../components/shared";

type ScannerType = 'cli' | 'dotnet';

const DOTNET_SDK_VERSIONS = ['6.0', '7.0', '8.0', '9.0', '10.0'];

type ScanConfig = {
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
};

type QualityGate = {
  id: string;
  name: string;
  isDefault: boolean;
  isBuiltIn: boolean;
};

type QualityProfile = {
  key: string;
  name: string;
  language: string;
  languageName: string;
  isDefault: boolean;
};

type Props = {
  repoId: string;
  accountId: string;
  resourceId: string;
  busy: boolean;
  onBusyChange: (b: boolean) => void;
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
};

const emptyConfig: ScanConfig = {
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

const tagClass = "inline-flex items-center gap-1 rounded bg-surface-300 border border-border-default px-2 py-0.5 text-[11px] text-text-secondary";

export function SqScanConfigPanel({ repoId, accountId, resourceId, busy, onBusyChange, onError, onInfo }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [config, setConfig] = useState<ScanConfig>(emptyConfig);
  const [defaultExclusions, setDefaultExclusions] = useState<string[]>([]);
  const [gates, setGates] = useState<QualityGate[]>([]);
  const [profiles, setProfiles] = useState<QualityProfile[]>([]);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [newExclusion, setNewExclusion] = useState("");
  const [newPropKey, setNewPropKey] = useState("");
  const [newPropValue, setNewPropValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  const qualityLoadedForAccount = useRef<string | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const res = await api<{ config: ScanConfig; defaultExclusions: string[] }>(
        `/api/sonarqube/scan-config?repoId=${repoId}&accountId=${accountId}&resourceId=${resourceId}`
      );
      // Merge with defaults to guard against missing fields
      setConfig({ ...emptyConfig, ...res.config });
      setDefaultExclusions(res.defaultExclusions ?? []);
      setLoaded(true);
    } catch { /* silent */ }
  }, [repoId, accountId, resourceId]);

  useEffect(() => { void loadConfig(); }, [loadConfig]);

  const loadQualityOptions = useCallback(async () => {
    if (qualityLoadedForAccount.current === accountId) return;
    setQualityLoading(true);
    try {
      const [gatesRes, profilesRes] = await Promise.all([
        api<{ gates: QualityGate[] }>(`/api/sonarqube/quality-gates?accountId=${accountId}`),
        api<{ profiles: QualityProfile[] }>(`/api/sonarqube/quality-profiles?accountId=${accountId}`),
      ]);
      qualityLoadedForAccount.current = accountId;
      setGates(gatesRes.gates);
      setProfiles(profilesRes.profiles);
      const defGate = gatesRes.gates.find(g => g.isDefault);
      if (defGate) {
        setConfig(prev => prev.qualityGateName ? prev : { ...prev, qualityGateName: defGate.name });
      }
    } catch { /* silent */ } finally {
      setQualityLoading(false);
    }
  }, [accountId]);

  const defaultExclusionSet = useMemo(() => new Set(defaultExclusions), [defaultExclusions]);

  const allExclusions = useMemo(() => {
    const seen = new Set(defaultExclusions);
    const result = [...defaultExclusions];
    for (const exc of config.exclusions) {
      if (!seen.has(exc)) { seen.add(exc); result.push(exc); }
    }
    return result;
  }, [defaultExclusions, config.exclusions]);

  function removeExclusion(exc: string) {
    setConfig(prev => ({
      ...prev,
      exclusions: prev.exclusions.filter(e => e !== exc),
    }));
  }

  function addExclusion() {
    const trimmed = newExclusion.trim();
    if (!trimmed || allExclusions.includes(trimmed)) { setNewExclusion(""); return; }
    setConfig(prev => ({
      ...prev,
      exclusions: [...prev.exclusions, trimmed],
    }));
    setNewExclusion("");
  }

  function resetDefaults() {
    setConfig(prev => ({ ...prev, exclusions: [] }));
  }

  function addProperty() {
    const k = newPropKey.trim();
    const v = newPropValue.trim();
    if (!k) return;
    setConfig(prev => ({
      ...prev,
      extraProperties: { ...prev.extraProperties, [k]: v },
    }));
    setNewPropKey("");
    setNewPropValue("");
  }

  function removeProperty(key: string) {
    setConfig(prev => {
      const copy = { ...prev.extraProperties };
      delete copy[key];
      return { ...prev, extraProperties: copy };
    });
  }

  async function handleSave() {
    onError(""); onBusyChange(true);
    try {
      const selectedProfile = profiles.find(p => p.key === config.qualityProfileKey);
      await api("/api/sonarqube/scan-config", {
        method: "POST",
        body: JSON.stringify({
          repoId,
          accountId,
          resourceId,
          config,
          qualityGateName: config.qualityGateName || undefined,
          qualityProfileName: selectedProfile?.name || undefined,
          qualityProfileLanguage: selectedProfile?.language || config.language || undefined,
        }),
      });
      onInfo("Scan configuration saved.");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      onBusyChange(false);
    }
  }

  if (!loaded) return null;

  return (
    <div className="rounded-xl border border-border-default bg-surface-200 overflow-hidden">
      <button
        onClick={() => { setExpanded(!expanded); if (!expanded) void loadQualityOptions(); }}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-text-secondary hover:bg-surface-300 transition"
      >
        <span>Scan Configuration</span>
        <span className="text-text-muted text-xs">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border-default pt-3">
          {/* Exclusions */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-text-muted uppercase tracking-wide">Exclusions</label>
              <button onClick={resetDefaults} className="text-[10px] text-brand hover:underline">Reset Defaults</button>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {allExclusions.map(exc => (
                <span key={exc} className={tagClass}>
                  <span className="max-w-[200px] truncate">{exc}</span>
                  {!defaultExclusionSet.has(exc) && (
                    <button onClick={() => removeExclusion(exc)} className="text-text-muted hover:text-error-text ml-0.5">&times;</button>
                  )}
                </span>
              ))}
            </div>
            <div className="flex gap-1.5">
              <input
                className={`${inputClass} flex-1 !py-1.5 !text-xs`}
                placeholder="**/pattern/**"
                value={newExclusion}
                onChange={e => setNewExclusion(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addExclusion(); } }}
              />
              <button onClick={addExclusion} className={`${btnSecondary} !px-3 !py-1.5 !text-xs`}>+</button>
            </div>
          </div>

          {/* Source directories */}
          <div>
            <label className="mb-1 block text-xs text-text-muted">Source Directories</label>
            <input
              className={inputClass}
              placeholder="."
              value={config.sources ?? ""}
              onChange={e => setConfig(prev => ({ ...prev, sources: e.target.value || null }))}
            />
          </div>

          {/* SCM disabled */}
          <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={config.scmDisabled === true}
              onChange={e => setConfig(prev => ({ ...prev, scmDisabled: e.target.checked || null }))}
              className="rounded border-border-strong"
            />
            Disable SCM Analysis
          </label>

          {/* Scanner Type */}
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted uppercase tracking-wide">Scanner Type</label>
            <select
              className={selectClass}
              value={config.scannerType ?? ""}
              onChange={e => setConfig(prev => ({
                ...prev,
                scannerType: (e.target.value || null) as ScannerType | null,
              }))}
            >
              <option value="">Auto (CLI)</option>
              <option value="cli">sonar-scanner-cli — JS/TS/Python/Java/Go/PHP</option>
              <option value="dotnet">sonar-scanner-dotnet — C#/VB.NET</option>
            </select>
          </div>

          {/* .NET SDK Version — only when dotnet scanner */}
          {config.scannerType === 'dotnet' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted uppercase tracking-wide">.NET SDK Version</label>
              <select
                className={selectClass}
                value={config.dotnetSdkVersion ?? "8.0"}
                onChange={e => setConfig(prev => ({ ...prev, dotnetSdkVersion: e.target.value }))}
              >
                {DOTNET_SDK_VERSIONS.map(v => (
                  <option key={v} value={v}>.NET {v}</option>
                ))}
              </select>
            </div>
          )}

          {/* Language */}
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted uppercase tracking-wide">Language</label>
            {qualityLoading ? (
              <p className="text-xs text-text-muted">Loading...</p>
            ) : (
              <select
                className={selectClass}
                value={config.language ?? ""}
                onChange={e => setConfig(prev => ({
                  ...prev,
                  language: e.target.value || null,
                  qualityProfileKey: null,
                }))}
              >
                <option value="">Auto-detect</option>
                {[...new Map(profiles.map(p => [p.language, p.languageName]))].map(([lang, langName]) => (
                  <option key={lang} value={lang}>{langName}</option>
                ))}
              </select>
            )}
          </div>

          {/* Quality Profile */}
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted uppercase tracking-wide">Quality Profile</label>
            {qualityLoading ? (
              <p className="text-xs text-text-muted">Loading...</p>
            ) : (() => {
              const filtered = config.language
                ? profiles.filter(p => p.language === config.language)
                : profiles;
              return (
                <select
                  className={selectClass}
                  value={config.qualityProfileKey ?? ""}
                  onChange={e => setConfig(prev => ({ ...prev, qualityProfileKey: e.target.value || null }))}
                >
                  <option value="">Default</option>
                  {filtered.map(p => (
                    <option key={p.key} value={p.key}>
                      {p.name} ({p.languageName}){p.isDefault ? " *" : ""}
                    </option>
                  ))}
                </select>
              );
            })()}
          </div>

          {/* Quality Gate */}
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted uppercase tracking-wide">Quality Gate</label>
            {qualityLoading ? (
              <p className="text-xs text-text-muted">Loading...</p>
            ) : (
              <select
                className={selectClass}
                value={config.qualityGateName ?? ""}
                onChange={e => setConfig(prev => ({ ...prev, qualityGateName: e.target.value || null }))}
              >
                <option value="">Default</option>
                {gates.map(g => (
                  <option key={g.id} value={g.name}>
                    {g.name}{g.isDefault ? " (default)" : ""}{g.isBuiltIn ? " (built-in)" : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Generate properties file */}
          <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={config.generatePropertiesFile}
              onChange={e => setConfig(prev => ({ ...prev, generatePropertiesFile: e.target.checked }))}
              className="rounded border-border-strong"
            />
            Generate sonar-project.properties before scan
          </label>

          {/* Custom properties */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-muted uppercase tracking-wide">Custom Properties</label>
            {Object.entries(config.extraProperties).map(([k, v]) => (
              <div key={k} className="flex items-center gap-1.5 mb-1.5">
                <span className={tagClass}>
                  <span className="font-mono">{k}={v}</span>
                  <button onClick={() => removeProperty(k)} className="text-text-muted hover:text-error-text ml-0.5">&times;</button>
                </span>
              </div>
            ))}
            <div className="flex gap-1.5">
              <input
                className={`${inputClass} flex-1 !py-1.5 !text-xs`}
                placeholder="key"
                value={newPropKey}
                onChange={e => setNewPropKey(e.target.value)}
              />
              <input
                className={`${inputClass} flex-1 !py-1.5 !text-xs`}
                placeholder="value"
                value={newPropValue}
                onChange={e => setNewPropValue(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addProperty(); } }}
              />
              <button onClick={addProperty} className={`${btnSecondary} !px-3 !py-1.5 !text-xs`}>+</button>
            </div>
          </div>

          {/* Save button */}
          <button
            onClick={() => void handleSave()}
            disabled={busy}
            className={btnPrimary}
          >
            Save Configuration
          </button>
        </div>
      )}
    </div>
  );
}
