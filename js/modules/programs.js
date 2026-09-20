import { COLLECTIONS, PROGRAM_STATUS } from "../config.js";
import { state } from "../state.js";
import { escapeHtml, formatDate } from "../utils.js";
import { getProgram } from "../selectors.js";
import { runtime, register, expose } from "../runtime.js";

export function programStatusLabel(status) {
  const labels = { draft: "Taslak", approved: "Onaylandı", active: "Aktif", closed: "Kapatıldı", archived: "Arşivlendi" };
  return labels[status] || status || "Taslak";
}

export function programStatusPill(status) {
  const cls = status === "active" ? "green" : status === "approved" ? "blue" : status === "closed" ? "gray" : status === "archived" ? "gray" : "yellow";
  return `<span class="pill ${cls}">${escapeHtml(programStatusLabel(status))}</span>`;
}

export function programPill(status) {
  const cls = status === "active" ? "green" : status === "approved" ? "blue" : status === "closed" ? "yellow" : status === "archived" ? "gray" : "purple";
  return `<span class="pill ${cls}">${escapeHtml(PROGRAM_STATUS[status] || status || "Taslak")}</span>`;
}

export function programAuditCounts(programId) {
  const audits = state.audits.filter(a => a.programId === programId);
  return {
    total: audits.length,
    planned: audits.filter(a => ["planned", "programmed"].includes(a.status)).length,
    active: audits.filter(a => ["waiting_auditee_response", "pre_evaluation", "audit_in_progress", "objection_period", "final_report_preparation", "final_report_sent"].includes(a.status)).length,
    cap: audits.filter(a => ["cap_waiting", "cap_under_review", "cap_monitoring"].includes(a.status)).length,
    closed: audits.filter(a => a.status === "closed").length,
    archived: audits.filter(a => a.status === "archived").length
  };
}

export function programCompletionPercent(programId) {
  const c = programAuditCounts(programId);
  const denominator = c.total - c.archived;
  return denominator > 0 ? Math.round((c.closed / denominator) * 100) : 0;
}

export function newAnnualProgram() {
  state.editProgramId = null;
  runtime.showSection("programCreate");
}

export function editAnnualProgram(programId) {
  state.editProgramId = programId;
  runtime.showSection("programCreate");
}

