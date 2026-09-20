import {
  DATA_FILE, COLLECTIONS, AREA_ORDER, AREA_LABELS, AUDIT_STATUS, CAP_STATUS
} from "./config.js";
import { state } from "./state.js";
import { escapeHtml, today } from "./utils.js";
import {
  initRepository, isProductionDataMode, dataModeLabel, readDocument, readCollection, saveRecord, updateRecord
} from "./repository.js";
import { getRowsFromModel, normalizeRow } from "./master-data.js";
import { runtime, register } from "./runtime.js";
import {
  getOrganizationContextOptions, renderRoleSelect, renderMenu, setTitle, showSection
} from "./modules/ui-shell.js";
import {
  renderMasterLibrary, renderFormRevisions, renderRevisionArchive
} from "./modules/master-forms.js";
import { renderProgramCreate, renderAnnualPrograms } from "./modules/programs.js";
import { renderProgramAddAudit, renderAuditList, renderAuditCard } from "./modules/audits.js";
import { renderAuditFile } from "./modules/assignments.js";
import { auditeeVisibleAudits } from "./modules/workflow-context.js";
import { renderAuditeeResponses } from "./modules/auditee-responses.js";
import { renderPreEvaluation } from "./modules/pre-evaluation.js";
import { renderAuditExecution } from "./modules/audit-execution.js";
import { renderAuditeeObjections } from "./modules/objections.js";
import { renderFinalReportModule } from "./modules/final-reports.js";
import { renderFindingsAndCap, renderCapReportModule } from "./modules/cap.js";
import {
  initAuthGate, makePendingUserProfile, applyAuthProfile, renderAuthState
} from "./modules/auth-users.js";
import { renderNotificationsPanel } from "./modules/notifications.js";
import { renderSettings } from "./modules/settings.js";

