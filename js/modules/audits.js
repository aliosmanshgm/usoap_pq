import {
  COLLECTIONS, AREA_ORDER, AREA_LABELS, AUDIT_STATUS,
  AUDIT_METHOD_LABELS, AUDIT_TYPE_LABELS, ROLES
} from "../config.js";
import { state } from "../state.js";
import { escapeHtml, today, addDays, uid, daysBetween, formatDate } from "../utils.js";
import { getProgram, getAudit } from "../selectors.js";
import { runtime, register, expose } from "../runtime.js";

export function auditMethodLabel(value) {
  return { onsite: "Yerinde", remote: "Uzaktan", hybrid: "Hibrit" }[value] || value || "-";
}

export function auditTypeLabel(value) {
  return {
    planned_announced: "Planlı / Haberli",
    planned_unannounced: "Planlı / Habersiz",
    unplanned_announced: "Plansız / Haberli",
    unplanned_unannounced: "Plansız / Habersiz"
  }[value] || value || "-";
}

export function criticalDateForAudit(audit) {
  const candidates = [
    { key: "auditeeResponseDueDate", label: "Kuruluş cevap son tarihi", date: audit.auditeeResponseDueDate, statuses: ["planned", "waiting_auditee_response"] },
    { key: "preEvaluationDueDate", label: "Ön değerlendirme son tarihi", date: audit.preEvaluationDueDate, statuses: ["waiting_auditee_response", "pre_evaluation"] },
    { key: "plannedStartDate", label: "Denetim başlangıcı", date: audit.plannedStartDate, statuses: ["planned", "pre_evaluation"] },
    { key: "plannedEndDate", label: "Denetim bitişi", date: audit.plannedEndDate, statuses: ["audit_in_progress"] },
    { key: "objectionDueDate", label: "İtiraz son tarihi", date: audit.objectionDueDate, statuses: ["objection_period"] },
    { key: "finalReportDueDate", label: "Nihai rapor son tarihi", date: audit.finalReportDueDate, statuses: ["final_report_preparation"] },
    { key: "capDueDate", label: "CAP sunma son tarihi", date: audit.capDueDate, statuses: ["cap_waiting"] }
  ];
  return candidates.find(c => c.statuses.includes(audit.status) && c.date) || candidates.find(c => c.date) || null;
}

export function prefillAuditProgram(programId) {
  state.editAuditId = null;
  runtime.showSection("programAddAudit");
  setTimeout(() => {
    const sel = document.getElementById("auditProgramSelect");
    if (sel) sel.value = programId;
    updateAuditDuePreview();
  }, 50);
}

