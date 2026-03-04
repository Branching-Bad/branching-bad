// ── Stack trace extraction from Sentry events ──

export function extractStackTrace(event: any): string | null {
  if (!event) return null;

  // Try "entries" array first (Sentry event detail format)
  if (Array.isArray(event.entries)) {
    for (const entry of event.entries) {
      if (entry.type === 'exception') {
        const result = formatExceptionValues(entry.data?.values);
        if (result) return result;
      }
    }
  }

  // Fallback: top-level "exception" object
  const result = formatExceptionValues(event.exception?.values);
  if (result) return result;

  return null;
}

function formatExceptionValues(values: any): string | null {
  if (!Array.isArray(values)) return null;

  const traces: string[] = [];
  for (const exc of values) {
    const excType = String(exc.type ?? 'Exception');
    const excValue = String(exc.value ?? '');
    traces.push(`${excType}: ${excValue}`);

    const frames = exc.stacktrace?.frames;
    if (Array.isArray(frames)) {
      const reversed = [...frames].reverse().slice(0, 15);
      for (const frame of reversed) {
        const filename = String(
          frame.filename ?? frame.absPath ?? '?',
        );
        const lineno = Number(frame.lineno ?? frame.lineNo ?? 0);
        const colno = frame.colNo ?? frame.colno;
        const func = String(frame.function ?? '?');
        const location =
          colno && Number(colno) > 0
            ? `${filename}:${lineno}:${colno}`
            : `${filename}:${lineno}`;
        traces.push(`  at ${func} (${location})`);
      }
    }
  }

  if (traces.length === 0) return null;
  return traces.join('\n');
}
