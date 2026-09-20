import { DATA_FILE, COLLECTIONS, AREA_ORDER, AREA_LABELS, ROLES } from "../config.js";
import { state } from "../state.js";
import { escapeHtml, today } from "../utils.js";
import { extractNotesAndCriteria, criteriaCount } from "../master-data.js";
import { runtime, register, expose } from "../runtime.js";

export function renderMasterLibrary() {
  const el = document.getElementById("masterLibrary");
  if (!el) return;
  const areaOptions = AREA_ORDER.map(area => `<option value="${area}">${area} - ${AREA_LABELS[area]}</option>`).join("");
  el.innerHTML = `
    <div class="info-banner">Bu ekran master kontrol formu kütüphanesidir. Denetim cevabı, bulgu notu, incelenen kanıt, CAP veya kapanış alanı gösterilmez. Kayıtlar yalnızca <strong>${DATA_FILE}</strong> üzerinden okunur.</div>
    <div class="toolbar">
      <div class="field"><label>Audit Area</label><select id="masterArea" onchange="renderMasterRows()">${areaOptions}</select></div>
      <div class="field"><label>Dil</label><select id="masterLang" onchange="renderMasterRows()"><option value="tr">TR</option><option value="en">EN</option></select></div>
      <div class="field" style="flex:2"><label>Arama</label><input id="masterSearch" type="search" placeholder="PQ no, soru, referans veya kriter ara..." oninput="renderMasterRows()"></div>
      <button class="btn" onclick="renderMasterRows()">Listele</button>
    </div>
    <div id="masterStats"></div>
    <div id="masterRows"></div>`;
  renderMasterRows();
}

export function renderMasterRows() {
  const area = document.getElementById("masterArea")?.value || "LEG";
  const lang = document.getElementById("masterLang")?.value || "tr";
  const search = (document.getElementById("masterSearch")?.value || "").toLowerCase().trim();
  let rows = state.normalizedAreas[area]?.rows || [];
  if (search) rows = rows.filter(row => [row.pqNo, row.ce, row.questionEn, row.questionTr, row.reference, row.reviewEvidenceEn, row.reviewEvidenceTr].join(" ").toLowerCase().includes(search));
  const totalCriteria = rows.reduce((sum, row) => sum + criteriaCount(row), 0);
  const stats = document.getElementById("masterStats");
  const list = document.getElementById("masterRows");
  if (!stats || !list) return;
  stats.innerHTML = `<div class="card" style="margin-bottom:12px"><strong>${area} - ${AREA_LABELS[area]}</strong> <span class="pill blue">${rows.length} PQ</span><span class="pill yellow">${totalCriteria} kriter</span><span class="pill gray">Read-only</span><span class="pill green">${DATA_FILE}</span></div>`;
  list.innerHTML = rows.map(row => {
    const q = lang === "tr" ? (row.questionTr || row.questionEn) : (row.questionEn || row.questionTr);
    const ev = lang === "tr" ? (row.reviewEvidenceTr || row.reviewEvidenceEn) : (row.reviewEvidenceEn || row.reviewEvidenceTr);
    const parsed = extractNotesAndCriteria(ev);
    const note = parsed.noteText;
    const criteria = parsed.criteriaLines.join("\n");
    return `<div class="pq-card">
      <div class="pq-head">
        <div class="pq-title"><span class="pq-no">PQ ${escapeHtml(row.pqNo)}</span><span>${escapeHtml(q)}</span></div>
        <div style="margin-top:8px"><span class="pill blue">${escapeHtml(row.ce || area)}</span>${row.ppq ? `<span class="pill red">PPQ</span>` : ""}<span class="pill green">${row.onSiteRequired ? "On-Site" : "Off-Site"}</span><span class="pill yellow">${criteriaCount(row)} Kriter</span></div>
      </div>
      <div class="pq-body">
        <div class="prebox"><strong>Reference</strong>\n${escapeHtml(row.reference || "-")}</div>
        <div class="prebox"><strong>${lang === "tr" ? "İncelenecek Kanıtlar / Kriter" : "Review Evidence / Criteria"}</strong>\n${escapeHtml(criteria || ev || "-")}</div>
        ${note ? `<div class="note-box" style="grid-column:1/-1"><strong>${lang === "tr" ? "Denetçiye Notlar" : "Notes to the Auditor"}</strong>\n${escapeHtml(note)}</div>` : ""}
      </div>
    </div>`;
  }).join("") || `<div class="empty">Kriterlere uygun master PQ bulunamadı.</div>`;
}

