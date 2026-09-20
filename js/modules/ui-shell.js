import { ROLES, ROLE_SECTIONS, MENUS } from "../config.js";
import { state } from "../state.js";
import { escapeHtml } from "../utils.js";
import { runtime, register, expose } from "../runtime.js";

export function sectionAllowed(sectionId) {
  if (sectionId === "notifications") return true;
  if (runtime.isAuthLocked?.() && runtime.userIsPending?.(state.userProfile)) {
    return ["home", "settings", "notifications"].includes(sectionId);
  }
  const allowed = ROLE_SECTIONS[state.role];
  return allowed === "all" || (Array.isArray(allowed) && allowed.includes(sectionId));
}

export function getOrganizationContextOptions() {
  const map = new Map();
  state.audits.forEach(a => {
    const id = a.organizationId || "";
    if (!id) return;
    map.set(id, { id, name: a.organizationName || id, auditCount: (map.get(id)?.auditCount || 0) + 1 });
  });
  state.organizations.forEach(o => {
    const id = o.organizationId || o.id || "";
    if (!id) return;
    const existing = map.get(id);
    map.set(id, { id, name: o.name || existing?.name || id, auditCount: existing?.auditCount || 0 });
  });
  if (state.orgContext && !map.has(state.orgContext)) {
    map.set(state.orgContext, { id: state.orgContext, name: state.orgContext, auditCount: 0 });
  }
  if (!map.size) map.set("org_demo", { id: "org_demo", name: "Demo Kuruluş", auditCount: 0 });
  return [...map.values()].sort((a,b) => String(a.name).localeCompare(String(b.name), "tr"));
}

export function renderRoleSelect() {
  const select = document.getElementById("roleSelect");
  if (!select) return;
  select.innerHTML = Object.entries(ROLES).map(([key, label]) => `<option value="${key}" ${key === state.role ? "selected" : ""}>${label}</option>`).join("");
  const orgOptions = getOrganizationContextOptions();
  const orgSelect = document.getElementById("orgContextSelect");
  const currentExists = orgOptions.some(o => o.id === state.orgContext);
  if (!currentExists && orgOptions[0] && !(runtime.isAuthLocked?.() && state.role === "auditee")) state.orgContext = orgOptions[0].id;
  if (orgSelect) {
    orgSelect.innerHTML = orgOptions.map(o => `<option value="${escapeHtml(o.id)}" ${o.id === state.orgContext ? "selected" : ""}>${escapeHtml(o.name)} — ${escapeHtml(o.id)}${o.auditCount ? ` (${o.auditCount} denetim)` : ""}</option>`).join("");
  }
  const manual = document.getElementById("orgContextInput");
  if (manual) manual.value = state.orgContext;
  runtime.renderAuthState?.();
}

export function renderMenu() {
  const root = document.getElementById("menuRoot");
  if (!root) return;
  root.innerHTML = MENUS.map(group => {
    const items = group.items.map(item => {
      const hidden = sectionAllowed(item.id) ? "" : " hidden-by-role";
      const active = state.currentSection === item.id ? " active" : "";
      return `<div class="menu-item${hidden}${active}" onclick="showSection('${item.id}')"><span>${escapeHtml(item.label)}</span><small>${escapeHtml(item.tag || "")}</small></div>`;
    }).join("");
    return `<div class="menu-group"><div class="menu-title">${escapeHtml(group.group)}</div>${items}</div>`;
  }).join("");
}

export function setTitle(title, subtitle) {
  const titleEl = document.getElementById("pageTitle");
  const subtitleEl = document.getElementById("pageSubtitle");
  if (titleEl) titleEl.innerText = title;
  if (subtitleEl) subtitleEl.innerText = subtitle || "";
}

