// Faz 8B.4 - İtiraz süreci modülü.
// Kuruluş itiraz bildirimi, itiraz süresinin kontrollü tamamlanması ve durum göstergeleri burada tutulur.
import { COLLECTIONS, AUDIT_STATUS } from "../config.js";
import { state } from "../state.js";
import { escapeHtml, daysBetween, formatDate } from "../utils.js";
import { getAudit } from "../selectors.js";
import { runtime, register, expose } from "../runtime.js";
import { showSection } from "./ui-shell.js";
import { renderAuditList, statusPill } from "./audits.js";
import { auditeeVisibleAudits } from "./workflow-context.js";

export function objectionEligibleAudits() {
  return auditeeVisibleAudits().filter(a => ['objection_period','final_report_preparation','final_report_sent','cap_waiting','cap_under_review','cap_monitoring','closed'].includes(a.status));
}

export function getObjection(auditId) {
  return state.organizationResponses.find(r => r.auditId === auditId && r.responseType === 'objection') || null;
}

export function objectionStatusLabel(record, audit) {
  if (!record && audit?.objectionStatus === 'auto_no_objection') return 'Sistem: İtiraz Yoktur';
  if (!record) return 'Bekleniyor';
  if (record.decision === 'no_objection') return record.autoCompleted ? 'Sistem: İtiraz Yoktur' : 'İtiraz Yoktur';
  if (record.decision === 'objection') return 'İtiraz Bildirildi';
  return 'Taslak';
}

export function objectionPill(auditId) {
  const audit = getAudit(auditId);
  const record = getObjection(auditId);
  const label = objectionStatusLabel(record, audit);
  const cls = !record && audit?.status === 'objection_period' ? 'yellow' : (record?.decision === 'objection' ? 'red' : record?.decision === 'no_objection' || audit?.objectionStatus === 'auto_no_objection' ? 'green' : 'gray');
  return `<span class="pill ${cls}">İtiraz: ${escapeHtml(label)}</span>`;
}

function ensureObjectionSelection() {
  const audits = objectionEligibleAudits();
  const current = state.currentObjectionAuditId && getAudit(state.currentObjectionAuditId) ? state.currentObjectionAuditId : '';
  if (current && audits.some(a => a.auditId === current)) return current;
  const first = audits[0];
  state.currentObjectionAuditId = first?.auditId || '';
  if (state.currentObjectionAuditId) localStorage.setItem('usoap_phase5_current_objection_audit', state.currentObjectionAuditId);
  return state.currentObjectionAuditId;
}

export function openObjectionProcess(auditId) {
  state.currentObjectionAuditId = auditId || '';
  if (state.currentObjectionAuditId) localStorage.setItem('usoap_phase5_current_objection_audit', state.currentObjectionAuditId);
  showSection('auditeeObjections');
}

export function selectObjectionAudit(auditId) {
  state.currentObjectionAuditId = auditId || '';
  if (state.currentObjectionAuditId) localStorage.setItem('usoap_phase5_current_objection_audit', state.currentObjectionAuditId);
  if (state.role === 'auditee') renderAuditeeObjections();
  else renderAuditList('objectionAudits', ['objection_period'], 'İtiraz Sürecindeki Denetimler', 'Denetim bitişinden itibaren 2 günlük itiraz var/yok bildirim süreci.');
}

function objectionAuditOptions(selectedId = '') {
  return objectionEligibleAudits().map(a => `<option value="${escapeHtml(a.auditId)}" ${a.auditId === selectedId ? 'selected' : ''}>${escapeHtml(a.auditId)} - ${escapeHtml(a.organizationName || '-')} (${escapeHtml(AUDIT_STATUS[a.status] || a.status)})</option>`).join('');
}

