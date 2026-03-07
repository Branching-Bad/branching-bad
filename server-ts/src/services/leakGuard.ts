import type { LogMsg } from '../msgStore.js';
import { MsgStore } from '../msgStore.js';

// ---------------------------------------------------------------------------
// LeakGuard — language-agnostic code detection & redaction
// ---------------------------------------------------------------------------

const REDACT_NOTICE = '[LeakGuard: code redacted — analyst must not share source code]';

/** Fenced code block: ```lang ... ``` */
const FENCED_BLOCK_RE = /```[\w]*\n[\s\S]*?```/g;

/** Characters that are common in code but rare in natural prose */
const CODE_CHARS = new Set(['{', '}', '(', ')', '[', ']', ';', '=', '<', '>', '!', '&', '|', '+', '-', '*', '/', '~', '^', '%', ':', '@', '#']);

/** Multi-char operators found across virtually all languages */
const OPERATOR_RE = /=>|->|::|!=|==|&&|\|\||<<|>>|\+=|-=|\*=|\/=|\.\.\.|\?\?|<-/;

/** Dot-access pattern (obj.field) — universal across OOP/module languages */
const DOT_ACCESS_RE = /\w\.\w/;

/** Declaration keywords common across many languages (not prose words) */
const DECL_RE = /^\s*(let|val|var|const|mut|func|fn|def|fun|struct|enum|trait|impl|interface|type|class)\s+\w/;

/** Shell / scripting block keywords (standalone or at end of line) */
const SHELL_BLOCK_RE = /^\s*(do|done|fi|esac|then|elif|endif|endfor|end)\s*[;]?\s*$/;
const SHELL_TAIL_RE = /;\s*(do|then)\s*$/;

// ---------------------------------------------------------------------------
// Language-agnostic line scoring
// ---------------------------------------------------------------------------

/**
 * Score a single line for "code-likeness" (0–5).
 * Uses structural signals, not language keywords.
 */
function codeScore(line: string): number {
  const trimmed = line.trim();
  if (!trimmed) return 0;
  // Pure closing delimiters are ambiguous
  if (/^[}\]);,]+$/.test(trimmed)) return 1;

  let score = 0;

  // 1. Indentation (code is indented, prose rarely is)
  if (/^[ \t]{2,}/.test(line)) score += 1;

  // 2. Ends with a structural delimiter
  if (/[{};,)\]:]$/.test(trimmed)) score += 1;

  // 3. High ratio of code-like special characters
  let codeCharCount = 0;
  for (const ch of trimmed) {
    if (CODE_CHARS.has(ch)) codeCharCount++;
  }
  const ratio = codeCharCount / trimmed.length;
  if (ratio > 0.12) score += 1;
  if (ratio > 0.25) score += 1;

  // 4. Contains multi-char operators
  if (OPERATOR_RE.test(trimmed)) score += 1;

  // 5. Dot-access (obj.field, pkg.Class, etc.)
  if (DOT_ACCESS_RE.test(trimmed)) score += 1;

  // 6. Declaration keyword at line start
  if (DECL_RE.test(line)) score += 1;

  // 7. Shell block keywords / shebang
  if (/^#!/.test(trimmed)) score += 2;
  if (SHELL_BLOCK_RE.test(line)) score += 1;
  if (SHELL_TAIL_RE.test(trimmed)) score += 1;

  // 8. Variable interpolation ($var, ${var}, $(cmd))
  if (/\$[\w{(]/.test(trimmed)) score += 1;

  return score;
}

/** Sliding window size for code density detection */
const WINDOW_SIZE = 4;
/** Minimum average score across a window to flag as code */
const WINDOW_AVG_THRESHOLD = 1.5;
/** Minimum contiguous code region to redact */
const BLOCK_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Core redaction
// ---------------------------------------------------------------------------

/**
 * Scan text and redact code blocks.
 * Returns sanitised text, or null if no changes were needed.
 */
export function redactCode(text: string): string | null {
  let changed = false;

  // 1. Redact fenced code blocks
  let result = text.replace(FENCED_BLOCK_RE, () => {
    changed = true;
    return REDACT_NOTICE;
  });

  // 2. Sliding-window code density detection
  const lines = result.split('\n');
  const scores = lines.map(codeScore);
  const isCode = new Array<boolean>(lines.length).fill(false);

  // Mark lines that fall within a high-density window
  for (let i = 0; i <= lines.length - WINDOW_SIZE; i++) {
    let sum = 0;
    for (let j = i; j < i + WINDOW_SIZE; j++) sum += scores[j];
    if (sum / WINDOW_SIZE >= WINDOW_AVG_THRESHOLD) {
      for (let j = i; j < i + WINDOW_SIZE; j++) isCode[j] = true;
    }
  }

  // Build output, replacing contiguous code regions with redact notice
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isCode[i]) {
      const start = i;
      while (i < lines.length && isCode[i]) i++;
      if (i - start >= BLOCK_THRESHOLD) {
        changed = true;
        out.push(REDACT_NOTICE);
      } else {
        for (let j = start; j < i; j++) out.push(lines[j]);
      }
    } else {
      out.push(lines[i]);
      i++;
    }
  }

  if (!changed) return null;
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// MsgStore wrapper
// ---------------------------------------------------------------------------

/**
 * MsgStore subclass that filters agent output for code leaks.
 * Drop-in replacement — pass to spawnAgent and it filters automatically.
 */
export class GuardedMsgStore extends MsgStore {
  private target: MsgStore;

  constructor(target: MsgStore) {
    super();
    this.target = target;
  }

  override push(msg: LogMsg): void {
    if (msg.type === 'agent_text' || msg.type === 'stdout') {
      const redacted = redactCode(msg.data);
      if (redacted !== null) {
        this.target.push({ type: msg.type, data: redacted });
        return;
      }
    }
    this.target.push(msg);
  }

  override setSessionId(id: string): void {
    this.target.setSessionId(id);
  }
}
