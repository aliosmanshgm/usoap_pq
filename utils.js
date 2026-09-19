// Faz 8B.1 - shared helpers
export function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
export function localDateYmd(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
export function parseYmdLocal(dateText) {
    if (!dateText) return null;
    const value = String(dateText).slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }
export function today() { return localDateYmd(new Date()); }
export function addDays(dateText, days) {
    const d = parseYmdLocal(dateText);
    if (!d) return "";
    d.setDate(d.getDate() + Number(days));
    return localDateYmd(d);
  }
export function uid(prefix) {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${stamp}-${rand}`;
  }
export function asBool(value) {
    if (value === true) return true;
    if (value === false || value == null) return false;
    return ["true", "yes", "1", "x", "on", "on-site", "onsite"].includes(String(value).trim().toLowerCase());
  }
export function dateOrDash(value) { return value || "-"; }
export function daysBetween(dateText) {
    const todayDate = parseYmdLocal(today());
    const target = parseYmdLocal(dateText);
    if (!todayDate || !target) return null;
    return Math.round((target - todayDate) / 86400000);
  }
export function formatDate(value) {
    if (!value) return "-";
    const d = parseYmdLocal(value);
    if (!d) return String(value);
    return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
  }
