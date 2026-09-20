// Faz 8B.5 - Bulgular modülü.
// Açık/kapatılmış bulgu listelerinin salt görüntüleme tablosu burada tutulur.
import { state } from "../state.js";
import { escapeHtml } from "../utils.js";

export function openFindings() {
  return state.findings.filter(f => !["closed", "finding_closed", "void", "withdrawn"].includes(f.status));
}

export function closedFindings() {
  return state.findings.filter(f => ["closed", "finding_closed"].includes(f.status));
}

export function findingsTable(rows, title, subtitle) {
  if (!rows.length) return `<div class="info-banner"><strong>${title}:</strong> ${subtitle}</div><div class="empty">Kayıt bulunmuyor.</div>`;
  return `<div class="info-banner"><strong>${title}:</strong> ${subtitle}</div><div class="table-wrap"><table><thead><tr><th>Bulgu</th><th>Denetim</th><th>Area / PQ</th><th>CE</th><th>Bulgu Metni</th><th>Durum</th></tr></thead><tbody>${rows.map(f => `<tr><td>${escapeHtml(f.findingId || f.id)}</td><td>${escapeHtml(f.auditId || "-")}</td><td>${escapeHtml(f.areaKey || "-")} / ${escapeHtml(f.pqNo || "-")}</td><td>${escapeHtml(f.ce || "-")}</td><td>${escapeHtml(f.findingText || "-")}</td><td>${escapeHtml(f.status || "open")}</td></tr>`).join("")}</tbody></table></div>`;
}
