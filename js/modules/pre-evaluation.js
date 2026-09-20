// Faz 8B.3 - Denetçi ön değerlendirme modülü.
import { COLLECTIONS, AREA_LABELS, AUDIT_STATUS } from "../config.js";
import { state } from "../state.js";
import { escapeHtml, formatDate } from "../utils.js";
import { getAudit } from "../selectors.js";
import { runtime, register, expose } from "../runtime.js";
import { showSection } from "./ui-shell.js";
import { nextActionForAudit } from "./audits.js";
import { getAuditRowsForAudit, pqKey, getOrgResponse, getPreEvaluation } from "./workflow-context.js";
import { orgResponseStatusLabel, orgResponsePill } from "./auditee-responses.js";

export function preEvalPill(auditId) {
  const pe = getPreEvaluation(auditId);
  const cls = !pe ? 'gray' : pe.status === 'completed' ? 'green' : 'yellow';
  return `<span class="pill ${cls}">Ön Değerlendirme: ${pe ? (pe.status === 'completed' ? 'Tamamlandı' : 'Taslak') : 'Yok'}</span>`;
}
function ensurePreEvaluationSelection() {
  const eligible = state.audits.filter(a => ['pre_evaluation','waiting_auditee_response','audit_in_progress'].includes(a.status));
  const current = state.currentPreEvaluationAuditId && getAudit(state.currentPreEvaluationAuditId) ? state.currentPreEvaluationAuditId : '';
  if (current && eligible.some(a => a.auditId === current)) return current;
  const first = eligible[0];
  state.currentPreEvaluationAuditId = first?.auditId || '';
  if (state.currentPreEvaluationAuditId) localStorage.setItem('usoap_phase3b_current_preeval_audit', state.currentPreEvaluationAuditId);
  return state.currentPreEvaluationAuditId;
}

export function openPreEvaluation(auditId) {
  state.currentPreEvaluationAuditId = auditId || '';
  if (state.currentPreEvaluationAuditId) localStorage.setItem('usoap_phase3b_current_preeval_audit', state.currentPreEvaluationAuditId);
  showSection('preEvaluation');
}

export function selectPreEvaluationAudit(auditId) {
  state.currentPreEvaluationAuditId = auditId || '';
  if (state.currentPreEvaluationAuditId) localStorage.setItem('usoap_phase3b_current_preeval_audit', state.currentPreEvaluationAuditId);
  renderPreEvaluation();
}

function preEvaluationOptions(selectedId = '') {
  return state.audits.filter(a => ['pre_evaluation','waiting_auditee_response','audit_in_progress'].includes(a.status)).map(a => `<option value="${escapeHtml(a.auditId)}" ${a.auditId === selectedId ? 'selected' : ''}>${escapeHtml(a.auditId)} - ${escapeHtml(a.organizationName || '-')} (${formatDate(a.plannedStartDate)})</option>`).join('');
}

