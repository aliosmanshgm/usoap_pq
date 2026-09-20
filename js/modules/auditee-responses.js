// Faz 8B.3 - Denetlenen kuruluş ön cevap modülü.
import { COLLECTIONS, AREA_LABELS, AUDIT_STATUS } from "../config.js";
import { state } from "../state.js";
import { escapeHtml, daysBetween, formatDate } from "../utils.js";
import { getAudit } from "../selectors.js";
import { runtime, register, expose } from "../runtime.js";
import { showSection } from "./ui-shell.js";
import { getAuditRowsForAudit, pqKey, getOrgResponse, auditeeVisibleAudits } from "./workflow-context.js";

export function orgResponseStatusLabel(response, audit) {
  if (!response) return 'Henüz cevap yok';
  if (response.status === 'late') return 'Süresi Geçmiş Cevap';
  if (response.status === 'submitted') return 'Gönderildi';
  return 'Taslak';
}

export function orgResponsePill(auditId) {
  const audit = getAudit(auditId);
  const response = getOrgResponse(auditId);
  const cls = !response ? 'gray' : response.status === 'submitted' ? 'green' : response.status === 'late' ? 'red' : 'yellow';
  return `<span class="pill ${cls}">Kuruluş Cevabı: ${escapeHtml(orgResponseStatusLabel(response, audit))}</span>`;
}
export function responseEligibleAudits() {
  return auditeeVisibleAudits().filter(a => ['waiting_auditee_response','pre_evaluation','audit_in_progress','planned'].includes(a.status));
}

function ensureAuditeeResponseSelection() {
  const current = state.currentAuditeeResponseAuditId && getAudit(state.currentAuditeeResponseAuditId) ? state.currentAuditeeResponseAuditId : '';
  if (current) return current;
  const first = responseEligibleAudits()[0];
  state.currentAuditeeResponseAuditId = first?.auditId || '';
  if (state.currentAuditeeResponseAuditId) localStorage.setItem('usoap_phase3b_current_response_audit', state.currentAuditeeResponseAuditId);
  return state.currentAuditeeResponseAuditId;
}

export function openAuditeeResponse(auditId) {
  state.currentAuditeeResponseAuditId = auditId || '';
  if (state.currentAuditeeResponseAuditId) localStorage.setItem('usoap_phase3b_current_response_audit', state.currentAuditeeResponseAuditId);
  showSection('auditeeResponses');
}

export function selectAuditeeResponseAudit(auditId) {
  state.currentAuditeeResponseAuditId = auditId || '';
  if (state.currentAuditeeResponseAuditId) localStorage.setItem('usoap_phase3b_current_response_audit', state.currentAuditeeResponseAuditId);
  renderAuditeeResponses();
}

function responseAuditOptions(selectedId = '') {
  return responseEligibleAudits().map(a => `<option value="${escapeHtml(a.auditId)}" ${a.auditId === selectedId ? 'selected' : ''}>${escapeHtml(a.auditId)} - ${escapeHtml(a.organizationName || '-')} (${formatDate(a.plannedStartDate)})</option>`).join('');
}

