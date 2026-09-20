// Faz 8B.4 - Nihai rapor modülü.
// Nihai rapor taslağı, gönderim, rapor görünümü ve gönderim sonrası CAP başlangıcı burada tutulur.
import {
  COLLECTIONS, AUDIT_STATUS, AUDIT_METHOD_LABELS, AUDIT_TYPE_LABELS
} from "../config.js";
import { state } from "../state.js";
import {
  escapeHtml, localDateYmd, today, addDays, daysBetween, formatDate
} from "../utils.js";
import { getAudit } from "../selectors.js";
import { runtime, register, expose } from "../runtime.js";
import { showSection } from "./ui-shell.js";
import { statusPill } from "./audits.js";
import { getAssignment } from "./assignments.js";
import { getObjection, objectionStatusLabel, objectionPill } from "./objections.js";

export function reportEligibleAudits() {
  return state.audits.filter(a => ['final_report_preparation','final_report_sent','cap_waiting','cap_under_review','cap_monitoring','closed'].includes(a.status));
}

export function getReport(auditId) {
  return state.reports.find(r => r.auditId === auditId && (r.reportType || 'final') === 'final') || null;
}

export function reportPill(auditId) {
  const audit = getAudit(auditId);
  const report = getReport(auditId);
  if (report?.status === 'sent' || audit?.finalReportSentDate) return `<span class="pill green">Nihai Rapor: Gönderildi</span>`;
  if (report?.status === 'draft') return `<span class="pill yellow">Nihai Rapor: Taslak</span>`;
  return `<span class="pill gray">Nihai Rapor: Yok</span>`;
}

function ensureFinalReportSelection() {
  const audits = reportEligibleAudits();
  const current = state.currentFinalReportAuditId && getAudit(state.currentFinalReportAuditId) ? state.currentFinalReportAuditId : '';
  if (current && audits.some(a => a.auditId === current)) return current;
  const first = audits[0];
  state.currentFinalReportAuditId = first?.auditId || '';
  if (state.currentFinalReportAuditId) localStorage.setItem('usoap_phase5_current_final_report_audit', state.currentFinalReportAuditId);
  return state.currentFinalReportAuditId;
}

export function openFinalReport(auditId) {
  state.currentFinalReportAuditId = auditId || '';
  if (state.currentFinalReportAuditId) localStorage.setItem('usoap_phase5_current_final_report_audit', state.currentFinalReportAuditId);
  showSection('reportsAudit');
}

export function selectFinalReportAudit(auditId) {
  state.currentFinalReportAuditId = auditId || '';
  if (state.currentFinalReportAuditId) localStorage.setItem('usoap_phase5_current_final_report_audit', state.currentFinalReportAuditId);
  if (runtime.renderReports) runtime.renderReports();
  else renderFinalReportModule();
}

function finalReportAuditOptions(selectedId = '') {
  return reportEligibleAudits().map(a => `<option value="${escapeHtml(a.auditId)}" ${a.auditId === selectedId ? 'selected' : ''}>${escapeHtml(a.auditId)} - ${escapeHtml(a.organizationName || '-')} (${escapeHtml(AUDIT_STATUS[a.status] || a.status)})</option>`).join('');
}

export function auditFindings(auditId) {
  return state.findings.filter(f => f.auditId === auditId && !['void','withdrawn'].includes(f.status));
}

export function reportDefaultSummary(audit, findings) {
  return `Denetim ${formatDate(audit.plannedStartDate)} - ${formatDate(audit.plannedEndDate)} tarihleri arasında ${audit.organizationName || 'ilgili kuruluş'} nezdinde gerçekleştirilmiştir. Denetim kapsamındaki kontrol formlarında yapılan değerlendirme sonucunda ${findings.length} NS bulgu tespit edilmiştir.`;
}

