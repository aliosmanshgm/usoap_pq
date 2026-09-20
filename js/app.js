import {
  DATA_FILE, COLLECTIONS, ROLES, ROLE_SECTIONS, AREA_ORDER, AREA_LABELS,
  AUDIT_STATUS, CAP_STATUS, PROGRAM_STATUS, AUDIT_METHOD_LABELS,
  AUDIT_TYPE_LABELS, MENUS
} from "./config.js";
import { state } from "./state.js";
import {
  escapeHtml, parseYmdLocal, today, formatDate
} from "./utils.js";
import {
  createFirebaseClient, collection, doc, getDocs, getDoc, setDoc, updateDoc,
  query, where, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "./firebase-client.js";
import { getRowsFromModel, normalizeRow } from "./master-data.js";
import { runtime, register } from "./runtime.js";
import { getProgram, getAudit } from "./selectors.js";
import {
  sectionAllowed, getOrganizationContextOptions, renderRoleSelect, renderMenu,
  setTitle, showSection, showModal, closeModal
} from "./modules/ui-shell.js";
import {
  renderMasterLibrary, renderFormRevisions, renderRevisionArchive
} from "./modules/master-forms.js";
import { renderProgramCreate, renderAnnualPrograms } from "./modules/programs.js";
import {
  renderProgramAddAudit, renderAuditList, renderAuditCard, statusPill
} from "./modules/audits.js";
import { renderAuditFile, getAssignment } from "./modules/assignments.js";
import { auditeeVisibleAudits } from "./modules/workflow-context.js";
import { renderAuditeeResponses } from "./modules/auditee-responses.js";
import { renderPreEvaluation } from "./modules/pre-evaluation.js";
import { renderAuditExecution } from "./modules/audit-execution.js";
import { renderAuditeeObjections } from "./modules/objections.js";
import { renderFinalReportModule } from "./modules/final-reports.js";
import { renderFindingsAndCap, renderCapReportModule, getCapPlan, capPlanIdOf } from "./modules/cap.js";

// Faz 8A: Demo ve gerçek veri modu kesin olarak ayrılır.
  // Demo modu localStorage kullanır; gerçek kullanıcı girişi yalnızca Firestore kullanır.
  function isProductionDataMode() {
    return !state.demoMode && !!state.authUser;
  }
  function dataModeLabel() {
    return isProductionDataMode() ? "Firebase / Gerçek Veri" : "Demo / Yerel Veri";
  }
  function localKey(collectionName) { return `usoap_phase1_${collectionName}`; }
  function localRead(collectionName) {
    try { return JSON.parse(localStorage.getItem(localKey(collectionName)) || "[]"); }
    catch { return []; }
  }
  function localWrite(collectionName, rows) {
    localStorage.setItem(localKey(collectionName), JSON.stringify(rows || []));
  }
  function recordIdOf(collectionName, row) {
    return row?.id || row?.[`${collectionName.slice(0,-1)}Id`] || row?.auditId || row?.programId || row?.findingId || row?.capPlanId || row?.capStepId || row?.revisionId || row?.organizationId || "";
  }
  function productionDataError(action, collectionName, err) {
    const detail = err?.message || String(err || "Bilinmeyen hata");
    state.firebaseMessage = `Firebase ${action} hatası (${collectionName}): ${detail}`;
    console.error(state.firebaseMessage, err);
    throw new Error(`Gerçek veri modunda işlem tamamlanamadı. ${collectionName}: ${detail}`);
  }
  async function saveRecord(collectionName, id, data) {
    const row = { ...data, id };
    if (isProductionDataMode()) {
      if (!state.db) throw new Error("Gerçek veri modunda Firebase bağlantısı hazır değil. Yerel kopyaya geri dönülmedi.");
      try {
        await setDoc(doc(state.db, collectionName, id), row, { merge: true });
        return row;
      } catch (err) {
        productionDataError("kayıt", collectionName, err);
      }
    }
    const rows = localRead(collectionName);
    const existingIndex = rows.findIndex(x => recordIdOf(collectionName, x) === id);
    if (existingIndex >= 0) rows[existingIndex] = row;
    else rows.push(row);
    localWrite(collectionName, rows);
    return row;
  }
  async function updateRecord(collectionName, id, patch) {
    const updatedAt = new Date().toISOString();
    if (isProductionDataMode()) {
      if (!state.db) throw new Error("Gerçek veri modunda Firebase bağlantısı hazır değil. Yerel kopyaya geri dönülmedi.");
      try {
        await updateDoc(doc(state.db, collectionName, id), { ...patch, updatedAt });
        return;
      } catch (err) {
        productionDataError("güncelleme", collectionName, err);
      }
    }
    const rows = localRead(collectionName);
    const idx = rows.findIndex(x => recordIdOf(collectionName, x) === id);
    if (idx >= 0) rows[idx] = { ...rows[idx], ...patch, updatedAt };
    localWrite(collectionName, rows);
  }

  const AUDITEE_ORG_SCOPED_COLLECTIONS = new Set([
    COLLECTIONS.audits,
    COLLECTIONS.organizationResponses,
    COLLECTIONS.findings,
    COLLECTIONS.capPlans,
    COLLECTIONS.capSteps,
    COLLECTIONS.reports,
    COLLECTIONS.evidenceReferences
  ]);
  const AUDITEE_INTERNAL_COLLECTIONS = new Set([
    COLLECTIONS.auditPrograms,
    COLLECTIONS.auditAssignments,
    COLLECTIONS.auditResponses,
    COLLECTIONS.auditPreEvaluations,
    COLLECTIONS.masterForms,
    COLLECTIONS.formRevisions,
    COLLECTIONS.auditLogs
  ]);
  async function firestoreRows(ref) {
    const snap = await getDocs(ref);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  async function ensureCurrentUserProfile() {
    if (!isProductionDataMode()) return null;
    if (!state.db || !state.authUser) throw new Error("Firebase kullanıcı oturumu hazır değil.");
    const userRef = doc(state.db, COLLECTIONS.users, state.authUser.uid);
    let profile;
    try {
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        profile = { id: snap.id, ...snap.data() };
        const heartbeat = { lastLoginAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        if (!profile.email && state.authUser.email) heartbeat.email = state.authUser.email;
        if (!profile.displayName && (state.authUser.displayName || state.authUser.email)) heartbeat.displayName = state.authUser.displayName || state.authUser.email;
        await updateDoc(userRef, heartbeat);
        profile = { ...profile, ...heartbeat };
      } else {
        profile = makePendingUserProfile();
        await setDoc(userRef, profile, { merge: false });
      }
    } catch (err) {
      productionDataError("kullanıcı profili", COLLECTIONS.users, err);
    }
    state.userProfile = profile;
    state.users = profile ? [profile] : [];
    applyAuthProfile();
    return profile;
  }
  async function readCollection(collectionName) {
    if (!isProductionDataMode()) return localRead(collectionName);
    if (!state.db || !state.authUser) return [];
    try {
      if (collectionName === COLLECTIONS.users) {
        if (state.role === "admin" && state.userProfile?.active === true) {
          return await firestoreRows(collection(state.db, collectionName));
        }
        const snap = await getDoc(doc(state.db, collectionName, state.authUser.uid));
        return snap.exists() ? [{ id: snap.id, ...snap.data() }] : [];
      }
      if (!state.userProfile || userIsPending(state.userProfile) || state.userProfile.active !== true) return [];
      if (state.role === "auditee") {
        if (collectionName === COLLECTIONS.organizations) {
          if (!state.orgContext) return [];
          const snap = await getDoc(doc(state.db, collectionName, state.orgContext));
          return snap.exists() ? [{ id: snap.id, ...snap.data() }] : [];
        }
        if (AUDITEE_INTERNAL_COLLECTIONS.has(collectionName)) return [];
        if (AUDITEE_ORG_SCOPED_COLLECTIONS.has(collectionName)) {
          if (!state.orgContext) return [];
          return await firestoreRows(query(collection(state.db, collectionName), where("organizationId", "==", state.orgContext)));
        }
        return [];
      }
      return await firestoreRows(collection(state.db, collectionName));
    } catch (err) {
      productionDataError("okuma", collectionName, err);
    }
  }

  async function initFirebase() {
    try {
      const client = createFirebaseClient();
      state.db = client.db;
      state.auth = client.auth;
      state.firebaseReady = true;
      state.firebaseMessage = "Firestore/Firebase Auth hazır. Yetki rolü users koleksiyonundan ve Firestore Rules kurallarından gelir.";
    } catch (err) {
      state.firebaseReady = false;
      state.firebaseMessage = "Firebase başlatılamadı. Demo modunda yerel kayıt kullanılabilir; gerçek modda işlem durdurulur.";
    }
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
        <strong>Faz 8A stabilizasyonu:</strong> Gerçek Firebase veri modu localStorage'dan ayrıldı; tarih ve CAP veri bütünlüğü güçlendirildi.
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
  function renderSettings() {
    const collectionsJson = JSON.stringify(COLLECTIONS, null, 2);
    document.getElementById("settings").innerHTML = `
      <div class="grid">
        <div class="card span-6"><h3>Rol Matrisi</h3><div class="table-wrap"><table><thead><tr><th>Rol</th><th>Yetki Özeti</th></tr></thead><tbody>
          <tr><td>Yönetici</td><td>Master form revizyonu, kullanıcı/yetki, tüm kayıtlar.</td></tr>
          <tr><td>Program Yöneticisi</td><td>Yıllık program ve denetim planlama.</td></tr>
          <tr><td>Baş Denetçi</td><td>Heyet, ön değerlendirme, nihai rapor, CAP değerlendirme.</td></tr>
          <tr><td>Denetçi</td><td>Atandığı denetimde PQ değerlendirme ve kanıt/not.</td></tr>
          <tr><td>Denetlenen Kuruluş</td><td>Kendi denetimi için cevap, itiraz, CAP.</td></tr>
          <tr><td>Görüntüleyen</td><td>Salt okunur görüntüleme ve rapor.</td></tr>
        </tbody></table></div></div>
        <div class="card span-6"><h3>Bağlantı Durumu</h3><p>${escapeHtml(state.firebaseMessage)}</p><p><strong>Mevcut test rolü:</strong> ${escapeHtml(ROLES[state.role])}</p><p><strong>Kuruluş bağlamı:</strong> ${escapeHtml(state.orgContext)}</p></div>
        <div class="card span-12"><h3>Firestore Koleksiyon Omurgası</h3><pre class="model-code">${escapeHtml(collectionsJson)}</pre></div>
        <div class="card span-12"><h3>Fazlara Bölünen Geliştirme</h3><p><strong>Faz 1:</strong> Mimari omurga ve menü/veri modeli. <strong>Faz 2:</strong> Yıllık program ve planlı denetimlerin işlevsel hale getirilmesi. <strong>Faz 3A:</strong> Denetim dosyası ve heyet atama. <strong>Faz 3B:</strong> Kuruluş cevap süreci ve ön değerlendirme. <strong>Faz 4:</strong> Aktif denetim uygulama ve PQ bazlı S/NS/NA değerlendirme. <strong>Faz 5:</strong> İtiraz süreci ve nihai rapor hazırlama/gönderme. <strong>Faz 6:</strong> CAP planı/adımları, değerlendirme, izleme, doğrulama, Kanban ve CAP durum raporu.</p></div>
      </div>`;
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

  // =========================
  // Faz 7 - Auth, Bildirimler ve Gecikme Uyarıları
  // =========================
  function isAuthLocked() {
    return !!state.authUser && !state.demoMode;
  }
  function activeUid() { return state.authUser?.uid || "demo"; }
  function profileRole() { return state.userProfile?.role || state.role || "viewer"; }
  function profileOrg() { return state.userProfile?.organizationId || state.orgContext || ""; }
  function authLabel() {
    if (state.demoMode) return "Demo/Test Modu";
    if (state.authUser && userIsPending(state.userProfile)) return `${state.authUser.email || state.authUser.uid} / Onay Bekliyor`;
    if (state.authUser) return `${state.authUser.email || state.authUser.uid} / ${ROLES[state.role] || state.role}`;
    return "Giriş bekleniyor";
  }
  function showAuthOverlay(show, message = "") {
    const overlay = document.getElementById("authOverlay");
    const msg = document.getElementById("authMessage");
    if (!overlay) return;
    overlay.classList.toggle("hidden", !show);
    if (msg) {
      msg.classList.toggle("hidden", !message);
      msg.innerHTML = escapeHtml(message || "");
    }
  }
  async function initAuthGate() {
    if (!state.auth || state.demoMode) {
      state.authReady = true;
      showAuthOverlay(false);
      return;
    }
    await new Promise(resolve => {
      const unsubscribe = onAuthStateChanged(state.auth, user => {
        state.authUser = user || null;
        state.authReady = true;
        if (!user) showAuthOverlay(true);
        else showAuthOverlay(false);
        unsubscribe();
        resolve();
      }, () => resolve());
    });
  }
  function makePendingUserProfile() {
    const now = new Date().toISOString();
    return {
      id: state.authUser.uid,
      uid: state.authUser.uid,
      email: state.authUser.email || "",
      displayName: state.authUser.displayName || state.authUser.email || state.authUser.uid,
      role: "viewer",
      organizationId: "",
      active: false,
      pendingProfile: true,
      approvalStatus: "pending",
      selfRegistered: true,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now
    };
  }

  function applyAuthProfile() {
    if (state.demoMode) return;
    if (!state.authUser) {
      state.userProfile = null;
      state.role = "viewer";
      return;
    }
    const profile = state.users.find(u =>
      (u.uid || u.id) === state.authUser.uid ||
      String(u.email || "").toLowerCase() === String(state.authUser.email || "").toLowerCase()
    ) || state.userProfile || null;
    state.userProfile = profile;
    if (!profile) {
      state.role = "viewer";
      return;
    }
    const pending = userIsPending(profile);
    state.role = pending ? "viewer" : (profile.role || "viewer");
    if (profile.organizationId) {
      state.orgContext = profile.organizationId;
      localStorage.setItem("usoap_phase1_org", state.orgContext);
    }
  }
  window.loginWithEmail = async function() {
    const email = document.getElementById("authEmail")?.value.trim();
    const pass = document.getElementById("authPassword")?.value || "";
    if (!email || !pass) return showAuthOverlay(true, "E-posta ve şifre girin.");
    if (!state.auth) return showAuthOverlay(true, "Firebase Auth başlatılamadı.");
    try {
      state.demoMode = false;
      localStorage.removeItem("usoap_phase7_demo_mode");
      const cred = await signInWithEmailAndPassword(state.auth, email, pass);
      state.authUser = cred.user;
      showAuthOverlay(false);
      await loadData();
      renderAll();
      showSection(sectionAllowed(state.currentSection) ? state.currentSection : "home");
    } catch (err) {
      showAuthOverlay(true, `Giriş başarısız: ${err.message || err}`);
    }
  };
  window.continueDemoMode = async function() {
    // Faz 8A.1: Demo ve gerçek oturum birbirine karışmasın.
    // Demo moduna geçerken varsa gerçek Firebase oturumu kapatılır.
    if (state.auth?.currentUser) {
      try { await signOut(state.auth); } catch (err) { console.warn("Demo moduna geçerken Firebase oturumu kapatılamadı", err); }
    }
    state.authUser = null;
    state.userProfile = null;
    state.demoMode = true;
    localStorage.setItem("usoap_phase7_demo_mode", "true");
    showAuthOverlay(false);
    await loadData();
    renderAll();
    showSection("home");
  };

  window.exitDemoMode = async function() {
    // Demo modundan çıkış her zaman gerçek giriş ekranına döner.
    // Önceki Firebase oturumu varsa temizlenir; böylece kullanıcı hangi hesapla
    // gerçek moda geçtiğini açıkça bilir. Demo localStorage kayıtları silinmez.
    try {
      if (state.auth?.currentUser) await signOut(state.auth);
    } catch (err) {
      console.warn("Gerçek girişe geçerken önceki Firebase oturumu kapatılamadı", err);
    }
    state.demoMode = false;
    localStorage.removeItem("usoap_phase7_demo_mode");
    state.authUser = null;
    state.userProfile = null;
    state.role = "viewer";
    localStorage.setItem("usoap_phase1_role", "viewer");
    state.currentSection = "home";
    renderRoleSelect();
    renderMenu();
    renderAuthState();
    showAuthOverlay(true, "Demo/Test modundan çıkıldı. Gerçek kullanıcı hesabınızla giriş yapın.");
  };

  window.logoutCurrentUser = async function() {
    if (state.auth && state.authUser) await signOut(state.auth);
    state.authUser = null;
    state.userProfile = null;
    state.demoMode = false;
    localStorage.removeItem("usoap_phase7_demo_mode");
    showAuthOverlay(true, "Çıkış yapıldı.");
    renderAuthState();
  };

  function userIsPending(user) {
    if (!user) return false;
    return user.pendingProfile === true || user.approvalStatus === "pending" || user.active === false;
  }
  function profileStatusText(user) {
    if (!user) return "Profil yok";
    if (userIsPending(user)) return "Onay Bekliyor";
    return "Aktif";
  }
  function userCanManageUsers() { return state.role === "admin"; }
  function pendingUsersSummaryHtml() {
    const pending = state.users.filter(userIsPending);
    if (!pending.length) return `<div class="info-banner"><strong>Onay bekleyen kullanıcı yok.</strong> Yeni kullanıcılar ilk giriş yaptığında burada otomatik görünür.</div>`;
    const rows = pending.map(u => `<li><strong>${escapeHtml(u.displayName || u.email || u.uid || "Kullanıcı")}</strong> — ${escapeHtml(u.email || "-")} <span class="pill yellow">Onay Bekliyor</span></li>`).join("");
    return `<div class="warn-banner"><strong>${pending.length} kullanıcı onay bekliyor.</strong><ul style="margin:8px 0 0 18px">${rows}</ul></div>`;
  }

  function userRowsHtml() {
    const rows = state.users.slice().sort((a,b)=>{
      const ap = userIsPending(a) ? 0 : 1;
      const bp = userIsPending(b) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return String(a.email||a.displayName||"").localeCompare(String(b.email||b.displayName||""), "tr");
    });
    const body = rows.map(u => {
      const id = u.uid || u.id;
      const pending = userIsPending(u);
      const statusPill = pending ? `<span class="pill yellow">Onay Bekliyor</span>` : `<span class="pill green">Aktif</span>`;
      const actionButtons = userCanManageUsers()
        ? `<button class="btn success" onclick="saveUserProfile('${jsArg(id)}')">Kaydet</button>${pending ? `<button class="btn primary" onclick="activateUserProfile('${jsArg(id)}')">Aktifleştir</button>` : ""}`
        : "-";
      return `<tr><td><input id="u_uid_${escapeHtml(id)}" value="${escapeHtml(id)}" disabled></td><td><input id="u_name_${escapeHtml(id)}" value="${escapeHtml(u.displayName || "")}" ${userCanManageUsers()?"":"disabled"}></td><td><input id="u_email_${escapeHtml(id)}" value="${escapeHtml(u.email || "")}" ${userCanManageUsers()?"":"disabled"}></td><td><select id="u_role_${escapeHtml(id)}" ${userCanManageUsers()?"":"disabled"}>${Object.entries(ROLES).map(([k,l])=>`<option value="${k}" ${k===(u.role||"viewer")?"selected":""}>${escapeHtml(l)}</option>`).join("")}</select></td><td><input id="u_org_${escapeHtml(id)}" value="${escapeHtml(u.organizationId || "")}" ${userCanManageUsers()?"":"disabled"}></td><td>${statusPill}<select id="u_active_${escapeHtml(id)}" ${userCanManageUsers()?"":"disabled"} style="margin-top:6px"><option value="true" ${u.active!==false?"selected":""}>Aktif</option><option value="false" ${u.active===false?"selected":""}>Pasif / Beklemede</option></select></td><td>${actionButtons}</td></tr>`;
    }).join("");
    return `<div class="table-wrap"><table class="user-table"><thead><tr><th>UID</th><th>Ad Soyad</th><th>E-posta</th><th>Rol</th><th>Kuruluş ID</th><th>Durum</th><th>İşlem</th></tr></thead><tbody>${body || `<tr><td colspan="7">Kullanıcı profili yok. Gerçek giriş yapan kullanıcılar burada otomatik Onay Bekleyen Kullanıcı olarak görünecek.</td></tr>`}</tbody></table></div>`;
  }
  function newUserFormHtml() {
    if (!userCanManageUsers()) return `<div class="warn-banner">Kullanıcı profili yönetimi yalnızca Yönetici rolüyle yapılır. Giriş yaptıysanız ve onay bekliyorsanız, yöneticinin profilinizi aktifleştirmesi gerekir.</div>`;
    return `<div class="card span-12"><h3>Manuel / Yedek Kullanıcı Profil Kaydı</h3><p>Ana yöntem artık otomatik profildir: kullanıcı ilk kez giriş yapar, sistem onu <strong>Onay Bekleyen Kullanıcı</strong> olarak kaydeder. Bu form yalnızca Firebase Console’dan UID ile manuel profil açmak gereken teknik durumlar içindir.</p><div class="form-grid"><div class="field"><label>Firebase UID <small>(teknik/yedek)</small></label><input id="newUserUid" placeholder="Auth UID"></div><div class="field"><label>E-posta</label><input id="newUserEmail" placeholder="kullanici@..." type="email"></div><div class="field"><label>Ad Soyad</label><input id="newUserName" placeholder="Ad Soyad"></div><div class="field"><label>Rol</label><select id="newUserRole">${Object.entries(ROLES).map(([k,l])=>`<option value="${k}">${escapeHtml(l)}</option>`).join("")}</select></div><div class="field"><label>Kuruluş ID</label><input id="newUserOrg" placeholder="org_001 / org_shgm"></div><div class="field"><label>Durum</label><select id="newUserActive"><option value="true">Aktif</option><option value="false">Pasif / Beklemede</option></select></div></div><button class="btn success" style="margin-top:10px" onclick="createUserProfile()">Manuel Profil Kaydet</button></div>`;
  }
  window.createUserProfile = async function() {
    if (!userCanManageUsers()) return alert("Yalnızca yönetici kullanıcı profili ekleyebilir.");
    const uidVal = document.getElementById("newUserUid")?.value.trim();
    if (!uidVal) return alert("Manuel profil için Firebase UID gerekir. Normal kullanımda kullanıcı önce giriş yapar ve sistem profili otomatik oluşturur.");
    const row = {
      id: uidVal,
      uid: uidVal,
      email: document.getElementById("newUserEmail")?.value.trim() || "",
      displayName: document.getElementById("newUserName")?.value.trim() || "",
      role: document.getElementById("newUserRole")?.value || "viewer",
      organizationId: document.getElementById("newUserOrg")?.value.trim() || "",
      active: document.getElementById("newUserActive")?.value !== "false",
      pendingProfile: document.getElementById("newUserActive")?.value === "false",
      approvalStatus: document.getElementById("newUserActive")?.value === "false" ? "pending" : "approved",
      approvedBy: document.getElementById("newUserActive")?.value === "false" ? null : activeUid(),
      approvedAt: document.getElementById("newUserActive")?.value === "false" ? null : new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await saveRecord(COLLECTIONS.users, uidVal, row);
    await loadData(); renderAll(); showSection("settings");
    alert("Kullanıcı profili kaydedildi.");
  };
  window.saveUserProfile = async function(uidVal) {
    if (!userCanManageUsers()) return alert("Yalnızca yönetici kullanıcı profili kaydedebilir.");
    const existing = state.users.find(u => (u.uid || u.id) === uidVal) || {};
    const row = {
      ...existing,
      id: uidVal,
      uid: uidVal,
      displayName: document.getElementById(`u_name_${uidVal}`)?.value.trim() || "",
      email: document.getElementById(`u_email_${uidVal}`)?.value.trim() || "",
      role: document.getElementById(`u_role_${uidVal}`)?.value || "viewer",
      organizationId: document.getElementById(`u_org_${uidVal}`)?.value.trim() || "",
      active: document.getElementById(`u_active_${uidVal}`)?.value !== "false",
      pendingProfile: document.getElementById(`u_active_${uidVal}`)?.value === "false",
      approvalStatus: document.getElementById(`u_active_${uidVal}`)?.value === "false" ? "pending" : "approved",
      approvedBy: document.getElementById(`u_active_${uidVal}`)?.value === "false" ? (existing.approvedBy || null) : (existing.approvedBy || activeUid()),
      approvedAt: document.getElementById(`u_active_${uidVal}`)?.value === "false" ? (existing.approvedAt || null) : (existing.approvedAt || new Date().toISOString()),
      updatedAt: new Date().toISOString()
    };
    await saveRecord(COLLECTIONS.users, uidVal, row);
    await loadData(); renderAll(); showSection("settings");
    alert("Kullanıcı profili güncellendi.");
  };
  window.activateUserProfile = async function(uidVal) {
    if (!userCanManageUsers()) return alert("Yalnızca yönetici kullanıcı aktifleştirebilir.");
    const existing = state.users.find(u => (u.uid || u.id) === uidVal) || {};
    const role = document.getElementById(`u_role_${uidVal}`)?.value || existing.role || "viewer";
    const organizationId = document.getElementById(`u_org_${uidVal}`)?.value.trim() || existing.organizationId || "";
    if (role === "auditee" && !organizationId) return alert("Denetlenen Kuruluş rolü için Kuruluş ID zorunludur.");
    const row = {
      ...existing,
      id: uidVal,
      uid: uidVal,
      displayName: document.getElementById(`u_name_${uidVal}`)?.value.trim() || existing.displayName || "",
      email: document.getElementById(`u_email_${uidVal}`)?.value.trim() || existing.email || "",
      role,
      organizationId,
      active: true,
      pendingProfile: false,
      approvalStatus: "approved",
      approvedBy: activeUid(),
      approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await saveRecord(COLLECTIONS.users, uidVal, row);
    await loadData(); renderAll(); showSection("settings");
    alert("Kullanıcı aktifleştirildi. Kullanıcı çıkış yapıp tekrar giriş yaptığında yeni rol ve kuruluş yetkisi uygulanır.");
  };

  function renderAuthState() {
    const badge = document.getElementById("authStatusBadge");
    const realLogin = document.getElementById("realLoginButton");
    const logout = document.getElementById("logoutButton");
    if (badge) {
      badge.className = `auth-status ${isAuthLocked()?"locked":"demo"}`;
      badge.innerHTML = `${isAuthLocked()?"🔒":"🧪"} ${escapeHtml(authLabel())}`;
    }
    if (realLogin) realLogin.style.display = state.demoMode ? "inline-flex" : "none";
    if (logout) logout.style.display = state.authUser && !state.demoMode ? "inline-flex" : "none";
    const btn = document.getElementById("notificationTopButton");
    if (btn) {
      const unread = buildNotifications().filter(n => !state.notificationReads.includes(n.id)).length;
      btn.innerHTML = `Bildirimler${unread ? ` (${unread})` : ""}`;
    }
    const roleSelect = document.getElementById("roleSelect");
    if (roleSelect) roleSelect.disabled = isAuthLocked();
    const orgInput = document.getElementById("orgContextInput");
    if (orgInput) orgInput.disabled = isAuthLocked() && state.role === "auditee";
    const orgSelect = document.getElementById("orgContextSelect");
    if (orgSelect) orgSelect.disabled = isAuthLocked() && state.role === "auditee";
  }


  function daysFromToday(dateText) {
    const a = parseYmdLocal(today());
    const b = parseYmdLocal(dateText);
    if (!a || !b) return null;
    return Math.round((b - a) / 86400000);
  }
  function deadlineClass(dateText, completed=false) {
    if (completed) return "ok";
    const d = daysFromToday(dateText);
    if (d === null) return "ok";
    if (d < 0) return "overdue";
    if (d <= 7) return "soon";
    return "ok";
  }
  function deadlineText(dateText, completed=false) {
    if (!dateText) return "Tarih yok";
    if (completed) return `Tamamlandı / ${formatDate(dateText)}`;
    const d = daysFromToday(dateText);
    if (d === null) return formatDate(dateText);
    if (d < 0) return `${formatDate(dateText)} / ${Math.abs(d)} gün gecikti`;
    if (d === 0) return `${formatDate(dateText)} / bugün son gün`;
    return `${formatDate(dateText)} / ${d} gün kaldı`;
  }
  function deadlineBadge(dateText, completed=false) {
    return `<span class="deadline-inline ${deadlineClass(dateText, completed)}">${escapeHtml(deadlineText(dateText, completed))}</span>`;
  }
  function isAuditVisibleForCurrentUser(audit) {
    if (!audit) return false;
    if (state.demoMode || !state.authUser) return true;
    if (["admin","program_manager","viewer"].includes(state.role)) return true;
    if (state.role === "auditee") return audit.organizationId === profileOrg();
    const assignment = getAssignment(audit.auditId) || {};
    const uid = activeUid();
    const email = String(state.authUser?.email || "").toLowerCase();
    const name = String(state.userProfile?.displayName || "").toLowerCase();
    const uidFields = [assignment.leadAuditorUid, ...(assignment.auditorUids || []), ...(assignment.technicalExpertUids || []), ...(assignment.observerUids || [])].filter(Boolean);
    if (uidFields.includes(uid)) return true;
    const text = [assignment.leadAuditorName, ...(assignment.auditorNames || []), ...(assignment.technicalExpertNames || [])].join(" ").toLowerCase();
    return (!!email && text.includes(email)) || (!!name && text.includes(name));
  }
  function visibleAuditsForCurrentUser(rows = state.audits) { return rows.filter(isAuditVisibleForCurrentUser); }

  function buildNotifications() {
    const out = [];
    const add = (n) => { if (n.date && (n.days === null || n.days <= 14 || n.severity === "overdue")) out.push(n); };
    visibleAuditsForCurrentUser().forEach(a => {
      const pushAudit = (kind, title, date, doneStatuses, section, actionText) => {
        const done = doneStatuses.includes(a.status);
        if (done) return;
        const days = daysFromToday(date);
        const severity = days !== null && days < 0 ? "overdue" : days !== null && days <= 7 ? "soon" : "info";
        add({ id:`audit-${a.auditId}-${kind}`, type:"audit", severity, days, date, section, title, actionText, auditId:a.auditId, org:a.organizationName, text:`${a.auditId} / ${a.organizationName || "-"} / ${deadlineText(date)}` });
      };
      if (["planned","programmed"].includes(a.status)) pushAudit("auditee-response", "Kuruluş cevap süresi yaklaşıyor", a.auditeeResponseDueDate, ["pre_evaluation","audit_in_progress","objection_period","final_report_preparation","final_report_sent","cap_waiting","cap_under_review","cap_monitoring","closed"], "waitingAuditeeResponse", "Cevap sürecini kontrol et");
      if (["waiting_auditee_response","pre_evaluation"].includes(a.status)) pushAudit("preeval", "Ön değerlendirme son tarihi", a.preEvaluationDueDate, ["audit_in_progress","objection_period","final_report_preparation","final_report_sent","cap_waiting","cap_under_review","cap_monitoring","closed"], "preEvaluation", "Ön değerlendirme");
      if (a.status === "objection_period") pushAudit("objection", "İtiraz bildirimi son tarihi", a.objectionDueDate, ["final_report_preparation","final_report_sent","cap_waiting","cap_under_review","cap_monitoring","closed"], state.role === "auditee" ? "auditeeObjections" : "objectionAudits", "İtiraz sürecini aç");
      if (a.status === "final_report_preparation") pushAudit("final-report", "Nihai rapor son tarihi", a.finalReportDueDate, ["final_report_sent","cap_waiting","cap_under_review","cap_monitoring","closed"], "reportsAudit", "Nihai rapor");
      if (["final_report_sent","cap_waiting"].includes(a.status)) pushAudit("cap-submit", "CAP sunma son tarihi", a.capDueDate, ["cap_under_review","cap_monitoring","closed"], state.role === "auditee" ? "auditeeCap" : "capWaiting", "CAP girişi");
    });
    state.capPlans.filter(c => isAuditVisibleForCurrentUser(getAudit(c.auditId))).forEach(c => {
      if (["finding_closed","closed"].includes(c.status)) return;
      const days = daysFromToday(c.dueDate);
      const severity = days !== null && days < 0 ? "overdue" : days !== null && days <= 7 ? "soon" : "info";
      add({ id:`cap-${capPlanIdOf(c)}-due`, type:"cap", severity, days, date:c.dueDate, section: state.role === "auditee" ? "auditeeCap" : "capWaiting", title:"CAP planı son tarihi", actionText:"CAP planını aç", auditId:c.auditId, org:c.organizationName, text:`${capPlanIdOf(c)} / ${c.organizationName || "-"} / ${deadlineText(c.dueDate)}` });
    });
    state.capSteps.forEach(step => {
      const plan = getCapPlan(step.capPlanId);
      if (!plan || ["verified","deleted"].includes(step.status)) return;
      if (!isAuditVisibleForCurrentUser(getAudit(plan.auditId))) return;
      const date = step.revisedImplementationDate || step.estimatedImplementationDate;
      const days = daysFromToday(date);
      const severity = days !== null && days < 0 ? "overdue" : days !== null && days <= 7 ? "soon" : "info";
      add({ id:`capstep-${step.capStepId || step.id}`, type:"cap-step", severity, days, date, section: state.role === "auditee" ? "auditeeCap" : "capMonitoring", title:`CAP adımı ${step.stepNo || ""}`, actionText:"CAP izle", auditId:plan.auditId, org:plan.organizationName, text:`${plan.organizationName || "-"} / ${step.responsibleUnit || "-"} / ${deadlineText(date)}` });
    });
    return out.sort((a,b) => (a.days ?? 9999) - (b.days ?? 9999));
  }
  function notificationStats(notifs) {
    return {
      total: notifs.length,
      unread: notifs.filter(n => !state.notificationReads.includes(n.id)).length,
      overdue: notifs.filter(n => n.severity === "overdue").length,
      soon: notifs.filter(n => n.severity === "soon").length
    };
  }
  function renderNotificationsPanel() {
    const el = document.getElementById("notifications");
    if (!el) return;
    const rows = buildNotifications();
    const stats = notificationStats(rows);
    const list = rows.length ? rows.map(n => `<div class="notification-item ${n.severity} ${state.notificationReads.includes(n.id)?"done":""}"><div><h4>${escapeHtml(n.title)} ${deadlineBadge(n.date)}</h4><p>${escapeHtml(n.text)}<br><strong>İlgili kayıt:</strong> ${escapeHtml(n.auditId || "-")} | ${escapeHtml(n.org || "-")}</p></div><div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><button class="btn primary" onclick="openNotification('${jsArg(n.id)}')">${escapeHtml(n.actionText || "Aç")}</button><button class="btn" onclick="markNotificationRead('${jsArg(n.id)}')">Okundu</button></div></div>`).join("") : `<div class="empty">Açık bildirim veya gecikme uyarısı bulunmuyor.</div>`;
    el.innerHTML = `<div class="info-banner"><strong>Faz 8A Bildirim Merkezi:</strong> Kritik tarihler, gecikmeler ve 14 gün içindeki yaklaşan görevler bu ekranda toplanır. Statik GitHub Pages ortamında arka plan zamanlayıcı olmadığı için uyarılar sayfa açıldığında ve yenilendiğinde hesaplanır.</div><div class="notification-strip"><div class="notification-stat"><b>${stats.total}</b><span>Toplam uyarı</span></div><div class="notification-stat"><b>${stats.unread}</b><span>Okunmamış</span></div><div class="notification-stat"><b>${stats.overdue}</b><span>Geciken</span></div><div class="notification-stat"><b>${stats.soon}</b><span>7 gün içinde</span></div></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"><button class="btn success" onclick="markAllNotificationsRead()">Tümünü Okundu Yap</button><button class="btn warning" onclick="applyAutomaticDeadlineTransitions(true)">Süreleri Kontrol Et / Uygula</button></div><div class="notification-list">${list}</div>`;
  }
  window.markNotificationRead = function(id) {
    if (!state.notificationReads.includes(id)) state.notificationReads.push(id);
    localStorage.setItem("usoap_phase7_notification_reads", JSON.stringify(state.notificationReads));
    renderNotificationsPanel(); renderAuthState();
  };
  window.markAllNotificationsRead = function() {
    state.notificationReads = [...new Set([...state.notificationReads, ...buildNotifications().map(n => n.id)])];
    localStorage.setItem("usoap_phase7_notification_reads", JSON.stringify(state.notificationReads));
    renderNotificationsPanel(); renderAuthState();
  };
  window.openNotification = function(id) {
    const n = buildNotifications().find(x => x.id === id);
    if (!n) return;
    window.markNotificationRead(id);
    if (n.auditId) {
      if (n.section === "reportsAudit") state.currentFinalReportAuditId = n.auditId;
      if (n.section === "preEvaluation") state.currentPreEvaluationAuditId = n.auditId;
      if (n.section === "auditExecution") state.currentAuditExecutionId = n.auditId;
      if (n.section === "auditeeObjections" || n.section === "objectionAudits") state.currentObjectionAuditId = n.auditId;
    }
    showSection(n.section || "notifications");
  };


  // Override settings with user management and security rules guidance.
  renderSettings = function() {
    const collectionsJson = JSON.stringify(COLLECTIONS, null, 2);
    const profile = state.userProfile;
    const rulesNote = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function hasProfile() {
      return signedIn() && exists(/databases/$(database)/documents/users/$(request.auth.uid));
    }
    function profile() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }
    function active() { return hasProfile() && profile().active == true; }
    function role() { return active() ? profile().role : 'none'; }
    function admin() { return role() == 'admin'; }
    function programManager() { return role() in ['admin', 'program_manager']; }
    function leadOrManager() { return role() in ['admin', 'program_manager', 'lead_auditor']; }
    function auditorStaff() { return role() in ['admin', 'program_manager', 'lead_auditor', 'auditor']; }
    function staffRead() { return role() in ['admin', 'program_manager', 'lead_auditor', 'auditor', 'viewer']; }
    function auditeeFor(orgId) {
      return role() == 'auditee' && profile().organizationId == orgId;
    }
    function auditeeCreateOwnOrg() {
      return role() == 'auditee' && request.resource.data.organizationId == profile().organizationId;
    }
    function auditeeUpdateOwnOrg() {
      return role() == 'auditee'
        && resource.data.organizationId == profile().organizationId
        && request.resource.data.organizationId == resource.data.organizationId;
    }
    function selfPendingCreate(uid) {
      return signedIn()
        && request.auth.uid == uid
        && request.resource.data.uid == uid
        && request.resource.data.role == 'viewer'
        && request.resource.data.active == false
        && request.resource.data.pendingProfile == true
        && request.resource.data.approvalStatus == 'pending';
    }
    function selfProfileHeartbeat(uid) {
      return signedIn()
        && request.auth.uid == uid
        && request.resource.data.uid == resource.data.uid
        && request.resource.data.role == resource.data.role
        && request.resource.data.active == resource.data.active
        && request.resource.data.organizationId == resource.data.organizationId
        && request.resource.data.pendingProfile == resource.data.pendingProfile
        && request.resource.data.approvalStatus == resource.data.approvalStatus
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
          'lastLoginAt', 'email', 'displayName', 'updatedAt'
        ]);
    }

    match /users/{uid} {
      allow read: if signedIn() && (admin() || request.auth.uid == uid);
      allow create: if admin() || selfPendingCreate(uid);
      allow update: if admin() || selfProfileHeartbeat(uid);
      allow delete: if admin();
    }

    match /organizations/{id} {
      allow read: if staffRead() || (role() == 'auditee' && id == profile().organizationId);
      allow create, update: if programManager();
      allow delete: if admin();
    }

    match /masterForms/{id} {
      allow read: if staffRead();
      allow write: if admin();
    }

    match /formRevisions/{id} {
      allow read: if staffRead();
      allow write: if admin();
    }

    match /auditPrograms/{id} {
      allow read: if staffRead();
      allow create, update: if programManager();
      allow delete: if admin();
    }

    match /audits/{id} {
      allow read: if staffRead() || auditeeFor(resource.data.organizationId);
      allow create, update: if leadOrManager();
      allow delete: if admin();
    }

    match /auditAssignments/{id} {
      allow read: if staffRead();
      allow create, update: if leadOrManager();
      allow delete: if admin();
    }

    match /organizationResponses/{id} {
      allow read: if staffRead() || auditeeFor(resource.data.organizationId);
      allow create: if auditorStaff() || auditeeCreateOwnOrg();
      allow update: if auditorStaff() || auditeeUpdateOwnOrg();
      allow delete: if admin();
    }

    match /auditPreEvaluations/{id} {
      allow read: if staffRead();
      allow create, update: if auditorStaff();
      allow delete: if admin();
    }

    match /auditResponses/{id} {
      allow read: if staffRead();
      allow create, update: if role() in ['admin', 'lead_auditor', 'auditor'];
      allow delete: if admin();
    }

    match /findings/{id} {
      allow read: if staffRead() || auditeeFor(resource.data.organizationId);
      allow create, update: if auditorStaff();
      allow delete: if admin();
    }

    match /capPlans/{id} {
      allow read: if staffRead() || auditeeFor(resource.data.organizationId);
      allow create: if auditorStaff() || auditeeCreateOwnOrg();
      allow update: if auditorStaff() || (
        auditeeUpdateOwnOrg()
        && request.resource.data.auditId == resource.data.auditId
        && request.resource.data.findingId == resource.data.findingId
        && request.resource.data.capPlanId == resource.data.capPlanId
      );
      allow delete: if admin();
    }

    match /capSteps/{id} {
      allow read: if staffRead() || auditeeFor(resource.data.organizationId);
      allow create: if auditorStaff() || auditeeCreateOwnOrg();
      allow update: if auditorStaff() || (
        auditeeUpdateOwnOrg()
        && request.resource.data.auditId == resource.data.auditId
        && request.resource.data.findingId == resource.data.findingId
        && request.resource.data.capPlanId == resource.data.capPlanId
        && request.resource.data.capStepId == resource.data.capStepId
      );
      allow delete: if admin();
    }

    match /reports/{id} {
      allow read: if staffRead() || auditeeFor(resource.data.organizationId);
      allow create, update: if leadOrManager();
      allow delete: if admin();
    }

    match /evidenceReferences/{id} {
      allow read: if staffRead() || auditeeFor(resource.data.organizationId);
      allow create: if auditorStaff() || auditeeCreateOwnOrg();
      allow update: if auditorStaff() || auditeeUpdateOwnOrg();
      allow delete: if admin();
    }

    match /auditLogs/{id} {
      allow read: if staffRead();
      allow create: if active();
      allow update, delete: if false;
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}`;
    document.getElementById("settings").innerHTML = `<div class="grid"><div class="card span-6"><h3>Giriş / Yetki Durumu</h3><p>${isAuthLocked() ? "Gerçek kullanıcı girişi aktif." : "Demo/Test modu aktif veya kullanıcı girişi yapılmadı."}</p><div class="detail-grid"><div class="detail-box"><b>Kullanıcı</b>${escapeHtml(state.authUser?.email || "Demo/Test")}</div><div class="detail-box"><b>Rol</b>${escapeHtml(ROLES[state.role] || state.role)}</div><div class="detail-box"><b>Kuruluş</b>${escapeHtml(state.orgContext || "-")}</div><div class="detail-box"><b>Profil Durumu</b>${escapeHtml(profileStatusText(profile))}</div><div class="detail-box"><b>Veri Modu</b>${escapeHtml(dataModeLabel())}</div></div></div><div class="card span-6"><h3>Bağlantı Durumu</h3><p>${escapeHtml(state.firebaseMessage)}</p><p><strong>Faz 8A kuralı:</strong> Gerçek kullanıcı girişinde Firestore hatası oluşursa sistem localStorage'a geri dönmez; işlem başarısız sayılır.</p></div><div class="card span-12"><h3>Onay Bekleyen Kullanıcılar</h3>${pendingUsersSummaryHtml()}</div><div class="card span-12"><h3>Kullanıcı Profilleri</h3>${userRowsHtml()}</div>${newUserFormHtml()}<div class="card span-12"><h3>Faz 8A Veri Bakım Araçları</h3><p>Eski Faz 6/7 kayıtlarını yeni veri bütünlüğü kurallarına uyarlamak için Yönetici rolüyle bir kez çalıştırılabilir.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" onclick="repairCapStepOrganizationIds()">CAP Adımlarına Kuruluş ID Onarımı</button><button class="btn primary" onclick="reconcileAllAuditCapStatuses()">Denetim CAP Statülerini Yeniden Hesapla</button></div></div><div class="card span-12"><h3>Firestore Security Rules - Faz 8A</h3><p>Bu taslak paket içindeki <strong>firestore.rules</strong> dosyasıyla aynıdır. İlk yönetici hesabı otomatik oluşturulmaz; ilk <code>admin</code> users profili Firebase Console'dan kontrollü olarak tanımlanmalıdır.</p><pre class="model-code">${escapeHtml(rulesNote)}</pre></div><div class="card span-12"><h3>Firestore Koleksiyon Omurgası</h3><pre class="model-code">${escapeHtml(collectionsJson)}</pre></div><div class="card span-12"><h3>Faz 8A Kapsamı</h3><p><strong>Faz 8A:</strong> Yerel saat güvenli tarih hesapları, Demo/Firebase veri modu ayrımı, role ve kuruluşa göre Firestore sorguları, güçlendirilmiş Security Rules, CAP adımı silme bütünlüğü ve denetim üst statüsünün tüm CAP planlarından türetilmesi. Master PQ revizyon snapshot'ı ve daha ileri kullanıcı-atama güvenliği sonraki 8A/8B paketinde ele alınacaktır.</p></div></div>`;
  };

  // Faz 8B.5: app.js içinde kalan domain callbackleri bir kez kaydedilir; taşınan modüller kendi callbacklerini kaydeder.
  register("saveRecord", saveRecord);
  register("updateRecord", updateRecord);
  register("loadData", loadData);
  register("renderAll", renderAll);
  register("renderReports", renderReports);
  register("isAuthLocked", isAuthLocked);
  register("profileOrg", profileOrg);
  register("renderAuthState", renderAuthState);
  register("userIsPending", userIsPending);
  register("visibleAuditsForCurrentUser", visibleAuditsForCurrentUser);
  register("deadlineBadge", deadlineBadge);
  register("getProgram", getProgram);
  register("getAudit", getAudit);

  // Faz 8B.5: app.js içinde kalan inline HTML olaylarının erişmesi gereken render fonksiyonları.
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
      await initFirebase();
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
