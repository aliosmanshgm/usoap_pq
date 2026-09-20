// Faz 8B.3 - Denetim icrası / kriter bazlı PQ değerlendirme modülü.
import { COLLECTIONS, AREA_LABELS, AUDIT_STATUS } from "../config.js";
import { state } from "../state.js";
import { escapeHtml, formatDate } from "../utils.js";
import { extractNotesAndCriteria } from "../master-data.js";
import { getAudit } from "../selectors.js";
import { runtime, register, expose } from "../runtime.js";
import { showSection, showModal } from "./ui-shell.js";
import { getAuditRowsForAudit, pqKey, getAuditResponse } from "./workflow-context.js";

function auditWorkAudits() {
  const statuses = ['audit_in_progress','objection_period','final_report_preparation','final_report_sent','cap_waiting','cap_under_review','cap_monitoring','closed'];
  return state.audits.filter(a => statuses.includes(a.status) && !['archived','cancelled'].includes(a.status));
}

function canEditAuditExecution(audit) {
  return audit && audit.status === 'audit_in_progress' && ['admin','lead_auditor','auditor'].includes(state.role);
}

export function auditResponsePill(auditId) {
  const response = getAuditResponse(auditId);
  if (!response) return `<span class="pill gray">Denetim Cevabı: Yok</span>`;
  const rows = getAuditRowsForAudit(getAudit(auditId));
  const items = response.items || response.responses || {};
  const counts = auditExecutionCounts(rows, items);
  const cls = response.status === 'completed' ? 'green' : 'yellow';
  return `<span class="pill ${cls}">Denetim Cevabı: ${response.status === 'completed' ? 'Tamamlandı' : 'Taslak'} ${counts.answered}/${counts.total}</span>`;
}

function ensureAuditExecutionSelection() {
  const current = state.currentAuditExecutionId && getAudit(state.currentAuditExecutionId) ? state.currentAuditExecutionId : '';
  if (current && auditWorkAudits().some(a => a.auditId === current)) return current;
  const first = auditWorkAudits()[0];
  state.currentAuditExecutionId = first?.auditId || '';
  if (state.currentAuditExecutionId) localStorage.setItem('usoap_phase4_current_execution_audit', state.currentAuditExecutionId);
  return state.currentAuditExecutionId;
}

export function openAuditExecution(auditId) {
  state.currentAuditExecutionId = auditId || '';
  if (state.currentAuditExecutionId) localStorage.setItem('usoap_phase4_current_execution_audit', state.currentAuditExecutionId);
  showSection('auditExecution');
}

export function selectAuditExecutionAudit(auditId) {
  state.currentAuditExecutionId = auditId || '';
  if (state.currentAuditExecutionId) localStorage.setItem('usoap_phase4_current_execution_audit', state.currentAuditExecutionId);
  renderAuditExecution();
}

function auditExecutionOptions(selectedId = '') {
  return auditWorkAudits().map(a => `<option value="${escapeHtml(a.auditId)}" ${a.auditId === selectedId ? 'selected' : ''}>${escapeHtml(a.auditId)} - ${escapeHtml(a.organizationName || '-')} (${escapeHtml(AUDIT_STATUS[a.status] || a.status)})</option>`).join('');
}

export function criteriaLinesForRow(row) {
  const parsedTr = extractNotesAndCriteria(row.reviewEvidenceTr || '');
  const parsedEn = extractNotesAndCriteria(row.reviewEvidenceEn || '');
  const sourceLines = parsedTr.criteriaLines.length ? parsedTr.criteriaLines : parsedEn.criteriaLines;
  const clean = sourceLines.map(line => String(line || '').trim()).filter(Boolean);
  if (clean.length) return clean.map((text, idx) => ({ id: `c${idx + 1}`, no: idx + 1, text }));
  return [{ id: 'c1', no: 1, text: 'Bu PQ için ayrı İncelenecek Kanıt / Kriter satırı bulunmadı. Genel PQ değerlendirmesini bu satır üzerinden yapın.' }];
}

