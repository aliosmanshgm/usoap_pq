import {
  DATA_FILE, COLLECTIONS, ROLES, ROLE_SECTIONS, AREA_ORDER, AREA_LABELS,
  AUDIT_STATUS, CAP_STATUS, PROGRAM_STATUS, AUDIT_METHOD_LABELS,
  AUDIT_TYPE_LABELS, MENUS
} from "./config.js";
import { state } from "./state.js";
import {
  escapeHtml, localDateYmd, parseYmdLocal, today, addDays, uid, asBool, dateOrDash, daysBetween, formatDate
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

  function objectionEligibleAudits() {
    return auditeeVisibleAudits().filter(a => ['objection_period','final_report_preparation','final_report_sent','cap_waiting','cap_under_review','cap_monitoring','closed'].includes(a.status));
  }

  function getObjection(auditId) {
    return state.organizationResponses.find(r => r.auditId === auditId && r.responseType === 'objection') || null;
  }

  function objectionStatusLabel(record, audit) {
    if (!record && audit?.objectionStatus === 'auto_no_objection') return 'Sistem: İtiraz Yoktur';
    if (!record) return 'Bekleniyor';
    if (record.decision === 'no_objection') return record.autoCompleted ? 'Sistem: İtiraz Yoktur' : 'İtiraz Yoktur';
    if (record.decision === 'objection') return 'İtiraz Bildirildi';
    return 'Taslak';
  }

  function objectionPill(auditId) {
    const audit = getAudit(auditId);
    const record = getObjection(auditId);
    const label = objectionStatusLabel(record, audit);
    const cls = !record && audit?.status === 'objection_period' ? 'yellow' : (record?.decision === 'objection' ? 'red' : record?.decision === 'no_objection' || audit?.objectionStatus === 'auto_no_objection' ? 'green' : 'gray');
    return `<span class="pill ${cls}">İtiraz: ${escapeHtml(label)}</span>`;
  }

  function ensureObjectionSelection() {
    const audits = objectionEligibleAudits();
    const current = state.currentObjectionAuditId && getAudit(state.currentObjectionAuditId) ? state.currentObjectionAuditId : '';
    if (current && audits.some(a => a.auditId === current)) return current;
    const first = audits[0];
    state.currentObjectionAuditId = first?.auditId || '';
    if (state.currentObjectionAuditId) localStorage.setItem('usoap_phase5_current_objection_audit', state.currentObjectionAuditId);
    return state.currentObjectionAuditId;
  }

  window.openObjectionProcess = function(auditId) {
    state.currentObjectionAuditId = auditId || '';
    if (state.currentObjectionAuditId) localStorage.setItem('usoap_phase5_current_objection_audit', state.currentObjectionAuditId);
    showSection('auditeeObjections');
  };

  window.selectObjectionAudit = function(auditId) {
    state.currentObjectionAuditId = auditId || '';
    if (state.currentObjectionAuditId) localStorage.setItem('usoap_phase5_current_objection_audit', state.currentObjectionAuditId);
    if (state.role === 'auditee') renderAuditeeObjections();
    else renderAuditList('objectionAudits', ['objection_period'], 'İtiraz Sürecindeki Denetimler', 'Denetim bitişinden itibaren 2 günlük itiraz var/yok bildirim süreci.');
  };

  function objectionAuditOptions(selectedId = '') {
    return objectionEligibleAudits().map(a => `<option value="${escapeHtml(a.auditId)}" ${a.auditId === selectedId ? 'selected' : ''}>${escapeHtml(a.auditId)} - ${escapeHtml(a.organizationName || '-')} (${escapeHtml(AUDIT_STATUS[a.status] || a.status)})</option>`).join('');
  }

  function renderAuditeeObjections(portalNote = '') {
    const section = document.getElementById('auditeeObjections');
    if (!section) return;
    const audits = objectionEligibleAudits().filter(a => state.role !== 'auditee' || a.organizationId === state.orgContext);
    if (!audits.length) {
      section.innerHTML = portalNote + `<div class="info-banner"><strong>İtiraz Bildirimi:</strong> Denetim cevapları tamamlandıktan sonra denetim İtiraz Sürecinde statüsüne alınır. Kuruluş bu ekrandan 2 gün içinde itiraz var/yok bildirimi yapar.</div><div class="empty">Bu kuruluş bağlamında itiraz bildirimi yapılacak denetim bulunmuyor.</div>`;
      return;
    }
    const selectedId = ensureObjectionSelection();
    const audit = getAudit(selectedId) || audits[0];
    const record = getObjection(audit.auditId) || {};
    const days = daysBetween(audit.objectionDueDate);
    const dueLabel = days === null ? '-' : days < 0 ? `${Math.abs(days)} gün geçti` : days === 0 ? 'Bugün son gün' : `${days} gün kaldı`;
    const canSubmit = state.role === 'auditee' && audit.status === 'objection_period' && (!record.decision || record.status === 'draft');
    const readonly = canSubmit ? '' : 'disabled';
    const choice = record.decision || 'no_objection';
    section.innerHTML = portalNote + `
      <div class="info-banner"><strong>Faz 5:</strong> Denetlenen kuruluş, denetim bitişinden itibaren 2 gün içinde itiraz var/yok bildirimi yapabilir. İtiraz yoksa rapor hazırlık aşamasına erken geçilebilir. Süre geçip bildirim yapılmadıysa sistem "itiraz yoktur" kaydı oluşturabilir.</div>
      <div class="toolbar"><div class="field" style="min-width:320px"><label>İtiraz Denetimi Seç</label><select onchange="selectObjectionAudit(this.value)">${objectionAuditOptions(audit.auditId)}</select></div><button class="btn" onclick="showAuditDetails('${audit.auditId}')">Denetim Detayı</button><button class="btn warning" onclick="applyAutomaticDeadlineTransitions(true)">Süreleri Kontrol Et / Uygula</button></div>
      <div class="deadline-grid"><div class="deadline-card"><b>${escapeHtml(audit.auditId)}</b><span>Denetim</span></div><div class="deadline-card"><b>${escapeHtml(audit.organizationName || '-')}</b><span>Kuruluş</span></div><div class="deadline-card"><b>${formatDate(audit.objectionDueDate)}</b><span>İtiraz son tarihi</span></div><div class="deadline-card"><b>${escapeHtml(dueLabel)}</b><span>Kalan/geçen süre</span></div></div>
      <div class="status-ribbon">${statusPill(audit.status)}${objectionPill(audit.auditId)}${reportPill(audit.auditId)}</div>
      ${record.decision ? `<div class="${record.decision === 'objection' ? 'warn-banner' : 'info-banner'}"><strong>Mevcut bildirim:</strong> ${escapeHtml(objectionStatusLabel(record, audit))}${record.submittedAt ? ` | ${new Date(record.submittedAt).toLocaleString('tr-TR')}` : ''}</div>` : ''}
      <div class="card" style="margin-top:14px"><h3>İtiraz Bildirimi</h3>
        <div class="objection-choice">
          <label><input ${readonly} type="radio" name="objectionDecision" value="no_objection" ${choice !== 'objection' ? 'checked' : ''}> İtiraz yoktur</label>
          <label><input ${readonly} type="radio" name="objectionDecision" value="objection" ${choice === 'objection' ? 'checked' : ''}> İtiraz vardır</label>
        </div>
        <div class="form-grid">
          <div class="field full"><label>İtiraz / Açıklama Notu</label><textarea id="objectionNote" ${readonly} placeholder="İtiraz varsa gerekçe, itiraz yoksa kısa onay notu...">${escapeHtml(record.objectionNote || '')}</textarea></div>
          <div class="field full"><label>Kanıt Dosya Adı / Link <span style="text-transform:none;color:#64748b">(opsiyonel)</span></label><textarea id="objectionEvidence" ${readonly} placeholder="Dosya adı, klasör yolu veya bağlantı...">${escapeHtml(record.evidenceReference || '')}</textarea></div>
        </div>
      </div>
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn success" onclick="submitObjectionDecision(false)" ${canSubmit ? '' : 'disabled'}>Taslak Kaydet</button>
        <button class="btn primary" onclick="submitObjectionDecision(true)" ${canSubmit ? '' : 'disabled'}>Bildirimi Gönder</button>
        ${['admin','program_manager','lead_auditor'].includes(state.role) ? `<button class="btn warning" onclick="completeObjectionForAudit('${audit.auditId}')">İtiraz Sürecini Tamamla</button>` : ''}
      </div>`;
  }

  window.submitObjectionDecision = async function(submit) {
    const audit = getAudit(state.currentObjectionAuditId);
    if (!audit) return alert('Denetim seçin.');
    if (state.role !== 'auditee') return alert('İtiraz bildirimi denetlenen kuruluş rolüyle yapılır.');
    if (audit.status !== 'objection_period') return alert('Bu denetim itiraz sürecinde değil.');
    const decision = document.querySelector('input[name="objectionDecision"]:checked')?.value || 'no_objection';
    const note = document.getElementById('objectionNote')?.value.trim() || '';
    if (submit && decision === 'objection' && !note) return alert('İtiraz bildirimi için açıklama/gerekçe zorunludur.');
    const existing = getObjection(audit.auditId) || {};
    const responseId = `OBJECTION-${audit.auditId}`;
    const data = {
      ...existing,
      responseId,
      responseType: 'objection',
      auditId: audit.auditId,
      organizationId: audit.organizationId,
      organizationName: audit.organizationName,
      status: submit ? 'submitted' : 'draft',
      decision,
      objectionNote: note,
      evidenceReference: document.getElementById('objectionEvidence')?.value.trim() || '',
      submittedByRole: submit ? state.role : existing.submittedByRole || '',
      submittedAt: submit ? new Date().toISOString() : existing.submittedAt || null,
      autoCompleted: false,
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await saveRecord(COLLECTIONS.organizationResponses, responseId, data);
    if (submit) {
      const patch = { objectionStatus: decision === 'objection' ? 'objection_submitted' : 'no_objection', objectionCompletedAt: new Date().toISOString() };
      if (decision === 'no_objection') patch.status = 'final_report_preparation';
      await updateRecord(COLLECTIONS.audits, audit.auditId, patch);
    }
    await loadData();
    renderAll();
    state.currentObjectionAuditId = audit.auditId;
    localStorage.setItem('usoap_phase5_current_objection_audit', audit.auditId);
    alert(submit ? (decision === 'no_objection' ? 'İtiraz yoktur bildirimi gönderildi; denetim nihai rapor hazırlık aşamasına alındı.' : 'İtiraz bildirimi gönderildi.') : 'İtiraz bildirimi taslak kaydedildi.');
    showSection('auditeeObjections');
  };

  window.completeObjectionForAudit = async function(auditId) {
    const audit = getAudit(auditId);
    if (!audit) return;
    if (!['admin','program_manager','lead_auditor'].includes(state.role)) return alert('Bu işlem için Yönetici/Program Yöneticisi/Baş Denetçi rolü gerekir.');
    const objection = getObjection(auditId);
    if (!objection && daysBetween(audit.objectionDueDate) >= 0 && !confirm('Kuruluş bildirimi yok ve 2 günlük süre henüz tamamlanmadı. Yine de itiraz yoktur kabul edilerek tamamlanacak. Devam edilsin mi?')) return;
    if (!objection) await createAutoNoObjection(audit);
    await updateRecord(COLLECTIONS.audits, auditId, { status: 'final_report_preparation', objectionStatus: objection?.decision === 'objection' ? 'objection_reviewed' : 'no_objection', objectionCompletedAt: new Date().toISOString() });
    await loadData(); renderAll(); showSection('objectionAudits');
  };

  async function createAutoNoObjection(audit) {
    const responseId = `OBJECTION-${audit.auditId}`;
    const data = {
      responseId,
      responseType: 'objection',
      auditId: audit.auditId,
      organizationId: audit.organizationId,
      organizationName: audit.organizationName,
      status: 'submitted',
      decision: 'no_objection',
      objectionNote: 'Süre içerisinde itiraz bildirilmediği için sistem tarafından itiraz yoktur olarak kaydedildi.',
      evidenceReference: '',
      submittedByRole: 'system',
      submittedAt: new Date().toISOString(),
      autoCompleted: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await saveRecord(COLLECTIONS.organizationResponses, responseId, data);
  }

  window.applyAutomaticDeadlineTransitions = async function(showResult = true) {
    // Faz 8A: bu fonksiyon artık sayfa yüklenirken çağrılmaz; yalnızca açık kullanıcı işlemiyle çalışır.
    if (!showResult) return 0;
    const candidates = state.audits.filter(a => {
      if (a.status !== 'objection_period') return false;
      if (getObjection(a.auditId)) return false;
      const d = daysBetween(a.objectionDueDate);
      return d !== null && d < 0;
    });
    if (!candidates.length) {
      alert('Otomatik tamamlanmaya uygun, süresi geçmiş itiraz kaydı bulunmadı. Hiçbir kayıt değiştirilmedi.');
      return 0;
    }
    if (!confirm(`${candidates.length} denetimde itiraz süresi dolmuş ve kuruluş bildirimi yok. Bu denetimler için sistem kaydı oluşturulup Nihai Rapor Hazırlanıyor aşamasına geçirilsin mi?`)) return 0;
    let count = 0;
    for (const audit of candidates) {
      await createAutoNoObjection(audit);
      await updateRecord(COLLECTIONS.audits, audit.auditId, { status: 'final_report_preparation', objectionStatus: 'auto_no_objection', objectionCompletedAt: new Date().toISOString() });
      count++;
    }
    await loadData();
    renderAll();
    showSection(state.currentSection);
    alert(`${count} denetim için "itiraz yoktur" kaydı kullanıcı onayıyla oluşturuldu.`);
    return count;
  };

  function reportEligibleAudits() {
    return state.audits.filter(a => ['final_report_preparation','final_report_sent','cap_waiting','cap_under_review','cap_monitoring','closed'].includes(a.status));
  }

  function getReport(auditId) {
    return state.reports.find(r => r.auditId === auditId && (r.reportType || 'final') === 'final') || null;
  }

  function reportPill(auditId) {
    const audit = getAudit(auditId);
    const report = getReport(auditId);
    if (report?.status === 'sent' || audit?.finalReportSentDate) return `<span class="pill green">Nihai Rapor: Gönderildi</span>`;
    if (report?.status === 'draft') return `<span class="pill yellow">Nihai Rapor: Taslak</span>`;
    return `<span class="pill gray">Nihai Rapor: Yok</span>`;
  }

  function ensureFinalReportSelection() {
    const audits = reportEligibleAudits();
    const current = state.currentFinalReportAuditId && getAudit(state.currentFinalReportAuditId) ? state.currentFinalReportAuditId : '';
    if (current && audits.some(a => a.auditId === current)) return current;
    const first = audits[0];
    state.currentFinalReportAuditId = first?.auditId || '';
    if (state.currentFinalReportAuditId) localStorage.setItem('usoap_phase5_current_final_report_audit', state.currentFinalReportAuditId);
    return state.currentFinalReportAuditId;
  }

  window.openFinalReport = function(auditId) {
    state.currentFinalReportAuditId = auditId || '';
    if (state.currentFinalReportAuditId) localStorage.setItem('usoap_phase5_current_final_report_audit', state.currentFinalReportAuditId);
    showSection('reportsAudit');
  };

  window.selectFinalReportAudit = function(auditId) {
    state.currentFinalReportAuditId = auditId || '';
    if (state.currentFinalReportAuditId) localStorage.setItem('usoap_phase5_current_final_report_audit', state.currentFinalReportAuditId);
    renderReports();
  };

  function finalReportAuditOptions(selectedId = '') {
    return reportEligibleAudits().map(a => `<option value="${escapeHtml(a.auditId)}" ${a.auditId === selectedId ? 'selected' : ''}>${escapeHtml(a.auditId)} - ${escapeHtml(a.organizationName || '-')} (${escapeHtml(AUDIT_STATUS[a.status] || a.status)})</option>`).join('');
  }

  function auditFindings(auditId) {
    return state.findings.filter(f => f.auditId === auditId && !['void','withdrawn'].includes(f.status));
  }

  function reportDefaultSummary(audit, findings) {
    return `Denetim ${formatDate(audit.plannedStartDate)} - ${formatDate(audit.plannedEndDate)} tarihleri arasında ${audit.organizationName || 'ilgili kuruluş'} nezdinde gerçekleştirilmiştir. Denetim kapsamındaki kontrol formlarında yapılan değerlendirme sonucunda ${findings.length} NS bulgu tespit edilmiştir.`;
  }

  function reportHtml(audit, report, findings) {
    const assignment = getAssignment(audit.auditId) || {};
    const objection = getObjection(audit.auditId);
    const rows = findings.map(f => `<tr><td>${escapeHtml(f.areaKey || '-')}</td><td>${escapeHtml(f.pqNo || '-')}</td><td>${escapeHtml(f.ce || '-')}</td><td>${escapeHtml(f.findingText || '-')}</td><td>${escapeHtml(f.reviewedEvidence || '-')}</td></tr>`).join('');
    return `<div class="report-preview">
      <h1>USOAP CMA DENETİM NİHAİ RAPORU</h1>
      <p><strong>Denetim:</strong> ${escapeHtml(audit.auditId)} | <strong>Kuruluş:</strong> ${escapeHtml(audit.organizationName || '-')}</p>
      <table class="meta-table"><tbody>
        <tr><th>Program</th><td>${escapeHtml(audit.programId || '-')}</td><th>Denetim Tarihi</th><td>${formatDate(audit.plannedStartDate)} - ${formatDate(audit.plannedEndDate)}</td></tr>
        <tr><th>Yer</th><td>${escapeHtml(audit.location || '-')}</td><th>Yöntem / Şekil</th><td>${escapeHtml(AUDIT_METHOD_LABELS[audit.auditMethod] || audit.auditMethod || '-')} / ${escapeHtml(AUDIT_TYPE_LABELS[audit.auditType] || audit.auditType || '-')}</td></tr>
        <tr><th>Heyet Başkanı</th><td>${escapeHtml(assignment.leadAuditorName || '-')}</td><th>Heyet Üyeleri</th><td>${escapeHtml((assignment.auditorNames || []).join(', ') || '-')}</td></tr>
        <tr><th>Kontrol Formları</th><td colspan="3">${escapeHtml((audit.selectedForms || []).join(', ') || '-')}</td></tr>
      </tbody></table>
      <h2>1. Amaç, Kapsam ve Kriterler</h2>
      <p><strong>Amaç:</strong> ${escapeHtml(audit.objectives || '-')}</p>
      <p><strong>Kapsam:</strong> ${escapeHtml(audit.scope || '-')}</p>
      <p><strong>Kriterler:</strong> ${escapeHtml(audit.criteria || '-')}</p>
      <h2>2. Yönetici Özeti</h2><p>${escapeHtml(report.summaryText || reportDefaultSummary(audit, findings))}</p>
      <h2>3. İtiraz Süreci</h2><p>${escapeHtml(objection ? `${objectionStatusLabel(objection, audit)}. ${objection.objectionNote || ''}` : 'İtiraz bildirimi bulunmamaktadır.')}</p>
      <h2>4. Bulgular</h2>
      <table class="meta-table"><thead><tr><th>Area</th><th>PQ</th><th>CE</th><th>Bulgu</th><th>İncelenen Kanıt</th></tr></thead><tbody>${rows || `<tr><td colspan="5">NS bulgu bulunmamaktadır.</td></tr>`}</tbody></table>
      <h2>5. Sonuç ve Takip</h2><p>${escapeHtml(report.conclusionText || 'NS bulgular için nihai rapor gönderiminden itibaren 45 gün içinde CAP hazırlanması beklenir.')}</p>
      ${report.distributionNote ? `<h2>6. Dağıtım / Gönderim Notu</h2><p>${escapeHtml(report.distributionNote)}</p>` : ''}
    </div>`;
  }

  function renderFinalReportModule() {
    const section = document.getElementById('reportsAudit');
    const audits = reportEligibleAudits();
    if (!audits.length) {
      section.innerHTML = `<div class="info-banner"><strong>Nihai Rapor:</strong> İtiraz süreci tamamlanan denetimler burada rapora dönüştürülür.</div><div class="empty">Nihai rapor hazırlanacak denetim bulunmuyor. Önce denetimi İtiraz Sürecinden Nihai Rapor Hazırlanıyor aşamasına alın.</div>`;
      return;
    }
    const selectedId = ensureFinalReportSelection();
    const audit = getAudit(selectedId) || audits[0];
    const report = getReport(audit.auditId) || {};
    const findings = auditFindings(audit.auditId);
    const days = daysBetween(audit.finalReportDueDate);
    const canEdit = ['admin','program_manager','lead_auditor'].includes(state.role) && audit.status === 'final_report_preparation';
    const disabled = canEdit ? '' : 'disabled';
    section.innerHTML = `
      <div class="info-banner"><strong>Faz 5:</strong> Nihai rapor, denetim bitişinden itibaren 15 gün içinde hazırlanıp gönderilmelidir. Gönderim yapıldığında açık NS bulguları için 45 günlük CAP bekleme süreci otomatik başlatılır.</div>
      <div class="toolbar"><div class="field" style="min-width:340px"><label>Nihai Rapor Denetimi Seç</label><select onchange="selectFinalReportAudit(this.value)">${finalReportAuditOptions(audit.auditId)}</select></div><button class="btn" onclick="showAuditDetails('${audit.auditId}')">Denetim Detayı</button><button class="btn" onclick="openObjectionProcess('${audit.auditId}')">İtiraz Süreci</button><button class="btn primary" onclick="window.print()">Yazdır / PDF</button></div>
      <div class="deadline-grid"><div class="deadline-card"><b>${escapeHtml(audit.auditId)}</b><span>Denetim</span></div><div class="deadline-card"><b>${formatDate(audit.finalReportDueDate)}</b><span>Nihai rapor son tarihi</span></div><div class="deadline-card"><b>${days === null ? '-' : days < 0 ? Math.abs(days) + ' gün gecikti' : days + ' gün kaldı'}</b><span>Süre durumu</span></div><div class="deadline-card"><b>${findings.length}</b><span>NS bulgu</span></div></div>
      <div class="status-ribbon">${statusPill(audit.status)}${objectionPill(audit.auditId)}${reportPill(audit.auditId)}</div>
      ${!canEdit && audit.status === 'final_report_preparation' ? `<div class="readonly-note">Nihai raporu düzenlemek/göndermek için Yönetici, Program Yöneticisi veya Baş Denetçi rolü gerekir.</div>` : ''}
      ${audit.status !== 'final_report_preparation' ? `<div class="readonly-note">Bu rapor gönderilmiş veya sonraki aşamaya geçmiş olabilir. Alanlar salt okunur gösterilir.</div>` : ''}
      <div class="split-panel" style="margin-top:14px">
        <div class="phase5-panel"><h3>Rapor Bilgileri</h3>
          <div class="field"><label>Yönetici Özeti</label><textarea id="reportSummaryText" ${disabled}>${escapeHtml(report.summaryText || reportDefaultSummary(audit, findings))}</textarea></div>
          <div class="field"><label>Sonuç / Takip Notu</label><textarea id="reportConclusionText" ${disabled}>${escapeHtml(report.conclusionText || 'NS bulgular için nihai rapor gönderiminden itibaren 45 gün içinde CAP hazırlanması beklenir.')}</textarea></div>
          <div class="field"><label>Dağıtım / Gönderim Notu</label><textarea id="reportDistributionNote" ${disabled}>${escapeHtml(report.distributionNote || '')}</textarea></div>
          <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn success" onclick="saveFinalReport(false)" ${disabled}>Taslak Raporu Kaydet</button><button class="btn primary" onclick="saveFinalReport(true)" ${disabled}>Nihai Raporu Gönder</button></div>
        </div>
        <div>${reportHtml(audit, report, findings)}</div>
      </div>`;
  }

  window.saveFinalReport = async function(send) {
    const audit = getAudit(state.currentFinalReportAuditId);
    if (!audit) return alert('Denetim seçin.');
    if (!['admin','program_manager','lead_auditor'].includes(state.role)) return alert('Nihai rapor için Yönetici/Program Yöneticisi/Baş Denetçi rolü gerekir.');
    const findings = auditFindings(audit.auditId);
    const reportId = `REPORT-${audit.auditId}`;
    const existing = getReport(audit.auditId) || {};
    const data = {
      ...existing,
      reportId,
      reportType: 'final',
      auditId: audit.auditId,
      organizationId: audit.organizationId,
      organizationName: audit.organizationName,
      status: send ? 'sent' : 'draft',
      summaryText: document.getElementById('reportSummaryText')?.value.trim() || reportDefaultSummary(audit, findings),
      conclusionText: document.getElementById('reportConclusionText')?.value.trim() || '',
      distributionNote: document.getElementById('reportDistributionNote')?.value.trim() || '',
      findingIds: findings.map(f => f.findingId || f.id),
      sentAt: send ? new Date().toISOString() : existing.sentAt || null,
      createdByRole: existing.createdByRole || state.role,
      updatedByRole: state.role,
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await saveRecord(COLLECTIONS.reports, reportId, data);
    if (send) {
      await finalizeReportAndStartCap(audit, data.sentAt);
    }
    await loadData(); renderAll();
    state.currentFinalReportAuditId = audit.auditId;
    localStorage.setItem('usoap_phase5_current_final_report_audit', audit.auditId);
    alert(send ? 'Nihai rapor gönderildi. Açık bulgular için 45 günlük CAP bekleme kayıtları oluşturuldu.' : 'Nihai rapor taslağı kaydedildi.');
    showSection('reportsAudit');
  };

  async function finalizeReportAndStartCap(audit, sentAtIso) {
    const sentDate = sentAtIso ? localDateYmd(new Date(sentAtIso)) : today();
    const capDueDate = addDays(sentDate, audit.capDueDays || 45);
    await updateRecord(COLLECTIONS.audits, audit.auditId, { status: 'cap_waiting', finalReportSentDate: sentDate, finalReportSentAt: sentAtIso, capDueDays: audit.capDueDays || 45, capDueDate });
    const findings = auditFindings(audit.auditId).filter(f => !['closed','finding_closed','void','withdrawn'].includes(f.status));
    for (const f of findings) {
      const findingId = f.findingId || f.id;
      const capPlanId = `CAP-${findingId}`;
      const existing = state.capPlans.find(c => (c.capPlanId || c.id) === capPlanId) || {};
      await saveRecord(COLLECTIONS.capPlans, capPlanId, {
        ...existing,
        capPlanId,
        findingId,
        auditId: audit.auditId,
        organizationId: audit.organizationId,
        organizationName: audit.organizationName,
        dueDate: existing.dueDate || capDueDate,
        status: existing.status || 'cap_waiting',
        submittedAt: existing.submittedAt || null,
        evaluationNote: existing.evaluationNote || '',
        createdAt: existing.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      await updateRecord(COLLECTIONS.findings, findingId, { status: 'cap_waiting', finalReportIncluded: true, capPlanId, capDueDate });
    }
  }

  function renderFindingsAndCap() {
    const openFindings = state.findings.filter(f => !["closed", "finding_closed", "void", "withdrawn"].includes(f.status));
    const closedFindings = state.findings.filter(f => ["closed", "finding_closed"].includes(f.status));
    const capWaiting = state.capPlans.filter(c => c.status === "cap_waiting");
    const capReview = state.capPlans.filter(c => ["cap_submitted", "cap_partially_accepted_revision_required", "cap_rejected"].includes(c.status));
    const capMonitoring = state.capPlans.filter(c => ["cap_accepted", "implementation_in_progress", "completion_reported", "verification_pending", "cap_resubmission_required"].includes(c.status));
    document.getElementById("findingsOpen").innerHTML = findingsTable(openFindings, "Açık Bulgular", "Bulgu yalnızca NS denetim cevabından oluşur.");
    document.getElementById("capWaiting").innerHTML = capTable(capWaiting, "CAP Bekleyenler", "Nihai rapor sonrası 45 gün içinde CAP beklenen bulgular.");
    document.getElementById("capReview").innerHTML = capTable(capReview, "CAP Değerlendirme", "Kabul, kısmen kabul/revizyon veya iade kararları bu aşamada verilir.");
    document.getElementById("capMonitoring").innerHTML = capTable(capMonitoring, "CAP İzleme", "Kabul edilen CAP adımları ilerleme, tamamlanma ve doğrulama aşamalarında izlenir.");
    document.getElementById("closedFindings").innerHTML = findingsTable(closedFindings, "Kapatılan Bulgular", "Doğrulanarak kapatılan bulgular.");
  }
  function findingsTable(rows, title, subtitle) {
    if (!rows.length) return `<div class="info-banner"><strong>${title}:</strong> ${subtitle}</div><div class="empty">Kayıt bulunmuyor. Faz 2'de NS denetim cevaplarından otomatik bulgu oluşturulacak.</div>`;
    return `<div class="info-banner"><strong>${title}:</strong> ${subtitle}</div><div class="table-wrap"><table><thead><tr><th>Bulgu</th><th>Denetim</th><th>Area / PQ</th><th>CE</th><th>Bulgu Metni</th><th>Durum</th></tr></thead><tbody>${rows.map(f => `<tr><td>${escapeHtml(f.findingId || f.id)}</td><td>${escapeHtml(f.auditId || "-")}</td><td>${escapeHtml(f.areaKey || "-")} / ${escapeHtml(f.pqNo || "-")}</td><td>${escapeHtml(f.ce || "-")}</td><td>${escapeHtml(f.findingText || "-")}</td><td>${escapeHtml(f.status || "open")}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function capTable(rows, title, subtitle) {
    if (!rows.length) return `<div class="info-banner"><strong>${title}:</strong> ${subtitle}</div><div class="empty">CAP kaydı bulunmuyor.</div>`;
    return `<div class="info-banner"><strong>${title}:</strong> ${subtitle}</div><div class="table-wrap"><table><thead><tr><th>CAP Plan</th><th>Bulgu</th><th>Son Tarih</th><th>Durum</th><th>Değerlendirme Notu</th></tr></thead><tbody>${rows.map(c => `<tr><td>${escapeHtml(c.capPlanId || c.id)}</td><td>${escapeHtml(c.findingId || "-")}</td><td>${escapeHtml(c.dueDate || "-")}</td><td>${escapeHtml(CAP_STATUS[c.status] || c.status || "-")}</td><td>${escapeHtml(c.evaluationNote || "-")}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function renderReports() {
    renderFinalReportModule();
    const programRows = state.auditPrograms.map(p => {
      const audits = state.audits.filter(a => a.programId === p.programId);
      return `<tr><td>${escapeHtml(p.programId)}</td><td>${escapeHtml(p.name)}</td><td>${audits.length}</td><td>${audits.filter(a => a.status === "closed").length}</td><td>${audits.filter(a => a.status === "archived").length}</td></tr>`;
    }).join("");
    document.getElementById("reportsProgram").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Program</th><th>Adı</th><th>Denetim</th><th>Kapatılan</th><th>Arşiv</th></tr></thead><tbody>${programRows || `<tr><td colspan="5">Program bulunmuyor.</td></tr>`}</tbody></table></div>`;
    document.getElementById("reportsCap").innerHTML = `<div class="card"><h3>CAP Durum Raporu</h3><p>Açık bulgu: ${state.findings.filter(f => !["closed", "finding_closed"].includes(f.status)).length}. CAP planı: ${state.capPlans.length}. Faz 6'da CAP girişi, geciken CAP, yaklaşan görevler ve Kanban entegrasyonu eklenecek.</p></div>`;
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
  function getCapPlan(capPlanId) {
    return state.capPlans.find(c => (c.capPlanId || c.id) === capPlanId) || null;
  }
  function getCapPlanForFinding(findingId) {
    return state.capPlans.find(c => c.findingId === findingId) || null;
  }
  function capPlanIdOf(plan) {
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
    await updateRecord(COLLECTIONS.audits, auditId, patch);
    return status;
  }
  window.reconcileAllAuditCapStatuses = async function() {
    if (state.role !== "admin") return alert("Bu bakım işlemi yalnızca Yönetici rolüyle yapılabilir.");
    const auditIds = [...new Set(state.capPlans.map(p => p.auditId).filter(Boolean))];
    if (!auditIds.length) return alert("CAP planına bağlı denetim bulunmuyor.");
    if (!confirm(`${auditIds.length} denetimin üst CAP statüsü bulgu/CAP planlarından yeniden hesaplansın mı?`)) return;
    for (const auditId of auditIds) await syncAuditCapStatus(auditId);
    await loadData(); renderAll(); showSection("settings");
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
      await updateRecord(COLLECTIONS.capSteps, step.capStepId || step.id, { organizationId: plan.organizationId });
    }
    await loadData(); renderAll(); showSection("settings");
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
    await updateRecord(COLLECTIONS.capPlans, capPlanId, { status: "cap_submitted", submittedAt: new Date().toISOString(), submittedByRole: state.role });
    if (plan.findingId) await updateRecord(COLLECTIONS.findings, plan.findingId, { status: "cap_under_review" });
  }
  window.submitAllAuditeeCapPlans = async function() {
    if (state.role !== "auditee") return alert("Toplu CAP sunumu denetlenen kuruluş rolüyle yapılabilir.");
    const selectedId = getCapSelection("auditeeCap");
    if (selectedId && getCapPlan(selectedId)) {
      await persistCapPlanForm(selectedId).catch(err => console.warn("Seçili CAP taslağı kaydedilemedi", err));
    }
    await loadData();
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
    await loadData(); renderAll(); showSection("auditeeCap");
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
    await updateRecord(COLLECTIONS.capPlans, capPlanId, patch);
    const rows = Array.from(root.querySelectorAll(".cap-step-row"));
    for (const row of rows) {
      const stepId = row.dataset.stepId;
      const existingRaw = state.capSteps.find(s => (s.capStepId || s.id) === stepId) || {};
      const existing = normalizedCapStep(existingRaw);
      const progress = Math.max(0, Math.min(100, Number(row.querySelector('[data-field="progressPercent"]')?.value || 0)));
      const status = progress >= 100 && (row.querySelector('[data-field="completionDate"]')?.value || "") ? "completed" : progress > 0 ? "in_progress" : (existing.status || "not_started");
      await saveRecord(COLLECTIONS.capSteps, stepId, {
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
    await loadData();
    const existingSteps = capStepsForPlan(capPlanId).filter(s => s.status !== "deleted");
    let nextNo = existingSteps.length ? Math.max(...existingSteps.map(s => Number(s.stepNo || 0))) + 1 : 1;
    let stepId = `${capPlanId}-STEP-${String(nextNo).padStart(2,"0")}`;
    while (state.capSteps.some(s => (s.capStepId || s.id) === stepId && s.status !== "deleted")) {
      nextNo += 1;
      stepId = `${capPlanId}-STEP-${String(nextNo).padStart(2,"0")}`;
    }
    await saveRecord(COLLECTIONS.capSteps, stepId, {
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
    await loadData(); renderAll(); showSection(state.currentSection);
  };
  window.removeCapStep = async function(stepId) {
    if (!confirm("Bu CAP adımı silinsin mi?")) return;
    if (isProductionDataMode()) {
      await updateRecord(COLLECTIONS.capSteps, stepId, { deleted: true, status: "deleted", deletedAt: new Date().toISOString(), deletedByRole: state.role });
    } else {
      const rows = localRead(COLLECTIONS.capSteps).filter(s => (s.capStepId || s.id) !== stepId);
      localWrite(COLLECTIONS.capSteps, rows);
    }
    await loadData();
    renderAll(); showSection(state.currentSection);
  };
  window.saveCapDraft = async function(capPlanId) {
    if (!capPlanId) return alert("CAP planı seçin.");
    await persistCapPlanForm(capPlanId);
    setCapSelection(state.currentSection || "auditeeCap", capPlanId);
    state.lastCapMessage = "CAP taslağı kaydedildi. Bu işlem CAP'i denetleyen değerlendirmesine göndermez; hazır olduğunda CAP Planını Sun butonuna basmalısınız.";
    await loadData(); renderAll(); showSection(state.currentSection);
    alert("CAP taslağı kaydedildi. Hazır olduğunda CAP Planını Sun butonuyla denetleyen değerlendirmesine gönderebilirsiniz.");
  };
  window.submitCapPlan = async function(capPlanId) {
    const plan = getCapPlan(capPlanId);
    if (!plan) return alert("CAP planı seçin.");
    if (state.role !== "auditee") return alert("CAP sunumu denetlenen kuruluş rolüyle yapılabilir.");
    await persistCapPlanForm(capPlanId);
    await loadData();
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
    await updateRecord(COLLECTIONS.capPlans, capPlanId, { status: "cap_submitted", submittedAt: new Date().toISOString(), submittedByRole: state.role });
    await updateRecord(COLLECTIONS.findings, plan.findingId, { status: "cap_under_review" });
    if (plan.auditId) await syncAuditCapStatus(plan.auditId, { [capPlanId]: "cap_submitted" });
    setCapSelection("auditeeCap", capPlanId);
    setCapSelection("capReview", capPlanId);
    state.lastCapMessage = "CAP planı denetleyen değerlendirmesine sunuldu.";
    await loadData(); renderAll(); showSection("auditeeCap");
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
    await updateRecord(COLLECTIONS.capPlans, capPlanId, { status, evaluationNote: note, evaluatedAt: new Date().toISOString(), evaluatorRole: state.role });
    if (decision === "accept") {
      await updateRecord(COLLECTIONS.findings, plan.findingId, { status: "cap_monitoring" });
    } else {
      await updateRecord(COLLECTIONS.findings, plan.findingId, { status: "cap_resubmission_required" });
    }
    if (plan.auditId) await syncAuditCapStatus(plan.auditId, { [capPlanId]: status });
    const nextSection = decision === "accept" ? "capMonitoring" : "capReview";
    setCapSelection(nextSection, capPlanId);
    setCapSelection("auditeeCap", capPlanId);
    state.lastCapMessage = decision === "accept" ? "CAP kabul edildi ve izleme aşamasına alındı." : "CAP revizyon/iade kararıyla kuruluşa geri gönderildi.";
    await loadData(); renderAll(); showSection(nextSection);
    alert(decision === "accept" ? "CAP kabul edildi ve izleme aşamasına alındı." : "CAP revizyon/iade kararıyla kuruluşa geri gönderildi.");
  };
  window.reportCapCompletion = async function(capPlanId) {
    const plan = getCapPlan(capPlanId);
    if (!plan) return alert("CAP planı seçin.");
    if (state.role !== "auditee") return alert("Tamamlandı bildirimi denetlenen kuruluş rolüyle yapılabilir.");
    await persistCapPlanForm(capPlanId);
    await loadData();
    const steps = capStepsForPlan(capPlanId);
    if (!steps.length || steps.some(s => Number(s.progressPercent || 0) < 100 || !s.completionDate)) return alert("Tamamlandı bildirimi için tüm adımlarda ilerleme %100 ve tamamlanma tarihi olmalıdır.");
    await updateRecord(COLLECTIONS.capPlans, capPlanId, { status: "completion_reported", completionReportedAt: new Date().toISOString() });
    await updateRecord(COLLECTIONS.findings, plan.findingId, { status: "verification_pending" });
    if (plan.auditId) await syncAuditCapStatus(plan.auditId, { [capPlanId]: "completion_reported" });
    setCapSelection("auditeeCap", capPlanId);
    setCapSelection("capMonitoring", capPlanId);
    state.lastCapMessage = "CAP tamamlandı bildirimi denetleyen doğrulamasına gönderildi.";
    await loadData(); renderAll(); showSection("auditeeCap");
    alert("CAP tamamlandı bildirimi denetleyen doğrulamasına gönderildi.");
  };
  window.verifyCapStep = async function(stepId, ok) {
    const step = state.capSteps.find(s => (s.capStepId || s.id) === stepId);
    if (!step) return alert("CAP adımı bulunamadı.");
    if (!["admin","program_manager","lead_auditor","auditor"].includes(state.role)) return alert("Doğrulama için denetçi rolü gerekir.");
    await updateRecord(COLLECTIONS.capSteps, stepId, { status: ok ? "verified" : "rejected", verifiedAt: ok ? new Date().toISOString() : null, verifierRole: state.role });
    const plan = getCapPlan(step.capPlanId);
    if (!ok && plan) {
      await updateRecord(COLLECTIONS.capPlans, step.capPlanId, { status: "cap_resubmission_required", evaluationNote: "Doğrulamada uygun bulunmayan adım var. CAP revizyonu bekleniyor." });
      await updateRecord(COLLECTIONS.findings, plan.findingId, { status: "cap_resubmission_required" });
      if (plan.auditId) await syncAuditCapStatus(plan.auditId, { [step.capPlanId]: "cap_resubmission_required" });
    } else if (plan) {
      await updateRecord(COLLECTIONS.capPlans, step.capPlanId, { status: "verification_pending" });
      if (plan.auditId) await syncAuditCapStatus(plan.auditId, { [step.capPlanId]: "verification_pending" });
    }
    setCapSelection("capMonitoring", step.capPlanId);
    state.lastCapMessage = ok ? "CAP adımı doğrulandı." : "CAP adımı uygun bulunmadı; kuruluş revizyonu bekleniyor.";
    await loadData(); renderAll(); showSection("capMonitoring");
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
      await updateRecord(COLLECTIONS.capSteps, stepId, { status: "verified", verifiedAt: new Date().toISOString(), verifierRole: state.role });
    }
    await updateRecord(COLLECTIONS.capPlans, capPlanId, { status: "verification_pending", verificationStartedAt: new Date().toISOString() });
    await updateRecord(COLLECTIONS.findings, plan.findingId, { status: "verification_pending" });
    if (plan.auditId) await syncAuditCapStatus(plan.auditId, { [capPlanId]: "verification_pending" });
    setCapSelection("capMonitoring", capPlanId);
    state.lastCapMessage = "Tüm CAP adımları doğrulandı. Artık bulguyu kapatabilirsiniz.";
    await loadData(); renderAll(); showSection("capMonitoring");
    alert("Tüm CAP adımları doğrulandı. Artık Bulguyu Kapat butonunu kullanabilirsiniz.");
  };

  window.closeFindingFromCap = async function(capPlanId) {
    const plan = getCapPlan(capPlanId);
    if (!plan) return alert("CAP planı seçin.");
    if (!["admin","program_manager","lead_auditor"].includes(state.role)) return alert("Bulgu kapatma için Yönetici/Program Yöneticisi/Baş Denetçi rolü gerekir.");
    const steps = capStepsForPlan(capPlanId);
    if (!steps.length || steps.some(s => s.status !== "verified")) return alert("Bulgu kapatılmadan önce tüm CAP adımları doğrulanmalıdır.");
    const closureNote = capDetailRoot(capPlanId, "monitoring")?.querySelector("#capClosureNote")?.value.trim() || "CAP adımları doğrulandı ve bulgu kapatıldı.";
    await updateRecord(COLLECTIONS.capPlans, capPlanId, { status: "finding_closed", closedAt: new Date().toISOString(), closureNote });
    await updateRecord(COLLECTIONS.findings, plan.findingId, { status: "finding_closed", closedAt: new Date().toISOString(), closureNote });
    if (plan.auditId) await syncAuditCapStatus(plan.auditId, { [capPlanId]: "finding_closed" });
    await loadData(); renderAll(); showSection("closedFindings");
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

  renderFindingsAndCap = function() {
    const openFindings = state.findings.filter(f => !["closed", "finding_closed", "void", "withdrawn"].includes(f.status));
    const closedFindings = state.findings.filter(f => ["closed", "finding_closed"].includes(f.status));
    const capWaiting = capPlanRowsByStatus("waiting");
    const capReview = capPlanRowsByStatus("review");
    const capMonitoring = capPlanRowsByStatus("monitoring");
    document.getElementById("findingsOpen").innerHTML = findingsTable(openFindings, "Açık Bulgular", "Bulgu yalnızca NS denetim cevabından oluşur. Nihai rapor gönderildikten sonra CAP planı ile ilişkilendirilir.");
    renderCapWorkflowSection("capWaiting", capWaiting, "CAP Bekleyenler", "Nihai rapor sonrası 45 gün içinde CAP planı/adımı beklenen bulgular.", "waiting");
    renderCapWorkflowSection("capReview", capReview, "CAP Değerlendirme", "Sunulan CAP planı kabul, kısmen kabul/revizyon veya iade kararına bağlanır.", "review");
    renderCapWorkflowSection("capMonitoring", capMonitoring, "CAP İzleme", "Kabul edilen CAP adımlarının ilerleme, tamamlanma ve doğrulama süreci izlenir.", "monitoring");
    document.getElementById("closedFindings").innerHTML = findingsTable(closedFindings, "Kapatılan Bulgular", "Tüm CAP adımları doğrulanarak kapatılan bulgular.");
    renderAuditeeCapModule();
  };

  function renderCapReportModule() {
    const all = state.capPlans;
    const rows = all.slice().sort((a,b) => String(a.dueDate || "").localeCompare(String(b.dueDate || "")));
    const kanban = `<div class="cap-board"><div class="cap-column"><h3>Bekleyen <span class="pill gray">${capPlanRowsByStatus("waiting").length}</span></h3>${capPlanRowsByStatus("waiting").map(c => capPlanCard(c,"capWaiting")).join("") || `<div class="empty">Yok</div>`}</div><div class="cap-column"><h3>Değerlendirme <span class="pill gray">${capPlanRowsByStatus("review").length}</span></h3>${capPlanRowsByStatus("review").map(c => capPlanCard(c,"capReview")).join("") || `<div class="empty">Yok</div>`}</div><div class="cap-column"><h3>İzleme <span class="pill gray">${capPlanRowsByStatus("monitoring").length}</span></h3>${capPlanRowsByStatus("monitoring").map(c => capPlanCard(c,"capMonitoring")).join("") || `<div class="empty">Yok</div>`}</div></div>`;
    const table = rows.length ? `<div class="table-wrap"><table><thead><tr><th>CAP Plan</th><th>Kuruluş</th><th>Bulgu</th><th>Son Tarih</th><th>Durum</th><th>Adım / İlerleme</th></tr></thead><tbody>${rows.map(c => { const f = capPlanFinding(c); const m = capProgressMeta(c); return `<tr><td>${escapeHtml(capPlanIdOf(c))}</td><td>${escapeHtml(c.organizationName || "-")}</td><td>${escapeHtml(f.areaKey || "-")} / PQ ${escapeHtml(f.pqNo || "-")}</td><td>${escapeHtml(capDueText(c))}</td><td>${capStatusPill(c.status)}</td><td>${m.steps.length} adım / %${m.progress}<div class="progress-track"><span style="width:${m.progress}%"></span></div></td></tr>`; }).join("")}</tbody></table></div>` : `<div class="empty">CAP kaydı bulunmuyor.</div>`;
    document.getElementById("reportsCap").innerHTML = `<div class="info-banner"><strong>CAP Durum Raporu:</strong> CAP sunumu, değerlendirme, izleme, gecikme ve kapanış durumu tek ekranda izlenir.</div>${capDashboard(all)}${kanban}${table}`;
  }

  renderReports = function() {
    renderFinalReportModule();
    const programRows = state.auditPrograms.map(p => {
      const audits = state.audits.filter(a => a.programId === p.programId);
      return `<tr><td>${escapeHtml(p.programId)}</td><td>${escapeHtml(p.name)}</td><td>${audits.length}</td><td>${audits.filter(a => a.status === "closed").length}</td><td>${audits.filter(a => a.status === "archived").length}</td></tr>`;
    }).join("");
    document.getElementById("reportsProgram").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Program</th><th>Adı</th><th>Denetim</th><th>Kapatılan</th><th>Arşiv</th></tr></thead><tbody>${programRows || `<tr><td colspan="5">Program bulunmuyor.</td></tr>`}</tbody></table></div>`;
    renderCapReportModule();
  }



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

  // Faz 8B.3: app.js içinde kalan domain callbackleri bir kez kaydedilir; taşınan modüller kendi callbacklerini kaydeder.
  register("saveRecord", saveRecord);
  register("updateRecord", updateRecord);
  register("loadData", loadData);
  register("renderAll", renderAll);
  register("isAuthLocked", isAuthLocked);
  register("profileOrg", profileOrg);
  register("renderAuthState", renderAuthState);
  register("userIsPending", userIsPending);
  register("getObjection", getObjection);
  register("createAutoNoObjection", createAutoNoObjection);
  register("getReport", getReport);
  register("reportDefaultSummary", reportDefaultSummary);
  register("auditFindings", auditFindings);
  register("finalizeReportAndStartCap", finalizeReportAndStartCap);
  register("objectionPill", objectionPill);
  register("reportPill", reportPill);
  register("visibleAuditsForCurrentUser", visibleAuditsForCurrentUser);
  register("deadlineBadge", deadlineBadge);
  register("getProgram", getProgram);
  register("getAudit", getAudit);

  // Faz 8B.3: app.js içinde kalan inline HTML olaylarının erişmesi gereken render fonksiyonları.
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
