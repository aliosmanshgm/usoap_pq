// Faz 8B.5 - CAP yaşam döngüsü modülü.
// CAP girişi, adımlar, değerlendirme, izleme, doğrulama, bulgu kapanışı ve CAP raporu burada tutulur.
import { CAP_STATUS, COLLECTIONS } from "../config.js";
import { state } from "../state.js";
import { escapeHtml, daysBetween, formatDate } from "../utils.js";
import { getAudit } from "../selectors.js";
import { runtime, register } from "../runtime.js";
import { showSection } from "./ui-shell.js";
import { findingsTable, openFindings, closedFindings } from "./findings.js";

// ===== Faz 6: CAP Girişi, CAP Adımları, Değerlendirme ve İzleme =====
state.currentCapPlanId = localStorage.getItem("usoap_phase6_current_cap_plan") || "";
try { state.capSelections = JSON.parse(localStorage.getItem("usoap_phase6_cap_selections") || "{}"); }
catch { state.capSelections = {}; }
state.lastCapMessage = "";

function saveCapSelections() {
  localStorage.setItem("usoap_phase6_cap_selections", JSON.stringify(state.capSelections || {}));
}
function getCapSelection(targetSection) {
  return (state.capSelections && state.capSelections[targetSection]) || state.currentCapPlanId || "";
}
function setCapSelection(targetSection, capPlanId) {
  if (!state.capSelections) state.capSelections = {};
  state.capSelections[targetSection] = capPlanId || "";
  state.currentCapPlanId = capPlanId || "";
  saveCapSelections();
  localStorage.setItem("usoap_phase6_current_cap_plan", state.currentCapPlanId);
}

const CAP_STEP_STATUS = {
  not_started: "Başlamadı",
  in_progress: "Devam Ediyor",
  completed: "Tamamlandı Bildirildi",
  verified: "Doğrulandı",
  rejected: "Yeniden Çalışılacak"
};