export function renderProgramCreate() {
  const year = new Date().getFullYear();
  const edit = state.editProgramId ? getProgram(state.editProgramId) : null;
  const isEdit = Boolean(edit);
  const defaultProgramName = `${year} Yılı USOAP CMA Denetim Programı`;
  const el = document.getElementById("programCreate");
  if (!el) return;
  el.innerHTML = `
    <div class="info-banner"><strong>Faz 2:</strong> Denetim programı yıllık açılır. Bu kayıt; amaç, kapsam, kriter, risk/öncelik yaklaşımı ve programa bağlı denetimleri yöneten üst kayıttır.</div>
    <div class="card"><h3>${isEdit ? "Yıllık Programı Düzenle" : "Yıllık Program Oluştur"}</h3>
      <div class="form-grid">
        <div class="field"><label>Yıl</label><input id="programYear" type="number" min="2024" max="2100" value="${escapeHtml(edit?.year || year)}" ${isEdit ? "readonly" : ""}></div>
        <div class="field"><label>Program Durumu</label><select id="programStatus">${Object.entries(PROGRAM_STATUS).filter(([k]) => k !== "archived").map(([k,v]) => `<option value="${k}" ${k === (edit?.status || "draft") ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="field full"><label>Program Adı</label><input id="programName" value="${escapeHtml(edit?.name || defaultProgramName)}"></div>
        <div class="field full"><label>Program Amacı</label><textarea id="programObjective" placeholder="Yıllık denetim programının amacı...">${escapeHtml(edit?.objective || "")}</textarea></div>
        <div class="field full"><label>Kapsam</label><textarea id="programScope" placeholder="Denetlenecek alanlar, kuruluşlar, süreçler...">${escapeHtml(edit?.scope || "")}</textarea></div>
        <div class="field full"><label>Denetim Kriterleri</label><textarea id="programCriteria" placeholder="USOAP CMA PQ, ICAO Annex, ulusal mevzuat, prosedürler...">${escapeHtml(edit?.criteria || "")}</textarea></div>
        <div class="field full"><label>Risk / Öncelik Yaklaşımı</label><textarea id="programRisk" placeholder="Önceki denetimler, performans, değişiklikler, şikayetler, riskler...">${escapeHtml(edit?.riskApproachNote || "")}</textarea></div>
      </div>
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn success" onclick="saveAnnualProgram()">${isEdit ? "Programı Güncelle" : "Yıllık Programı Kaydet"}</button>
        <button class="btn" onclick="newAnnualProgram()">Yeni Form Aç</button>
        <button class="btn" onclick="showSection('annualPrograms')">Programları Gör</button>
      </div>
    </div>`;
}

export async function saveAnnualProgram() {
  const year = document.getElementById("programYear").value.trim();
  if (!year) return alert("Yıl girin.");
  const programId = state.editProgramId || `PROGRAM-${year}`;
  const existing = getProgram(programId) || {};
  const data = {
    ...existing,
    programId,
    year: Number(year),
    name: document.getElementById("programName").value.trim() || `${year} Yılı Denetim Programı`,
    objective: document.getElementById("programObjective").value.trim(),
    scope: document.getElementById("programScope").value.trim(),
    criteria: document.getElementById("programCriteria").value.trim(),
    riskApproachNote: document.getElementById("programRisk").value.trim(),
    status: document.getElementById("programStatus").value || "draft",
    createdBy: existing.createdBy || state.role,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await runtime.saveRecord(COLLECTIONS.auditPrograms, programId, data);
  state.editProgramId = null;
  await runtime.loadData();
  runtime.renderAll();
  alert("Yıllık denetim programı kaydedildi.");
  runtime.showSection("annualPrograms");
}

export function setProgramFilter(key, value) {
  state.programFilters[key] = value;
  renderAnnualPrograms();
}

export function resetProgramFilters() {
  state.programFilters = { search: "", status: "all", year: "all" };
  renderAnnualPrograms();
}

export function getFilteredPrograms() {
  const f = state.programFilters;
  return [...state.auditPrograms].filter(p => {
    if (f.status !== "all" && (p.status || "draft") !== f.status) return false;
    if (f.year !== "all" && String(p.year) !== String(f.year)) return false;
    if (f.search) {
      const haystack = [p.programId, p.name, p.objective, p.scope, p.criteria, p.riskApproachNote].join(" ").toLowerCase();
      if (!haystack.includes(f.search.toLowerCase())) return false;
    }
    return true;
  }).sort((a,b) => (b.year || 0) - (a.year || 0));
}

export function renderAnnualPrograms() {
  const rows = getFilteredPrograms();
  const years = [...new Set(state.auditPrograms.map(p => p.year).filter(Boolean))].sort((a,b) => b - a);
  const totalAudits = rows.reduce((sum, p) => sum + programAuditCounts(p.programId).total, 0);
  const activePrograms = rows.filter(p => p.status === "active").length;
  const closedPrograms = rows.filter(p => p.status === "closed").length;
  const el = document.getElementById("annualPrograms");
  if (!el) return;
  el.innerHTML = `
    <div class="summary-strip">
      <div class="mini-stat"><strong>${rows.length}</strong><span>Listelenen program</span></div>
      <div class="mini-stat"><strong>${activePrograms}</strong><span>Aktif program</span></div>
      <div class="mini-stat"><strong>${totalAudits}</strong><span>Bağlı denetim</span></div>
      <div class="mini-stat"><strong>${closedPrograms}</strong><span>Kapatılan program</span></div>
    </div>
    <div class="toolbar">
      <div class="field"><label>Arama</label><input type="search" value="${escapeHtml(state.programFilters.search)}" placeholder="Program adı, amaç, kapsam..." onchange="setProgramFilter('search', this.value)"></div>
      <div class="field"><label>Durum</label><select onchange="setProgramFilter('status', this.value)"><option value="all">Tümü</option>${Object.entries(PROGRAM_STATUS).map(([k,v]) => `<option value="${k}" ${state.programFilters.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div class="field"><label>Yıl</label><select onchange="setProgramFilter('year', this.value)"><option value="all">Tümü</option>${years.map(y => `<option value="${y}" ${String(state.programFilters.year) === String(y) ? "selected" : ""}>${y}</option>`).join("")}</select></div>
      <button class="btn" onclick="resetProgramFilters()">Filtreleri Temizle</button>
      <button class="btn primary" onclick="newAnnualProgram()">Yeni Program</button>
    </div>
    ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Program</th><th>Yıl</th><th>Durum</th><th>Amaç / Kapsam</th><th>Denetim Özeti</th><th>İşlem</th></tr></thead><tbody>${rows.map(p => {
      const c = programAuditCounts(p.programId);
      const pct = programCompletionPercent(p.programId);
      return `<tr><td><strong>${escapeHtml(p.name)}</strong><br><small>${escapeHtml(p.programId)}</small></td><td>${escapeHtml(p.year)}</td><td>${programPill(p.status || "draft")}</td><td><strong>Amaç:</strong> ${escapeHtml(p.objective || "-")}<br><strong>Kapsam:</strong> ${escapeHtml(p.scope || "-")}</td><td><span class="pill blue">${c.total} denetim</span><span class="pill yellow">${c.planned} planlı</span><span class="pill purple">${c.cap} CAP</span><span class="pill green">${c.closed} kapalı</span><div class="progress-line"><span style="width:${pct}%"></span></div><small>%${pct} kapanma</small></td><td><div class="audit-actions"><button class="btn" onclick="viewProgramDetails('${p.programId}')">Detay</button><button class="btn" onclick="editAnnualProgram('${p.programId}')">Düzenle</button><button class="btn primary" onclick="prefillAuditProgram('${p.programId}')">Denetim Ekle</button><button class="btn" onclick="changeProgramStatus('${p.programId}','approved')">Onayla</button><button class="btn success" onclick="changeProgramStatus('${p.programId}','active')">Aktif Yap</button><button class="btn warning" onclick="changeProgramStatus('${p.programId}','closed')">Kapat</button><button class="btn danger" onclick="archiveProgram('${p.programId}')">Arşivle</button></div></td></tr>`;
    }).join("")}</tbody></table></div>` : `<div class="empty">Henüz yıllık program oluşturulmadı veya filtreye uygun kayıt yok.<br><br><button class="btn primary" onclick="newAnnualProgram()">Yıllık Program Oluştur</button></div>`}`;
}

export async function changeProgramStatus(programId, status) {
  const p = getProgram(programId);
  if (!p) return;
  if (status === "closed") {
    const openAudits = state.audits.filter(a => a.programId === programId && !["closed", "archived", "cancelled"].includes(a.status));
    if (openAudits.length && !confirm(`Bu programa bağlı ${openAudits.length} açık denetim var. Program yine de kapatılsın mı?`)) return;
  }
  await runtime.updateRecord(COLLECTIONS.auditPrograms, programId, { status, [`${status}At`]: new Date().toISOString() });
  await runtime.loadData();
  runtime.renderAll();
  runtime.showSection("annualPrograms");
}

export async function archiveProgram(programId) {
  const audits = state.audits.filter(a => a.programId === programId && a.status !== "archived");
  const msg = audits.length ? `Bu programa bağlı ${audits.length} denetim var. Sadece program kaydı arşivlenecek; denetimler ayrı kalacak. Devam edilsin mi?` : "Program arşivlensin mi?";
  if (!confirm(msg)) return;
  await runtime.updateRecord(COLLECTIONS.auditPrograms, programId, { status: "archived", archivedAt: new Date().toISOString() });
  await runtime.loadData();
  runtime.renderAll();
  runtime.showSection("annualPrograms");
}

export function viewProgramDetails(programId) {
  const p = getProgram(programId);
  if (!p) return;
  const audits = state.audits.filter(a => a.programId === programId);
  const c = programAuditCounts(programId);
  const rows = audits.map(a => `<tr><td>${escapeHtml(a.auditId)}</td><td>${escapeHtml(a.organizationName || "-")}</td><td>${formatDate(a.plannedStartDate)} - ${formatDate(a.plannedEndDate)}</td><td>${runtime.statusPill?.(a.status || "planned") || escapeHtml(a.status || "planned")}</td><td>${(a.selectedForms || []).map(f => `<span class="pill gray">${f}</span>`).join("")}</td></tr>`).join("");
  runtime.showModal(`Program Detayı - ${escapeHtml(p.programId)}`, `<div class="detail-grid"><div class="detail-box"><b>Program</b>${escapeHtml(p.name || "-")}</div><div class="detail-box"><b>Durum</b>${programPill(p.status || "draft")}</div><div class="detail-box"><b>Amaç</b>${escapeHtml(p.objective || "-")}</div><div class="detail-box"><b>Kapsam</b>${escapeHtml(p.scope || "-")}</div><div class="detail-box"><b>Kriter</b>${escapeHtml(p.criteria || "-")}</div><div class="detail-box"><b>Risk / Öncelik</b>${escapeHtml(p.riskApproachNote || "-")}</div></div><div class="summary-strip" style="margin-top:14px"><div class="mini-stat"><strong>${c.total}</strong><span>Denetim</span></div><div class="mini-stat"><strong>${c.planned}</strong><span>Planlı</span></div><div class="mini-stat"><strong>${c.active}</strong><span>Süreçte</span></div><div class="mini-stat"><strong>${c.closed}</strong><span>Kapatıldı</span></div></div><div class="table-wrap"><table><thead><tr><th>Denetim</th><th>Kuruluş</th><th>Tarih</th><th>Durum</th><th>Formlar</th></tr></thead><tbody>${rows || `<tr><td colspan="5">Bu programa bağlı denetim yok.</td></tr>`}</tbody></table></div>`);
}

register("programPill", programPill);
register("programAuditCounts", programAuditCounts);
register("renderProgramCreate", renderProgramCreate);
register("renderAnnualPrograms", renderAnnualPrograms);
expose("newAnnualProgram", newAnnualProgram);
expose("editAnnualProgram", editAnnualProgram);
expose("saveAnnualProgram", saveAnnualProgram);
expose("setProgramFilter", setProgramFilter);
expose("resetProgramFilters", resetProgramFilters);
expose("changeProgramStatus", changeProgramStatus);
expose("archiveProgram", archiveProgram);
expose("viewProgramDetails", viewProgramDetails);
expose("renderProgramCreate", renderProgramCreate);