export function renderAuditeeObjections(portalNote = '') {
  const section = document.getElementById('auditeeObjections');
  if (!section) return;
  const audits = objectionEligibleAudits().filter(a => state.role !== 'auditee' || a.organizationId === state.orgContext);
  if (!audits.length) {
    section.innerHTML = portalNote + `<div class="info-banner"><strong>İtiraz Bildirimi:</strong> Denetim cevapları tamamlandıktan sonra denetim İtiraz Sürecinde statüsüne alınır. Kuruluş bu ekrandan 2 gün içinde itiraz var/yok bildirimi yapar.</div><div class="empty">Bu kuruluş bağlamında itiraz bildirimi yapılacak denetim bulunmuyor.</div>`;
    return;
  }
  const selectedId = ensureObjectionSelection();
  const audit = getAudit(selectedId) || audits[0];
  const record = getObjection(audit.auditId) || {};
  const days = daysBetween(audit.objectionDueDate);
  const dueLabel = days === null ? '-' : days < 0 ? `${Math.abs(days)} gün geçti` : days === 0 ? 'Bugün son gün' : `${days} gün kaldı`;
  const canSubmit = state.role === 'auditee' && audit.status === 'objection_period' && (!record.decision || record.status === 'draft');
  const readonly = canSubmit ? '' : 'disabled';
  const choice = record.decision || 'no_objection';
  const reportPillHtml = runtime.reportPill?.(audit.auditId) || `<span class="pill gray">Nihai Rapor: Yok</span>`;
  section.innerHTML = portalNote + `
    <div class="info-banner"><strong>Faz 5:</strong> Denetlenen kuruluş, denetim bitişinden itibaren 2 gün içinde itiraz var/yok bildirimi yapabilir. İtiraz yoksa rapor hazırlık aşamasına erken geçilebilir. Süre geçip bildirim yapılmadıysa sistem "itiraz yoktur" kaydı oluşturabilir.</div>
    <div class="toolbar"><div class="field" style="min-width:320px"><label>İtiraz Denetimi Seç</label><select onchange="selectObjectionAudit(this.value)">${objectionAuditOptions(audit.auditId)}</select></div><button class="btn" onclick="showAuditDetails('${audit.auditId}')">Denetim Detayı</button><button class="btn warning" onclick="applyAutomaticDeadlineTransitions(true)">Süreleri Kontrol Et / Uygula</button></div>
    <div class="deadline-grid"><div class="deadline-card"><b>${escapeHtml(audit.auditId)}</b><span>Denetim</span></div><div class="deadline-card"><b>${escapeHtml(audit.organizationName || '-')}</b><span>Kuruluş</span></div><div class="deadline-card"><b>${formatDate(audit.objectionDueDate)}</b><span>İtiraz son tarihi</span></div><div class="deadline-card"><b>${escapeHtml(dueLabel)}</b><span>Kalan/geçen süre</span></div></div>
    <div class="status-ribbon">${statusPill(audit.status)}${objectionPill(audit.auditId)}${reportPillHtml}</div>
    ${record.decision ? `<div class="${record.decision === 'objection' ? 'warn-banner' : 'info-banner'}"><strong>Mevcut bildirim:</strong> ${escapeHtml(objectionStatusLabel(record, audit))}${record.submittedAt ? ` | ${new Date(record.submittedAt).toLocaleString('tr-TR')}` : ''}</div>` : ''}
    <div class="card" style="margin-top:14px"><h3>İtiraz Bildirimi</h3>
      <div class="objection-choice">
        <label><input ${readonly} type="radio" name="objectionDecision" value="no_objection" ${choice !== 'objection' ? 'checked' : ''}> İtiraz yoktur</label>
        <label><input ${readonly} type="radio" name="objectionDecision" value="objection" ${choice === 'objection' ? 'checked' : ''}> İtiraz vardır</label>
      </div>
      <div class="form-grid">
        <div class="field full"><label>İtiraz / Açıklama Notu</label><textarea id="objectionNote" ${readonly} placeholder="İtiraz varsa gerekçe, itiraz yoksa kısa onay notu...">${escapeHtml(record.objectionNote || '')}</textarea></div>
        <div class="field full"><label>Kanıt Dosya Adı / Link <span style="text-transform:none;color:#64748b">(opsiyonel)</span></label><textarea id="objectionEvidence" ${readonly} placeholder="Dosya adı, klasör yolu veya bağlantı...">${escapeHtml(record.evidenceReference || '')}</textarea></div>
      </div>
    </div>
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn success" onclick="submitObjectionDecision(false)" ${canSubmit ? '' : 'disabled'}>Taslak Kaydet</button>
      <button class="btn primary" onclick="submitObjectionDecision(true)" ${canSubmit ? '' : 'disabled'}>Bildirimi Gönder</button>
      ${['admin','program_manager','lead_auditor'].includes(state.role) ? `<button class="btn warning" onclick="completeObjectionForAudit('${audit.auditId}')">İtiraz Sürecini Tamamla</button>` : ''}
    </div>`;
}