export function renderProgramAddAudit() {
  const edit = state.editAuditId ? getAudit(state.editAuditId) : null;
  const isEdit = Boolean(edit);
  const programOptions = state.auditPrograms.filter(p => p.status !== "archived").map(p => `<option value="${p.programId}" ${p.programId === edit?.programId ? "selected" : ""}>${p.programId} - ${p.name}</option>`).join("");
  const formChecks = AREA_ORDER.map(area => `<label class="check-tile"><input type="checkbox" name="auditForms" value="${area}" ${(edit?.selectedForms || []).includes(area) ? "checked" : ""}> ${area}<small>${AREA_LABELS[area]}</small></label>`).join("");
  const el = document.getElementById("programAddAudit");
  if (!el) return;
  el.innerHTML = `
    ${state.auditPrograms.length ? "" : `<div class="warn-banner">Programa denetim eklemek için önce yıllık program oluşturmalısınız.</div>`}
    <div class="card"><h3>${isEdit ? "Planlı Denetimi Düzenle" : "Programa Denetim Ekle"}</h3>
      <div class="form-grid">
        <div class="field"><label>Yıllık Program</label><select id="auditProgramSelect" onchange="updateAuditDuePreview()">${programOptions}</select></div>
        <div class="field"><label>Kuruluş / İşletme</label><input id="auditOrgName" placeholder="Denetlenecek kuruluş adı" value="${escapeHtml(edit?.organizationName || "")}"></div>
        <div class="field"><label>Kuruluş ID</label><input id="auditOrgId" placeholder="Otomatik üretilir veya mevcut ID" value="${escapeHtml(edit?.organizationId || "")}"></div>
        <div class="field"><label>Planlı Başlangıç</label><input id="auditStart" type="date" value="${escapeHtml(edit?.plannedStartDate || "")}" onchange="updateAuditDuePreview()"></div>
        <div class="field"><label>Planlı Bitiş</label><input id="auditEnd" type="date" value="${escapeHtml(edit?.plannedEndDate || "")}" onchange="updateAuditDuePreview()"></div>
        <div class="field"><label>Denetim Yeri</label><input id="auditLocation" placeholder="Yer / tesis / şehir" value="${escapeHtml(edit?.location || "")}"></div>
        <div class="field"><label>Denetim Yöntemi</label><select id="auditMethod">${Object.entries(AUDIT_METHOD_LABELS).map(([k,v]) => `<option value="${k}" ${k === (edit?.auditMethod || "onsite") ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="field"><label>Denetim Şekli</label><select id="auditType">${Object.entries(AUDIT_TYPE_LABELS).map(([k,v]) => `<option value="${k}" ${k === (edit?.auditType || "planned_announced") ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="field"><label>Kuruluş Ön Cevap Son Tarihi</label><input id="auditeeResponseDueDate" type="date" value="${escapeHtml(edit?.auditeeResponseDueDate || "")}"></div>
        <div class="field"><label>Risk / Öncelik Seviyesi</label><select id="riskPriorityLevel"><option value="normal" ${edit?.riskPriorityLevel === "normal" ? "selected" : ""}>Normal</option><option value="high" ${edit?.riskPriorityLevel === "high" ? "selected" : ""}>Yüksek</option><option value="critical" ${edit?.riskPriorityLevel === "critical" ? "selected" : ""}>Kritik</option></select></div>
        <div class="field"><label>Görev Unvanları</label><input id="requiredTitles" value="${escapeHtml((edit?.requiredTitles || []).join(", "))}" placeholder="Virgülle ayırın: Baş denetçi, Denetçi, Teknik uzman"></div>
        <div class="field full"><label>Kontrol Formları</label><div class="checkbox-grid">${formChecks}</div></div>
        <div class="field full"><label>Denetim Amacı</label><textarea id="auditObjectives">${escapeHtml(edit?.objectives || "")}</textarea></div>
        <div class="field full"><label>Denetim Kapsamı</label><textarea id="auditScope">${escapeHtml(edit?.scope || "")}</textarea></div>
        <div class="field full"><label>Denetim Kriterleri</label><textarea id="auditCriteria">${escapeHtml(edit?.criteria || "")}</textarea></div>
        <div class="field full"><label>Risk / Öncelik Notu</label><textarea id="auditRisk">${escapeHtml(edit?.riskPriorityNote || "")}</textarea></div>
      </div>
      <div id="auditDuePreview" style="margin-top:12px"></div>
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn success" onclick="savePlannedAudit()">${isEdit ? "Denetimi Güncelle" : "Planlı Denetimi Kaydet"}</button><button class="btn" onclick="checkAllAuditForms(true)">Tüm Formları Seç</button><button class="btn" onclick="checkAllAuditForms(false)">Temizle</button><button class="btn" onclick="newPlannedAudit()">Yeni Form Aç</button><button class="btn" onclick="showSection('plannedAudits')">Planlı Denetimleri Gör</button></div>
    </div>`;
  updateAuditDuePreview();
}

export function updateAuditDuePreview() {
  const start = document.getElementById("auditStart")?.value || "";
  const end = document.getElementById("auditEnd")?.value || "";
  const responseEl = document.getElementById("auditeeResponseDueDate");
  if (responseEl && start && !responseEl.value) responseEl.value = addDays(start, -7);
  const preview = document.getElementById("auditDuePreview");
  if (!preview) return;
  preview.innerHTML = `<div class="summary-strip"><div class="mini-stat"><strong>${formatDate(responseEl?.value || (start ? addDays(start, -7) : ""))}</strong><span>Kuruluş cevap son tarihi</span></div><div class="mini-stat"><strong>${formatDate(start ? addDays(start, -1) : "")}</strong><span>Ön değerlendirme son tarihi</span></div><div class="mini-stat"><strong>${formatDate(end ? addDays(end, 2) : "")}</strong><span>İtiraz son tarihi</span></div><div class="mini-stat"><strong>${formatDate(end ? addDays(end, 15) : "")}</strong><span>Nihai rapor son tarihi</span></div><div class="mini-stat"><strong>45 gün</strong><span>CAP sunma süresi</span></div></div>`;
}

export function checkAllAuditForms(checked) {
  document.querySelectorAll("input[name='auditForms']").forEach(cb => cb.checked = checked);
}

export function newPlannedAudit() {
  state.editAuditId = null;
  renderProgramAddAudit();
}

export function editAudit(auditId) {
  state.editAuditId = auditId;
  runtime.showSection("programAddAudit");
}

export async function savePlannedAudit() {
  const programId = document.getElementById("auditProgramSelect").value;
  if (!programId) return alert("Yıllık program seçin.");
  const program = getProgram(programId);
  if (!program) return alert("Seçilen program bulunamadı.");
  const orgName = document.getElementById("auditOrgName").value.trim();
  if (!orgName) return alert("Kuruluş / işletme adı girin.");
  const selectedForms = [...document.querySelectorAll("input[name='auditForms']:checked")].map(cb => cb.value);
  if (!selectedForms.length) return alert("En az bir kontrol formu seçin.");
  const start = document.getElementById("auditStart").value;
  const end = document.getElementById("auditEnd").value;
  if (!start || !end) return alert("Planlı başlangıç ve bitiş tarihlerini girin.");
  if (new Date(end) < new Date(start)) return alert("Planlı bitiş tarihi başlangıç tarihinden önce olamaz.");
  const generatedOrgId = `org_${orgName.toLowerCase().replace(/[^a-z0-9ğüşöçıİĞÜŞÖÇ]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "demo"}`;
  const orgId = document.getElementById("auditOrgId").value.trim() || generatedOrgId;
  const existing = state.editAuditId ? getAudit(state.editAuditId) : null;
  const auditId = existing?.auditId || uid(`AUDIT-${new Date(start).getFullYear()}`);
  const selectedFormRevisions = {};
  selectedForms.forEach(area => {
    const rev = state.formRevisions.find(r => r.formId === area && r.status === "active");
    selectedFormRevisions[area] = rev?.revisionId || `${area}-REV-JSON-CURRENT`;
  });
  await runtime.saveRecord(COLLECTIONS.organizations, orgId, { organizationId: orgId, name: orgName, type: "Kuruluş", active: true, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() });
  const data = {
    ...(existing || {}),
    auditId,
    programId,
    organizationId: orgId,
    organizationName: orgName,
    selectedForms,
    selectedFormRevisions,
    auditType: document.getElementById("auditType").value,
    auditMethod: document.getElementById("auditMethod").value,
    plannedStartDate: start,
    plannedEndDate: end,
    location: document.getElementById("auditLocation").value.trim(),
    requiredTitles: document.getElementById("requiredTitles").value.split(",").map(x => x.trim()).filter(Boolean),
    objectives: document.getElementById("auditObjectives").value.trim(),
    scope: document.getElementById("auditScope").value.trim(),
    criteria: document.getElementById("auditCriteria").value.trim(),
    riskPriorityNote: document.getElementById("auditRisk").value.trim(),
    riskPriorityLevel: document.getElementById("riskPriorityLevel").value,
    status: existing?.status || "planned",
    auditeeResponseDueDate: document.getElementById("auditeeResponseDueDate").value || addDays(start, -7),
    preEvaluationDueDate: addDays(start, -1),
    objectionDueDate: addDays(end, 2),
    finalReportDueDate: addDays(end, 15),
    capDueDays: 45,
    capDueDate: existing?.capDueDate || "",
    objectionStatus: existing?.objectionStatus || "waiting",
    createdBy: existing?.createdBy || state.role,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await runtime.saveRecord(COLLECTIONS.audits, auditId, data);
  state.editAuditId = null;
  await runtime.loadData();
  runtime.renderAll();
  alert("Planlı denetim kaydedildi.");
  runtime.showSection("plannedAudits");
}

export function rerenderCurrentAuditList() {
  const cfg = {
    plannedAudits: [["planned", "programmed"], "Planlı Denetimler", "Programa alınmış veya planlanmış denetimler."],
    waitingAuditeeResponse: [["waiting_auditee_response"], "Cevap Bekleyen Denetimler", "Kuruluşa ön cevap süresi verilmiş denetimler."],
    preEvaluation: [["pre_evaluation"], "Ön Değerlendirme", "Denetim heyetinin planlı denetim tarihinden bir gün öncesine kadar ön değerlendirme yapacağı kayıtlar."],
    activeAudits: [["audit_in_progress"], "Aktif Denetimler", "Denetim tarihleri içinde sahada/uzaktan yürütülen denetimler."],
    objectionAudits: [["objection_period"], "İtiraz Sürecindeki Denetimler", "Denetim bitişinden itibaren 2 günlük itiraz süreci."],
    finalReportAudits: [["final_report_preparation", "final_report_sent", "cap_waiting"], "Nihai Rapor Bekleyenler", "Denetim bitişinden itibaren 15 gün içinde nihai rapor hazırlanır/gönderilir; gönderim sonrası CAP süresi başlar."]
  };
  const item = cfg[state.currentSection];
  if (item) renderAuditList(state.currentSection, item[0], item[1], item[2]);
  else runtime.renderAll();
}

export function setAuditFilter(key, value) {
  state.auditFilters[key] = value;
  rerenderCurrentAuditList();
}

export function resetAuditFilters() {
  state.auditFilters = { search: "", programId: "all", method: "all", type: "all", dateFrom: "", dateTo: "" };
  rerenderCurrentAuditList();
}

export function applyAuditFilters(rows) {
  const f = state.auditFilters;
  return rows.filter(a => {
    if (f.programId !== "all" && a.programId !== f.programId) return false;
    if (f.method !== "all" && a.auditMethod !== f.method) return false;
    if (f.type !== "all" && a.auditType !== f.type) return false;
    if (f.dateFrom && (!a.plannedEndDate || a.plannedEndDate < f.dateFrom)) return false;
    if (f.dateTo && (!a.plannedStartDate || a.plannedStartDate > f.dateTo)) return false;
    if (f.search) {
      const haystack = [a.auditId, a.programId, a.organizationName, a.organizationId, a.location, a.scope, a.objectives, a.criteria, (a.selectedForms || []).join(" "), (a.requiredTitles || []).join(" ")].join(" ").toLowerCase();
      if (!haystack.includes(f.search.toLowerCase())) return false;
    }
    return true;
  }).sort((a,b) => String(a.plannedStartDate || "").localeCompare(String(b.plannedStartDate || "")));
}

export function auditFilterToolbar() {
  const programOptions = state.auditPrograms.map(p => `<option value="${p.programId}" ${state.auditFilters.programId === p.programId ? "selected" : ""}>${p.programId}</option>`).join("");
  return `<div class="toolbar"><div class="field"><label>Arama</label><input type="search" value="${escapeHtml(state.auditFilters.search)}" placeholder="Denetim, kuruluş, yer, form..." onchange="setAuditFilter('search', this.value)"></div><div class="field"><label>Program</label><select onchange="setAuditFilter('programId', this.value)"><option value="all">Tümü</option>${programOptions}</select></div><div class="field"><label>Yöntem</label><select onchange="setAuditFilter('method', this.value)"><option value="all">Tümü</option>${Object.entries(AUDIT_METHOD_LABELS).map(([k,v]) => `<option value="${k}" ${state.auditFilters.method === k ? "selected" : ""}>${v}</option>`).join("")}</select></div><div class="field"><label>Şekil</label><select onchange="setAuditFilter('type', this.value)"><option value="all">Tümü</option>${Object.entries(AUDIT_TYPE_LABELS).map(([k,v]) => `<option value="${k}" ${state.auditFilters.type === k ? "selected" : ""}>${v}</option>`).join("")}</select></div><div class="field"><label>Başlangıçtan</label><input type="date" value="${escapeHtml(state.auditFilters.dateFrom)}" onchange="setAuditFilter('dateFrom', this.value)"></div><div class="field"><label>Bitişe kadar</label><input type="date" value="${escapeHtml(state.auditFilters.dateTo)}" onchange="setAuditFilter('dateTo', this.value)"></div><button class="btn" onclick="resetAuditFilters()">Temizle</button><button class="btn primary" onclick="showSection('programAddAudit')">Denetim Ekle</button></div>`;
}

export function renderAuditList(sectionId, statuses, title, subtitle) {
  const baseRowsAll = state.audits.filter(a => statuses.includes(a.status));
  const baseRows = runtime.visibleAuditsForCurrentUser ? runtime.visibleAuditsForCurrentUser(baseRowsAll) : baseRowsAll;
  const rows = applyAuditFilters(baseRows);
  const dueSoon = rows.filter(a => { const d = daysBetween(nextCriticalDate(a)); return d !== null && d >= 0 && d <= 7; }).length;
  const overdue = rows.filter(a => { const d = daysBetween(nextCriticalDate(a)); return d !== null && d < 0; }).length;
  const roleNote = runtime.isAuthLocked?.() ? `<div class="auth-lock-note">Bu liste kullanıcı profilinize göre filtrelenmiştir. Rol: <strong>${escapeHtml(ROLES[state.role] || state.role)}</strong>${state.role === "auditee" ? ` | Kuruluş: <strong>${escapeHtml(state.orgContext)}</strong>` : ""}</div>` : "";
  const el = document.getElementById(sectionId);
  if (!el) return;
  el.innerHTML = `${roleNote}<div class="info-banner"><strong>${escapeHtml(title)}:</strong> ${escapeHtml(subtitle)}</div><div class="summary-strip"><div class="mini-stat"><strong>${baseRows.length}</strong><span>Yetkili kayıt</span></div><div class="mini-stat"><strong>${rows.length}</strong><span>Filtre sonrası</span></div><div class="mini-stat"><strong>${dueSoon}</strong><span>7 gün içinde kritik</span></div><div class="mini-stat"><strong>${overdue}</strong><span>Geciken kritik tarih</span></div></div>${auditFilterToolbar()}<div class="list">${rows.map(renderAuditCard).join("") || `<div class="empty">Bu statüde veya filtreye uygun denetim kaydı bulunmuyor.</div>`}</div>`;
}

export function statusPill(status) {
  const cls = status === "closed" ? "green" : status === "archived" ? "gray" : String(status).includes("cap") ? "purple" : String(status).includes("objection") ? "yellow" : "blue";
  return `<span class="pill ${cls}">${escapeHtml(AUDIT_STATUS[status] || status)}</span>`;
}

export function nextCriticalDate(audit) {
  const map = {
    planned: audit.auditeeResponseDueDate,
    programmed: audit.plannedStartDate,
    waiting_auditee_response: audit.auditeeResponseDueDate,
    pre_evaluation: audit.preEvaluationDueDate,
    audit_in_progress: audit.plannedEndDate,
    objection_period: audit.objectionDueDate,
    final_report_preparation: audit.finalReportDueDate,
    final_report_sent: audit.capDueDate,
    cap_waiting: audit.capDueDate,
    cap_under_review: audit.capDueDate,
    cap_monitoring: audit.capDueDate
  };
  return map[audit.status] || audit.plannedStartDate || audit.finalReportDueDate || "";
}

export function criticalDateText(audit) {
  if (runtime.deadlineBadge) return runtime.deadlineBadge(nextCriticalDate(audit));
  const date = nextCriticalDate(audit);
  const d = daysBetween(date);
  const label = d === null ? "-" : d < 0 ? `${Math.abs(d)} gün gecikti` : d === 0 ? "Bugün" : `${d} gün kaldı`;
  const cls = d !== null && d < 0 ? "red" : d !== null && d <= 7 ? "yellow" : "gray";
  return `<span class="pill ${cls}">${formatDate(date)} / ${label}</span>`;
}

export function renderAuditCard(audit) {
  const next = nextActionForAudit(audit);
  const method = AUDIT_METHOD_LABELS[audit.auditMethod] || audit.auditMethod || "-";
  const type = AUDIT_TYPE_LABELS[audit.auditType] || audit.auditType || "-";
  const isAuditee = state.role === "auditee";
  const canEditPlan = ["admin","program_manager"].includes(state.role);
  const canAdvance = ["admin","program_manager","lead_auditor"].includes(state.role);
  const auditeeActions = `<button class="btn" onclick="showAuditDetails('${audit.auditId}')">Detay</button><button class="btn primary" onclick="openAuditeeResponse('${audit.auditId}')">Ön Cevaplar</button>${audit.status === "objection_period" ? `<button class="btn warning" onclick="openObjectionProcess('${audit.auditId}')">İtiraz Bildirimi</button>` : ""}${["cap_waiting","cap_under_review","cap_monitoring"].includes(audit.status) ? `<button class="btn" onclick="showSection('auditeeCap')">CAP Girişi</button>` : ""}`;
  const staffActions = `<button class="btn" onclick="showAuditDetails('${audit.auditId}')">Detay</button><button class="btn" onclick="openAuditFile('${audit.auditId}')">Denetim Dosyası</button><button class="btn" onclick="openAuditeeResponse('${audit.auditId}')">Kuruluş Cevapları</button><button class="btn" onclick="openPreEvaluation('${audit.auditId}')">Ön Değerlendirme</button><button class="btn" onclick="openAuditExecution('${audit.auditId}')">Denetim Çalışması</button>${["objection_period","final_report_preparation"].includes(audit.status) ? `<button class="btn warning" onclick="openObjectionProcess('${audit.auditId}')">İtiraz Süreci</button>` : ""}${["final_report_preparation","final_report_sent","cap_waiting","cap_under_review","cap_monitoring","closed"].includes(audit.status) ? `<button class="btn success" onclick="openFinalReport('${audit.auditId}')">Nihai Rapor</button>` : ""}${canEditPlan ? `<button class="btn" onclick="editAudit('${audit.auditId}')">Düzenle</button>` : ""}${next && canAdvance ? `<button class="btn primary" onclick="advanceAudit('${audit.auditId}','${next.status}')">${escapeHtml(next.label)}</button>` : ""}${canEditPlan ? `<button class="btn warning" onclick="archiveAudit('${audit.auditId}')">Arşivle</button>` : ""}`;
  return `<div class="audit-card">
    <div><h4>${escapeHtml(audit.organizationName || "-")}</h4><div class="audit-meta"><strong>${escapeHtml(audit.auditId)}</strong> | ${escapeHtml(audit.programId || "-")}<br><strong>Kuruluş ID:</strong> ${escapeHtml(audit.organizationId || "-")}<br>${formatDate(audit.plannedStartDate)} → ${formatDate(audit.plannedEndDate)} | ${escapeHtml(audit.location || "-")}<br>${escapeHtml(method)} | ${escapeHtml(type)}</div></div>
    <div><div>${statusPill(audit.status || "draft")} ${audit.riskPriorityLevel ? `<span class="pill ${audit.riskPriorityLevel === "critical" ? "red" : audit.riskPriorityLevel === "high" ? "yellow" : "gray"}">${escapeHtml(audit.riskPriorityLevel)}</span>` : ""}</div><div style="margin-top:6px">${(audit.selectedForms || []).map(a => `<span class="pill gray">${a}</span>`).join("")} ${runtime.assignmentPill?.(audit.auditId) || ""}</div><div class="status-ribbon">${runtime.orgResponsePill?.(audit.auditId) || ""}${runtime.preEvalPill?.(audit.auditId) || ""}${runtime.auditResponsePill?.(audit.auditId) || ""}</div><div class="audit-meta" style="margin-top:6px">Kritik tarih: ${criticalDateText(audit)}</div></div>
    <div class="audit-actions">${isAuditee ? auditeeActions : staffActions}</div>
  </div>`;
}

export function nextActionForAudit(audit) {
  const map = {
    planned: { status: "waiting_auditee_response", label: "Cevap Sürecine Al" },
    programmed: { status: "planned", label: "Planlandı Yap" },
    waiting_auditee_response: { status: "pre_evaluation", label: "Ön Değerlendirmeye Al" },
    pre_evaluation: { status: "audit_in_progress", label: "Denetimi Başlat" },
    audit_in_progress: { status: "objection_period", label: "İtiraz Sürecine Al" },
    objection_period: { status: "final_report_preparation", label: "Rapor Hazırlığa Al" },
    final_report_preparation: { status: "final_report_sent", label: "Nihai Rapor Gönderildi" },
    final_report_sent: { status: "cap_waiting", label: "CAP Bekleniyor" }
  };
  return map[audit.status];
}

export async function advanceAudit(auditId, status) {
  const audit = getAudit(auditId);
  if (!audit) return;
  if (status === "objection_period") {
    const response = runtime.getAuditResponse?.(auditId);
    if (!response || response.status !== "completed") return alert("İtiraz sürecine geçmeden önce Denetim Çalışması ekranında tüm PQ cevaplarını tamamlayın.");
  }
  if (status === "final_report_preparation") {
    const objection = runtime.getObjection?.(auditId);
    if (!objection && daysBetween(audit.objectionDueDate) < 0) await runtime.createAutoNoObjection?.(audit);
    if (!objection && daysBetween(audit.objectionDueDate) >= 0 && !confirm("İtiraz süresi henüz tamamlanmadı ve kuruluş bildirimi yok. Yine de rapor hazırlık aşamasına geçilsin mi?")) return;
  }
  const patch = { status };
  if (status === "waiting_auditee_response") patch.auditeeResponseStartedAt = new Date().toISOString();
  if (status === "pre_evaluation") patch.preEvaluationStartedAt = new Date().toISOString();
  if (status === "audit_in_progress") patch.auditStartedAt = new Date().toISOString();
  if (status === "objection_period") patch.objectionStartedAt = new Date().toISOString();
  if (status === "final_report_preparation") patch.finalReportPreparationStartedAt = new Date().toISOString();
  if (status === "final_report_sent") {
    patch.finalReportSentDate = today();
    patch.capDueDate = addDays(today(), 45);
  }
  if (status === "cap_waiting" && !audit.capDueDate) patch.capDueDate = addDays(audit.finalReportSentDate || today(), 45);
  if (status === "closed") patch.closedAt = new Date().toISOString();
  await runtime.updateRecord(COLLECTIONS.audits, auditId, patch);
  if (status === "final_report_sent") {
    const reportId = `REPORT-${auditId}`;
    const existingReport = runtime.getReport?.(auditId) || {};
    const findings = runtime.auditFindings?.(auditId) || [];
    await runtime.saveRecord(COLLECTIONS.reports, reportId, {
      ...existingReport,
      reportId,
      reportType: "final",
      auditId,
      organizationId: audit.organizationId,
      organizationName: audit.organizationName,
      status: "sent",
      summaryText: existingReport.summaryText || runtime.reportDefaultSummary?.(audit, findings) || "",
      conclusionText: existingReport.conclusionText || "NS bulgular için nihai rapor gönderiminden itibaren 45 gün içinde CAP hazırlanması beklenir.",
      distributionNote: existingReport.distributionNote || "",
      findingIds: findings.map(f => f.findingId || f.id),
      sentAt: new Date().toISOString(),
      createdAt: existingReport.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    await runtime.finalizeReportAndStartCap?.(audit, new Date().toISOString());
  }
  await runtime.loadData();
  runtime.renderAll();
  runtime.showSection(state.currentSection);
}

export async function archiveAudit(auditId) {
  if (!confirm("Denetim arşivlensin mi?")) return;
  await runtime.updateRecord(COLLECTIONS.audits, auditId, { status: "archived", archivedAt: new Date().toISOString() });
  await runtime.loadData();
  runtime.renderAll();
  runtime.showSection(state.currentSection);
}

export function showAuditDetails(auditId) {
  const a = getAudit(auditId);
  if (!a) return;
  const p = getProgram(a.programId);
  runtime.showModal(`Denetim Detayı - ${escapeHtml(a.auditId)}`, `<div class="detail-grid"><div class="detail-box"><b>Program</b>${escapeHtml(a.programId || "-")}<br>${escapeHtml(p?.name || "")}</div><div class="detail-box"><b>Kuruluş</b>${escapeHtml(a.organizationName || "-")}<br><small>${escapeHtml(a.organizationId || "-")}</small></div><div class="detail-box"><b>Durum</b>${statusPill(a.status || "planned")}</div><div class="detail-box"><b>Dosya/Hazırlık</b>${runtime.assignmentPill?.(a.auditId) || ""}</div><div class="detail-box"><b>Denetim Şekli/Yöntemi</b>${escapeHtml(AUDIT_TYPE_LABELS[a.auditType] || a.auditType || "-")}<br>${escapeHtml(AUDIT_METHOD_LABELS[a.auditMethod] || a.auditMethod || "-")}</div><div class="detail-box"><b>Tarih/Yer</b>${formatDate(a.plannedStartDate)} - ${formatDate(a.plannedEndDate)}<br>${escapeHtml(a.location || "-")}</div><div class="detail-box"><b>Kontrol Formları</b>${(a.selectedForms || []).map(x => `<span class="pill gray">${x}</span>`).join("") || "-"}</div><div class="detail-box"><b>Kritik Tarihler</b>Kuruluş cevap: ${formatDate(a.auditeeResponseDueDate)}<br>Ön değerlendirme: ${formatDate(a.preEvaluationDueDate)}<br>İtiraz: ${formatDate(a.objectionDueDate)}<br>Nihai rapor: ${formatDate(a.finalReportDueDate)}<br>CAP: ${a.capDueDate ? formatDate(a.capDueDate) : `${a.capDueDays || 45} gün / nihai rapordan sonra`}</div><div class="detail-box"><b>Görev Unvanları</b>${escapeHtml((a.requiredTitles || []).join(", ") || "-")}</div><div class="detail-box"><b>Amaç</b>${escapeHtml(a.objectives || "-")}</div><div class="detail-box"><b>Kapsam</b>${escapeHtml(a.scope || "-")}</div><div class="detail-box"><b>Kriter</b>${escapeHtml(a.criteria || "-")}</div><div class="detail-box"><b>Risk / Öncelik</b>${escapeHtml(a.riskPriorityNote || "-")}</div></div><h3 style="margin-top:16px">Heyet ve Görev Ataması</h3>${runtime.assignmentSummaryHtml?.(a.auditId) || ""}<h3 style="margin-top:16px">Kuruluş Cevabı, Ön Değerlendirme ve Raporlama</h3><div class="detail-grid"><div class="detail-box"><b>Kuruluş Cevabı</b>${runtime.orgResponsePill?.(a.auditId) || ""}</div><div class="detail-box"><b>Ön Değerlendirme</b>${runtime.preEvalPill?.(a.auditId) || ""}</div><div class="detail-box"><b>Denetim Çalışması</b>${runtime.auditResponsePill?.(a.auditId) || ""}</div><div class="detail-box"><b>İtiraz</b>${runtime.objectionPill?.(a.auditId) || ""}</div><div class="detail-box"><b>Nihai Rapor</b>${runtime.reportPill?.(a.auditId) || ""}</div></div><div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" onclick="closeModal(); openAuditFile('${a.auditId}')">Denetim Dosyası / Heyet</button><button class="btn" onclick="closeModal(); openAuditeeResponse('${a.auditId}')">Kuruluş Cevapları</button><button class="btn" onclick="closeModal(); openPreEvaluation('${a.auditId}')">Ön Değerlendirme</button><button class="btn" onclick="closeModal(); openAuditExecution('${a.auditId}')">Denetim Çalışması</button><button class="btn" onclick="closeModal(); openObjectionProcess('${a.auditId}')">İtiraz Süreci</button><button class="btn" onclick="closeModal(); openFinalReport('${a.auditId}')">Nihai Rapor</button><button class="btn" onclick="closeModal(); editAudit('${a.auditId}')">Plan Bilgilerini Düzenle</button>${nextActionForAudit(a) ? `<button class="btn primary" onclick="closeModal(); advanceAudit('${a.auditId}','${nextActionForAudit(a).status}')">${escapeHtml(nextActionForAudit(a).label)}</button>` : ""}</div>`);
}

register("statusPill", statusPill);
register("nextActionForAudit", nextActionForAudit);
register("renderAuditList", renderAuditList);
register("renderAuditCard", renderAuditCard);
register("criticalDateText", criticalDateText);
register("nextCriticalDate", nextCriticalDate);
register("renderProgramAddAudit", renderProgramAddAudit);
expose("prefillAuditProgram", prefillAuditProgram);
expose("updateAuditDuePreview", updateAuditDuePreview);
expose("checkAllAuditForms", checkAllAuditForms);
expose("newPlannedAudit", newPlannedAudit);
expose("editAudit", editAudit);
expose("savePlannedAudit", savePlannedAudit);
expose("setAuditFilter", setAuditFilter);
expose("resetAuditFilters", resetAuditFilters);
expose("advanceAudit", advanceAudit);
expose("archiveAudit", archiveAudit);
expose("showAuditDetails", showAuditDetails);
