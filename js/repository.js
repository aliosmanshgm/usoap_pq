// Faz 8B.7 - Merkezi veri erişim katmanı.
// Demo/Test modunda localStorage, gerçek kullanıcı oturumunda yalnızca Firestore kullanılır.
import { COLLECTIONS } from "./config.js";
import { state } from "./state.js";
import {
  createFirebaseClient, collection, doc, getDocs, getDoc, setDoc, updateDoc, query, where
} from "./firebase-client.js";

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

export function isProductionDataMode() {
  return !state.demoMode && !!state.authUser;
}

export function dataModeLabel() {
  return isProductionDataMode() ? "Firebase / Gerçek Veri" : "Demo / Yerel Veri";
}

function localKey(collectionName) {
  return `usoap_phase1_${collectionName}`;
}

function localRead(collectionName) {
  try {
    return JSON.parse(localStorage.getItem(localKey(collectionName)) || "[]");
  } catch {
    return [];
  }
}

function localWrite(collectionName, rows) {
  localStorage.setItem(localKey(collectionName), JSON.stringify(rows || []));
}

function recordIdOf(collectionName, row) {
  return row?.id || row?.[`${collectionName.slice(0, -1)}Id`] || row?.auditId || row?.programId || row?.findingId || row?.capPlanId || row?.capStepId || row?.revisionId || row?.organizationId || "";
}

function userProfileIsPending(user) {
  if (!user) return false;
  return user.pendingProfile === true || user.approvalStatus === "pending" || user.active === false;
}

function productionDataError(action, collectionName, err) {
  const detail = err?.message || String(err || "Bilinmeyen hata");
  state.firebaseMessage = `Firebase ${action} hatası (${collectionName}): ${detail}`;
  console.error(state.firebaseMessage, err);
  throw new Error(`Gerçek veri modunda işlem tamamlanamadı. ${collectionName}: ${detail}`);
}

async function firestoreRows(ref) {
  const snap = await getDocs(ref);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function initRepository() {
  try {
    const client = createFirebaseClient();
    state.db = client.db;
    state.auth = client.auth;
    state.firebaseReady = true;
    state.firebaseMessage = "Firestore/Firebase Auth hazır. Yetki rolü users koleksiyonundan ve Firestore Rules kurallarından gelir.";
    return client;
  } catch (err) {
    state.db = null;
    state.auth = null;
    state.firebaseReady = false;
    state.firebaseMessage = "Firebase başlatılamadı. Demo modunda yerel kayıt kullanılabilir; gerçek modda işlem durdurulur.";
    return null;
  }
}

export async function readDocument(collectionName, id) {
  if (!id) return null;
  if (!isProductionDataMode()) {
    return localRead(collectionName).find(x => recordIdOf(collectionName, x) === id) || null;
  }
  if (!state.db || !state.authUser) return null;
  try {
    const snap = await getDoc(doc(state.db, collectionName, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (err) {
    productionDataError("tekil okuma", collectionName, err);
  }
}

export async function saveRecord(collectionName, id, data) {
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

export async function updateRecord(collectionName, id, patch) {
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

export async function readCollection(collectionName) {
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

    if (!state.userProfile || userProfileIsPending(state.userProfile) || state.userProfile.active !== true) return [];

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
