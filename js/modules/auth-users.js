// Faz 8B.6 - Firebase Authentication, kullanıcı profili ve rol/kuruluş yönetimi.
import { COLLECTIONS, ROLES } from "../config.js";
import { state } from "../state.js";
import { escapeHtml } from "../utils.js";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "../firebase-client.js";
import { runtime, register, expose } from "../runtime.js";
import { sectionAllowed, renderRoleSelect, renderMenu, showSection } from "./ui-shell.js";

function jsArg(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\r?\n/g, " ");
}

export function isAuthLocked() {
  return !!state.authUser && !state.demoMode;
}

export function activeUid() {
  return state.authUser?.uid || "demo";
}

export function profileRole() {
  return state.userProfile?.role || state.role || "viewer";
}

export function profileOrg() {
  return state.userProfile?.organizationId || state.orgContext || "";
}

export function userIsPending(user) {
  if (!user) return false;
  return user.pendingProfile === true || user.approvalStatus === "pending" || user.active === false;
}

export function profileStatusText(user) {
  if (!user) return "Profil yok";
  if (userIsPending(user)) return "Onay Bekliyor";
  return "Aktif";
}

export function authLabel() {
  if (state.demoMode) return "Demo/Test Modu";
  if (state.authUser && userIsPending(state.userProfile)) return `${state.authUser.email || state.authUser.uid} / Onay Bekliyor`;
  if (state.authUser) return `${state.authUser.email || state.authUser.uid} / ${ROLES[state.role] || state.role}`;
  return "Giriş bekleniyor";
}

export function showAuthOverlay(show, message = "") {
  const overlay = document.getElementById("authOverlay");
  const msg = document.getElementById("authMessage");
  if (!overlay) return;
  overlay.classList.toggle("hidden", !show);
  if (msg) {
    msg.classList.toggle("hidden", !message);
    msg.innerHTML = escapeHtml(message || "");
  }
}

