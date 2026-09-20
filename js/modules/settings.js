// Faz 8B.6 - Ayarlar / yetkiler görünümü ve güvenlik kuralı bilgilendirmesi.
import { COLLECTIONS, ROLES } from "../config.js";
import { state } from "../state.js";
import { escapeHtml } from "../utils.js";
import { runtime, register } from "../runtime.js";
import {
  isAuthLocked, profileStatusText, pendingUsersSummaryHtml, userRowsHtml, newUserFormHtml
} from "./auth-users.js";

const FIRESTORE_RULES_TEXT = `rules_version = '2';
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
}
`;

export function renderSettings() {
  const collectionsJson = JSON.stringify(COLLECTIONS, null, 2);
  const profile = state.userProfile;
  const dataMode = runtime.dataModeLabel?.() || (state.demoMode ? "Demo / Yerel Veri" : "Firebase / Gerçek Veri");
  const el = document.getElementById("settings");
  if (!el) return;
  el.innerHTML = `<div class="grid">
    <div class="card span-6"><h3>Giriş / Yetki Durumu</h3><p>${isAuthLocked() ? "Gerçek kullanıcı girişi aktif." : "Demo/Test modu aktif veya kullanıcı girişi yapılmadı."}</p><div class="detail-grid"><div class="detail-box"><b>Kullanıcı</b>${escapeHtml(state.authUser?.email || "Demo/Test")}</div><div class="detail-box"><b>Rol</b>${escapeHtml(ROLES[state.role] || state.role)}</div><div class="detail-box"><b>Kuruluş</b>${escapeHtml(state.orgContext || "-")}</div><div class="detail-box"><b>Profil Durumu</b>${escapeHtml(profileStatusText(profile))}</div><div class="detail-box"><b>Veri Modu</b>${escapeHtml(dataMode)}</div></div></div>
    <div class="card span-6"><h3>Bağlantı Durumu</h3><p>${escapeHtml(state.firebaseMessage)}</p><p><strong>Faz 8A kuralı:</strong> Gerçek kullanıcı girişinde Firestore hatası oluşursa sistem localStorage'a geri dönmez; işlem başarısız sayılır.</p></div>
    <div class="card span-12"><h3>Onay Bekleyen Kullanıcılar</h3>${pendingUsersSummaryHtml()}</div>
    <div class="card span-12"><h3>Kullanıcı Profilleri</h3>${userRowsHtml()}</div>
    ${newUserFormHtml()}
    <div class="card span-12"><h3>Faz 8A Veri Bakım Araçları</h3><p>Eski Faz 6/7 kayıtlarını yeni veri bütünlüğü kurallarına uyarlamak için Yönetici rolüyle bir kez çalıştırılabilir.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" onclick="repairCapStepOrganizationIds()">CAP Adımlarına Kuruluş ID Onarımı</button><button class="btn primary" onclick="reconcileAllAuditCapStatuses()">Denetim CAP Statülerini Yeniden Hesapla</button></div></div>
    <div class="card span-12"><h3>Firestore Security Rules - Faz 8A</h3><p>Bu metin paket içindeki <strong>firestore.rules</strong> dosyasıyla aynıdır. İlk yönetici hesabı otomatik oluşturulmaz; ilk <code>admin</code> users profili Firebase Console'dan kontrollü olarak tanımlanmalıdır.</p><pre class="model-code">${escapeHtml(FIRESTORE_RULES_TEXT)}</pre></div>
    <div class="card span-12"><h3>Firestore Koleksiyon Omurgası</h3><pre class="model-code">${escapeHtml(collectionsJson)}</pre></div>
    <div class="card span-12"><h3>Faz 8B.7 Veri Erişim Katmanı</h3><p>Firestore/localStorage ayrımı, koleksiyon okuma-yazma, tekil doküman okuma ve Firebase başlatma işlemleri <code>repository.js</code> içinde merkezileştirilmiştir. Kimlik doğrulama <code>auth-users.js</code>, bildirimler <code>notifications.js</code>, Ayarlar/Yetkiler görünümü <code>settings.js</code> içinde kalır. Faz 8A veri güvenliği ve CAP veri bütünlüğü kuralları korunmuştur.</p></div>
  </div>`;
}

register("renderSettings", renderSettings);