export function renderSection(sectionId) {
  const map = {
    home: ["Ana Sayfa", "Faz 8B.7: Firestore/localStorage veri erişimi repository.js içinde merkezileştirildi; Faz 8A veri güvenliği korunur."],
    notifications: ["Bildirimler / Gecikme Uyarıları", "Kritik tarihler, geciken işler, yaklaşan görevler ve CAP uyarıları."],
    masterLibrary: ["Master Kontrol Formları / Form Kütüphanesi", "JSON kaynaklı read-only PQ master kütüphanesi."],
    formRevisions: ["Form Revizyonları", "Yönetici rolü için master kontrol formu revizyon omurgası."],
    revisionArchive: ["Revizyon Arşivi", "Arşivlenmiş form revizyonları."],
    programCreate: ["Yıllık Denetim Programı Oluştur", "Her yıl için ayrı denetim programı oluşturulur."],
    annualPrograms: ["Yıllık Programlar", "Oluşturulan yıllık denetim programları."],
    programAddAudit: ["Programa Denetim Ekle", "Yıllık programa bağlı planlı denetim kaydı oluşturulur."],
    auditFile: ["Denetim Dosyası / Heyet Atama", "Seçili denetimin planlama dosyası, heyet ve görev dağılımı yönetilir."],
    plannedAudits: ["Planlı Denetimler", "Planlı veya programa alınmış denetimler."],
    waitingAuditeeResponse: ["Cevap Bekleyen Denetimler", "Denetlenen kuruluş cevap sürecindeki denetimler."],
    preEvaluation: ["Ön Değerlendirme", "Kuruluş cevapları üzerinden denetim heyeti ön değerlendirme notları ve sahada doğrulama planı."],
    activeAudits: ["Aktif Denetimler", "Denetim uygulama aşaması."],
    auditExecution: ["Denetim Çalışması", "Aktif denetimde PQ bazlı S / NS / NA değerlendirme, mevzuat dayanağı, incelenen kanıt ve bulgu oluşturma."],
    objectionAudits: ["İtiraz Süreci", "Denetim bitişinden sonraki 2 günlük itiraz var/yok bildirim ve değerlendirme süreci."],
    finalReportAudits: ["Nihai Rapor Bekleyenler", "Nihai rapor ve CAP bekleme süreci."],
    auditeeAssigned: ["Kuruluş Portalı / Bana Atanan Denetimler", "Denetlenen kuruluş kullanıcısı sadece kendi kayıtlarını görür."],
    auditeeResponses: ["Kuruluş Portalı / Ön Cevaplar", "Kuruluşun denetim öncesi cevap ve kanıt bağlantısı gireceği alan."],
    auditeeObjections: ["Kuruluş Portalı / İtiraz Bildirimi", "2 günlük itiraz sürecinde itiraz var/yok bildirimi."],
    auditeeCap: ["Kuruluş Portalı / CAP Girişi", "Nihai rapordan sonra 45 gün içinde CAP planı sunulacak alan."],
    findingsOpen: ["Açık Bulgular", "Sadece NS kayıtlarından oluşan bulgu listesi."],
    capWaiting: ["CAP Bekleyenler", "45 günlük CAP sunma süresi izlenir."],
    capReview: ["CAP Değerlendirme", "Kabul, kısmen kabul/revizyon veya iade süreci."],
    capMonitoring: ["CAP İzleme", "Kabul edilen CAP adımlarının ilerleme ve doğrulama süreci."],
    closedFindings: ["Kapatılan Bulgular", "Doğrulanarak kapatılmış bulgular."],
    reportsAudit: ["Denetim Raporları", "Nihai rapor hazırlama, taslak kayıt ve gönderme işlemleri."],
    reportsProgram: ["Program Özeti", "Yıllık program bazında özet."],
    reportsCap: ["CAP Durum Raporu", "CAP bekleyen, geciken ve kapanan bulgular."],
    archive: ["Arşiv", "Arşivlenen denetim, program ve revizyon kayıtları."],
    settings: ["Ayarlar / Yetkiler", "Rol matrisi, veri modeli ve faz bilgileri."]
  };
  const [title, subtitle] = map[sectionId] || ["USOAP CMA", ""];
  setTitle(title, subtitle);
}

export function showModal(title, body) {
  let modal = document.getElementById("appModal");
  if (!modal) {
    document.body.insertAdjacentHTML("beforeend", `<div id="appModal" class="modal-backdrop"><div class="modal-card"><div class="modal-head"><h3 id="appModalTitle"></h3><button class="btn" onclick="closeModal()">Kapat</button></div><div id="appModalBody" class="modal-body"></div></div></div>`);
    modal = document.getElementById("appModal");
    modal.addEventListener("click", e => { if (e.target.id === "appModal") closeModal(); });
  }
  document.getElementById("appModalTitle").innerHTML = title;
  document.getElementById("appModalBody").innerHTML = body;
  modal.classList.add("open");
}

export function closeModal() {
  const modal = document.getElementById("appModal");
  if (modal) modal.classList.remove("open");
}

export function setRole(role) {
  if (runtime.isAuthLocked?.()) {
    renderRoleSelect();
    return alert("Gerçek kullanıcı girişinde rol, users profil kaydından gelir ve test menüsünden değiştirilemez.");
  }
  state.role = role;
  localStorage.setItem("usoap_phase1_role", role);
  if (!sectionAllowed(state.currentSection)) state.currentSection = "home";
  runtime.renderAll?.();
  showSection(state.currentSection);
}

export function setOrgContext(orgId) {
  if (runtime.isAuthLocked?.() && state.role === "auditee") {
    state.orgContext = runtime.profileOrg?.() || state.orgContext;
    renderRoleSelect();
    return alert("Denetlenen Kuruluş kullanıcısında kuruluş bağlamı profil kaydından gelir ve değiştirilemez.");
  }
  state.orgContext = orgId || "org_demo";
  localStorage.setItem("usoap_phase1_org", state.orgContext);
  const manual = document.getElementById("orgContextInput");
  if (manual) manual.value = state.orgContext;
  const orgSelect = document.getElementById("orgContextSelect");
  if (orgSelect && [...orgSelect.options].some(o => o.value === state.orgContext)) orgSelect.value = state.orgContext;
  runtime.renderAll?.();
}

export function showSection(sectionId) {
  if (!sectionAllowed(sectionId)) {
    alert("Bu rol için bu ekrana erişim görünür değildir. Test rolünü değiştirerek deneyebilirsiniz.");
    return;
  }
  state.currentSection = sectionId;
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  const el = document.getElementById(sectionId);
  if (el) el.classList.add("active");
  renderMenu();
  renderSection(sectionId);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export async function refreshAll() {
  await runtime.loadData?.();
  runtime.renderAll?.();
  showSection(state.currentSection);
}

register("sectionAllowed", sectionAllowed);
register("getOrganizationContextOptions", getOrganizationContextOptions);
register("renderRoleSelect", renderRoleSelect);
register("renderMenu", renderMenu);
register("setTitle", setTitle);
register("renderSection", renderSection);
register("showModal", showModal);
register("closeModal", closeModal);
expose("setRole", setRole);
expose("setOrgContext", setOrgContext);
expose("showSection", showSection);
expose("refreshAll", refreshAll);
expose("showModal", showModal);
expose("closeModal", closeModal);