function reportHtml(audit, report, findings) {
  const assignment = getAssignment(audit.auditId) || {};
  const objection = getObjection(audit.auditId);
  const rows = findings.map(f => `<tr><td>${escapeHtml(f.areaKey || '-')}</td><td>${escapeHtml(f.pqNo || '-')}</td><td>${escapeHtml(f.ce || '-')}</td><td>${escapeHtml(f.findingText || '-')}</td><td>${escapeHtml(f.reviewedEvidence || '-')}</td></tr>`).join('');
  return `<div class="report-preview">
    <h1>USOAP CMA DENETİM NİHAİ RAPORU</h1>
    <p><strong>Denetim:</strong> ${escapeHtml(audit.auditId)} | <strong>Kuruluş:</strong> ${escapeHtml(audit.organizationName || '-')}</p>
    <table class="meta-table"><tbody>
      <tr><th>Program</th><td>${escapeHtml(audit.programId || '-')}</td><th>Denetim Tarihi</th><td>${formatDate(audit.plannedStartDate)} - ${formatDate(audit.plannedEndDate)}</td></tr>
      <tr><th>Yer</th><td>${escapeHtml(audit.location || '-')}</td><th>Yöntem / Şekil</th><td>${escapeHtml(AUDIT_METHOD_LABELS[audit.auditMethod] || audit.auditMethod || '-')} / ${escapeHtml(AUDIT_TYPE_LABELS[audit.auditType] || audit.auditType || '-')}</td></tr>
      <tr><th>Heyet Başkanı</th><td>${escapeHtml(assignment.leadAuditorName || '-')}</td><th>Heyet Üyeleri</th><td>${escapeHtml((assignment.auditorNames || []).join(', ') || '-')}</td></tr>
      <tr><th>Kontrol Formları</th><td colspan="3">${escapeHtml((audit.selectedForms || []).join(', ') || '-')}</td></tr>
    </tbody></table>
    <h2>1. Amaç, Kapsam ve Kriterler</h2>
    <p><strong>Amaç:</strong> ${escapeHtml(audit.objectives || '-')}</p>
    <p><strong>Kapsam:</strong> ${escapeHtml(audit.scope || '-')}</p>
    <p><strong>Kriterler:</strong> ${escapeHtml(audit.criteria || '-')}</p>
    <h2>2. Yönetici Özeti</h2><p>${escapeHtml(report.summaryText || reportDefaultSummary(audit, findings))}</p>
    <h2>3. İtiraz Süreci</h2><p>${escapeHtml(objection ? `${objectionStatusLabel(objection, audit)}. ${objection.objectionNote || ''}` : 'İtiraz bildirimi bulunmamaktadır.')}</p>
    <h2>4. Bulgular</h2>
    <table class="meta-table"><thead><tr><th>Area</th><th>PQ</th><th>CE</th><th>Bulgu</th><th>İncelenen Kanıt</th></tr></thead><tbody>${rows || `<tr><td colspan="5">NS bulgu bulunmamaktadır.</td></tr>`}</tbody></table>
    <h2>5. Sonuç ve Takip</h2><p>${escapeHtml(report.conclusionText || 'NS bulgular için nihai rapor gönderiminden itibaren 45 gün içinde CAP hazırlanması beklenir.')}</p>
    ${report.distributionNote ? `<h2>6. Dağıtım / Gönderim Notu</h2><p>${escapeHtml(report.distributionNote)}</p>` : ''}
  </div>`;
}

export function renderFinalReportModule() {
  const section = document.getElementById('reportsAudit');
  if (!section) return;
  const audits = reportEligibleAudits();
  if (!audits.length) {
    section.innerHTML = `<div class="info-banner"><strong>Nihai Rapor:</strong> İtiraz süreci tamamlanan denetimler burada rapora dönüştürülür.</div><div class="empty">Nihai rapor hazırlanacak denetim bulunmuyor. Önce denetimi İtiraz Sürecinden Nihai Rapor Hazırlanıyor aşamasına alın.</div>`;
    return;
  }
  const selectedId = ensureFinalReportSelection();
  const audit = getAudit(selectedId) || audits[0];
  const report = getReport(audit.auditId) || {};
  const findings = auditFindings(audit.auditId);
  const days = daysBetween(audit.finalReportDueDate);
  const canEdit = ['admin','program_manager','lead_auditor'].includes(state.role) && audit.status === 'final_report_preparation';
  const disabled = canEdit ? '' : 'disabled';
  section.innerHTML = `
    <div class="info-banner"><strong>Faz 5:</strong> Nihai rapor, denetim bitişinden itibaren 15 gün içinde hazırlanıp gönderilmelidir. Gönderim yapıldığında açık NS bulguları için 45 günlük CAP bekleme süreci otomatik başlatılır.</div>
    <div class="toolbar"><div class="field" style="min-width:340px"><label>Nihai Rapor Denetimi Seç</label><select onchange="selectFinalReportAudit(this.value)">${finalReportAuditOptions(audit.auditId)}</select></div><button class="btn" onclick="showAuditDetails('${audit.auditId}')">Denetim Detayı</button><button class="btn" onclick="openObjectionProcess('${audit.auditId}')">İtiraz Süreci</button><button class="btn primary" onclick="window.print()">Yazdır / PDF</button></div>
    <div class="deadline-grid"><div class="deadline-card"><b>${escapeHtml(audit.auditId)}</b><span>Denetim</span></div><div class="deadline-card"><b>${formatDate(audit.finalReportDueDate)}</b><span>Nihai rapor son tarihi</span></div><div class="deadline-card"><b>${days === null ? '-' : days < 0 ? Math.abs(days) + ' gün gecikti' : days + ' gün kaldı'}</b><span>Süre durumu</span></div><div class="deadline-card"><b>${findings.length}</b><span>NS bulgu</span></div></div>
    <div class="status-ribbon">${statusPill(audit.status)}${objectionPill(audit.auditId)}${reportPill(audit.auditId)}</div>
    ${!canEdit && audit.status === 'final_report_preparation' ? `<div class="readonly-note">Nihai raporu düzenlemek/göndermek için Yönetici, Program Yöneticisi veya Baş Denetçi rolü gerekir.</div>` : ''}
    ${audit.status !== 'final_report_preparation' ? `<div class="readonly-note">Bu rapor gönderilmiş veya sonraki aşamaya geçmiş olabilir. Alanlar salt okunur gösterilir.</div>` : ''}
    <div class="split-panel" style="margin-top:14px">
      <div class="phase5-panel"><h3>Rapor Bilgileri</h3>
        <div class="field"><label>Yönetici Özeti</label><textarea id="reportSummaryText" ${disabled}>${escapeHtml(report.summaryText || reportDefaultSummary(audit, findings))}</textarea></div>
        <div class="field"><label>Sonuç / Takip Notu</label><textarea id="reportConclusionText" ${disabled}>${escapeHtml(report.conclusionText || 'NS bulgular için nihai rapor gönderiminden itibaren 45 gün içinde CAP hazırlanması beklenir.')}</textarea></div>
        <div class="field"><label>Dağıtım / Gönderim Notu</label><textarea id="reportDistributionNote" ${disabled}>${escapeHtml(report.distributionNote || '')}</textarea></div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn success" onclick="saveFinalReport(false)" ${disabled}>Taslak Raporu Kaydet</button><button class="btn primary" onclick="saveFinalReport(true)" ${disabled}>Nihai Raporu Gönder</button></div>
      </div>
      <div>${reportHtml(audit, report, findings)}</div>
    </div>`;
}