function jsArg(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
function getFinding(findingId) {
  return state.findings.find(f => (f.findingId || f.id) === findingId) || null;
}
export function getCapPlan(capPlanId) {
  return state.capPlans.find(c => (c.capPlanId || c.id) === capPlanId) || null;
}
function getCapPlanForFinding(findingId) {
  return state.capPlans.find(c => c.findingId === findingId) || null;
}
export function capPlanIdOf(plan) {
  return plan?.capPlanId || plan?.id || "";
}
function capStepEncodedPlanId(step) {
  const stepId = step?.capStepId || step?.id || "";
  const marker = "-STEP-";
  const idx = stepId.lastIndexOf(marker);
  return idx > 0 ? stepId.slice(0, idx) : "";
}
function normalizedCapStep(step) {
  const encodedPlanId = capStepEncodedPlanId(step);
  if (encodedPlanId && getCapPlan(encodedPlanId) && step.capPlanId !== encodedPlanId) {
    return { ...step, capPlanId: encodedPlanId, repairedFromCapPlanId: step.capPlanId || "" };
  }
  return step;
}
function capStepsForPlan(capPlanId) {
  return state.capSteps
    .map(normalizedCapStep)
    .filter(s => s.capPlanId === capPlanId && s.status !== "deleted" && s.deleted !== true)
    .slice()
    .sort((a,b) => Number(a.stepNo || 0) - Number(b.stepNo || 0));
}
function capDetailRoot(capPlanId, preferredContext = "") {
  const roots = Array.from(document.querySelectorAll(".cap-detail"))
    .filter(root => root.dataset.capPlanId === capPlanId);
  if (!roots.length) return null;
  if (preferredContext) {
    const match = roots.find(root => root.dataset.capContext === preferredContext);
    if (match) return match;
  }
  const contextBySection = { auditeeCap: "auditee", capWaiting: "waiting", capReview: "review", capMonitoring: "monitoring" };
  const sectionContext = contextBySection[state.currentSection] || "";
  if (sectionContext) {
    const match = roots.find(root => root.dataset.capContext === sectionContext);
    if (match) return match;
  }
  return roots[0];
}
function capPlanFinding(plan) {
  return getFinding(plan?.findingId) || {};
}
function capPlanAudit(plan) {
  return getAudit(plan?.auditId) || {};
}
function capPlanDueClass(plan) {
  if (["finding_closed"].includes(plan?.status)) return "closed";
  const d = daysBetween(plan?.dueDate);
  if (d !== null && d < 0 && !["cap_submitted","cap_accepted","implementation_in_progress","completion_reported","verification_pending","finding_closed"].includes(plan?.status)) return "overdue";
  if (plan?.status === "cap_submitted") return "review";
  if (["cap_accepted","implementation_in_progress","completion_reported","verification_pending"].includes(plan?.status)) return "monitoring";
  return "waiting";
}
function capDueText(plan) {
  const d = daysBetween(plan?.dueDate);
  if (!plan?.dueDate) return "-";
  if (d === null) return formatDate(plan.dueDate);
  const label = d < 0 ? `${Math.abs(d)} gün gecikti` : d === 0 ? "Bugün" : `${d} gün kaldı`;
  return `${formatDate(plan.dueDate)} / ${label}`;
}
function capStepProgress(steps) {
  if (!steps.length) return 0;
  const total = steps.reduce((sum, s) => sum + Math.max(0, Math.min(100, Number(s.progressPercent || 0))), 0);
  return Math.round(total / steps.length);
}
function capProgressMeta(plan) {
  const steps = capStepsForPlan(capPlanIdOf(plan));
  const verified = steps.filter(s => s.status === "verified").length;
  const completed = steps.filter(s => ["completed","verified"].includes(s.status)).length;
  const progress = capStepProgress(steps);
  return { steps, verified, completed, progress };
}
function deriveAuditCapStatus(auditId, statusOverrides = {}) {
  const plans = state.capPlans
    .filter(p => p.auditId === auditId)
    .map(p => ({ ...p, status: statusOverrides[capPlanIdOf(p)] || p.status }));
  if (!plans.length) return null;
  const statuses = plans.map(p => p.status || "cap_waiting");
  if (statuses.every(s => s === "finding_closed")) return "closed";
  if (statuses.some(s => ["cap_waiting","cap_partially_accepted_revision_required","cap_rejected","cap_resubmission_required"].includes(s))) return "cap_waiting";
  if (statuses.some(s => s === "cap_submitted")) return "cap_under_review";
  if (statuses.some(s => ["cap_accepted","implementation_in_progress","completion_reported","verification_pending"].includes(s))) return "cap_monitoring";
  return "cap_waiting";
}
async function syncAuditCapStatus(auditId, statusOverrides = {}) {
  if (!auditId) return null;
  const status = deriveAuditCapStatus(auditId, statusOverrides);
  if (!status) return null;
  const patch = { status, capStatusSyncedAt: new Date().toISOString() };
  if (status === "closed") patch.closedAt = new Date().toISOString();
  await runtime.updateRecord(COLLECTIONS.audits, auditId, patch);
  return status;
}
window.reconcileAllAuditCapStatuses = async function() {
  if (state.role !== "admin") return alert("Bu bakım işlemi yalnızca Yönetici rolüyle yapılabilir.");
  const auditIds = [...new Set(state.capPlans.map(p => p.auditId).filter(Boolean))];
  if (!auditIds.length) return alert("CAP planına bağlı denetim bulunmuyor.");
  if (!confirm(`${auditIds.length} denetimin üst CAP statüsü bulgu/CAP planlarından yeniden hesaplansın mı?`)) return;
  for (const auditId of auditIds) await syncAuditCapStatus(auditId);
  await runtime.loadData(); runtime.renderAll(); showSection("settings");
  alert(`${auditIds.length} denetimin CAP üst statüsü yeniden hesaplandı.`);
};
window.repairCapStepOrganizationIds = async function() {
  if (state.role !== "admin") return alert("Bu bakım işlemi yalnızca Yönetici rolüyle yapılabilir.");
  const repairs = state.capSteps.filter(step => step.status !== "deleted" && step.deleted !== true && !step.organizationId).map(step => {
    const plan = getCapPlan(step.capPlanId || capStepEncodedPlanId(step));
    return { step, plan };
  }).filter(x => x.plan?.organizationId);
  if (!repairs.length) return alert("Kuruluş ID onarımı gerektiren CAP adımı bulunmuyor.");
  if (!confirm(`${repairs.length} eski CAP adımına CAP planındaki Kuruluş ID yazılsın mı?`)) return;
  for (const { step, plan } of repairs) {
    await runtime.updateRecord(COLLECTIONS.capSteps, step.capStepId || step.id, { organizationId: plan.organizationId });
  }
  await runtime.loadData(); runtime.renderAll(); showSection("settings");
  alert(`${repairs.length} CAP adımının Kuruluş ID alanı onarıldı.`);
};
function capStatusPill(status) {
  const cls = status === "finding_closed" ? "green" : status === "cap_waiting" ? "yellow" : status === "cap_submitted" ? "purple" : status === "cap_rejected" ? "red" : status === "cap_partially_accepted_revision_required" ? "yellow" : status === "cap_resubmission_required" ? "red" : ["cap_accepted","implementation_in_progress","completion_reported","verification_pending"].includes(status) ? "blue" : "gray";
  return `<span class="pill ${cls}">${escapeHtml(CAP_STATUS[status] || status || "-")}</span>`;
}
function capStepPill(status) {
  const cls = status === "verified" ? "green" : status === "completed" ? "blue" : status === "rejected" ? "red" : status === "in_progress" ? "yellow" : "gray";
  return `<span class="pill ${cls}">${escapeHtml(CAP_STEP_STATUS[status] || status || "Başlamadı")}</span>`;
}
function capPlanRowsByStatus(kind) {
  if (kind === "waiting") return state.capPlans.filter(c => ["cap_waiting","cap_partially_accepted_revision_required","cap_rejected","cap_resubmission_required"].includes(c.status));
  if (kind === "review") return state.capPlans.filter(c => c.status === "cap_submitted");
  if (kind === "monitoring") return state.capPlans.filter(c => ["cap_accepted","implementation_in_progress","completion_reported","verification_pending"].includes(c.status));
  if (kind === "closed") return state.capPlans.filter(c => c.status === "finding_closed");
  return state.capPlans;
}
function capDashboard(rows) {
  const all = rows || state.capPlans;
  const waiting = all.filter(c => ["cap_waiting","cap_partially_accepted_revision_required","cap_rejected","cap_resubmission_required"].includes(c.status)).length;
  const review = all.filter(c => c.status === "cap_submitted").length;
  const monitoring = all.filter(c => ["cap_accepted","implementation_in_progress","completion_reported","verification_pending"].includes(c.status)).length;
  const closed = all.filter(c => c.status === "finding_closed").length;
  const overdue = all.filter(c => capPlanDueClass(c) === "overdue").length;
  const dueSoon = all.filter(c => { const d = daysBetween(c.dueDate); return d !== null && d >= 0 && d <= 7 && c.status === "cap_waiting"; }).length;
  const avg = all.length ? Math.round(all.reduce((sum, c) => sum + capProgressMeta(c).progress, 0) / all.length) : 0;
  return `<div class="cap-dashboard"><div class="cap-stat"><b>${all.length}</b><span>CAP Planı</span></div><div class="cap-stat"><b>${waiting}</b><span>Bekleyen</span></div><div class="cap-stat"><b>${review}</b><span>Değerlendirmede</span></div><div class="cap-stat"><b>${monitoring}</b><span>İzlemede</span></div><div class="cap-stat"><b>${closed}</b><span>Kapanan</span></div><div class="cap-stat"><b>${overdue}</b><span>Geciken</span></div><div class="cap-stat"><b>${dueSoon}</b><span>7 gün içinde</span></div><div class="cap-stat"><b>%${avg}</b><span>Ortalama ilerleme</span></div></div>`;
}
function capPlanSelect(rows, selectedId, targetSection) {
  return `<div class="toolbar"><div class="field" style="min-width:420px"><label>CAP Planı / Bulgu Seç</label><select onchange="selectCapPlan(this.value,'${targetSection}')"><option value="">Seçiniz</option>${rows.map(c => {
    const f = capPlanFinding(c);
    const m = capProgressMeta(c);
    return `<option value="${escapeHtml(capPlanIdOf(c))}" ${capPlanIdOf(c) === selectedId ? "selected" : ""}>${escapeHtml(f.areaKey || "-")} / PQ ${escapeHtml(f.pqNo || "-")} - ${escapeHtml(CAP_STATUS[c.status] || c.status || "-")} - ${m.steps.length} adım / %${m.progress}</option>`;
  }).join("")}</select><small>Listeden bulguyu seç; seçili bulguya ait CAP formu hemen aşağıda açılır.</small></div><button class="btn" onclick="showAuditDetails('${jsArg(getCapPlan(selectedId)?.auditId || '')}')" ${selectedId ? "" : "disabled"}>Denetim Detayı</button></div>`;
}
function capPlanCard(plan, targetSection) {
  const f = capPlanFinding(plan);
  const audit = capPlanAudit(plan);
  const meta = capProgressMeta(plan);
  const cls = capPlanDueClass(plan);
  const selectedCls = capPlanIdOf(plan) === getCapSelection(targetSection) ? " selected" : "";
  return `<div class="cap-card ${cls}${selectedCls}"><h4>${escapeHtml(capPlanIdOf(plan))}</h4><div class="cap-meta"><strong>Kuruluş:</strong> ${escapeHtml(plan.organizationName || audit.organizationName || "-")}<br><strong>Bulgu:</strong> ${escapeHtml(f.areaKey || "-")} / PQ ${escapeHtml(f.pqNo || "-")} / ${escapeHtml(f.ce || "-")}<br><strong>Son tarih:</strong> ${escapeHtml(capDueText(plan))}<br><strong>Adım:</strong> ${meta.steps.length} | <strong>İlerleme:</strong> %${meta.progress} | <strong>Doğrulanan:</strong> ${meta.verified}/${meta.steps.length}</div><div class="progress-track"><span style="width:${meta.progress}%"></span></div><div style="margin-top:8px">${capStatusPill(plan.status)}</div><div class="cap-card-actions"><button class="btn primary" onclick="openCapPlan('${jsArg(capPlanIdOf(plan))}','${targetSection}')">Seç / İşlem Yap</button></div></div>`;
}
function ensureCapSelection(rows, targetSection) {
  const current = getCapSelection(targetSection);
  if (current && rows.some(c => capPlanIdOf(c) === current)) return current;
  const first = rows[0];
  const nextId = first ? capPlanIdOf(first) : "";
  setCapSelection(targetSection, nextId);
  return nextId;
}
window.openCapPlan = function(capPlanId, targetSection = "capWaiting") {
  setCapSelection(targetSection, capPlanId || "");
  showSection(targetSection);
};
window.selectCapPlan = function(capPlanId, targetSection = "capWaiting") {
  setCapSelection(targetSection, capPlanId || "");
  state.lastCapMessage = "";
  renderFindingsAndCap();
  renderReports();
};
function auditeeCapPlans() {
  return state.capPlans.filter(c => c.organizationId === state.orgContext && c.status !== "finding_closed");
}
function auditeeSubmittableCapPlans() {
  return auditeeCapPlans().filter(c => ["cap_waiting","cap_partially_accepted_revision_required","cap_rejected","cap_resubmission_required"].includes(c.status));
}
function validateCapPlanReady(plan) {
  const capPlanId = capPlanIdOf(plan);
  const steps = capStepsForPlan(capPlanId).filter(s => s.status !== "deleted");
  const missing = [];
  if (!steps.length) missing.push("en az bir CAP adımı eklenmeli");
  steps.forEach(s => {
    const prefix = `Adım ${s.stepNo || "?"}`;
    if (!String(s.actionText || "").trim()) missing.push(`${prefix}: adım içeriği boş`);
    if (!String(s.responsibleUnit || "").trim()) missing.push(`${prefix}: sorumlu birim boş`);
    if (!String(s.estimatedImplementationDate || "").trim()) missing.push(`${prefix}: tahmini uygulama tarihi boş`);
  });
  return missing;
}
function capEntryPanel(rows, selectedId) {
  const submittable = rows.filter(c => ["cap_waiting","cap_partially_accepted_revision_required","cap_rejected","cap_resubmission_required"].includes(c.status));
  const ready = submittable.filter(c => !validateCapPlanReady(c).length).length;
  const selected = getCapPlan(selectedId);
  const selectedFinding = selected ? capPlanFinding(selected) : {};
  const selectedText = selected ? `Seçili bulgu: ${selectedFinding.areaKey || "-"} / PQ ${selectedFinding.pqNo || "-"} (${CAP_STATUS[selected.status] || selected.status || "-"})` : "Seçili CAP planı yok.";
  const canSubmitAll = state.role === "auditee" && submittable.length > 0;
  return `<div class="cap-entry-panel"><div><strong>CAP Giriş Akışı</strong><small>${escapeHtml(selectedText)}<br>Taslak Kaydet ara kayıt alır. Tüm bulgular için CAP adımları tamamlanınca <strong>Tüm CAP Planlarını Onaya Sun</strong> ile denetleyen değerlendirmesine gönderilir.</small><small>Hazır CAP: ${ready}/${submittable.length} | Toplam açık CAP: ${rows.length}</small></div><div class="cap-entry-actions"><button class="btn primary" onclick="submitAllAuditeeCapPlans()" ${canSubmitAll ? "" : "disabled"}>Tüm CAP Planlarını Onaya Sun</button></div></div>`;
}
async function submitCapPlanDirect(capPlanId) {
  const plan = getCapPlan(capPlanId);
  if (!plan) throw new Error(`${capPlanId}: CAP planı bulunamadı.`);
  await runtime.updateRecord(COLLECTIONS.capPlans, capPlanId, { status: "cap_submitted", submittedAt: new Date().toISOString(), submittedByRole: state.role });
  if (plan.findingId) await runtime.updateRecord(COLLECTIONS.findings, plan.findingId, { status: "cap_under_review" });
}
window.submitAllAuditeeCapPlans = async function() {
  if (state.role !== "auditee") return alert("Toplu CAP sunumu denetlenen kuruluş rolüyle yapılabilir.");
  const selectedId = getCapSelection("auditeeCap");
  if (selectedId && getCapPlan(selectedId)) {
    await persistCapPlanForm(selectedId).catch(err => console.warn("Seçili CAP taslağı kaydedilemedi", err));
  }
  await runtime.loadData();
  const rows = auditeeSubmittableCapPlans();
  if (!rows.length) return alert("Onaya sunulacak CAP planı bulunmuyor.");
  const missing = [];
  rows.forEach(c => {
    const f = capPlanFinding(c);
    const gaps = validateCapPlanReady(c);
    if (gaps.length) missing.push(`${f.areaKey || "-"} / PQ ${f.pqNo || "-"}: ${gaps.join("; ")}`);
  });
  if (missing.length) return alert("Tüm CAP planlarını onaya sunmadan önce eksikleri tamamlayın:\n- " + missing.join("\n- "));
  if (!confirm(`${rows.length} CAP planı denetleyen değerlendirmesine sunulsun mu?`)) return;
  for (const c of rows) await submitCapPlanDirect(capPlanIdOf(c));
  const affectedAuditIds = [...new Set(rows.map(c => c.auditId).filter(Boolean))];
  for (const auditId of affectedAuditIds) {
    const overrides = Object.fromEntries(rows.filter(c => c.auditId === auditId).map(c => [capPlanIdOf(c), "cap_submitted"]));
    await syncAuditCapStatus(auditId, overrides);
  }
  setCapSelection("auditeeCap", capPlanIdOf(rows[0]) || "");
  setCapSelection("capReview", capPlanIdOf(rows[0]) || "");
  state.lastCapMessage = "Tüm hazır CAP planları denetleyen değerlendirmesine sunuldu.";
  await runtime.loadData(); runtime.renderAll(); showSection("auditeeCap");
  alert("Tüm CAP planları denetleyen değerlendirmesine sunuldu.");
};
function stepInput(stepId, field, fallback = "") {
  const el = document.querySelector(`[data-step-id="${CSS.escape(stepId)}"] [data-field="${field}"]`);
  return el ? el.value.trim() : fallback;
}
async function persistCapPlanForm(capPlanId, preferredContext = "") {
  const plan = getCapPlan(capPlanId);
  if (!plan) throw new Error("CAP planı bulunamadı.");
  const root = capDetailRoot(capPlanId, preferredContext);
  if (!root) throw new Error("Seçili CAP formu ekranda bulunamadı.");
  const patch = {
    rootCause: root.querySelector("#capRootCause")?.value.trim() || "",
    proposedCorrectionSummary: root.querySelector("#capCorrectionSummary")?.value.trim() || "",
    capCoordinator: root.querySelector("#capCoordinator")?.value.trim() || "",
    planNote: root.querySelector("#capPlanNote")?.value.trim() || "",
    updatedAt: new Date().toISOString()
  };
  await runtime.updateRecord(COLLECTIONS.capPlans, capPlanId, patch);
  const rows = Array.from(root.querySelectorAll(".cap-step-row"));
  for (const row of rows) {
    const stepId = row.dataset.stepId;
    const existingRaw = state.capSteps.find(s => (s.capStepId || s.id) === stepId) || {};
    const existing = normalizedCapStep(existingRaw);
    const progress = Math.max(0, Math.min(100, Number(row.querySelector('[data-field="progressPercent"]')?.value || 0)));
    const status = progress >= 100 && (row.querySelector('[data-field="completionDate"]')?.value || "") ? "completed" : progress > 0 ? "in_progress" : (existing.status || "not_started");
    await runtime.saveRecord(COLLECTIONS.capSteps, stepId, {
      ...existing,
      capStepId: stepId,
      capPlanId,
      findingId: plan.findingId,
      auditId: plan.auditId,
      organizationId: plan.organizationId || "",
      stepNo: Number(row.dataset.stepNo || existing.stepNo || 1),
      actionText: row.querySelector('[data-field="actionText"]')?.value.trim() || "",
      responsibleUnit: row.querySelector('[data-field="responsibleUnit"]')?.value.trim() || "",
      evidenceFileName: row.querySelector('[data-field="evidenceFileName"]')?.value.trim() || "",
      evidenceUrl: row.querySelector('[data-field="evidenceUrl"]')?.value.trim() || "",
      estimatedImplementationDate: row.querySelector('[data-field="estimatedImplementationDate"]')?.value || "",
      revisedImplementationDate: row.querySelector('[data-field="revisedImplementationDate"]')?.value || "",
      completionDate: row.querySelector('[data-field="completionDate"]')?.value || "",
      progressPercent: progress,
      status: existing.status === "verified" ? "verified" : status,
      createdByRole: existing.createdByRole || state.role,
      updatedByRole: state.role,
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
}
window.addCapStep = async function(capPlanId) {
  const plan = getCapPlan(capPlanId);
  if (!plan) return alert("CAP planı bulunamadı.");
  await persistCapPlanForm(capPlanId).catch(() => {});
  await runtime.loadData();
  const existingSteps = capStepsForPlan(capPlanId).filter(s => s.status !== "deleted");
  let nextNo = existingSteps.length ? Math.max(...existingSteps.map(s => Number(s.stepNo || 0))) + 1 : 1;
  let stepId = `${capPlanId}-STEP-${String(nextNo).padStart(2,"0")}`;
  while (state.capSteps.some(s => (s.capStepId || s.id) === stepId && s.status !== "deleted")) {
    nextNo += 1;
    stepId = `${capPlanId}-STEP-${String(nextNo).padStart(2,"0")}`;
  }
  await runtime.saveRecord(COLLECTIONS.capSteps, stepId, {
    capStepId: stepId,
    capPlanId,
    findingId: plan.findingId,
    auditId: plan.auditId,
    organizationId: plan.organizationId || "",
    stepNo: nextNo,
    actionText: "",
    responsibleUnit: "",
    evidenceFileName: "",
    evidenceUrl: "",
    estimatedImplementationDate: "",
    revisedImplementationDate: "",
    completionDate: "",
    progressPercent: 0,
    status: "not_started",
    createdByRole: state.role,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  setCapSelection(state.currentSection || "auditeeCap", capPlanId);
  state.lastCapMessage = `Yeni CAP adımı eklendi. Adım bilgilerini doldurup Taslak Kaydet veya CAP Planını Sun işlemini yapabilirsiniz.`;
  await runtime.loadData(); runtime.renderAll(); showSection(state.currentSection);
};
window.removeCapStep = async function(stepId) {
  if (!confirm("Bu CAP adımı silinsin mi?")) return;
  if (isProductionDataMode()) {
    await runtime.updateRecord(COLLECTIONS.capSteps, stepId, { deleted: true, status: "deleted", deletedAt: new Date().toISOString(), deletedByRole: state.role });
  } else {
    const rows = localRead(COLLECTIONS.capSteps).filter(s => (s.capStepId || s.id) !== stepId);
    localWrite(COLLECTIONS.capSteps, rows);
  }
  await runtime.loadData();
  runtime.renderAll(); showSection(state.currentSection);
};
window.saveCapDraft = async function(capPlanId) {
  if (!capPlanId) return alert("CAP planı seçin.");
  await persistCapPlanForm(capPlanId);
  setCapSelection(state.currentSection || "auditeeCap", capPlanId);
  state.lastCapMessage = "CAP taslağı kaydedildi. Bu işlem CAP'i denetleyen değerlendirmesine göndermez; hazır olduğunda CAP Planını Sun butonuna basmalısınız.";
  await runtime.loadData(); runtime.renderAll(); showSection(state.currentSection);
  alert("CAP taslağı kaydedildi. Hazır olduğunda CAP Planını Sun butonuyla denetleyen değerlendirmesine gönderebilirsiniz.");
};
window.submitCapPlan = async function(capPlanId) {
  const plan = getCapPlan(capPlanId);
  if (!plan) return alert("CAP planı seçin.");
  if (state.role !== "auditee") return alert("CAP sunumu denetlenen kuruluş rolüyle yapılabilir.");
  await persistCapPlanForm(capPlanId);
  await runtime.loadData();
  const steps = capStepsForPlan(capPlanId).filter(s => s.status !== "deleted");
  const missing = [];
  if (!steps.length) missing.push("En az bir CAP adımı eklenmelidir.");
  steps.forEach(s => {
    const prefix = `Adım ${s.stepNo || "?"}`;
    if (!s.actionText) missing.push(`${prefix}: Adım içeriği boş.`);
    if (!s.responsibleUnit) missing.push(`${prefix}: Sorumlu birim boş.`);
    if (!s.estimatedImplementationDate) missing.push(`${prefix}: Tahmini uygulama tarihi boş.`);
  });
  if (missing.length) return alert("CAP sunulamadı:\n- " + missing.join("\n- "));
  await runtime.updateRecord(COLLECTIONS.capPlans, capPlanId, { status: "cap_submitted", submittedAt: new Date().toISOString(), submittedByRole: state.role });
  await runtime.updateRecord(COLLECTIONS.findings, plan.findingId, { status: "cap_under_review" });
  if (plan.auditId) await syncAuditCapStatus(plan.auditId, { [capPlanId]: "cap_submitted" });
  setCapSelection("auditeeCap", capPlanId);
  setCapSelection("capReview", capPlanId);
  state.lastCapMessage = "CAP planı denetleyen değerlendirmesine sunuldu.";
  await runtime.loadData(); runtime.renderAll(); showSection("auditeeCap");
  alert("CAP planı denetleyen değerlendirmesine sunuldu.");
};
window.saveCapEvaluation = async function(capPlanId, decision) {
  const plan = getCapPlan(capPlanId);
  if (!plan) return alert("CAP planı seçin.");
  if (!["admin","program_manager","lead_auditor"].includes(state.role)) return alert("CAP değerlendirmesi için Yönetici/Program Yöneticisi/Baş Denetçi rolü gerekir.");
  const note = capDetailRoot(capPlanId, "review")?.querySelector("#capEvaluationNote")?.value.trim() || "";
  const map = {
    accept: "cap_accepted",
    partial: "cap_partially_accepted_revision_required",
    reject: "cap_rejected"
  };
  const status = map[decision];
  if (!status) return;
  if (decision !== "accept" && !note) return alert("Kısmen kabul/iade kararında değerlendirme notu girilmelidir.");
  await runtime.updateRecord(COLLECTIONS.capPlans, capPlanId, { status, evaluationNote: note, evaluatedAt: new Date().toISOString(), evaluatorRole: state.role });
  if (decision === "accept") {
    await runtime.updateRecord(COLLECTIONS.findings, plan.findingId, { status: "cap_monitoring" });
  } else {
    await runtime.updateRecord(COLLECTIONS.findings, plan.findingId, { status: "cap_resubmission_required" });
  }
  if (plan.auditId) await syncAuditCapStatus(plan.auditId, { [capPlanId]: status });
  const nextSection = decision === "accept" ? "capMonitoring" : "capReview";
  setCapSelection(nextSection, capPlanId);
  setCapSelection("auditeeCap", capPlanId);
  state.lastCapMessage = decision === "accept" ? "CAP kabul edildi ve izleme aşamasına alındı." : "CAP revizyon/iade kararıyla kuruluşa geri gönderildi.";
  await runtime.loadData(); runtime.renderAll(); showSection(nextSection);
  alert(decision === "accept" ? "CAP kabul edildi ve izleme aşamasına alındı." : "CAP revizyon/iade kararıyla kuruluşa geri gönderildi.");
};
window.reportCapCompletion = async function(capPlanId) {
  const plan = getCapPlan(capPlanId);
  if (!plan) return alert("CAP planı seçin.");
  if (state.role !== "auditee") return alert("Tamamlandı bildirimi denetlenen kuruluş rolüyle yapılabilir.");
  await persistCapPlanForm(capPlanId);
  await runtime.loadData();
  const steps = capStepsForPlan(capPlanId);
  if (!steps.length || steps.some(s => Number(s.progressPercent || 0) < 100 || !s.completionDate)) return alert("Tamamlandı bildirimi için tüm adımlarda ilerleme %100 ve tamamlanma tarihi olmalıdır.");
  await runtime.updateRecord(COLLECTIONS.capPlans, capPlanId, { status: "completion_reported", completionReportedAt: new Date().toISOString() });
  await runtime.updateRecord(COLLECTIONS.findings, plan.findingId, { status: "verification_pending" });
  if (plan.auditId) await syncAuditCapStatus(plan.auditId, { [capPlanId]: "completion_reported" });
  setCapSelection("auditeeCap", capPlanId);
  setCapSelection("capMonitoring", capPlanId);
  state.lastCapMessage = "CAP tamamlandı bildirimi denetleyen doğrulamasına gönderildi.";
  await runtime.loadData(); runtime.renderAll(); showSection("auditeeCap");
  alert("CAP tamamlandı bildirimi denetleyen doğrulamasına gönderildi.");
};
window.verifyCapStep = async function(stepId, ok) {
  const step = state.capSteps.find(s => (s.capStepId || s.id) === stepId);
  if (!step) return alert("CAP adımı bulunamadı.");
  if (!["admin","program_manager","lead_auditor","auditor"].includes(state.role)) return alert("Doğrulama için denetçi rolü gerekir.");
  await runtime.updateRecord(COLLECTIONS.capSteps, stepId, { status: ok ? "verified" : "rejected", verifiedAt: ok ? new Date().toISOString() : null, verifierRole: state.role });
  const plan = getCapPlan(step.capPlanId);
  if (!ok && plan) {
    await runtime.updateRecord(COLLECTIONS.capPlans, step.capPlanId, { status: "cap_resubmission_required", evaluationNote: "Doğrulamada uygun bulunmayan adım var. CAP revizyonu bekleniyor." });
    await runtime.updateRecord(COLLECTIONS.findings, plan.findingId, { status: "cap_resubmission_required" });
    if (plan.auditId) await syncAuditCapStatus(plan.auditId, { [step.capPlanId]: "cap_resubmission_required" });
  } else if (plan) {
    await runtime.updateRecord(COLLECTIONS.capPlans, step.capPlanId, { status: "verification_pending" });
    if (plan.auditId) await syncAuditCapStatus(plan.auditId, { [step.capPlanId]: "verification_pending" });
  }
  setCapSelection("capMonitoring", step.capPlanId);
  state.lastCapMessage = ok ? "CAP adımı doğrulandı." : "CAP adımı uygun bulunmadı; kuruluş revizyonu bekleniyor.";
  await runtime.loadData(); runtime.renderAll(); showSection("capMonitoring");
};
window.verifyAllCapSteps = async function(capPlanId) {
  const plan = getCapPlan(capPlanId);
  if (!plan) return alert("CAP planı seçin.");
  if (!["admin","program_manager","lead_auditor","auditor"].includes(state.role)) return alert("Doğrulama için denetçi rolü gerekir.");
  const steps = capStepsForPlan(capPlanId).filter(s => s.status !== "deleted");
  if (!steps.length) return alert("Doğrulanacak CAP adımı bulunmuyor.");
  const incomplete = steps.filter(s => Number(s.progressPercent || 0) < 100 || !s.completionDate);
  if (incomplete.length) {
    return alert("Tüm adımlar doğrulanamadı. Önce kuruluş tarafından her adım için ilerleme %100 ve tamamlanma tarihi girilmelidir:\n- " + incomplete.map(s => `Adım ${s.stepNo || "?"}`).join("\n- "));
  }
  const pending = steps.filter(s => s.status !== "verified");
  if (!pending.length) return alert("Bu CAP planındaki tüm adımlar zaten doğrulanmış.");
  for (const step of pending) {
    const stepId = step.capStepId || step.id;
    await runtime.updateRecord(COLLECTIONS.capSteps, stepId, { status: "verified", verifiedAt: new Date().toISOString(), verifierRole: state.role });
  }
  await runtime.updateRecord(COLLECTIONS.capPlans, capPlanId, { status: "verification_pending", verificationStartedAt: new Date().toISOString() });
  await runtime.updateRecord(COLLECTIONS.findings, plan.findingId, { status: "verification_pending" });
  if (plan.auditId) await syncAuditCapStatus(plan.auditId, { [capPlanId]: "verification_pending" });
  setCapSelection("capMonitoring", capPlanId);
  state.lastCapMessage = "Tüm CAP adımları doğrulandı. Artık bulguyu kapatabilirsiniz.";
  await runtime.loadData(); runtime.renderAll(); showSection("capMonitoring");
  alert("Tüm CAP adımları doğrulandı. Artık Bulguyu Kapat butonunu kullanabilirsiniz.");
};

window.closeFindingFromCap = async function(capPlanId) {
  const plan = getCapPlan(capPlanId);
  if (!plan) return alert("CAP planı seçin.");
  if (!["admin","program_manager","lead_auditor"].includes(state.role)) return alert("Bulgu kapatma için Yönetici/Program Yöneticisi/Baş Denetçi rolü gerekir.");
  const steps = capStepsForPlan(capPlanId);
  if (!steps.length || steps.some(s => s.status !== "verified")) return alert("Bulgu kapatılmadan önce tüm CAP adımları doğrulanmalıdır.");
  const closureNote = capDetailRoot(capPlanId, "monitoring")?.querySelector("#capClosureNote")?.value.trim() || "CAP adımları doğrulandı ve bulgu kapatıldı.";
  await runtime.updateRecord(COLLECTIONS.capPlans, capPlanId, { status: "finding_closed", closedAt: new Date().toISOString(), closureNote });
  await runtime.updateRecord(COLLECTIONS.findings, plan.findingId, { status: "finding_closed", closedAt: new Date().toISOString(), closureNote });
  if (plan.auditId) await syncAuditCapStatus(plan.auditId, { [capPlanId]: "finding_closed" });
  await runtime.loadData(); runtime.renderAll(); showSection("closedFindings");
  alert("Bulgu kapatıldı. Denetimde açık bulgu kalmadıysa denetim de kapatıldı.");
};

function capStepEditor(step, canEdit, canVerify) {
  const stepId = step.capStepId || step.id;
  const disabled = canEdit ? "" : "disabled";
  const progress = Math.max(0, Math.min(100, Number(step.progressPercent || 0)));
  const completedReady = progress >= 100 && !!step.completionDate;
  const isVerified = step.status === "verified";
  const verificationControls = canVerify ? (() => {
    if (isVerified) {
      return `<div class="cap-save-notice" style="margin-top:10px">Bu CAP adımı doğrulandı.</div>`;
    }
    if (!completedReady) {
      return `<div class="cap-save-notice" style="margin-top:10px">Doğrulama için kuruluşun bu adımı %100 ilerleme ve tamamlanma tarihi ile tamamlandı bildirmesi gerekir.</div><div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn success" disabled>Adımı Doğrula</button><button class="btn warning" disabled>Uygun Değil / Revizyon</button></div>`;
    }
    return `<div class="cap-save-notice" style="margin-top:10px">Bu adım doğrulamaya hazır.</div><div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn success" onclick="verifyCapStep('${jsArg(stepId)}',true)">Adımı Doğrula</button><button class="btn warning" onclick="verifyCapStep('${jsArg(stepId)}',false)">Uygun Değil / Revizyon</button></div>`;
  })() : "";
  return `<div class="cap-step-row" data-step-id="${escapeHtml(stepId)}" data-step-no="${escapeHtml(step.stepNo || 1)}"><div class="cap-step-head"><b>Adım ${escapeHtml(step.stepNo || "-")}</b><div>${capStepPill(step.status || "not_started")}${canEdit ? `<button class="btn danger" onclick="removeCapStep('${jsArg(stepId)}')">Sil</button>` : ""}</div></div><div class="cap-step-grid"><div class="field"><label>Adımın İçeriği</label><textarea data-field="actionText" ${disabled}>${escapeHtml(step.actionText || "")}</textarea></div><div class="field"><label>Sorumlu Birim</label><input data-field="responsibleUnit" value="${escapeHtml(step.responsibleUnit || "")}" ${disabled}></div><div class="field"><label>Kanıt Doküman Adı</label><input data-field="evidenceFileName" value="${escapeHtml(step.evidenceFileName || step.evidenceReference?.fileName || "")}" ${disabled}></div><div class="field"><label>Kanıt Linki</label><input data-field="evidenceUrl" value="${escapeHtml(step.evidenceUrl || step.evidenceReference?.url || "")}" ${disabled}></div><div class="field"><label>Tahmini Uygulama Tarihi</label><input type="date" data-field="estimatedImplementationDate" value="${escapeHtml(step.estimatedImplementationDate || "")}" ${disabled}></div><div class="field"><label>Revize Uygulama Tarihi</label><input type="date" data-field="revisedImplementationDate" value="${escapeHtml(step.revisedImplementationDate || "")}" ${disabled}></div><div class="field"><label>Tamamlanma Tarihi</label><input type="date" data-field="completionDate" value="${escapeHtml(step.completionDate || "")}" ${disabled}></div><div class="field"><label>İlerleme Yüzdesi</label><input type="number" min="0" max="100" data-field="progressPercent" value="${progress}" ${disabled}></div></div><div class="progress-track"><span style="width:${progress}%"></span></div>${verificationControls}</div>`;
}

function capPlanDetailHtml(plan, context) {
  if (!plan) return `<div class="empty">CAP planı seçiniz.</div>`;
  const capPlanId = capPlanIdOf(plan);
  const finding = capPlanFinding(plan);
  const audit = capPlanAudit(plan);
  const steps = capStepsForPlan(capPlanId).filter(s => s.status !== "deleted");
  const meta = capProgressMeta(plan);
  const isAuditeeOwner = state.role === "auditee" && plan.organizationId === state.orgContext;
  const canCreateOrRevise = isAuditeeOwner && ["cap_waiting","cap_partially_accepted_revision_required","cap_rejected","cap_resubmission_required"].includes(plan.status);
  const canUpdateImplementation = isAuditeeOwner && ["cap_accepted","implementation_in_progress","completion_reported","verification_pending"].includes(plan.status);
  const canAuditeeEdit = canCreateOrRevise || canUpdateImplementation;
  const canEvaluate = ["admin","program_manager","lead_auditor"].includes(state.role) && plan.status === "cap_submitted";
  const canVerify = ["admin","program_manager","lead_auditor","auditor"].includes(state.role) && ["cap_accepted","implementation_in_progress","completion_reported","verification_pending"].includes(plan.status);
  const planDisabled = canAuditeeEdit ? "" : "disabled";
  const stepHtml = steps.map(s => capStepEditor(s, canAuditeeEdit, canVerify)).join("") || `<div class="empty">Henüz CAP adımı yok. CAP sunumu için en az bir adım eklenmelidir.</div>`;
  const saveNotice = state.lastCapMessage ? `<div class="cap-save-notice">${escapeHtml(state.lastCapMessage)}</div>` : "";
  const evalPanel = canEvaluate ? `<div class="cap-eval-panel"><h3>Denetleyen CAP Değerlendirmesi</h3><div class="field"><label>Değerlendirme Notu</label><textarea id="capEvaluationNote">${escapeHtml(plan.evaluationNote || "")}</textarea></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn success" onclick="saveCapEvaluation('${jsArg(capPlanId)}','accept')">Kabul Et</button><button class="btn warning" onclick="saveCapEvaluation('${jsArg(capPlanId)}','partial')">Kısmen Kabul / Revizyon İste</button><button class="btn danger" onclick="saveCapEvaluation('${jsArg(capPlanId)}','reject')">İade Et</button></div></div>` : "";
  const allStepsCompletionReady = !!steps.length && steps.every(s => Number(s.progressPercent || 0) >= 100 && !!s.completionDate);
  const allStepsVerified = !!steps.length && steps.every(s => s.status === "verified");
  const monitorHint = !steps.length ? "Bu CAP planında henüz adım yok." : allStepsVerified ? "Tüm CAP adımları doğrulandı. Bulguyu kapatabilirsiniz." : allStepsCompletionReady ? "CAP adımları tamamlandı bildirildi. Adımları tek tek veya toplu doğrulayabilirsiniz." : "Doğrulama için kuruluşun her adımda ilerlemeyi %100 yapması ve tamamlanma tarihi girmesi gerekir.";
  const monitorPanel = canVerify ? `<div class="cap-monitor-panel"><h3>Doğrulama ve Kapatma</h3><p>Önce CAP adımları doğrulanır; tüm adımlar doğrulandıktan sonra bulgu kapatılır. Uygun bulunmayan adım varsa sistem CAP revizyonunu yeniden başlatır.</p><div class="cap-save-notice">${escapeHtml(monitorHint)}</div><div class="field"><label>Kapanış Notu</label><textarea id="capClosureNote">${escapeHtml(plan.closureNote || "CAP adımları doğrulandı ve bulgu kapatıldı.")}</textarea></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn primary" onclick="verifyAllCapSteps('${jsArg(capPlanId)}')" ${allStepsCompletionReady && !allStepsVerified ? "" : "disabled"}>Tüm CAP Adımlarını Doğrula</button><button class="btn success" onclick="closeFindingFromCap('${jsArg(capPlanId)}')" ${allStepsVerified ? "" : "disabled"}>Bulguyu Kapat</button></div></div>` : "";
  const auditeeButtons = canAuditeeEdit ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn" onclick="addCapStep('${jsArg(capPlanId)}')">CAP Adımı Ekle</button><button class="btn success" onclick="saveCapDraft('${jsArg(capPlanId)}')">Taslak Kaydet</button>${canCreateOrRevise ? `<button class="btn primary" onclick="submitCapPlan('${jsArg(capPlanId)}')">Seçili CAP Planını Onaya Sun</button>` : ""}${canUpdateImplementation ? `<button class="btn primary" onclick="reportCapCompletion('${jsArg(capPlanId)}')">Tamamlandı Bildir</button>` : ""}</div>` : "";
  const selectedSummary = `<div class="cap-selected-summary"><strong>Seçili CAP:</strong> ${escapeHtml(finding.areaKey || "-")} / PQ ${escapeHtml(finding.pqNo || "-")} — ${capStatusPill(plan.status)}<br><strong>Kullanım:</strong> Bu ekranda seçili bulguya ait CAP bilgilerini ve adımlarını doldurup <strong>Taslak Kaydet</strong> ile ara kayıt alırsın. Diğer bulgular için yukarıdaki listeden başka CAP planı seçebilirsin.</div>`;
  return `<div class="cap-detail" data-cap-plan-id="${escapeHtml(capPlanId)}" data-cap-context="${escapeHtml(context || "")}"><h3>Seçili CAP Planı</h3>${selectedSummary}<div class="status-ribbon"><span class="pill gray">${escapeHtml(capPlanId)}</span><span class="pill gray">Son tarih: ${escapeHtml(capDueText(plan))}</span><span class="pill blue">İlerleme: %${meta.progress}</span><span class="pill green">Doğrulanan: ${meta.verified}/${meta.steps.length}</span></div>${canAuditeeEdit ? auditeeButtons : ""}<div class="detail-grid" style="margin-top:10px"><div class="detail-box"><b>Denetim</b>${escapeHtml(plan.auditId || "-")}<br>${escapeHtml(audit.organizationName || plan.organizationName || "-")}</div><div class="detail-box"><b>Bulgu</b>${escapeHtml(finding.areaKey || "-")} / PQ ${escapeHtml(finding.pqNo || "-")}<br>${escapeHtml(finding.ce || "-")}</div><div class="detail-box"><b>CAP Son Tarihi</b>${formatDate(plan.dueDate)}</div><div class="detail-box"><b>Sunum/Değerlendirme</b>Sunum: ${plan.submittedAt ? formatDate(plan.submittedAt) : "-"}<br>Değerlendirme: ${plan.evaluatedAt ? formatDate(plan.evaluatedAt) : "-"}</div></div><div class="cap-finding-box"><strong>Bulgu Metni</strong>
${escapeHtml(finding.findingText || "-")}

<strong>İncelenen Kanıt</strong>
${escapeHtml(finding.reviewedEvidence || "-")}</div><div class="grid"><div class="card span-6"><h3>CAP Plan Bilgileri</h3><div class="field"><label>Kök Neden / Değerlendirme</label><textarea id="capRootCause" ${planDisabled}>${escapeHtml(plan.rootCause || "")}</textarea></div><div class="field"><label>Genel Düzeltici Eylem Özeti</label><textarea id="capCorrectionSummary" ${planDisabled}>${escapeHtml(plan.proposedCorrectionSummary || "")}</textarea></div></div><div class="card span-6"><h3>Koordinasyon</h3><div class="field"><label>CAP Koordinatörü / İrtibat</label><input id="capCoordinator" value="${escapeHtml(plan.capCoordinator || "")}" ${planDisabled}></div><div class="field"><label>Plan Notu</label><textarea id="capPlanNote" ${planDisabled}>${escapeHtml(plan.planNote || "")}</textarea></div></div></div><h3 style="margin-top:14px">CAP Adımları</h3>${saveNotice}${stepHtml}${auditeeButtons}${evalPanel}${monitorPanel}</div>`;
}

function renderAuditeeCapModule() {
  const section = document.getElementById("auditeeCap");
  const rows = auditeeCapPlans();
  const selectedId = ensureCapSelection(rows, "auditeeCap");
  const selected = getCapPlan(selectedId);
  const portalNote = `<div class="info-banner"><strong>Kuruluş Portalı / CAP Girişi:</strong> Seçili test kuruluşu <strong>${escapeHtml(state.orgContext)}</strong>. Nihai rapor sonrası CAP planı azami 45 gün içinde sunulur. Her bulgu için en az bir CAP adımı zorunludur.<br><strong>Akış:</strong> CAP Planı / Bulgu Seç listesinden bir bulgu seç → CAP bilgilerini ve adımları doldur → Taslak Kaydet → diğer bulgular için tekrarla → hepsi tamamlanınca Tüm CAP Planlarını Onaya Sun.</div>`;
  section.innerHTML = portalNote + capDashboard(rows) + capEntryPanel(rows, selectedId) + capPlanSelect(rows, selectedId, "auditeeCap") + (selected ? capPlanDetailHtml(selected, "auditee") : `<div class="empty">Bu kuruluş için açık CAP kaydı bulunmuyor.</div>`);
}
function renderCapWorkflowSection(sectionId, rows, title, subtitle, context) {
  const selectedId = ensureCapSelection(rows, sectionId);
  const selected = getCapPlan(selectedId);
  const board = rows.length ? `<div class="cap-board"><div class="cap-column"><h3>${escapeHtml(title)} <span class="pill gray">${rows.length}</span></h3>${rows.map(c => capPlanCard(c, sectionId)).join("")}</div></div>` : `<div class="empty">Bu aşamada CAP kaydı bulunmuyor.</div>`;
  document.getElementById(sectionId).innerHTML = `<div class="info-banner"><strong>${escapeHtml(title)}:</strong> ${escapeHtml(subtitle)}</div>${capDashboard(rows)}${capPlanSelect(rows, selectedId, sectionId)}${board}${selected ? capPlanDetailHtml(selected, context) : ""}`;
}

export function renderFindingsAndCap() {
  const openRows = openFindings();
  const closedRows = closedFindings();
  const capWaiting = capPlanRowsByStatus("waiting");
  const capReview = capPlanRowsByStatus("review");
  const capMonitoring = capPlanRowsByStatus("monitoring");
  document.getElementById("findingsOpen").innerHTML = findingsTable(openRows, "Açık Bulgular", "Bulgu yalnızca NS denetim cevabından oluşur. Nihai rapor gönderildikten sonra CAP planı ile ilişkilendirilir.");
  renderCapWorkflowSection("capWaiting", capWaiting, "CAP Bekleyenler", "Nihai rapor sonrası 45 gün içinde CAP planı/adımı beklenen bulgular.", "waiting");
  renderCapWorkflowSection("capReview", capReview, "CAP Değerlendirme", "Sunulan CAP planı kabul, kısmen kabul/revizyon veya iade kararına bağlanır.", "review");
  renderCapWorkflowSection("capMonitoring", capMonitoring, "CAP İzleme", "Kabul edilen CAP adımlarının ilerleme, tamamlanma ve doğrulama süreci izlenir.", "monitoring");
  document.getElementById("closedFindings").innerHTML = findingsTable(closedRows, "Kapatılan Bulgular", "Tüm CAP adımları doğrulanarak kapatılan bulgular.");
  renderAuditeeCapModule();
}

export function renderCapReportModule() {
  const all = state.capPlans;
  const rows = all.slice().sort((a,b) => String(a.dueDate || "").localeCompare(String(b.dueDate || "")));
  const kanban = `<div class="cap-board"><div class="cap-column"><h3>Bekleyen <span class="pill gray">${capPlanRowsByStatus("waiting").length}</span></h3>${capPlanRowsByStatus("waiting").map(c => capPlanCard(c,"capWaiting")).join("") || `<div class="empty">Yok</div>`}</div><div class="cap-column"><h3>Değerlendirme <span class="pill gray">${capPlanRowsByStatus("review").length}</span></h3>${capPlanRowsByStatus("review").map(c => capPlanCard(c,"capReview")).join("") || `<div class="empty">Yok</div>`}</div><div class="cap-column"><h3>İzleme <span class="pill gray">${capPlanRowsByStatus("monitoring").length}</span></h3>${capPlanRowsByStatus("monitoring").map(c => capPlanCard(c,"capMonitoring")).join("") || `<div class="empty">Yok</div>`}</div></div>`;
  const table = rows.length ? `<div class="table-wrap"><table><thead><tr><th>CAP Plan</th><th>Kuruluş</th><th>Bulgu</th><th>Son Tarih</th><th>Durum</th><th>Adım / İlerleme</th></tr></thead><tbody>${rows.map(c => { const f = capPlanFinding(c); const m = capProgressMeta(c); return `<tr><td>${escapeHtml(capPlanIdOf(c))}</td><td>${escapeHtml(c.organizationName || "-")}</td><td>${escapeHtml(f.areaKey || "-")} / PQ ${escapeHtml(f.pqNo || "-")}</td><td>${escapeHtml(capDueText(c))}</td><td>${capStatusPill(c.status)}</td><td>${m.steps.length} adım / %${m.progress}<div class="progress-track"><span style="width:${m.progress}%"></span></div></td></tr>`; }).join("")}</tbody></table></div>` : `<div class="empty">CAP kaydı bulunmuyor.</div>`;
  document.getElementById("reportsCap").innerHTML = `<div class="info-banner"><strong>CAP Durum Raporu:</strong> CAP sunumu, değerlendirme, izleme, gecikme ve kapanış durumu tek ekranda izlenir.</div>${capDashboard(all)}${kanban}${table}`;
}

register("getCapPlan", getCapPlan);
register("capPlanIdOf", capPlanIdOf);
register("renderFindingsAndCap", renderFindingsAndCap);
register("renderCapReportModule", renderCapReportModule);
