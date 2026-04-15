// Centralized priority palette shared by TaskFormFields (PRIORITY_OPTIONS)
// and DetailsSidebar (PriorityChip). Values align with status/accent tokens
// in web/src/index.css (status-danger / status-caution / status-info / status-neutral).

export type PriorityValue = 'Highest' | 'High' | 'Medium' | 'Low' | 'Lowest';

export const PRIORITY_COLORS: Record<PriorityValue, string> = {
  Highest: '#FF453A',  // status-danger (SF systemRed)
  High:    '#FF9F0A',  // tool-edit / SF systemOrange (distinct from brand orange)
  Medium:  '#FFD60A',  // status-caution (SF systemYellow)
  Low:     '#0A84FF',  // status-info (SF systemBlue)
  Lowest:  '#8E8E93',  // status-neutral (SF systemGray)
};
