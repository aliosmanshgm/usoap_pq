// Faz 8B.6 - Bildirim merkezi, gecikme/son tarih hesapları ve rol bazlı görünürlük.
import { state } from "../state.js";
import { escapeHtml, parseYmdLocal, today, formatDate } from "../utils.js";
import { runtime, register, expose } from "../runtime.js";
import { getAudit } from "../selectors.js";
import { getAssignment } from "./assignments.js";
import { getCapPlan, capPlanIdOf } from "./cap.js";
import { activeUid, profileOrg } from "./auth-users.js";
import { showSection } from "./ui-shell.js";

function jsArg(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\r?\n/g, " ");
}

export function daysFromToday(dateText) {
  const a = parseYmdLocal(today());
  const b = parseYmdLocal(dateText);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}

export function deadlineClass(dateText, completed = false) {
  if (completed) return "ok";
  const d = daysFromToday(dateText);
  if (d === null) return "ok";
  if (d < 0) return "overdue";
  if (d <= 7) return "soon";
  return "ok";
}

export function deadlineText(dateText, completed = false) {
  if (!dateText) return "Tarih yok";
  if (completed) return `Tamamlandı / ${formatDate(dateText)}`;
  const d = daysFromToday(dateText);
  if (d === null) return formatDate(dateText);
  if (d < 0) return `${formatDate(dateText)} / ${Math.abs(d)} gün gecikti`;
  if (d === 0) return `${formatDate(dateText)} / bugün son gün`;
  return `${formatDate(dateText)} / ${d} gün kaldı`;
}

export function deadlineBadge(dateText, completed = false) {
  return `<span class="deadline-inline ${deadlineClass(dateText, completed)}">${escapeHtml(deadlineText(dateText, completed))}</span>`;
}

export function isAuditVisibleForCurrentUser(audit) {
  if (!audit) return false;
  if (state.demoMode || !state.authUser) return true;
  if (["admin", "program_manager", "viewer"].includes(state.role)) return true;
  if (state.role === "auditee") return audit.organizationId === profileOrg();
  const assignment = getAssignment(audit.auditId) || {};
  const uid = activeUid();
  const email = String(state.authUser?.email || "").toLowerCase();
  const name = String(state.userProfile?.displayName || "").toLowerCase();
  const uidFields = [
    assignment.leadAuditorUid,
    ...(assignment.auditorUids || []),
    ...(assignment.technicalExpertUids || []),
    ...(assignment.observerUids || [])
  ].filter(Boolean);
  if (uidFields.includes(uid)) return true;
  const text = [
    assignment.leadAuditorName,
    ...(assignment.auditorNames || []),
    ...(assignment.technicalExpertNames || [])
  ].join(" ").toLowerCase();
  return (!!email && text.includes(email)) || (!!name && text.includes(name));
}

export function visibleAuditsForCurrentUser(rows = state.audits) {
  return rows.filter(isAuditVisibleForCurrentUser);
}

export function buildNotifications() {
  const out = [];
  const add = n => {
    if (n.date && (n.days === null || n.days <= 14 || n.severity === "overdue")) out.push(n);
  };

  visibleAuditsForCurrentUser().forEach(a => {
    const pushAudit = (kind, title, date, doneStatuses, section, actionText) => {
      const done = doneStatuses.includes(a.status);
      if (done) return;
      const days = daysFromToday(date);
      const severity = days !== null && days < 0 ? "overdue" : days !== null && days <= 7 ? "soon" : "info";
      add({
        id: `audit-${a.auditId}-${kind}`,
        type: "audit",
        severity,
        days,
        date,
        section,
        title,
        actionText,
        auditId: a.auditId,
        org: a.organizationName,
        text: `${a.auditId} / ${a.organizationName || "-"} / ${deadlineText(date)}`
      });
    };
    if (["planned", "programmed"].includes(a.status)) {
      pushAudit("auditee-response", "Kuruluş cevap süresi yaklaşıyor", a.auditeeResponseDueDate, ["pre_evaluation", "audit_in_progress", "objection_period", "final_report_preparation", "final_report_sent", "cap_waiting", "cap_under_review", "cap_monitoring", "closed"], "waitingAuditeeResponse", "Cevap sürecini kontrol et");
    }
    if (["waiting_auditee_response", "pre_evaluation"].includes(a.status)) {
      pushAudit("preeval", "Ön değerlendirme son tarihi", a.preEvaluationDueDate, ["audit_in_progress", "objection_period", "final_report_preparation", "final_report_sent", "cap_waiting", "cap_under_review", "cap_monitoring", "closed"], "preEvaluation", "Ön değerlendirme");
    }
    if (a.status === "objection_period") {
      pushAudit("objection", "İtiraz bildirimi son tarihi", a.objectionDueDate, ["final_report_preparation", "final_report_sent", "cap_waiting", "cap_under_review", "cap_monitoring", "closed"], state.role === "auditee" ? "auditeeObjections" : "objectionAudits", "İtiraz sürecini aç");
    }
    if (a.status === "final_report_preparation") {
      pushAudit("final-report", "Nihai rapor son tarihi", a.finalReportDueDate, ["final_report_sent", "cap_waiting", "cap_under_review", "cap_monitoring", "closed"], "reportsAudit", "Nihai rapor");
    }
    if (["final_report_sent", "cap_waiting"].includes(a.status)) {
      pushAudit("cap-submit", "CAP sunma son tarihi", a.capDueDate, ["cap_under_review", "cap_monitoring", "closed"], state.role === "auditee" ? "auditeeCap" : "capWaiting", "CAP girişi");
    }
  });

  state.capPlans.filter(c => isAuditVisibleForCurrentUser(getAudit(c.auditId))).forEach(c => {
    if (["finding_closed", "closed"].includes(c.status)) return;
    const days = daysFromToday(c.dueDate);
    const severity = days !== null && days < 0 ? "overdue" : days !== null && days <= 7 ? "soon" : "info";
    add({
      id: `cap-${capPlanIdOf(c)}-due`,
      type: "cap",
      severity,
      days,
      date: c.dueDate,
      section: state.role === "auditee" ? "auditeeCap" : "capWaiting",
      title: "CAP planı son tarihi",
      actionText: "CAP planını aç",
      auditId: c.auditId,
      org: c.organizationName,
      text: `${capPlanIdOf(c)} / ${c.organizationName || "-"} / ${deadlineText(c.dueDate)}`
    });
  });

  state.capSteps.forEach(step => {
    const plan = getCapPlan(step.capPlanId);
    if (!plan || ["verified", "deleted"].includes(step.status)) return;
    if (!isAuditVisibleForCurrentUser(getAudit(plan.auditId))) return;
    const date = step.revisedImplementationDate || step.estimatedImplementationDate;
    const days = daysFromToday(date);
    const severity = days !== null && days < 0 ? "overdue" : days !== null && days <= 7 ? "soon" : "info";
    add({
      id: `capstep-${step.capStepId || step.id}`,
      type: "cap-step",
      severity,
      days,
      date,
      section: state.role === "auditee" ? "auditeeCap" : "capMonitoring",
      title: `CAP adımı ${step.stepNo || ""}`,
      actionText: "CAP izle",
      auditId: plan.auditId,
      org: plan.organizationName,
      text: `${plan.organizationName || "-"} / ${step.responsibleUnit || "-"} / ${deadlineText(date)}`
    });
  });

  return out.sort((a,b) => (a.days ?? 9999) - (b.days ?? 9999));
}