export function criteriaItemsForDisplay(item, row) {
  if (item && item.criteria && typeof item.criteria === 'object') return item.criteria;
  if (item && item.status) {
    return {
      c1: {
        status: item.status || '',
        legalBasisFindingNote: item.legalBasisFindingNote || item.findingNote || '',
        reviewedEvidence: item.reviewedEvidence || '',
        evidenceReference: item.evidenceReference || item.evidenceText || '',
        naJustification: item.naJustification || ''
      }
    };
  }
  return {};
}

export function derivePqStatusFromCriteria(criteriaItems, expectedCount) {
  const statuses = Object.values(criteriaItems || {}).map(c => c?.status || '').filter(Boolean);
  if (!expectedCount || statuses.length < expectedCount) return '';
  if (statuses.includes('NS')) return 'NS';
  if (statuses.every(s => s === 'NA')) return 'NA';
  if (statuses.includes('S')) return 'S';
  return '';
}

function mainStatusClass(status) {
  if (status === 'S') return 's';
  if (status === 'NS') return 'ns';
  if (status === 'NA') return 'na';
  return 'pending';
}

function mainStatusLabel(status) {
  return status || 'Bekliyor';
}

function criteriaStatusCounts(criteriaItems, expectedCount) {
  const counts = { total: expectedCount || 0, answered: 0, s: 0, ns: 0, na: 0, missing: 0 };
  Object.values(criteriaItems || {}).forEach(c => {
    if (!c?.status) return;
    counts.answered++;
    if (c.status === 'S') counts.s++;
    if (c.status === 'NS') counts.ns++;
    if (c.status === 'NA') counts.na++;
  });
  counts.missing = Math.max((expectedCount || 0) - counts.answered, 0);
  return counts;
}

export function auditExecutionCounts(rows, items) {
  const counts = { total: rows.length, answered: 0, s: 0, ns: 0, na: 0, missing: 0 };
  rows.forEach(row => {
    const item = items[pqKey(row.areaKey, row.pqNo)] || {};
    const defs = criteriaLinesForRow(row);
    const criteriaItems = criteriaItemsForDisplay(item, row);
    const status = item.status || derivePqStatusFromCriteria(criteriaItems, defs.length);
    if (status) {
      counts.answered++;
      if (status === 'S') counts.s++;
      if (status === 'NS') counts.ns++;
      if (status === 'NA') counts.na++;
    }
  });
  counts.missing = counts.total - counts.answered;
  return counts;
}

export function toggleExecCard(cardId) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const collapsed = card.classList.toggle('collapsed');
  const label = card.querySelector('[data-toggle-label]');
  if (label) label.textContent = collapsed ? 'Aç' : 'Kapat';
}

export function setAllExecCards(open) {
  document.querySelectorAll('.exec-card').forEach(card => {
    card.classList.toggle('collapsed', !open);
    const label = card.querySelector('[data-toggle-label]');
    if (label) label.textContent = open ? 'Kapat' : 'Aç';
  });
}