function renderResponsePqInputs(audit, response, mode = 'auditee') {
  const rows = getAuditRowsForAudit(audit);
  const items = response?.items || response?.pqResponses || {};
  const byArea = {};
  rows.forEach(row => { (byArea[row.areaKey] ||= []).push(row); });
  if (!rows.length) return `<div class="empty">Bu denetim için seçili kontrol formu bulunmuyor.</div>`;
  return Object.entries(byArea).map(([area, areaRows]) => `
    <div class="response-area-block">
      <div class="response-area-head"><h3>${escapeHtml(area)} - ${escapeHtml(AREA_LABELS[area] || '')}</h3><span class="pill blue">${areaRows.length} PQ</span></div>
      ${areaRows.map(row => {
        const key = pqKey(area, row.pqNo);
        const item = items[key] || {};
        const question = row.questionTr || row.questionEn || '';
        const evidence = item.evidenceText || item.evidenceLink || '';
        return `<div class="response-pq-card">
          <div class="response-pq-title"><b>PQ ${escapeHtml(row.pqNo)}</b> ${escapeHtml(question)}</div>
          <div class="response-row">
            <div class="field"><label>Kuruluş Ön Cevabı</label><textarea data-response-key="${escapeHtml(key)}" data-area="${escapeHtml(area)}" data-pq="${escapeHtml(row.pqNo)}" data-kind="response" placeholder="Kuruluş açıklaması / mevcut durum / hazırlık bilgisi...">${escapeHtml(item.responseText || '')}</textarea></div>
            <div class="field"><label>Kanıt Dosya Adı / Link</label><textarea data-response-key="${escapeHtml(key)}" data-area="${escapeHtml(area)}" data-pq="${escapeHtml(row.pqNo)}" data-kind="evidence" placeholder="Dosya adı, klasör yolu veya bağlantı...">${escapeHtml(evidence)}</textarea></div>
          </div>
        </div>`;
      }).join('')}
    </div>`).join('');
}

function collectAuditeeResponseItems() {
  const items = {};
  document.querySelectorAll('[data-response-key]').forEach(el => {
    const key = el.dataset.responseKey;
    const areaKey = el.dataset.area;
    const pqNo = el.dataset.pq;
    items[key] ||= { areaKey, pqNo, responseText: '', evidenceText: '' };
    if (el.dataset.kind === 'response') items[key].responseText = el.value.trim();
    if (el.dataset.kind === 'evidence') items[key].evidenceText = el.value.trim();
  });
  Object.keys(items).forEach(k => {
    if (!items[k].responseText && !items[k].evidenceText) delete items[k];
  });
  return items;
}

export function renderAuditeeResponses() {
  const section = document.getElementById('auditeeResponses');
  const selectedId = ensureAuditeeResponseSelection();
  const audits = responseEligibleAudits();
  if (!audits.length) {
    section.innerHTML = `<div class="info-banner">Kuruluş ön cevap ekranı, cevap sürecine alınan denetimler için kullanılır. Denetim İşlemleri ekranından planlı denetimi <strong>Cevap Sürecine Al</strong> statüsüne taşıyın.</div><div class="empty">Bu bağlamda ön cevap verilecek denetim bulunmuyor.</div>`;
    return;
  }
  const audit = getAudit(selectedId) || audits[0];
  if (!state.currentAuditeeResponseAuditId && audit) state.currentAuditeeResponseAuditId = audit.auditId;
  const response = getOrgResponse(audit.auditId) || {};
  const days = daysBetween(audit.auditeeResponseDueDate);
  const duePill = days === null ? '' : `<span class="pill ${days < 0 ? 'red' : days <= 3 ? 'yellow' : 'gray'}">Son tarih: ${formatDate(audit.auditeeResponseDueDate)} / ${days < 0 ? Math.abs(days) + ' gün geçti' : days + ' gün kaldı'}</span>`;
  const readonly = state.role !== 'auditee' && !['admin','program_manager'].includes(state.role) ? 'disabled' : '';
  section.innerHTML = `
    <div class="info-banner"><strong>Faz 3B:</strong> Denetlenen kuruluş, kendisine atanan denetim için genel ve PQ bazlı ön cevaplarını girer. Kanıt dokümanı için ilk etapta sadece dosya adı veya link kaydı tutulur.</div>
    <div class="response-toolbar">
      <div class="field" style="min-width:320px"><label>Denetim Seç</label><select onchange="selectAuditeeResponseAudit(this.value)">${responseAuditOptions(audit.auditId)}</select></div>
      <button class="btn" onclick="showAuditDetails('${audit.auditId}')">Denetim Detayı</button>
      <button class="btn" onclick="showSection('auditeeAssigned')">Atanan Denetimler</button>
    </div>
    <div class="summary-strip">
      <div class="mini-stat"><strong>${escapeHtml(audit.auditId)}</strong><span>Denetim</span></div>
      <div class="mini-stat"><strong>${escapeHtml(audit.organizationName || '-')}</strong><span>Kuruluş</span></div>
      <div class="mini-stat"><strong>${escapeHtml(AUDIT_STATUS[audit.status] || audit.status || '-')}</strong><span>Denetim durumu</span></div>
      <div class="mini-stat"><strong>${escapeHtml(orgResponseStatusLabel(response, audit))}</strong><span>Cevap durumu</span></div>
    </div>
    <div class="status-ribbon">${duePill}${orgResponsePill(audit.auditId)}${runtime.preEvalPill?.(audit.auditId) || ''}${runtime.auditResponsePill?.(audit.auditId) || ''}</div>
    <div class="card" style="margin-top:14px"><h3>Genel Ön Cevap</h3><div class="field full"><textarea id="auditeeGeneralResponse" ${readonly} placeholder="Kuruluşun genel ön cevabı, hazırlık notları, genel açıklamaları...">${escapeHtml(response.generalResponse || '')}</textarea></div></div>
    <div class="card" style="margin-top:14px"><h3>PQ Bazlı Ön Cevaplar</h3>${renderResponsePqInputs(audit, response, 'auditee')}</div>
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn success" onclick="saveAuditeePreResponse(false)" ${readonly}>Taslak Kaydet</button>
      <button class="btn primary" onclick="saveAuditeePreResponse(true)" ${readonly}>Kuruluş Cevaplarını Gönder</button>
      <button class="btn" onclick="renderAuditeeResponses()">Yenile</button>
    </div>`;
}

