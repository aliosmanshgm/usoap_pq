import { state } from "./state.js";

// Faz 8B.2 - shared state selectors. Keeping these here avoids circular imports
// between annual-program, audit and assignment modules.
export function getProgram(programId) {
  return state.auditPrograms.find(p => p.programId === programId || p.id === programId) || null;
}

export function getAudit(auditId) {
  return state.audits.find(a => a.auditId === auditId || a.id === auditId) || null;
}