export function renderAuditExecution() {
  const section = document.getElementById('auditExecution');
  if (!section) return;
  if (!auditWorkAudits().length) {
    section.innerHTML = `<div class="warn-banner">Aktif denetim çalışması için önce bir denetimi <strong>Denetim Devam Ediyor</strong> statüsüne almalısınız. Planlı denetim kartında statüleri ilerleterek veya Ön Değerlendirme sonrasında <strong>Denetimi Başlat</strong> butonuyla bu aşamaya geçebilirsiniz.</div><div class="empty"><button class="btn primary" onclick="showSection('plannedAudits')">Denetim Listesine Git</button></div>`;
    return;
  }
  const selectedId = ensureAuditExecutionSelection();
  const audit = getAudit(selectedId);
  if (!audit) {
    section.innerHTML = `<div class="empty">Seçili denetim bulunamadı.</div>`;
    return;
  }
  const response = getAuditResponse(audit.auditId) || {};
  const rows = getAuditRowsForAudit(audit);
  const items = response.items || response.responses || {};
  const counts = auditExecutionCounts(rows, items);
  const editable = canEditAuditExecution(audit);
  const readOnlyText = editable ? '' : `<div class="readonly-note">Bu ekran salt okunur. Denetim cevapları yalnızca denetim <strong>Denetim Devam Ediyor</strong> statüsündeyken ve Yönetici/Baş Denetçi/Denetçi rollerinde düzenlenebilir.</div>`;
  section.innerHTML = `
    <div class="info-banner"><strong>Faz 4 güncellemesi:</strong> PQ cevabı artık doğrudan seçilmez. Her PQ kartını tek tek açıp <strong>İncelenecek Kanıtlar / Kriter</strong> satırlarını cevaplayın. Sistem PQ sonucunu otomatik hesaplar: <strong>her kriter NA ise PQ=NA</strong>, <strong>tek bir kriter NS ise PQ=NS</strong>, <strong>NS yok ve en az bir S varsa PQ=S</strong>. Bulgu yalnızca sonucu NS olan PQ'lerden oluşur.</div>
    <div class="toolbar">
      <div class="field" style="min-width:310px"><label>Denetim Çalışması Seç</label><select onchange="selectAuditExecutionAudit(this.value)">${auditExecutionOptions(audit.auditId)}</select></div>
      <button class="btn" onclick="showAuditDetails('${audit.auditId}')">Denetim Detayı</button>
      <button class="btn" onclick="openPreEvaluation('${audit.auditId}')">Ön Değerlendirme</button>
      <button class="btn primary" onclick="showSection('activeAudits')">Aktif Denetimler</button>
    </div>
    <div class="execution-summary">
      <div class="box"><b>${counts.total}</b><span>Kapsamdaki PQ</span></div>
      <div class="box"><b>${counts.answered}</b><span>Netleşen PQ</span></div>
      <div class="box"><b>${counts.s}</b><span>S</span></div>
      <div class="box"><b>${counts.ns}</b><span>NS / Bulgu</span></div>
      <div class="box"><b>${counts.na}</b><span>NA</span></div>
      <div class="box"><b>${counts.missing}</b><span>Eksik</span></div>
    </div>
    <div class="summary-strip"><div class="mini-stat"><strong>${escapeHtml(audit.organizationName || '-')}</strong><span>Kuruluş</span></div><div class="mini-stat"><strong>${escapeHtml(AUDIT_STATUS[audit.status] || audit.status || '-')}</strong><span>Durum</span></div><div class="mini-stat"><strong>${formatDate(audit.plannedStartDate)} - ${formatDate(audit.plannedEndDate)}</strong><span>Denetim tarihleri</span></div><div class="mini-stat"><strong>${escapeHtml((audit.selectedForms || []).join(', ') || '-')}</strong><span>Kontrol formları</span></div></div>
    ${readOnlyText}
    ${renderAuditExecutionForm(audit, response, editable)}
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
      ${editable ? `<button class="btn success" onclick="saveAuditExecution('draft')">Taslak Kaydet</button><button class="btn primary" onclick="saveAuditExecution('completed')">Denetim Cevaplarını Tamamla</button>` : ''}
      ${response.status === 'completed' && ['admin','program_manager','lead_auditor'].includes(state.role) && audit.status === 'audit_in_progress' ? `<button class="btn warning" onclick="advanceAudit('${audit.auditId}','objection_period')">İtiraz Sürecine Al</button>` : ''}
    </div>`;
}

