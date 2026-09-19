// Faz 8B.1 - central configuration and domain constants
export const DATA_FILE = "PQ_JSON_Model.json";
export const FIREBASE_CONFIG = {
    apiKey: "AIzaSyAyiUrIOI7zkxgj_gTpPTt7qczaW7WPPCc",
    authDomain: "firestore-669de.firebaseapp.com",
    projectId: "firestore-669de",
    storageBucket: "firestore-669de.firebasestorage.app",
    messagingSenderId: "19378300872",
    appId: "1:19378300872:web:b14960ae129ed4ec34c2fd"
  };
export const COLLECTIONS = {
    users: "users",
    organizations: "organizations",
    masterForms: "masterForms",
    formRevisions: "formRevisions",
    auditPrograms: "auditPrograms",
    audits: "audits",
    auditAssignments: "auditAssignments",
    organizationResponses: "organizationResponses",
    auditResponses: "auditResponses",
    auditPreEvaluations: "auditPreEvaluations",
    findings: "findings",
    capPlans: "capPlans",
    capSteps: "capSteps",
    reports: "reports",
    evidenceReferences: "evidenceReferences",
    auditLogs: "auditLogs"
  };
export const ROLES = {
    admin: "Yönetici",
    program_manager: "Program Yöneticisi",
    lead_auditor: "Baş Denetçi",
    auditor: "Denetçi",
    auditee: "Denetlenen Kuruluş",
    viewer: "Görüntüleyen"
  };
export const ROLE_SECTIONS = {
    admin: "all",
    program_manager: ["home","masterLibrary","annualPrograms","programCreate","programAddAudit","auditFile","plannedAudits","waitingAuditeeResponse","preEvaluation","activeAudits","auditExecution","objectionAudits","auditeeObjections","finalReportAudits","findingsOpen","capWaiting","capReview","capMonitoring","closedFindings","reportsAudit","reportsProgram","reportsCap","archive","settings"],
    lead_auditor: ["home","masterLibrary","auditFile","plannedAudits","waitingAuditeeResponse","preEvaluation","activeAudits","auditExecution","objectionAudits","auditeeObjections","finalReportAudits","findingsOpen","capWaiting","capReview","capMonitoring","closedFindings","reportsAudit","reportsProgram","reportsCap","archive"],
    auditor: ["home","masterLibrary","auditFile","preEvaluation","activeAudits","auditExecution","findingsOpen","capMonitoring","reportsAudit"],
    auditee: ["home","auditeeAssigned","auditeeResponses","auditeeObjections","auditeeCap"],
    viewer: ["home","masterLibrary","annualPrograms","auditFile","plannedAudits","activeAudits","auditExecution","findingsOpen","capMonitoring","reportsAudit","reportsProgram","reportsCap","archive"]
  };
export const AREA_ORDER = ["LEG", "ORG", "PEL", "OPS", "AIR", "AIG", "ANS", "AGA", "SSP"];
export const AREA_LABELS = {
    LEG: "Legislation",
    ORG: "Civil Aviation Organization",
    PEL: "Personnel Licensing",
    OPS: "Aircraft Operations",
    AIR: "Airworthiness",
    AIG: "Aircraft Accident and Incident Investigation",
    ANS: "Air Navigation Services",
    AGA: "Aerodromes and Ground Aids",
    SSP: "State Safety Programme"
  };
export const AUDIT_STATUS = {
    draft: "Taslak",
    programmed: "Programa Alındı",
    planned: "Planlandı",
    waiting_auditee_response: "Kuruluş Cevabı Bekleniyor",
    pre_evaluation: "Ön Değerlendirme",
    audit_in_progress: "Denetim Devam Ediyor",
    objection_period: "İtiraz Sürecinde",
    final_report_preparation: "Nihai Rapor Hazırlanıyor",
    final_report_sent: "Nihai Rapor Gönderildi",
    cap_waiting: "CAP Bekleniyor",
    cap_under_review: "CAP Değerlendiriliyor",
    cap_monitoring: "CAP İzleniyor",
    closed: "Kapatıldı",
    archived: "Arşivlendi",
    cancelled: "İptal Edildi"
  };