export function notificationStats(notifs) {
  return {
    total: notifs.length,
    unread: notifs.filter(n => !state.notificationReads.includes(n.id)).length,
    overdue: notifs.filter(n => n.severity === "overdue").length,
    soon: notifs.filter(n => n.severity === "soon").length
  };
}

export function renderNotificationsPanel() {
  const el = document.getElementById("notifications");
  if (!el) return;
  const rows = buildNotifications();
  const stats = notificationStats(rows);
  const list = rows.length
    ? rows.map(n => `<div class="notification-item ${n.severity} ${state.notificationReads.includes(n.id)?"done":""}"><div><h4>${escapeHtml(n.title)} ${deadlineBadge(n.date)}</h4><p>${escapeHtml(n.text)}<br><strong>İlgili kayıt:</strong> ${escapeHtml(n.auditId || "-")} | ${escapeHtml(n.org || "-")}</p></div><div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><button class="btn primary" onclick="openNotification('${jsArg(n.id)}')">${escapeHtml(n.actionText || "Aç")}</button><button class="btn" onclick="markNotificationRead('${jsArg(n.id)}')">Okundu</button></div></div>`).join("")
    : `<div class="empty">Açık bildirim veya gecikme uyarısı bulunmuyor.</div>`;
  el.innerHTML = `<div class="info-banner"><strong>Faz 8A Bildirim Merkezi:</strong> Kritik tarihler, gecikmeler ve 14 gün içindeki yaklaşan görevler bu ekranda toplanır. Statik GitHub Pages ortamında arka plan zamanlayıcı olmadığı için uyarılar sayfa açıldığında ve yenilendiğinde hesaplanır.</div><div class="notification-strip"><div class="notification-stat"><b>${stats.total}</b><span>Toplam uyarı</span></div><div class="notification-stat"><b>${stats.unread}</b><span>Okunmamış</span></div><div class="notification-stat"><b>${stats.overdue}</b><span>Geciken</span></div><div class="notification-stat"><b>${stats.soon}</b><span>7 gün içinde</span></div></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"><button class="btn success" onclick="markAllNotificationsRead()">Tümünü Okundu Yap</button><button class="btn warning" onclick="applyAutomaticDeadlineTransitions(true)">Süreleri Kontrol Et / Uygula</button></div><div class="notification-list">${list}</div>`;
}

export function markNotificationRead(id) {
  if (!state.notificationReads.includes(id)) state.notificationReads.push(id);
  localStorage.setItem("usoap_phase7_notification_reads", JSON.stringify(state.notificationReads));
  renderNotificationsPanel();
  runtime.renderAuthState?.();
}

export function markAllNotificationsRead() {
  state.notificationReads = [...new Set([...state.notificationReads, ...buildNotifications().map(n => n.id)])];
  localStorage.setItem("usoap_phase7_notification_reads", JSON.stringify(state.notificationReads));
  renderNotificationsPanel();
  runtime.renderAuthState?.();
}

export function openNotification(id) {
  const n = buildNotifications().find(x => x.id === id);
  if (!n) return;
  markNotificationRead(id);
  if (n.auditId) {
    if (n.section === "reportsAudit") state.currentFinalReportAuditId = n.auditId;
    if (n.section === "preEvaluation") state.currentPreEvaluationAuditId = n.auditId;
    if (n.section === "auditExecution") state.currentAuditExecutionId = n.auditId;
    if (n.section === "auditeeObjections" || n.section === "objectionAudits") state.currentObjectionAuditId = n.auditId;
  }
  showSection(n.section || "notifications");
}

register("buildNotifications", buildNotifications);
register("visibleAuditsForCurrentUser", visibleAuditsForCurrentUser);
register("deadlineBadge", deadlineBadge);
register("renderNotificationsPanel", renderNotificationsPanel);

expose("markNotificationRead", markNotificationRead);
expose("markAllNotificationsRead", markAllNotificationsRead);
expose("openNotification", openNotification);