function renderAuditExecutionForm(audit, response, editable) {
  const rows = getAuditRowsForAudit(audit);
  const items = response?.items || response?.responses || {};
  const byArea = {};
  rows.forEach(row => { (byArea[row.areaKey] ||= []).push(row); });
  if (!rows.length) return `<div class="empty">Bu denetim için seçili kontrol formu yok.</div>`;
  const disabled = editable ? '' : 'disabled';
  const roClass = editable ? '' : 'exec-readonly';
  const jump = `<div class="area-jump"><button class="btn" onclick="setAllExecCards(true)">Tümünü Aç</button><button class="btn" onclick="setAllExecCards(false)">Tümünü Kapat</button>${Object.keys(byArea).map(area => `<button class="btn" onclick="document.getElementById('exec-area-${area}')?.scrollIntoView({behavior:'smooth',block:'start'})">${area}</button>`).join('')}</div>`;
  const blocks = Object.entries(byArea).map(([area, areaRows]) => `
    <div class="response-area-block" id="exec-area-${escapeHtml(area)}">
      <div class="response-area-head"><h3>${escapeHtml(area)} - ${escapeHtml(AREA_LABELS[area] || '')}</h3><span class="pill blue">${areaRows.length} PQ</span></div>
      ${areaRows.map(row => renderAuditExecutionPqCard(area, row, items[pqKey(area, row.pqNo)] || {}, disabled, roClass)).join('')}
    </div>`).join('');
  return jump + blocks;
}

function renderCriterionCard(key, criterion, cItem, disabled, roClass) {
  const cid = criterion.id;
  const status = cItem.status || '';
  const statusClass = mainStatusClass(status);
  const statusPill = `<span class="exec-main-status ${statusClass}">${mainStatusLabel(status)}</span>`;
  const helpText = status === 'NS'
    ? 'NS seçildi: bulgu notu ve incelenen kanıt zorunludur.'
    : status === 'S'
      ? 'S seçildi: uygunluğu destekleyen mevzuat/değerlendirme notu ve incelenen kanıt girilmelidir.'
      : status === 'NA'
        ? 'NA seçildi: bu kriterin neden uygulanmadığını NA gerekçesinde açıklayın.'
        : 'Önce S / NS / NA durumunu seçin; zorunlu alanlar seçime göre kontrol edilecektir.';
  return `<div class="criteria-card criteria-${statusClass}">
    <div class="criteria-header">
      <div class="criteria-title-wrap"><span class="criteria-no-badge">${escapeHtml(criterion.no)}</span><div class="criteria-title-text"><b>Kriter ${escapeHtml(criterion.no)}</b><small>İncelenecek kanıt / kriter değerlendirmesi</small></div></div>
      ${statusPill}
    </div>
    <div class="criteria-text">${escapeHtml(criterion.text || '-')}</div>
    <div class="exec-status-row criteria-status-row">
      ${['S','NS','NA'].map(v => `<label><input ${disabled} type="radio" name="crit_status_${escapeHtml(key)}_${escapeHtml(cid)}" data-exec-key="${escapeHtml(key)}" data-criterion="${escapeHtml(cid)}" data-kind="criteriaStatus" value="${v}" ${status === v ? 'checked' : ''}><span>${v}</span></label>`).join('')}
    </div>
    <div class="criteria-status-help">${escapeHtml(helpText)}</div>
    <div class="criteria-fields">
      <div class="field"><label>Mevzuat Dayanağı / Bulgu Notları</label><textarea class="${roClass}" ${disabled} data-exec-key="${escapeHtml(key)}" data-criterion="${escapeHtml(cid)}" data-kind="criteriaLegalBasisFindingNote" placeholder="S/NS için değerlendirme dayanağı; NS ise bulgu metni...">${escapeHtml(cItem.legalBasisFindingNote || cItem.findingNote || '')}</textarea></div>
      <div class="field"><label>İncelenen Kanıt</label><textarea class="${roClass}" ${disabled} data-exec-key="${escapeHtml(key)}" data-criterion="${escapeHtml(cid)}" data-kind="criteriaReviewedEvidence" placeholder="Kayıt, doküman, görüşme, gözlem vb...">${escapeHtml(cItem.reviewedEvidence || '')}</textarea></div>
      <div class="field"><label>Kanıt Doküman Adı / Link <span style="text-transform:none;font-weight:700;color:#64748b">(opsiyonel)</span></label><textarea class="${roClass}" ${disabled} data-exec-key="${escapeHtml(key)}" data-criterion="${escapeHtml(cid)}" data-kind="criteriaEvidenceReference" placeholder="Dosya adı, klasör yolu veya bağlantı...">${escapeHtml(cItem.evidenceReference || cItem.evidenceText || '')}</textarea></div>
      <div class="field"><label>NA Gerekçesi</label><textarea class="${roClass}" ${disabled} data-exec-key="${escapeHtml(key)}" data-criterion="${escapeHtml(cid)}" data-kind="criteriaNaJustification" placeholder="NA seçildiyse uygulanmama gerekçesi...">${escapeHtml(cItem.naJustification || '')}</textarea></div>
    </div>
  </div>`;
}