export const CAP_STATUS = {
    cap_waiting: "CAP Bekleniyor",
    cap_submitted: "CAP Sunuldu",
    cap_accepted: "CAP Kabul Edildi",
    cap_partially_accepted_revision_required: "Kısmen Kabul / Revizyon İstendi",
    cap_rejected: "CAP İade Edildi",
    implementation_in_progress: "Uygulama Devam Ediyor",
    completion_reported: "Tamamlandı Bildirildi",
    verification_pending: "Doğrulama Bekliyor",
    finding_closed: "Bulgu Kapatıldı",
    cap_resubmission_required: "Yeniden CAP Bekleniyor"
  };
export const PROGRAM_STATUS = {
    draft: "Taslak",
    approved: "Onaylandı",
    active: "Aktif",
    closed: "Kapatıldı",
    archived: "Arşivlendi"
  };
export const AUDIT_METHOD_LABELS = {
    onsite: "Yerinde",
    remote: "Uzaktan",
    hybrid: "Hibrit"
  };
export const AUDIT_TYPE_LABELS = {
    planned_announced: "Planlı / Haberli",
    planned_unannounced: "Planlı / Habersiz",
    unplanned_announced: "Plansız / Haberli",
    unplanned_unannounced: "Plansız / Habersiz"
  };
export const MENUS = [
    { group: "Genel", items: [
      { id: "home", label: "Ana Sayfa", tag: "Rehber" },
      { id: "notifications", label: "Bildirimler / Uyarılar", tag: "Yeni" }
    ]},
    { group: "Master Kontrol Formları", items: [
      { id: "masterLibrary", label: "Form Kütüphanesi", tag: "Read-only" },
      { id: "formRevisions", label: "Form Revizyonları", tag: "Admin" },
      { id: "revisionArchive", label: "Revizyon Arşivi", tag: "Geçmiş" }
    ]},
    { group: "Denetim Programı", items: [
      { id: "programCreate", label: "Yıllık Program Oluştur", tag: "Yıl" },
      { id: "annualPrograms", label: "Yıllık Programlar", tag: "Liste" },
      { id: "programAddAudit", label: "Programa Denetim Ekle", tag: "Plan" }
    ]},
    { group: "Denetim İşlemleri", items: [
      { id: "plannedAudits", label: "Planlı Denetimler", tag: "Plan" },
      { id: "auditFile", label: "Denetim Dosyası / Heyet", tag: "3A" },
      { id: "waitingAuditeeResponse", label: "Cevap Bekleyen Denetimler", tag: "Kuruluş" },
      { id: "preEvaluation", label: "Ön Değerlendirme", tag: "Heyet" },
      { id: "activeAudits", label: "Aktif Denetimler", tag: "Saha" },
      { id: "auditExecution", label: "Denetim Çalışması", tag: "S/NS/NA" },
      { id: "objectionAudits", label: "İtiraz Sürecindeki Denetimler", tag: "+2 gün" },
      { id: "finalReportAudits", label: "Nihai Rapor Bekleyenler", tag: "+15 gün" }
    ]},
    { group: "Kuruluş Portalı", items: [
      { id: "auditeeAssigned", label: "Bana Atanan Denetimler", tag: "Kuruluş" },
      { id: "auditeeResponses", label: "Ön Cevaplar", tag: "Cevap" },
      { id: "auditeeObjections", label: "İtiraz Bildirimi", tag: "2 gün" },
      { id: "auditeeCap", label: "CAP Girişi", tag: "45 gün" }
    ]},
    { group: "Bulgu / CAP Yönetimi", items: [
      { id: "findingsOpen", label: "Açık Bulgular", tag: "NS" },
      { id: "capWaiting", label: "CAP Bekleyenler", tag: "45 gün" },
      { id: "capReview", label: "CAP Değerlendirme", tag: "Kabul/İade" },
      { id: "capMonitoring", label: "CAP İzleme", tag: "İlerleme" },
      { id: "closedFindings", label: "Kapatılan Bulgular", tag: "Doğrulandı" }
    ]},
    { group: "Raporlama", items: [
      { id: "reportsAudit", label: "Denetim Raporları", tag: "PDF/Excel" },
      { id: "reportsProgram", label: "Program Özeti", tag: "Yıllık" },
      { id: "reportsCap", label: "CAP Durum Raporu", tag: "Takip" }
    ]},
    { group: "Sistem", items: [
      { id: "archive", label: "Arşiv", tag: "Kayıtlar" },
      { id: "settings", label: "Ayarlar / Yetkiler", tag: "Rol" }
    ]}
  ];