export function renderFormRevisions() {
  const isAdmin = state.role === "admin";
  const el = document.getElementById("formRevisions");
  if (!el) return;
  el.innerHTML = `
    ${isAdmin ? `<div class="info-banner">Yönetici rolü master kontrol formu revizyonlarını yönetebilir. Faz 2'de revizyon metadata kaydı korunur; gerçek PQ satır snapshot'larının alt koleksiyon olarak saklanması sonraki revizyon geliştirmesinde önerilir.</div>` : `<div class="warn-banner">Bu ekran sadece yönetici rolüyle düzenlenebilir. Mevcut rol: ${escapeHtml(ROLES[state.role])}</div>`}
    <div class="table-wrap"><table><thead><tr><th>Form</th><th>Aktif Revizyon</th><th>Yürürlük</th><th>Kaynak</th><th>PQ</th><th>Durum</th><th>İşlem</th></tr></thead><tbody>
      ${AREA_ORDER.map(area => {
        const rev = state.formRevisions.find(r => r.formId === area && r.status === "active") || {};
        return `<tr><td><strong>${area}</strong><br><small>${AREA_LABELS[area]}</small></td><td>${escapeHtml(rev.revisionNo || "-")}</td><td>${escapeHtml(rev.effectiveDate || "-")}</td><td>${escapeHtml(rev.sourceFile || DATA_FILE)}</td><td>${state.normalizedAreas[area]?.rows?.length || 0}</td><td><span class="pill green">Aktif</span></td><td>${isAdmin ? `<button class="btn" onclick="createRevisionMeta('${area}')">Yeni Revizyon Metadata</button>` : `<span class="pill gray">Read-only</span>`}</td></tr>`;
      }).join("")}
    </tbody></table></div>`;
}

export async function createRevisionMeta(area) {
  if (state.role !== "admin") return alert("Revizyon işlemi için yönetici rolü gerekir.");
  const revNo = prompt(`${area} için revizyon no girin`, `${new Date().getFullYear()}-01`);
  if (!revNo) return;
  const revisionId = `${area}-REV-${revNo}`.replace(/\s+/g, "-");
  const data = {
    revisionId,
    formId: area,
    revisionNo: revNo,
    effectiveDate: today(),
    changeSummary: prompt("Değişiklik özeti", "Revizyon metadata kaydı oluşturuldu.") || "",
    changedBy: state.role,
    status: "active",
    sourceFile: DATA_FILE,
    rowCount: state.normalizedAreas[area]?.rows?.length || 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.formRevisions = state.formRevisions.map(r => r.formId === area ? { ...r, status: "archived", updatedAt: new Date().toISOString() } : r);
  for (const old of state.formRevisions.filter(r => r.formId === area && r.status === "archived" && !r.localOnly)) {
    await runtime.saveRecord(COLLECTIONS.formRevisions, old.revisionId || old.id, old);
  }
  state.formRevisions.push(data);
  await runtime.saveRecord(COLLECTIONS.formRevisions, revisionId, data);
  runtime.renderAll();
  runtime.showSection("formRevisions");
}

export function renderRevisionArchive() {
  const archived = state.formRevisions.filter(r => r.status === "archived");
  const el = document.getElementById("revisionArchive");
  if (!el) return;
  el.innerHTML = archived.length ? `<div class="table-wrap"><table><thead><tr><th>Form</th><th>Revizyon</th><th>Yürürlük</th><th>Özet</th><th>Kaynak</th></tr></thead><tbody>${archived.map(r => `<tr><td>${escapeHtml(r.formId)}</td><td>${escapeHtml(r.revisionNo)}</td><td>${escapeHtml(r.effectiveDate)}</td><td>${escapeHtml(r.changeSummary)}</td><td>${escapeHtml(r.sourceFile)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">Arşivlenmiş revizyon bulunmuyor.</div>`;
}

register("renderMasterLibrary", renderMasterLibrary);
register("renderFormRevisions", renderFormRevisions);
register("renderRevisionArchive", renderRevisionArchive);
expose("renderMasterRows", renderMasterRows);
expose("createRevisionMeta", createRevisionMeta);
expose("renderMasterLibrary", renderMasterLibrary);