function renderAuditExecutionPqCard(area, row, item, disabled, roClass) {
  const key = pqKey(area, row.pqNo);
  const cardId = `exec-card-${key}`;
  const question = row.questionTr || row.questionEn || '';
  const reference = row.reference || '';
  const ev = row.reviewEvidenceTr || row.reviewEvidenceEn || '';
  const parsed = extractNotesAndCriteria(ev);
  const criteriaDefs = criteriaLinesForRow(row);
  const criteriaItems = criteriaItemsForDisplay(item, row);
  const derivedStatus = item.status || derivePqStatusFromCriteria(criteriaItems, criteriaDefs.length);
  const cCounts = criteriaStatusCounts(criteriaItems, criteriaDefs.length);
  const completionLabel = `${cCounts.answered}/${cCounts.total} kriter`;
  return `<div class="exec-card collapsed" id="${escapeHtml(cardId)}">
    <div class="exec-head">
      <div class="exec-head-top">
        <div style="min-width:0;flex:1">
          <div class="exec-head-title"><b>PQ ${escapeHtml(row.pqNo)}</b> ${escapeHtml(question)}</div>
          <div style="margin-top:8px"><span class="pill blue">${escapeHtml(row.ce || area)}</span>${row.ppq ? `<span class="pill red">PPQ</span>` : ''}<span class="pill green">${row.onSiteRequired ? 'On-Site' : 'Off-Site'}</span><span class="pill yellow">${criteriaDefs.length} Kriter</span></div>
          <div class="exec-criteria-progress"><span class="pill gray">Cevaplanan: ${completionLabel}</span><span class="pill green">S: ${cCounts.s}</span><span class="pill red">NS: ${cCounts.ns}</span><span class="pill gray">NA: ${cCounts.na}</span></div>
        </div>
        <div class="exec-head-actions"><span class="exec-main-status ${mainStatusClass(derivedStatus)}">PQ: ${mainStatusLabel(derivedStatus)}</span><button type="button" class="btn" onclick="toggleExecCard('${escapeHtml(cardId)}')"><span data-toggle-label>Aç</span></button></div>
      </div>
      <div class="exec-rule-note">PQ sonucu kriter cevaplarından otomatik hesaplanır. Tek bir kriter NS ise PQ NS olur; tüm kriterler NA ise PQ NA olur; NS yok ve en az bir kriter S ise PQ S olur.</div>
    </div>
    <div class="exec-body">
      <div class="prebox" style="grid-column:1/-1"><strong>Reference</strong>\n${escapeHtml(reference || '-')}</div>
      ${parsed.noteText ? `<div class="note-box" style="grid-column:1/-1"><strong>Denetçiye Notlar</strong>\n${escapeHtml(parsed.noteText)}</div>` : ''}
      <div class="criteria-list">
        ${criteriaDefs.map(def => renderCriterionCard(key, def, criteriaItems[def.id] || {}, disabled, roClass)).join('')}
      </div>
    </div>
  </div>`;
}