export async function initAuthGate() {
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

export function makePendingUserProfile() {
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

export function applyAuthProfile() {
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

export async function loginWithEmail() {
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
    await runtime.loadData?.();
    runtime.renderAll?.();
    showSection(sectionAllowed(state.currentSection) ? state.currentSection : "home");
  } catch (err) {
    showAuthOverlay(true, `Giriş başarısız: ${err.message || err}`);
  }
}

export async function continueDemoMode() {
  if (state.auth?.currentUser) {
    try { await signOut(state.auth); }
    catch (err) { console.warn("Demo moduna geçerken Firebase oturumu kapatılamadı", err); }
  }
  state.authUser = null;
  state.userProfile = null;
  state.demoMode = true;
  localStorage.setItem("usoap_phase7_demo_mode", "true");
  showAuthOverlay(false);
  await runtime.loadData?.();
  runtime.renderAll?.();
  showSection("home");
}

export async function exitDemoMode() {
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
}

export async function logoutCurrentUser() {
  if (state.auth && state.authUser) await signOut(state.auth);
  state.authUser = null;
  state.userProfile = null;
  state.demoMode = false;
  localStorage.removeItem("usoap_phase7_demo_mode");
  showAuthOverlay(true, "Çıkış yapıldı.");
  renderAuthState();
}

function userCanManageUsers() {
  return state.role === "admin";
}

export function pendingUsersSummaryHtml() {
  const pending = state.users.filter(userIsPending);
  if (!pending.length) return `<div class="info-banner"><strong>Onay bekleyen kullanıcı yok.</strong> Yeni kullanıcılar ilk giriş yaptığında burada otomatik görünür.</div>`;
  const rows = pending.map(u => `<li><strong>${escapeHtml(u.displayName || u.email || u.uid || "Kullanıcı")}</strong> — ${escapeHtml(u.email || "-")} <span class="pill yellow">Onay Bekliyor</span></li>`).join("");
  return `<div class="warn-banner"><strong>${pending.length} kullanıcı onay bekliyor.</strong><ul style="margin:8px 0 0 18px">${rows}</ul></div>`;
}

export function userRowsHtml() {
  const rows = state.users.slice().sort((a,b) => {
    const ap = userIsPending(a) ? 0 : 1;
    const bp = userIsPending(b) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return String(a.email || a.displayName || "").localeCompare(String(b.email || b.displayName || ""), "tr");
  });
  const body = rows.map(u => {
    const id = u.uid || u.id;
    const safeId = escapeHtml(id);
    const pending = userIsPending(u);
    const statusPill = pending ? `<span class="pill yellow">Onay Bekliyor</span>` : `<span class="pill green">Aktif</span>`;
    const actionButtons = userCanManageUsers()
      ? `<button class="btn success" onclick="saveUserProfile('${jsArg(id)}')">Kaydet</button>${pending ? `<button class="btn primary" onclick="activateUserProfile('${jsArg(id)}')">Aktifleştir</button>` : ""}`
      : "-";
    return `<tr><td><input id="u_uid_${safeId}" value="${safeId}" disabled></td><td><input id="u_name_${safeId}" value="${escapeHtml(u.displayName || "")}" ${userCanManageUsers()?"":"disabled"}></td><td><input id="u_email_${safeId}" value="${escapeHtml(u.email || "")}" ${userCanManageUsers()?"":"disabled"}></td><td><select id="u_role_${safeId}" ${userCanManageUsers()?"":"disabled"}>${Object.entries(ROLES).map(([k,l])=>`<option value="${k}" ${k===(u.role||"viewer")?"selected":""}>${escapeHtml(l)}</option>`).join("")}</select></td><td><input id="u_org_${safeId}" value="${escapeHtml(u.organizationId || "")}" ${userCanManageUsers()?"":"disabled"}></td><td>${statusPill}<select id="u_active_${safeId}" ${userCanManageUsers()?"":"disabled"} style="margin-top:6px"><option value="true" ${u.active!==false?"selected":""}>Aktif</option><option value="false" ${u.active===false?"selected":""}>Pasif / Beklemede</option></select></td><td>${actionButtons}</td></tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="user-table"><thead><tr><th>UID</th><th>Ad Soyad</th><th>E-posta</th><th>Rol</th><th>Kuruluş ID</th><th>Durum</th><th>İşlem</th></tr></thead><tbody>${body || `<tr><td colspan="7">Kullanıcı profili yok. Gerçek giriş yapan kullanıcılar burada otomatik Onay Bekleyen Kullanıcı olarak görünecek.</td></tr>`}</tbody></table></div>`;
}

export function newUserFormHtml() {
  if (!userCanManageUsers()) return `<div class="warn-banner">Kullanıcı profili yönetimi yalnızca Yönetici rolüyle yapılır. Giriş yaptıysanız ve onay bekliyorsanız, yöneticinin profilinizi aktifleştirmesi gerekir.</div>`;
  return `<div class="card span-12"><h3>Manuel / Yedek Kullanıcı Profil Kaydı</h3><p>Ana yöntem artık otomatik profildir: kullanıcı ilk kez giriş yapar, sistem onu <strong>Onay Bekleyen Kullanıcı</strong> olarak kaydeder. Bu form yalnızca Firebase Console’dan UID ile manuel profil açmak gereken teknik durumlar içindir.</p><div class="form-grid"><div class="field"><label>Firebase UID <small>(teknik/yedek)</small></label><input id="newUserUid" placeholder="Auth UID"></div><div class="field"><label>E-posta</label><input id="newUserEmail" placeholder="kullanici@..." type="email"></div><div class="field"><label>Ad Soyad</label><input id="newUserName" placeholder="Ad Soyad"></div><div class="field"><label>Rol</label><select id="newUserRole">${Object.entries(ROLES).map(([k,l])=>`<option value="${k}">${escapeHtml(l)}</option>`).join("")}</select></div><div class="field"><label>Kuruluş ID</label><input id="newUserOrg" placeholder="org_001 / org_shgm"></div><div class="field"><label>Durum</label><select id="newUserActive"><option value="true">Aktif</option><option value="false">Pasif / Beklemede</option></select></div></div><button class="btn success" style="margin-top:10px" onclick="createUserProfile()">Manuel Profil Kaydet</button></div>`;
}

export async function createUserProfile() {
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
  await runtime.saveRecord?.(COLLECTIONS.users, uidVal, row);
  await runtime.loadData?.();
  runtime.renderAll?.();
  showSection("settings");
  alert("Kullanıcı profili kaydedildi.");
}

export async function saveUserProfile(uidVal) {
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
  await runtime.saveRecord?.(COLLECTIONS.users, uidVal, row);
  await runtime.loadData?.();
  runtime.renderAll?.();
  showSection("settings");
  alert("Kullanıcı profili güncellendi.");
}

export async function activateUserProfile(uidVal) {
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
  await runtime.saveRecord?.(COLLECTIONS.users, uidVal, row);
  await runtime.loadData?.();
  runtime.renderAll?.();
  showSection("settings");
  alert("Kullanıcı aktifleştirildi. Kullanıcı çıkış yapıp tekrar giriş yaptığında yeni rol ve kuruluş yetkisi uygulanır.");
}

export function renderAuthState() {
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
    const rows = runtime.buildNotifications?.() || [];
    const unread = rows.filter(n => !state.notificationReads.includes(n.id)).length;
    btn.innerHTML = `Bildirimler${unread ? ` (${unread})` : ""}`;
  }
  const roleSelect = document.getElementById("roleSelect");
  if (roleSelect) roleSelect.disabled = isAuthLocked();
  const orgInput = document.getElementById("orgContextInput");
  if (orgInput) orgInput.disabled = isAuthLocked() && state.role === "auditee";
  const orgSelect = document.getElementById("orgContextSelect");
  if (orgSelect) orgSelect.disabled = isAuthLocked() && state.role === "auditee";
}

register("isAuthLocked", isAuthLocked);
register("profileOrg", profileOrg);
register("renderAuthState", renderAuthState);
register("userIsPending", userIsPending);
register("activeUid", activeUid);

expose("loginWithEmail", loginWithEmail);
expose("continueDemoMode", continueDemoMode);
expose("exitDemoMode", exitDemoMode);
expose("logoutCurrentUser", logoutCurrentUser);
expose("createUserProfile", createUserProfile);
expose("saveUserProfile", saveUserProfile);
expose("activateUserProfile", activateUserProfile);