// Faz 8B.7: Demo/gerçek veri ayrımı ve Firestore/localStorage erişimi repository.js içine taşındı.
  async function ensureCurrentUserProfile() {
    if (!isProductionDataMode()) return null;
    if (!state.db || !state.authUser) throw new Error("Firebase kullanıcı oturumu hazır değil.");

    let profile = await readDocument(COLLECTIONS.users, state.authUser.uid);
    if (profile) {
      const heartbeat = { lastLoginAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      if (!profile.email && state.authUser.email) heartbeat.email = state.authUser.email;
      if (!profile.displayName && (state.authUser.displayName || state.authUser.email)) {
        heartbeat.displayName = state.authUser.displayName || state.authUser.email;
      }
      await updateRecord(COLLECTIONS.users, state.authUser.uid, heartbeat);
      profile = { ...profile, ...heartbeat };
    } else {
      profile = makePendingUserProfile();
      await saveRecord(COLLECTIONS.users, state.authUser.uid, profile);
    }

    state.userProfile = profile;
    state.users = profile ? [profile] : [];
    applyAuthProfile();
    return profile;
  }

  async function loadMasterModel() {
    const response = await fetch(DATA_FILE, { cache: "no-store" });
    if (!response.ok) throw new Error(`${DATA_FILE} okunamadı.`);
    const model = await response.json();
    state.masterRows = getRowsFromModel(model).map(normalizeRow).filter(x => x.areaKey);
    AREA_ORDER.forEach(area => {
      const rows = state.masterRows.filter(row => row.areaKey === area);
      state.normalizedAreas[area] = { areaKey: area, areaName: AREA_LABELS[area], rows };
    });
  }

  async function loadData() {
    if (isProductionDataMode()) await ensureCurrentUserProfile();
    state.users = await readCollection(COLLECTIONS.users);
    applyAuthProfile();
    state.auditPrograms = await readCollection(COLLECTIONS.auditPrograms);
    state.audits = await readCollection(COLLECTIONS.audits);
    state.auditAssignments = await readCollection(COLLECTIONS.auditAssignments);
    state.organizationResponses = await readCollection(COLLECTIONS.organizationResponses);
    state.auditPreEvaluations = await readCollection(COLLECTIONS.auditPreEvaluations);
    state.auditResponses = await readCollection(COLLECTIONS.auditResponses);
    state.organizations = await readCollection(COLLECTIONS.organizations);
    state.findings = await readCollection(COLLECTIONS.findings);
    state.capPlans = await readCollection(COLLECTIONS.capPlans);
    state.capSteps = await readCollection(COLLECTIONS.capSteps);
    state.reports = await readCollection(COLLECTIONS.reports);
    state.formRevisions = await readCollection(COLLECTIONS.formRevisions);
    ensureDefaultRevisions();
    // Faz 8A: sayfa açılışında hiçbir süre/statü kaydı otomatik değiştirilmez.
    // Süre kontrolü uyarı üretir; resmi geçiş yalnızca kullanıcı onayıyla uygulanır.
  }

  function ensureDefaultRevisions() {
    const existing = new Set(state.formRevisions.map(r => r.formId));
    AREA_ORDER.forEach(area => {
      if (!existing.has(area)) {
        state.formRevisions.push({
          id: `${area}-REV-JSON-CURRENT`,
          revisionId: `${area}-REV-JSON-CURRENT`,
          formId: area,
          revisionNo: "JSON-CURRENT",
          effectiveDate: today(),
          changeSummary: `${DATA_FILE} içindeki aktif master veri seti.` ,
          status: "active",
          sourceFile: DATA_FILE,
          rowCount: state.normalizedAreas[area]?.rows?.length || 0,
          createdAt: new Date().toISOString(),
          localOnly: true
        });
      }
    });
  }


  function renderAll() {
    renderRoleSelect();
    renderMenu();
    renderHome();
    renderMasterLibrary();
    renderFormRevisions();
    renderRevisionArchive();
    renderProgramCreate();
    renderAnnualPrograms();
    renderProgramAddAudit();
    renderAuditFile();
    renderAuditList("plannedAudits", ["planned", "programmed"], "Planlı Denetimler", "Programa alınmış veya planlanmış denetimler.");
    renderAuditList("waitingAuditeeResponse", ["waiting_auditee_response"], "Cevap Bekleyen Denetimler", "Kuruluşa ön cevap süresi verilmiş denetimler.");
    renderPreEvaluation();
    renderAuditList("activeAudits", ["audit_in_progress"], "Aktif Denetimler", "Denetim tarihleri içinde sahada/uzaktan yürütülen denetimler.");
    renderAuditExecution();
    renderAuditList("objectionAudits", ["objection_period"], "İtiraz Sürecindeki Denetimler", "Denetim bitişinden itibaren 2 günlük itiraz süreci.");
    renderAuditList("finalReportAudits", ["final_report_preparation", "final_report_sent", "cap_waiting"], "Nihai Rapor Bekleyenler", "Denetim bitişinden itibaren 15 gün içinde nihai rapor hazırlanır/gönderilir; gönderim sonrası CAP süresi başlar.");
    renderAuditeePortal();
    renderFindingsAndCap();
    renderReports();
    renderArchive();
    renderSettings();
    renderNotificationsPanel();
    renderAuthState();
  }

  function renderHome() {
    const totalPq = state.masterRows.length;
    const programs = state.auditPrograms.length;
    const audits = state.audits.length;
    const activePrograms = state.auditPrograms.filter(p => ["approved", "active"].includes(p.status)).length;
    const planned = state.audits.filter(a => a.status === "planned").length;
    const responseWaiting = state.audits.filter(a => a.status === "waiting_auditee_response").length;
    const findings = state.findings.filter(f => f.status !== "closed" && f.status !== "finding_closed").length;
    document.getElementById("home").innerHTML = `
      <div class="info-banner">
        <strong>Faz 8B.7 veri erişim katmanı / Faz 8A stabilizasyonu:</strong> Gerçek Firebase veri modu localStorage'dan ayrıldı; tarih ve CAP veri bütünlüğü güçlendirildi.
      </div>
      <div class="data-mode-note ${isProductionDataMode() ? "production" : "demo"}"><strong>Veri modu:</strong> ${escapeHtml(dataModeLabel())}. ${isProductionDataMode() ? "Kayıtlar yalnızca Firestore üzerinden okunur/yazılır; Firebase hatasında yerel kopyaya geri dönülmez." : "Test kayıtları localStorage üzerinde tutulur ve gerçek Firebase verisinden ayrıdır."}</div>
      <div class="grid">
        <div class="card stat span-3"><div class="label">Master PQ</div><div class="num">${totalPq}</div><p>${DATA_FILE} üzerinden okunan read-only kayıt.</p></div>
        <div class="card stat span-3"><div class="label">Yıllık Program</div><div class="num">${programs}</div><p>${activePrograms} aktif/onaylı program.</p></div>
        <div class="card stat span-3"><div class="label">Denetim Kaydı</div><div class="num">${audits}</div><p>${planned} planlı, ${responseWaiting} cevap bekleyen.</p></div>
        <div class="card stat span-3"><div class="label">Açık Bulgu</div><div class="num">${findings}</div><p>NS kaynaklı bulgular.</p></div>
        <div class="card span-6">
          <h3>Faz 2 İş Akışı</h3>
          <p>Önce yıllık program oluşturulur ve onay/aktif statüsüne alınır. Sonra programa bağlı planlı denetim kaydı açılır. Denetim kartından kuruluş cevap süreci, ön değerlendirme ve aktif denetim statülerine geçiş yapılabilir.</p>
          <div>${["Yıllık Program", "Programa Denetim", "Denetim Dosyası", "Kuruluş Cevabı", "Ön Değerlendirme", "Statü Geçişleri"].map(x => `<span class="pill blue">${escapeHtml(x)}</span>`).join("")}</div>
        </div>
        <div class="card span-6">
          <h3>Sonraki Faz</h3>
          <p>Faz 6 ile CAP planı/adımları, değerlendirme, izleme, doğrulama ve bulgu kapatma akışı devreye alındı.</p>
          <div><button class="btn primary" onclick="showSection('programCreate')">Yıllık Program Oluştur</button><button class="btn" onclick="showSection('programAddAudit')">Programa Denetim Ekle</button><button class="btn" onclick="showSection('auditFile')">Denetim Dosyası / Heyet</button><button class="btn" onclick="showSection('auditeeResponses')">Kuruluş Ön Cevapları</button><button class="btn" onclick="showSection('preEvaluation')">Ön Değerlendirme</button><button class="btn" onclick="showSection('auditExecution')">Denetim Çalışması</button><button class="btn" onclick="showSection('auditeeObjections')">İtiraz Bildirimi</button><button class="btn" onclick="showSection('reportsAudit')">Nihai Rapor</button></div>
        </div>
      </div>`;
  }









  // Faz 8B.3: Kuruluş ön cevapları ve ön değerlendirme modüllere taşındı.

  function renderAuditeePortal() {
    const ownAudits = auditeeVisibleAudits();
    const orgOptions = getOrganizationContextOptions();
    const orgChooser = `<div class="toolbar"><div class="field" style="min-width:320px"><label>Test Kuruluşu Seç</label><select onchange="setOrgContext(this.value)">${orgOptions.map(o => `<option value="${escapeHtml(o.id)}" ${o.id === state.orgContext ? 'selected' : ''}>${escapeHtml(o.name)} — ${escapeHtml(o.id)}${o.auditCount ? ` (${o.auditCount} denetim)` : ''}</option>`).join('')}</select></div><div class="field" style="min-width:260px"><label>Aktif Organization ID</label><input value="${escapeHtml(state.orgContext)}" onchange="setOrgContext(this.value)" placeholder="Organization ID"></div></div>`;
    const portalNote = `<div class="info-banner">Kuruluş Portalı, denetlenen kuruluş kullanıcısının kendi kuruluşuna ait denetimleri görmesi için tasarlandı. Test için artık Organization ID kopyalaman gerekmiyor; aşağıdaki listeden ilgili kuruluşu seçebilirsin. Gerçek erişim kontrolü Firebase Auth + Firestore Rules ile uygulanır; kuruluş kullanıcısında Organization ID profil kaydından kilitli gelir.</div>${orgChooser}`;
    document.getElementById("auditeeAssigned").innerHTML = portalNote + `<div class="summary-strip"><div class="mini-stat"><strong>${ownAudits.length}</strong><span>Atanmış denetim</span></div><div class="mini-stat"><strong>${ownAudits.filter(a => a.status === 'waiting_auditee_response').length}</strong><span>Cevap bekleyen</span></div><div class="mini-stat"><strong>${ownAudits.filter(a => a.status === 'objection_period').length}</strong><span>İtiraz sürecinde</span></div><div class="mini-stat"><strong>${ownAudits.filter(a => ['cap_waiting','cap_under_review','cap_monitoring'].includes(a.status)).length}</strong><span>CAP süreci</span></div></div><div class="list">${ownAudits.map(renderAuditCard).join("") || `<div class="empty">Bu kuruluş bağlamına atanmış denetim yok.</div>`}</div>`;
    renderAuditeeResponses();
    renderAuditeeObjections(portalNote);
    document.getElementById("auditeeCap").innerHTML = portalNote + `<div class="card"><h3>CAP Girişi</h3><p>Nihai rapor gönderildikten sonra USOAP CMA kapsamında azami 45 gün içinde CAP planı sunulacak. Her bulgu için en az bir CAP adımı Faz 6'da zorunlu hale getirilecek.</p></div>`;
  }


  // Faz 8B.3: Denetim icrası / kriter bazlı PQ değerlendirmesi ayrı modüle taşındı.

  // Faz 8B.4: İtiraz ve Nihai Rapor iş akışları ayrı modüllere taşındı.

  // Faz 8B.5: Bulgular ve CAP yaşam döngüsü ayrı modüllere taşındı.

  function renderReports() {
    renderFinalReportModule();
    const programRows = state.auditPrograms.map(p => {
      const audits = state.audits.filter(a => a.programId === p.programId);
      return `<tr><td>${escapeHtml(p.programId)}</td><td>${escapeHtml(p.name)}</td><td>${audits.length}</td><td>${audits.filter(a => a.status === "closed").length}</td><td>${audits.filter(a => a.status === "archived").length}</td></tr>`;
    }).join("");
    document.getElementById("reportsProgram").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Program</th><th>Adı</th><th>Denetim</th><th>Kapatılan</th><th>Arşiv</th></tr></thead><tbody>${programRows || `<tr><td colspan="5">Program bulunmuyor.</td></tr>`}</tbody></table></div>`;
    renderCapReportModule();
  }
  function renderArchive() {
    const archivedAudits = state.audits.filter(a => a.status === "archived");
    const archivedRevs = state.formRevisions.filter(r => r.status === "archived");
    document.getElementById("archive").innerHTML = `<div class="grid"><div class="card span-6"><h3>Arşivlenen Denetimler</h3>${archivedAudits.length ? archivedAudits.map(a => `<p><strong>${escapeHtml(a.auditId)}</strong> - ${escapeHtml(a.organizationName || "-")}</p>`).join("") : `<p>Arşivlenmiş denetim yok.</p>`}</div><div class="card span-6"><h3>Revizyon Arşivi</h3>${archivedRevs.length ? archivedRevs.map(r => `<p><strong>${escapeHtml(r.formId)}</strong> - ${escapeHtml(r.revisionNo)}</p>`).join("") : `<p>Arşivlenmiş revizyon yok.</p>`}</div></div>`;
  }
  window.exportPhase1Json = function() {
    const data = {
      exportedAt: new Date().toISOString(),
      role: state.role,
      orgContext: state.orgContext,
      authUser: state.authUser ? { uid: state.authUser.uid, email: state.authUser.email } : null,
      userProfile: state.userProfile || null,
      collections: COLLECTIONS,
      auditStatuses: AUDIT_STATUS,
      capStatuses: CAP_STATUS,
      users: state.users,
      auditPrograms: state.auditPrograms,
      audits: state.audits,
      auditAssignments: state.auditAssignments,
      organizationResponses: state.organizationResponses,
      auditPreEvaluations: state.auditPreEvaluations,
      auditResponses: state.auditResponses,
      organizations: state.organizations,
      findings: state.findings,
      capPlans: state.capPlans,
      capSteps: state.capSteps,
      reports: state.reports,
      formRevisions: state.formRevisions
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "usoap_phase6_cap_module_export.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };



  // Faz 8B.5: CAP girişi/değerlendirmesi/izlemesi js/modules/cap.js içinde.

  // Faz 8B.6: Auth/kullanıcı, bildirim ve ayarlar modüllere taşındı.

  // Faz 8B.7: Firestore/localStorage veri erişimi js/repository.js içine taşındı.

  // Faz 8B.7: veri erişimi repository.js içindedir; app.js orkestrasyon callbacklerini kaydeder.
  register("saveRecord", saveRecord);
  register("updateRecord", updateRecord);
  register("loadData", loadData);
  register("renderAll", renderAll);
  register("renderReports", renderReports);
  register("dataModeLabel", dataModeLabel);

  // Faz 8B.7: app.js içinde kalan inline HTML olaylarının erişmesi gereken render fonksiyonları.
  window.renderAuditFile = renderAuditFile;
  window.renderProgramCreate = renderProgramCreate;

  window.addEventListener("unhandledrejection", event => {
    const message = event?.reason?.message || String(event?.reason || "Bilinmeyen hata");
    if (message.includes("Gerçek veri modunda") || message.includes("Firebase")) {
      alert(`İşlem tamamlanamadı:
${message}`);
      event.preventDefault();
    }
  });

  async function init() {
    renderRoleSelect();
    renderMenu();
    setTitle("Yükleniyor", `${DATA_FILE} okunuyor...`);
    try {
      await initRepository();
      await initAuthGate();
      await loadMasterModel();
      await loadData();
      renderAll();
      showSection("home");
    } catch (err) {
      setTitle("Yükleme Hatası", "Master veri veya yapı yüklenemedi.");
      document.getElementById("home").innerHTML = `<div class="danger-banner">${escapeHtml(err.message)}</div>`;
      document.getElementById("home").classList.add("active");
    }
  }

  init();