function collectAuditExecutionItems() {
  const items = {};
  const audit = getAudit(state.currentAuditExecutionId);
  document.querySelectorAll('[data-exec-key]').forEach(el => {
    const key = el.dataset.execKey;
    const criterionId = el.dataset.criterion || 'c1';
    items[key] ||= { areaKey: '', pqNo: '', status: '', criteria: {}, legalBasisFindingNote: '', reviewedEvidence: '', evidenceReference: '', naJustification: '' };
    items[key].criteria[criterionId] ||= { status: '', legalBasisFindingNote: '', reviewedEvidence: '', evidenceReference: '', naJustification: '' };
    const c = items[key].criteria[criterionId];
    if (el.dataset.kind === 'criteriaStatus' && el.checked) c.status = el.value;
    if (el.dataset.kind === 'criteriaLegalBasisFindingNote') c.legalBasisFindingNote = el.value.trim();
    if (el.dataset.kind === 'criteriaReviewedEvidence') c.reviewedEvidence = el.value.trim();
    if (el.dataset.kind === 'criteriaEvidenceReference') c.evidenceReference = el.value.trim();
    if (el.dataset.kind === 'criteriaNaJustification') c.naJustification = el.value.trim();
  });
  if (audit) {
    getAuditRowsForAudit(audit).forEach(row => {
      const key = pqKey(row.areaKey, row.pqNo);
      const defs = criteriaLinesForRow(row);
      items[key] ||= { areaKey: row.areaKey, pqNo: row.pqNo, status: '', criteria: {}, legalBasisFindingNote: '', reviewedEvidence: '', evidenceReference: '', naJustification: '' };
      items[key].areaKey = row.areaKey;
      items[key].pqNo = row.pqNo;
      const criteriaItems = items[key].criteria || {};
      items[key].status = derivePqStatusFromCriteria(criteriaItems, defs.length);
      const nsNotes = [];
      const allNotes = [];
      const allEvidence = [];
      const allRefs = [];
      const allNa = [];
      defs.forEach(def => {
        const c = criteriaItems[def.id] || {};
        const prefix = `Kriter ${def.no}`;
        if (c.legalBasisFindingNote) {
          allNotes.push(`${prefix}: ${c.legalBasisFindingNote}`);
          if (c.status === 'NS') nsNotes.push(`${prefix}: ${c.legalBasisFindingNote}`);
        }
        if (c.reviewedEvidence) allEvidence.push(`${prefix}: ${c.reviewedEvidence}`);
        if (c.evidenceReference) allRefs.push(`${prefix}: ${c.evidenceReference}`);
        if (c.naJustification) allNa.push(`${prefix}: ${c.naJustification}`);
      });
      items[key].legalBasisFindingNote = (nsNotes.length ? nsNotes : allNotes).join('\n');
      items[key].findingNote = nsNotes.join('\n');
      items[key].reviewedEvidence = allEvidence.join('\n');
      items[key].evidenceReference = allRefs.join('\n');
      items[key].naJustification = allNa.join('\n');
    });
  }
  return items;
}

function validateAuditExecution(audit, items) {
  const missing = [];
  getAuditRowsForAudit(audit).forEach(row => {
    const key = pqKey(row.areaKey, row.pqNo);
    const item = items[key] || {};
    const defs = criteriaLinesForRow(row);
    const label = `${row.areaKey} PQ ${row.pqNo}`;
    defs.forEach(def => {
      const c = item.criteria?.[def.id] || {};
      const cLabel = `${label} / Kriter ${def.no}`;
      if (!c.status) missing.push(`${cLabel}: S/NS/NA seçilmemiş.`);
      if (c.status === 'S' || c.status === 'NS') {
        if (!c.legalBasisFindingNote) missing.push(`${cLabel}: Mevzuat Dayanağı / Bulgu Notları boş.`);
        if (!c.reviewedEvidence) missing.push(`${cLabel}: İncelenen Kanıt boş.`);
      }
      if (c.status === 'NA' && !c.naJustification) missing.push(`${cLabel}: NA gerekçesi boş.`);
    });
    if (!derivePqStatusFromCriteria(item.criteria || {}, defs.length)) missing.push(`${label}: PQ sonucu henüz netleşmedi.`);
  });
  return missing;
}

