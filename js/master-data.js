import { asBool } from "./utils.js";

// Faz 8B.1 - PQ master normalization/parsing
export function getRowsFromModel(model) {
    if (Array.isArray(model)) return model;
    if (model && Array.isArray(model.rows)) return model.rows;
    if (model && Array.isArray(model.sheets)) return model.sheets.flatMap(sheet => Array.isArray(sheet.rows) ? sheet.rows : []);
    return [];
  }
export function normalizeRow(row) {
    return {
      pqNo: row["PQ Number"] ?? row.no ?? "",
      areaKey: String(row["Audit Area"] ?? row.area ?? "").trim().toUpperCase(),
      ce: row["CE Code"] ?? row.ce ?? "",
      questionEn: row["PQ Question"] ?? row.question_en ?? "",
      questionTr: row["PQ Sorusu"] ?? row.question_tr ?? "",
      reference: row.Reference ?? row.reference ?? "",
      reviewEvidenceEn: row["Review Evidence"] ?? row.review_evidence_en ?? "",
      reviewEvidenceTr: row["İncelenecek Kanıtlar"] ?? row["Incelenecek Kanitlar"] ?? row.review_evidence_tr ?? "",
      onSiteRequired: asBool(row.OnSiteRequired ?? row["OnSiteRequired"]),
      ppq: asBool(row["Is PPQ"] ?? row.ppq ?? row.is_ppq)
    };
  }
export function extractNotesAndCriteria(fullText) {
    if (!fullText) return { criteriaLines: [], noteText: "" };
    const lines = String(fullText).split("\n");
    const noteLabelRegex = /^\s*(notes? to the auditor:|note to the auditor:|denetçiye not(?:lar|u)?\s*:|denetciye not(?:lar|u)?\s*:)\s*/i;
    let foundNote = false;
    const criteriaLines = [];
    let noteText = "";
    for (const line of lines) {
      const clean = line.trim();
      if (!clean) continue;
      if (noteLabelRegex.test(clean)) {
        foundNote = true;
        const rest = line.replace(noteLabelRegex, "").trim();
        if (rest) noteText += (noteText ? "\n" : "") + rest;
        continue;
      }
      if (foundNote) noteText += (noteText ? "\n" : "") + line;
      else criteriaLines.push(line);
    }
    return { criteriaLines, noteText };
  }
export function criteriaCount(row) {
    const parsedTr = extractNotesAndCriteria(row.reviewEvidenceTr);
    const parsedEn = extractNotesAndCriteria(row.reviewEvidenceEn);
    return Math.max(parsedTr.criteriaLines.length, parsedEn.criteriaLines.length, 0);
  }
