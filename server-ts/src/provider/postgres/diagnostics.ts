// ---------------------------------------------------------------------------
// PostgreSQL Diagnostics — barrel re-exports
// ---------------------------------------------------------------------------

export { findSlowQueries, findNPlusOne } from './diagnostics-queries.js';
export {
  findMissingIndexes,
  findUnusedIndexes,
  findVacuumNeeded,
} from './diagnostics-tables.js';