export async function saveAuditExecution(saveStatus = 'draft') {
  const audit = getAudit(state.currentAuditExecutionId);
  if (!audit) return alert('Denetim seçili değil.');
  if (!canEditAuditExecution(audit)) return alert('Bu denetim veya rol için denetim cevapları düzenlenemez.');
  const items = collectAuditExecutionItems();
  const missing = validateAuditExecution(audit, items);
  if (saveStatus === 'completed' && missing.length) {
    showModal('Eksik Denetim Cevapları', `<div class="danger-banner">Denetim cevapları tamamlanmadan önce aşağıdaki eksikler giderilmelidir. İlk 80 eksik gösteriliyor.</div><ul class="validation-list">${missing.slice(0,80).map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>${missing.length > 80 ? `<p>${missing.length - 80} ek eksik daha var.</p>` : ''}`);
    return;
  }
  const auditResponseId = `AUDRESP-${audit.auditId}`;
  const existing = getAuditResponse(audit.auditId) || {};
  const data = {
    ...existing,
    auditResponseId,
    auditId: audit.auditId,
    organizationId: audit.organizationId,
    organizationName: audit.organizationName,
    status: saveStatus,
    items,
    completedAt: saveStatus === 'completed' ? new Date().toISOString() : existing.completedAt || null,
    updatedBy: state.role,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await runtime.saveRecord(COLLECTIONS.auditResponses, auditResponseId, data);
  await syncFindingsFromAuditExecution(audit, data);
  await runtime.loadData();
  runtime.renderAll();
  showSection('auditExecution');
  alert(saveStatus === 'completed' ? 'Denetim cevapları tamamlandı ve NS kayıtları bulgu havuzuna aktarıldı.' : 'Denetim cevapları taslak olarak kaydedildi.');
}

async function syncFindingsFromAuditExecution(audit, auditResponse) {
  const items = auditResponse.items || {};
  const activeFindingIds = new Set();
  for (const row of getAuditRowsForAudit(audit)) {
    const key = pqKey(row.areaKey, row.pqNo);
    const item = items[key] || {};
    const findingId = `F-${audit.auditId}-${row.areaKey}-${String(row.pqNo).replace(/[^A-Za-z0-9_.-]/g, '_')}`;
    if (item.status === 'NS') {
      activeFindingIds.add(findingId);
      const existing = state.findings.find(f => (f.findingId || f.id) === findingId) || {};
      const finding = {
        ...existing,
        findingId,
        auditId: audit.auditId,
        organizationId: audit.organizationId,
        organizationName: audit.organizationName,
        areaKey: row.areaKey,
        pqNo: row.pqNo,
        ce: row.ce || '',
        findingText: item.legalBasisFindingNote || '',
        reviewedEvidence: item.reviewedEvidence || '',
        evidenceReference: item.evidenceReference || '',
        sourceAuditResponseId: auditResponse.auditResponseId,
        source: 'audit_execution',
        status: ['closed','finding_closed'].includes(existing.status) ? existing.status : 'open',
        finalReportIncluded: existing.finalReportIncluded || false,
        createdAt: existing.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await runtime.saveRecord(COLLECTIONS.findings, findingId, finding);
    }
  }
  const previous = state.findings.filter(f => f.auditId === audit.auditId && (f.source || 'audit_execution') === 'audit_execution' && !['closed','finding_closed'].includes(f.status));
  for (const f of previous) {
    const fid = f.findingId || f.id;
    if (!activeFindingIds.has(fid)) await runtime.updateRecord(COLLECTIONS.findings, fid, { status: 'void', voidedAt: new Date().toISOString(), voidReason: 'PQ artık NS değil veya cevap kaldırıldı.' });
  }
}

register("auditResponsePill", auditResponsePill);
register("getAuditResponse", getAuditResponse);
register("renderAuditExecution", renderAuditExecution);
expose("openAuditExecution", openAuditExecution);
expose("selectAuditExecutionAudit", selectAuditExecutionAudit);
expose("toggleExecCard", toggleExecCard);
expose("setAllExecCards", setAllExecCards);
expose("saveAuditExecution", saveAuditExecution);
expose("renderAuditExecution", renderAuditExecution);