export async function saveFinalReport(send) {
  const audit = getAudit(state.currentFinalReportAuditId);
  if (!audit) return alert('Denetim seçin.');
  if (!['admin','program_manager','lead_auditor'].includes(state.role)) return alert('Nihai rapor için Yönetici/Program Yöneticisi/Baş Denetçi rolü gerekir.');
  const findings = auditFindings(audit.auditId);
  const reportId = `REPORT-${audit.auditId}`;
  const existing = getReport(audit.auditId) || {};
  const data = {
    ...existing,
    reportId,
    reportType: 'final',
    auditId: audit.auditId,
    organizationId: audit.organizationId,
    organizationName: audit.organizationName,
    status: send ? 'sent' : 'draft',
    summaryText: document.getElementById('reportSummaryText')?.value.trim() || reportDefaultSummary(audit, findings),
    conclusionText: document.getElementById('reportConclusionText')?.value.trim() || '',
    distributionNote: document.getElementById('reportDistributionNote')?.value.trim() || '',
    findingIds: findings.map(f => f.findingId || f.id),
    sentAt: send ? new Date().toISOString() : existing.sentAt || null,
    createdByRole: existing.createdByRole || state.role,
    updatedByRole: state.role,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await runtime.saveRecord(COLLECTIONS.reports, reportId, data);
  if (send) await finalizeReportAndStartCap(audit, data.sentAt);
  await runtime.loadData();
  runtime.renderAll();
  state.currentFinalReportAuditId = audit.auditId;
  localStorage.setItem('usoap_phase5_current_final_report_audit', audit.auditId);
  alert(send ? 'Nihai rapor gönderildi. Açık bulgular için 45 günlük CAP bekleme kayıtları oluşturuldu.' : 'Nihai rapor taslağı kaydedildi.');
  showSection('reportsAudit');
}

export async function finalizeReportAndStartCap(audit, sentAtIso) {
  const sentDate = sentAtIso ? localDateYmd(new Date(sentAtIso)) : today();
  const capDueDate = addDays(sentDate, audit.capDueDays || 45);
  await runtime.updateRecord(COLLECTIONS.audits, audit.auditId, { status: 'cap_waiting', finalReportSentDate: sentDate, finalReportSentAt: sentAtIso, capDueDays: audit.capDueDays || 45, capDueDate });
  const findings = auditFindings(audit.auditId).filter(f => !['closed','finding_closed','void','withdrawn'].includes(f.status));
  for (const f of findings) {
    const findingId = f.findingId || f.id;
    const capPlanId = `CAP-${findingId}`;
    const existing = state.capPlans.find(c => (c.capPlanId || c.id) === capPlanId) || {};
    await runtime.saveRecord(COLLECTIONS.capPlans, capPlanId, {
      ...existing,
      capPlanId,
      findingId,
      auditId: audit.auditId,
      organizationId: audit.organizationId,
      organizationName: audit.organizationName,
      dueDate: existing.dueDate || capDueDate,
      status: existing.status || 'cap_waiting',
      submittedAt: existing.submittedAt || null,
      evaluationNote: existing.evaluationNote || '',
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    await runtime.updateRecord(COLLECTIONS.findings, findingId, { status: 'cap_waiting', finalReportIncluded: true, capPlanId, capDueDate });
  }
}

register("getReport", getReport);
register("reportDefaultSummary", reportDefaultSummary);
register("auditFindings", auditFindings);
register("finalizeReportAndStartCap", finalizeReportAndStartCap);
register("reportPill", reportPill);
register("renderFinalReportModule", renderFinalReportModule);
expose("openFinalReport", openFinalReport);
expose("selectFinalReportAudit", selectFinalReportAudit);
expose("saveFinalReport", saveFinalReport);
