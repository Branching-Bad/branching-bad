// Mirrors tokens from web/src/index.css @theme block.
// D3/SVG code can't read CSS vars without getComputedStyle, so these constants
// re-declare the values. Keep them in sync manually with the index.css source of truth.

export const CANVAS = {
  brand:            '#FD9201',                   // --color-brand
  brandTint:        'rgba(253, 146, 1, 0.12)',   // derived from --color-brand-tint (slightly bumped alpha)
  surface100:       '#1C1C1E',                   // --color-surface-100
  surface200:       '#2C2C2E',                   // --color-surface-200
  textPrimary:      '#FFFFFF',                   // --color-text-primary
  textSecondary:    'rgba(235, 235, 245, 0.6)',  // --color-text-secondary
  textMuted30:      'rgba(235, 235, 245, 0.30)', // --color-text-muted
  muted18:          'rgba(235, 235, 245, 0.18)',
  muted22:          'rgba(235, 235, 245, 0.22)',
  muted45:          'rgba(235, 235, 245, 0.45)',
  borderStrong:     'rgba(84, 84, 88, 0.65)',    // --color-border-strong
  statusDone:       '#30D158',                   // --color-status-success
  statusFailed:     '#FF453A',                   // --color-status-danger
  dotGrid:          'rgba(255, 255, 255, 0.07)',
} as const;
