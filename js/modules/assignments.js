import { COLLECTIONS, AUDIT_STATUS, AUDIT_METHOD_LABELS, AUDIT_TYPE_LABELS } from "../config.js";
import { state } from "../state.js";
import { escapeHtml, formatDate } from "../utils.js";
import { getProgram, getAudit } from "../selectors.js";
import { runtime, register, expose } from "../runtime.js";

export function getAssignment(auditId) {
  return state.auditAssignments.find(x => x.auditId === auditId || x.id === `ASSIGN-${auditId}` || x.assignmentId === `ASSIGN-${auditId}`) || null;
}

export function canManageAssignments() {
  return ["admin", "program_manager", "lead_auditor"].includes(state.role);
}

export function splitPeople(value) {
  return String(value || "")
    .split(/\n|,|;/)
    .map(x => x.trim())
    .filter(Boolean);
}

export function joinPeople(value) {
  return Array.isArray(value) ? value.join("\n") : String(value || "");
}

export function renderPeople(value) {
  const people = Array.isArray(value) ? value : splitPeople(value);
  if (!people.length) return '<span class="pill gray">Tanımlı değil</span>';
  return `<ul class="person-list">${people.map(p => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`;
}

export function assignmentCompleteness(auditId) {
  const audit = getAudit(auditId);
  const assignment = getAssignment(auditId) || {};
  const checks = [
    { ok: !!audit, label: "Denetim kaydı" },
    { ok: !!assignment.leadAuditorName, label: "Heyet başkanı" },
    { ok: splitPeople(joinPeople(assignment.auditorNames)).length > 0, label: "Heyet üyeleri" },
    { ok: audit && (audit.selectedForms || []).length > 0, label: "Kontrol formu" },
    { ok: audit && audit.plannedStartDate && audit.plannedEndDate, label: "Denetim tarihi" },
    { ok: audit && !!audit.location, label: "Denetim yeri" }
  ];
  const done = checks.filter(c => c.ok).length;
  return { done, total: checks.length, checks, percent: Math.round((done / checks.length) * 100) };
}

export function assignmentPill(auditId) {
  const c = assignmentCompleteness(auditId);
  const cls = c.percent === 100 ? "green" : c.percent >= 60 ? "yellow" : "red";
  return `<span class="pill ${cls}">Heyet/Dosya ${c.done}/${c.total}</span>`;
}

export function auditFileOptions(selectedId = "") {
  return state.audits
    .filter(a => !["archived", "cancelled"].includes(a.status))
    .sort((a,b) => String(a.plannedStartDate || "").localeCompare(String(b.plannedStartDate || "")))
    .map(a => `<option value="${escapeHtml(a.auditId)}" ${a.auditId === selectedId ? "selected" : ""}>${escapeHtml(a.auditId)} - ${escapeHtml(a.organizationName || "-")} (${formatDate(a.plannedStartDate)})</option>`)
    .join("");
}

export function ensureAuditFileSelection() {
  const current = state.currentAuditFileId && getAudit(state.currentAuditFileId) ? state.currentAuditFileId : "";
  if (current) return current;
  const first = state.audits.find(a => !["archived", "cancelled"].includes(a.status));
  state.currentAuditFileId = first?.auditId || "";
  if (state.currentAuditFileId) localStorage.setItem("usoap_phase3a_current_audit_file", state.currentAuditFileId);
  return state.currentAuditFileId;
}

export function openAuditFile(auditId) {
  state.currentAuditFileId = auditId || "";
  if (state.currentAuditFileId) localStorage.setItem("usoap_phase3a_current_audit_file", state.currentAuditFileId);
  runtime.showSection("auditFile");
}

export function selectAuditFile(auditId) {
  state.currentAuditFileId = auditId || "";
  if (state.currentAuditFileId) localStorage.setItem("usoap_phase3a_current_audit_file", state.currentAuditFileId);
  renderAuditFile();
}

