// Faz 8B.3 - ortak denetim akışı seçicileri ve anahtar yardımcıları.
// Bu modül salt state okur; kayıt yazma veya ekran çizme yapmaz.
import { state } from "../state.js";

export function getAuditRowsForAudit(audit) {
  if (!audit) return [];
  const forms = audit.selectedForms || [];
  return forms.flatMap(area => (state.normalizedAreas[area]?.rows || []).map(row => ({ ...row, areaKey: area })));
}

export function pqKey(area, pqNo) {
  return `${String(area || '').replace(/[^A-Za-z0-9_-]/g, '_')}__${String(pqNo || '').replace(/[^A-Za-z0-9_.-]/g, '_')}`;
}

export function getOrgResponse(auditId) {
  return state.organizationResponses.find(r => r.auditId === auditId && (r.responseType || 'pre_response') === 'pre_response') || null;
}

export function getPreEvaluation(auditId) {
  return state.auditPreEvaluations.find(r => r.auditId === auditId) || null;
}
export function auditeeVisibleAudits() {
  return state.audits.filter(a => {
    if (state.role === 'auditee') return a.organizationId === state.orgContext;
    return true;
  }).filter(a => !['archived','cancelled'].includes(a.status));
}
export function getAuditResponse(auditId) {
  return state.auditResponses.find(r => r.auditId === auditId || r.auditResponseId === `AUDRESP-${auditId}` || r.id === `AUDRESP-${auditId}`) || null;
}