export async function submitObjectionDecision(submit) {
  const audit = getAudit(state.currentObjectionAuditId);
  if (!audit) return alert('Denetim seçin.');
  if (state.role !== 'auditee') return alert('İtiraz bildirimi denetlenen kuruluş rolüyle yapılır.');
  if (audit.status !== 'objection_period') return alert('Bu denetim itiraz sürecinde değil.');
  const decision = document.querySelector('input[name="objectionDecision"]:checked')?.value || 'no_objection';
  const note = document.getElementById('objectionNote')?.value.trim() || '';
  if (submit && decision === 'objection' && !note) return alert('İtiraz bildirimi için açıklama/gerekçe zorunludur.');
  const existing = getObjection(audit.auditId) || {};
  const responseId = `OBJECTION-${audit.auditId}`;
  const data = {
    ...existing,
    responseId,
    responseType: 'objection',
    auditId: audit.auditId,
    organizationId: audit.organizationId,
    organizationName: audit.organizationName,
    status: submit ? 'submitted' : 'draft',
    decision,
    objectionNote: note,
    evidenceReference: document.getElementById('objectionEvidence')?.value.trim() || '',
    submittedByRole: submit ? state.role : existing.submittedByRole || '',
    submittedAt: submit ? new Date().toISOString() : existing.submittedAt || null,
    autoCompleted: false,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await runtime.saveRecord(COLLECTIONS.organizationResponses, responseId, data);
  if (submit) {
    const patch = { objectionStatus: decision === 'objection' ? 'objection_submitted' : 'no_objection', objectionCompletedAt: new Date().toISOString() };
    if (decision === 'no_objection') patch.status = 'final_report_preparation';
    await runtime.updateRecord(COLLECTIONS.audits, audit.auditId, patch);
  }
  await runtime.loadData();
  runtime.renderAll();
  state.currentObjectionAuditId = audit.auditId;
  localStorage.setItem('usoap_phase5_current_objection_audit', audit.auditId);
  alert(submit ? (decision === 'no_objection' ? 'İtiraz yoktur bildirimi gönderildi; denetim nihai rapor hazırlık aşamasına alındı.' : 'İtiraz bildirimi gönderildi.') : 'İtiraz bildirimi taslak kaydedildi.');
  showSection('auditeeObjections');
}

export async function completeObjectionForAudit(auditId) {
  const audit = getAudit(auditId);
  if (!audit) return;
  if (!['admin','program_manager','lead_auditor'].includes(state.role)) return alert('Bu işlem için Yönetici/Program Yöneticisi/Baş Denetçi rolü gerekir.');
  const objection = getObjection(auditId);
  if (!objection && daysBetween(audit.objectionDueDate) >= 0 && !confirm('Kuruluş bildirimi yok ve 2 günlük süre henüz tamamlanmadı. Yine de itiraz yoktur kabul edilerek tamamlanacak. Devam edilsin mi?')) return;
  if (!objection) await createAutoNoObjection(audit);
  await runtime.updateRecord(COLLECTIONS.audits, auditId, { status: 'final_report_preparation', objectionStatus: objection?.decision === 'objection' ? 'objection_reviewed' : 'no_objection', objectionCompletedAt: new Date().toISOString() });
  await runtime.loadData();
  runtime.renderAll();
  showSection('objectionAudits');
}

export async function createAutoNoObjection(audit) {
  const responseId = `OBJECTION-${audit.auditId}`;
  const data = {
    responseId,
    responseType: 'objection',
    auditId: audit.auditId,
    organizationId: audit.organizationId,
    organizationName: audit.organizationName,
    status: 'submitted',
    decision: 'no_objection',
    objectionNote: 'Süre içerisinde itiraz bildirilmediği için sistem tarafından itiraz yoktur olarak kaydedildi.',
    evidenceReference: '',
    submittedByRole: 'system',
    submittedAt: new Date().toISOString(),
    autoCompleted: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await runtime.saveRecord(COLLECTIONS.organizationResponses, responseId, data);
}

export async function applyAutomaticDeadlineTransitions(showResult = true) {
  // Faz 8A kuralı korunur: otomatik statü geçişi sayfa yüklenirken yapılmaz; açık kullanıcı onayı gerekir.
  if (!showResult) return 0;
  const candidates = state.audits.filter(a => {
    if (a.status !== 'objection_period') return false;
    if (getObjection(a.auditId)) return false;
    const d = daysBetween(a.objectionDueDate);
    return d !== null && d < 0;
  });
  if (!candidates.length) {
    alert('Otomatik tamamlanmaya uygun, süresi geçmiş itiraz kaydı bulunmadı. Hiçbir kayıt değiştirilmedi.');
    return 0;
  }
  if (!confirm(`${candidates.length} denetimde itiraz süresi dolmuş ve kuruluş bildirimi yok. Bu denetimler için sistem kaydı oluşturulup Nihai Rapor Hazırlanıyor aşamasına geçirilsin mi?`)) return 0;
  let count = 0;
  for (const audit of candidates) {
    await createAutoNoObjection(audit);
    await runtime.updateRecord(COLLECTIONS.audits, audit.auditId, { status: 'final_report_preparation', objectionStatus: 'auto_no_objection', objectionCompletedAt: new Date().toISOString() });
    count++;
  }
  await runtime.loadData();
  runtime.renderAll();
  showSection(state.currentSection);
  alert(`${count} denetim için "itiraz yoktur" kaydı kullanıcı onayıyla oluşturuldu.`);
  return count;
}

register("getObjection", getObjection);
register("createAutoNoObjection", createAutoNoObjection);
register("objectionPill", objectionPill);
register("objectionStatusLabel", objectionStatusLabel);
register("renderAuditeeObjections", renderAuditeeObjections);
expose("openObjectionProcess", openObjectionProcess);
expose("selectObjectionAudit", selectObjectionAudit);
expose("submitObjectionDecision", submitObjectionDecision);
expose("completeObjectionForAudit", completeObjectionForAudit);
expose("applyAutomaticDeadlineTransitions", applyAutomaticDeadlineTransitions);