export async function saveAuditeePreResponse(submit) {
  const auditId = state.currentAuditeeResponseAuditId;
  const audit = getAudit(auditId);
  if (!audit) return alert('Denetim seçin.');
  if (state.role !== 'auditee' && !['admin','program_manager'].includes(state.role)) return alert('Bu ekran kuruluş cevabı girişi içindir. Test için Denetlenen Kuruluş rolünü seçebilirsiniz.');
  const existing = getOrgResponse(auditId) || {};
  const status = submit ? (daysBetween(audit.auditeeResponseDueDate) < 0 ? 'late' : 'submitted') : (existing.status || 'draft');
  const responseId = `ORGRESP-${auditId}`;
  const data = {
    ...existing,
    responseId,
    responseType: 'pre_response',
    auditId,
    organizationId: audit.organizationId || state.orgContext,
    organizationName: audit.organizationName || '',
    status,
    generalResponse: document.getElementById('auditeeGeneralResponse')?.value.trim() || '',
    items: collectAuditeeResponseItems(),
    submittedByRole: submit ? state.role : existing.submittedByRole || '',
    submittedAt: submit ? new Date().toISOString() : existing.submittedAt || null,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await runtime.saveRecord(COLLECTIONS.organizationResponses, responseId, data);
  if (submit && audit.status === 'waiting_auditee_response') {
    await runtime.updateRecord(COLLECTIONS.audits, auditId, { status: 'pre_evaluation', auditeeResponseSubmittedAt: data.submittedAt });
  }
  await runtime.loadData();
  runtime.renderAll();
  state.currentAuditeeResponseAuditId = auditId;
  localStorage.setItem('usoap_phase3b_current_response_audit', auditId);
  alert(submit ? 'Kuruluş ön cevapları gönderildi. Denetim ön değerlendirme aşamasına alınabilir.' : 'Kuruluş ön cevap taslağı kaydedildi.');
  showSection('auditeeResponses');
}

register("orgResponsePill", orgResponsePill);
register("renderAuditeeResponses", renderAuditeeResponses);
expose("openAuditeeResponse", openAuditeeResponse);
expose("selectAuditeeResponseAudit", selectAuditeeResponseAudit);
expose("saveAuditeePreResponse", saveAuditeePreResponse);
expose("renderAuditeeResponses", renderAuditeeResponses);