export function renderTimeline(audit) {
  const items = [
    ["Kuruluş cevap son tarihi", audit.auditeeResponseDueDate],
    ["Ön değerlendirme son tarihi", audit.preEvaluationDueDate],
    ["Denetim başlangıcı", audit.plannedStartDate],
    ["Denetim bitişi", audit.plannedEndDate],
    ["İtiraz son tarihi", audit.objectionDueDate],
    ["Nihai rapor son tarihi", audit.finalReportDueDate],
    ["CAP sunma süresi", audit.capDueDate || `${audit.capDueDays || 45} gün / nihai rapordan sonra`]
  ];
  return `<div class="timeline-list">${items.map(([label, value]) => `<div class="timeline-item"><b>${escapeHtml(label)}</b><span>${escapeHtml(formatDate(value) === "Invalid Date" ? value : formatDate(value))}</span></div>`).join("")}</div>`;
}

export function renderAuditFile() {
  const section = document.getElementById("auditFile");
  if (!section) return;
  const selectedId = ensureAuditFileSelection();
  if (!state.audits.length) {
    section.innerHTML = `<div class="warn-banner">Denetim dosyası oluşturmak için önce yıllık programa bağlı bir denetim kaydı oluşturmalısınız.</div><div class="empty"><button class="btn primary" onclick="showSection('programAddAudit')">Programa Denetim Ekle</button></div>`;
    return;
  }
  const audit = getAudit(selectedId);
  if (!audit) {
    section.innerHTML = `<div class="empty">Seçili denetim bulunamadı.</div>`;
    return;
  }
  const assignment = getAssignment(audit.auditId) || {};
  const program = getProgram(audit.programId);
  const c = assignmentCompleteness(audit.auditId);
  const disabled = canManageAssignments() ? "" : "disabled";
  const readonlyNote = canManageAssignments() ? "" : `<div class="readonly-note">Bu rolde heyet bilgileri salt okunur gösterilir. Kaydetme yetkisi Yönetici, Program Yöneticisi ve Baş Denetçi rollerindedir.</div>`;
  const next = runtime.nextActionForAudit?.(audit);
  section.innerHTML = `
    <div class="info-banner"><strong>Faz 3B:</strong> Denetim dosyası, planlı denetimin operasyonel hazırlık kaydıdır. Bu ekranda denetim bilgileri, seçili kontrol formları, kritik tarihler ve heyet/görev atamaları birlikte yönetilir.</div>
    <div class="toolbar">
      <div class="field" style="min-width:280px"><label>Denetim Dosyası Seç</label><select id="auditFileSelect" onchange="selectAuditFile(this.value)">${auditFileOptions(audit.auditId)}</select></div>
      <button class="btn" onclick="showAuditDetails('${audit.auditId}')">Detay Modalı</button>
      <button class="btn" onclick="editAudit('${audit.auditId}')">Plan Bilgilerini Düzenle</button>
      <button class="btn primary" onclick="showSection('plannedAudits')">Denetim Listesine Dön</button>
    </div>
    <div class="summary-strip">
      <div class="mini-stat"><strong>${escapeHtml(audit.auditId)}</strong><span>Denetim ID</span></div>
      <div class="mini-stat"><strong>${escapeHtml(AUDIT_STATUS[audit.status] || audit.status || "-")}</strong><span>Durum</span></div>
      <div class="mini-stat"><strong>${c.done}/${c.total}</strong><span>Dosya hazırlık kontrolü</span></div>
      <div class="mini-stat"><strong>${escapeHtml((audit.selectedForms || []).join(", ") || "-")}</strong><span>Kontrol formları</span></div>
    </div>
    <div class="grid">
      <div class="card span-6"><h3>Denetim Bilgileri</h3><div class="detail-grid"><div class="detail-box"><b>Program</b>${escapeHtml(audit.programId || "-")}<br><small>${escapeHtml(program?.name || "")}</small></div><div class="detail-box"><b>Kuruluş</b>${escapeHtml(audit.organizationName || "-")}<br><small>${escapeHtml(audit.organizationId || "-")}</small></div><div class="detail-box"><b>Tarih / Yer</b>${formatDate(audit.plannedStartDate)} - ${formatDate(audit.plannedEndDate)}<br>${escapeHtml(audit.location || "-")}</div><div class="detail-box"><b>Yöntem / Şekil</b>${escapeHtml(AUDIT_METHOD_LABELS[audit.auditMethod] || audit.auditMethod || "-")}<br>${escapeHtml(AUDIT_TYPE_LABELS[audit.auditType] || audit.auditType || "-")}</div><div class="detail-box"><b>Görev Unvanları</b>${escapeHtml((audit.requiredTitles || []).join(", ") || "-")}</div><div class="detail-box"><b>Risk / Öncelik</b>${escapeHtml(audit.riskPriorityLevel || "-")}<br>${escapeHtml(audit.riskPriorityNote || "")}</div></div></div>
      <div class="card span-6"><h3>Kritik Tarihler</h3>${renderTimeline(audit)}</div>
      <div class="card span-12"><h3>Seçili Kontrol Formları ve Revizyonları</h3><div>${(audit.selectedForms || []).map(area => `<span class="pill blue">${area}</span><span class="pill gray">${escapeHtml(audit.selectedFormRevisions?.[area] || `${area}-REV-JSON-CURRENT`)}</span>`).join(" ") || "-"}</div></div>
    </div>
    <div class="assignment-panel" style="margin-top:14px">
      <div class="card"><h3>Heyet Atama</h3>${readonlyNote}<div class="form-grid">
        <div class="field full"><label>Heyet Başkanı</label><input id="assignLeadAuditor" ${disabled} placeholder="Ad Soyad / unvan" value="${escapeHtml(assignment.leadAuditorName || "")}"></div>
        <div class="field full"><label>Denetçiler / Heyet Üyeleri</label><textarea id="assignAuditors" ${disabled} placeholder="Her satıra bir kişi yazın">${escapeHtml(joinPeople(assignment.auditorNames))}</textarea></div>
        <div class="field full"><label>Teknik Uzmanlar</label><textarea id="assignExperts" ${disabled} placeholder="Opsiyonel; her satıra bir kişi">${escapeHtml(joinPeople(assignment.technicalExpertNames))}</textarea></div>
        <div class="field full"><label>Gözlemciler</label><textarea id="assignObservers" ${disabled} placeholder="Opsiyonel; her satıra bir kişi">${escapeHtml(joinPeople(assignment.observerNames))}</textarea></div>
        <div class="field full"><label>Denetlenen Kuruluş Temsilcileri</label><textarea id="assignAuditeeReps" ${disabled} placeholder="Kuruluş temsilcileri / muhatap kişiler">${escapeHtml(joinPeople(assignment.auditeeRepresentativeNames))}</textarea></div>
      </div></div>
      <div class="card"><h3>Görev Dağılımı ve Hazırlık Notları</h3><div class="form-grid">
        <div class="field full"><label>Görev Dağılımı / Sorumluluk Notu</label><textarea id="assignWorkDistribution" ${disabled} placeholder="Örn: AGA soruları X, doküman inceleme Y, koordinasyon Z...">${escapeHtml(assignment.workDistributionNote || "")}</textarea></div>
        <div class="field full"><label>Açılış / Kapanış Toplantısı Hazırlık Notu</label><textarea id="assignMeetingNote" ${disabled} placeholder="Toplantı gündemi, katılımcılar, özel hususlar...">${escapeHtml(assignment.meetingPreparationNote || "")}</textarea></div>
        <div class="field full"><label>İletişim ve Erişim Notu</label><textarea id="assignAccessNote" ${disabled} placeholder="Gizlilik, erişim, saha giriş, uzaktan bağlantı vb.">${escapeHtml(assignment.communicationAccessNote || "")}</textarea></div>
      </div></div>
    </div>
    <div class="card" style="margin-top:14px"><h3>Dosya Hazırlık Kontrolü</h3><div class="phase3-status">${c.checks.map(item => `<span class="pill ${item.ok ? "green" : "red"}">${item.ok ? "✓" : "!"} ${escapeHtml(item.label)}</span>`).join("")}</div><div class="progress-line" style="margin-top:10px"><span style="width:${c.percent}%"></span></div><p>${c.percent === 100 ? "Denetim dosyası Faz 3A/3B açısından hazır görünüyor." : "Eksik alanlar tamamlandığında denetim hazırlık dosyası tamamlanmış sayılır."}</p></div>
    ${canManageAssignments() ? `<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn success" onclick="saveAuditAssignment('${audit.auditId}')">Heyet ve Dosya Notlarını Kaydet</button><button class="btn" onclick="renderAuditFile()">Değişiklikleri Geri Al</button>${next ? `<button class="btn primary" onclick="advanceAudit('${audit.auditId}','${next.status}')">${escapeHtml(next.label)}</button>` : ""}</div>` : ""}
  `;
}

export async function saveAuditAssignment(auditId) {
  const audit = getAudit(auditId);
  if (!audit) return alert("Denetim bulunamadı.");
  if (!canManageAssignments()) return alert("Bu işlem için yetkiniz yok.");
  const lead = document.getElementById("assignLeadAuditor")?.value.trim() || "";
  const auditors = splitPeople(document.getElementById("assignAuditors")?.value || "");
  if (!lead) return alert("Heyet başkanı girin.");
  if (!auditors.length) return alert("En az bir heyet üyesi/denetçi girin.");
  const assignmentId = `ASSIGN-${auditId}`;
  const existing = getAssignment(auditId) || {};
  const data = {
    ...existing,
    assignmentId,
    auditId,
    organizationId: audit.organizationId || "",
    leadAuditorName: lead,
    auditorNames: auditors,
    technicalExpertNames: splitPeople(document.getElementById("assignExperts")?.value || ""),
    observerNames: splitPeople(document.getElementById("assignObservers")?.value || ""),
    auditeeRepresentativeNames: splitPeople(document.getElementById("assignAuditeeReps")?.value || ""),
    workDistributionNote: document.getElementById("assignWorkDistribution")?.value.trim() || "",
    meetingPreparationNote: document.getElementById("assignMeetingNote")?.value.trim() || "",
    communicationAccessNote: document.getElementById("assignAccessNote")?.value.trim() || "",
    updatedByRole: state.role,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await runtime.saveRecord(COLLECTIONS.auditAssignments, assignmentId, data);
  await runtime.loadData();
  runtime.renderAll();
  state.currentAuditFileId = auditId;
  localStorage.setItem("usoap_phase3a_current_audit_file", auditId);
  alert("Denetim heyeti ve dosya notları kaydedildi.");
  runtime.showSection("auditFile");
}

export function assignmentSummaryHtml(auditId) {
  const a = getAssignment(auditId) || {};
  const c = assignmentCompleteness(auditId);
  return `<div class="detail-grid"><div class="detail-box"><b>Hazırlık Durumu</b>${assignmentPill(auditId)}</div><div class="detail-box"><b>Heyet Başkanı</b>${escapeHtml(a.leadAuditorName || "-")}</div><div class="detail-box"><b>Heyet Üyeleri</b>${renderPeople(a.auditorNames)}</div><div class="detail-box"><b>Teknik Uzmanlar</b>${renderPeople(a.technicalExpertNames)}</div><div class="detail-box"><b>Gözlemciler</b>${renderPeople(a.observerNames)}</div><div class="detail-box"><b>Kuruluş Temsilcileri</b>${renderPeople(a.auditeeRepresentativeNames)}</div><div class="detail-box"><b>Görev Dağılımı</b>${escapeHtml(a.workDistributionNote || "-")}</div><div class="detail-box"><b>İletişim/Erişim</b>${escapeHtml(a.communicationAccessNote || "-")}</div></div>`;
}

register("getAssignment", getAssignment);
register("assignmentPill", assignmentPill);
register("assignmentSummaryHtml", assignmentSummaryHtml);
register("renderAuditFile", renderAuditFile);
expose("openAuditFile", openAuditFile);
expose("selectAuditFile", selectAuditFile);
expose("renderAuditFile", renderAuditFile);
expose("saveAuditAssignment", saveAuditAssignment);