function renderOrgResponseReadOnly(audit) {
  const response = getOrgResponse(audit.auditId);
  if (!response) return `<div class="warn-banner">Bu denetim için kuruluş ön cevabı henüz gönderilmemiş. Denetçi yine de ön değerlendirme taslağı oluşturabilir.</div>`;
  const items = response.items || {};
  const answered = Object.values(items).filter(x => x.responseText || x.evidenceText).length;
  const sample = Object.values(items).filter(x => x.responseText || x.evidenceText).slice(0, 12);
  return `<div class="info-banner"><strong>Kuruluş cevabı:</strong> ${escapeHtml(orgResponseStatusLabel(response, audit))}. ${answered} PQ için cevap/kanıt linki girilmiş. Genel cevap aşağıdadır.</div><div class="response-mini"><strong>Genel Cevap</strong>\n${escapeHtml(response.generalResponse || '-')}</div>${sample.length ? `<div style="margin-top:10px" class="table-wrap"><table><thead><tr><th>Area/PQ</th><th>Kuruluş Cevabı</th><th>Kanıt Dosya/Link</th></tr></thead><tbody>${sample.map(x => `<tr><td>${escapeHtml(x.areaKey)}/${escapeHtml(x.pqNo)}</td><td>${escapeHtml(x.responseText || '-')}</td><td>${escapeHtml(x.evidenceText || '-')}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
}

function renderPreEvaluationPqInputs(audit, preEval) {
  const rows = getAuditRowsForAudit(audit);
  const response = getOrgResponse(audit.auditId) || {};
  const responseItems = response.items || {};
  const items = preEval?.items || {};
  const byArea = {};
  rows.forEach(row => { (byArea[row.areaKey] ||= []).push(row); });
  if (!rows.length) return `<div class="empty">Bu denetim için seçili kontrol formu bulunmuyor.</div>`;
  return Object.entries(byArea).map(([area, areaRows]) => `
    <div class="response-area-block">
      <div class="response-area-head"><h3>${escapeHtml(area)} - ${escapeHtml(AREA_LABELS[area] || '')}</h3><span class="pill blue">${areaRows.length} PQ</span></div>
      ${areaRows.map(row => {
        const key = pqKey(area, row.pqNo);
        const orgItem = responseItems[key] || {};
        const peItem = items[key] || {};
        const question = row.questionTr || row.questionEn || '';
        return `<div class="response-pq-card">
          <div class="response-pq-title"><b>PQ ${escapeHtml(row.pqNo)}</b> ${escapeHtml(question)}</div>
          <div class="split-panel">
            <div class="response-mini"><strong>Kuruluş Cevabı</strong>\n${escapeHtml(orgItem.responseText || '-')}\n\n<strong>Kanıt Dosya/Link</strong>\n${escapeHtml(orgItem.evidenceText || '-')}</div>
            <div>
              <div class="field"><label>Denetçi Ön Değerlendirme Notu</label><textarea data-preeval-key="${escapeHtml(key)}" data-area="${escapeHtml(area)}" data-pq="${escapeHtml(row.pqNo)}" data-kind="note" placeholder="Sahada/uzaktan doğrulanacak hususlar, ön değerlendirme...">${escapeHtml(peItem.auditorNote || '')}</textarea></div>
              <div class="field"><label>Ön Risk / Odak Notu</label><textarea data-preeval-key="${escapeHtml(key)}" data-area="${escapeHtml(area)}" data-pq="${escapeHtml(row.pqNo)}" data-kind="focus" placeholder="Odak alanı, örneklem, özel dikkat edilecek husus...">${escapeHtml(peItem.focusNote || '')}</textarea></div>
              <label class="checkline"><input type="checkbox" data-preeval-key="${escapeHtml(key)}" data-area="${escapeHtml(area)}" data-pq="${escapeHtml(row.pqNo)}" data-kind="siteCheck" ${peItem.siteCheckRequired ? 'checked' : ''}> Sahada/denetimde doğrulanacak</label>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>`).join('');
}

function collectPreEvaluationItems() {
  const items = {};
  document.querySelectorAll('[data-preeval-key]').forEach(el => {
    const key = el.dataset.preevalKey;
    const areaKey = el.dataset.area;
    const pqNo = el.dataset.pq;
    items[key] ||= { areaKey, pqNo, auditorNote: '', focusNote: '', siteCheckRequired: false };
    if (el.dataset.kind === 'note') items[key].auditorNote = el.value.trim();
    if (el.dataset.kind === 'focus') items[key].focusNote = el.value.trim();
    if (el.dataset.kind === 'siteCheck') items[key].siteCheckRequired = el.checked;
  });
  Object.keys(items).forEach(k => {
    if (!items[k].auditorNote && !items[k].focusNote && !items[k].siteCheckRequired) delete items[k];
  });
  return items;
}

export function renderPreEvaluation() {
  const section = document.getElementById('preEvaluation');
  const eligible = state.audits.filter(a => ['pre_evaluation','waiting_auditee_response','audit_in_progress'].includes(a.status));
  const selectedId = ensurePreEvaluationSelection();
  if (!eligible.length) {
    section.innerHTML = `<div class="info-banner"><strong>Ön Değerlendirme:</strong> Kuruluş cevabı gönderilen veya cevap sürecinde olan denetimler burada değerlendirilir.</div><div class="empty">Ön değerlendirme yapılacak denetim bulunmuyor. Planlı denetimi önce cevap sürecine alın veya kuruluş cevabını gönderin.</div>`;
    return;
  }
  const audit = getAudit(selectedId) || eligible[0];
  const pe = getPreEvaluation(audit.auditId) || {};
  const response = getOrgResponse(audit.auditId);
  const canEdit = ['admin','program_manager','lead_auditor','auditor'].includes(state.role);
  const disabled = canEdit ? '' : 'disabled';
  section.innerHTML = `
    <div class="info-banner"><strong>Faz 3B:</strong> Denetim heyeti, kuruluş ön cevaplarını inceler; sahada doğrulanacak hususları, örneklem/fokus notlarını ve ön değerlendirme kayıtlarını oluşturur. Bu aşama nihai bulgu üretmez.</div>
    <div class="response-toolbar">
      <div class="field" style="min-width:320px"><label>Denetim Seç</label><select onchange="selectPreEvaluationAudit(this.value)">${preEvaluationOptions(audit.auditId)}</select></div>
      <button class="btn" onclick="showAuditDetails('${audit.auditId}')">Denetim Detayı</button>
      <button class="btn" onclick="openAuditFile('${audit.auditId}')">Denetim Dosyası / Heyet</button>
      <button class="btn" onclick="openAuditeeResponse('${audit.auditId}')">Kuruluş Cevaplarını Gör</button>
    </div>
    <div class="summary-strip"><div class="mini-stat"><strong>${escapeHtml(audit.auditId)}</strong><span>Denetim</span></div><div class="mini-stat"><strong>${escapeHtml(audit.organizationName || '-')}</strong><span>Kuruluş</span></div><div class="mini-stat"><strong>${escapeHtml(AUDIT_STATUS[audit.status] || audit.status || '-')}</strong><span>Denetim durumu</span></div><div class="mini-stat"><strong>${escapeHtml(pe.status === 'completed' ? 'Tamamlandı' : pe.status ? 'Taslak' : 'Başlamadı')}</strong><span>Ön değerlendirme</span></div></div>
    <div class="status-ribbon">${orgResponsePill(audit.auditId)}${preEvalPill(audit.auditId)}<span class="pill gray">Son tarih: ${formatDate(audit.preEvaluationDueDate)}</span></div>
    <div class="split-panel" style="margin-top:14px"><div class="card"><h3>Kuruluş Cevap Özeti</h3>${renderOrgResponseReadOnly(audit)}</div><div class="card"><h3>Genel Ön Değerlendirme</h3><div class="field full"><label>Genel Ön Değerlendirme Notu</label><textarea id="preEvalGeneralNote" ${disabled}>${escapeHtml(pe.generalNote || '')}</textarea></div><div class="field full"><label>Ön Risk / Odak Alanı Notu</label><textarea id="preEvalFocusNote" ${disabled}>${escapeHtml(pe.focusNote || '')}</textarea></div></div></div>
    <div class="card" style="margin-top:14px"><h3>PQ Bazlı Ön Değerlendirme</h3>${renderPreEvaluationPqInputs(audit, pe)}</div>
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn success" onclick="savePreEvaluation(false)" ${disabled}>Taslak Kaydet</button><button class="btn primary" onclick="savePreEvaluation(true)" ${disabled}>Ön Değerlendirmeyi Tamamla</button>${nextActionForAudit(audit) ? `<button class="btn" onclick="advanceAudit('${audit.auditId}','${nextActionForAudit(audit).status}')">${escapeHtml(nextActionForAudit(audit).label)}</button>` : ''}</div>`;
}

export async function savePreEvaluation(complete) {
  const auditId = state.currentPreEvaluationAuditId;
  const audit = getAudit(auditId);
  if (!audit) return alert('Denetim seçin.');
  if (!['admin','program_manager','lead_auditor','auditor'].includes(state.role)) return alert('Bu işlem için denetçi/baş denetçi rolü gerekir.');
  const existing = getPreEvaluation(auditId) || {};
  const preEvaluationId = `PREEVAL-${auditId}`;
  const data = {
    ...existing,
    preEvaluationId,
    auditId,
    organizationId: audit.organizationId || '',
    status: complete ? 'completed' : (existing.status || 'draft'),
    generalNote: document.getElementById('preEvalGeneralNote')?.value.trim() || '',
    focusNote: document.getElementById('preEvalFocusNote')?.value.trim() || '',
    items: collectPreEvaluationItems(),
    completedAt: complete ? new Date().toISOString() : existing.completedAt || null,
    updatedByRole: state.role,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await runtime.saveRecord(COLLECTIONS.auditPreEvaluations, preEvaluationId, data);
  if (complete && ['waiting_auditee_response','pre_evaluation'].includes(audit.status)) {
    await runtime.updateRecord(COLLECTIONS.audits, auditId, { status: 'pre_evaluation', preEvaluationCompletedAt: data.completedAt });
  }
  await runtime.loadData();
  runtime.renderAll();
  state.currentPreEvaluationAuditId = auditId;
  localStorage.setItem('usoap_phase3b_current_preeval_audit', auditId);
  alert(complete ? 'Ön değerlendirme tamamlandı.' : 'Ön değerlendirme taslağı kaydedildi.');
  showSection('preEvaluation');
}

register("preEvalPill", preEvalPill);
register("renderPreEvaluation", renderPreEvaluation);
expose("openPreEvaluation", openPreEvaluation);
expose("selectPreEvaluationAudit", selectPreEvaluationAudit);
expose("savePreEvaluation", savePreEvaluation);
expose("renderPreEvaluation", renderPreEvaluation);
