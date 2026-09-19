/**
 * DEC-online private Apps Script bridge.
 *
 * Deploy this directory as a separate Web App owned by the DEC administrator.
 * Store SPREADSHEET_ID and DEC_BACKEND_SECRET in Script Properties. The Worker
 * is the only caller; never put this endpoint or its secret in browser code.
 */

const TAB = Object.freeze({
  students: 'Students',
  accounts: 'Accounts',
  permissions: 'Permissions',
  results: 'Results',
});

function doPost(event) {
  try {
    const payload = JSON.parse((event && event.postData && event.postData.contents) || '{}');
    assertSecret_(payload.secret);
    const action = String(payload.action || '');
    let result;
    if (action === 'resolve_account') result = resolveAccount_(payload.email);
    else if (action === 'permissions') result = permissions_(payload.student_ids);
    else if (action === 'results') result = results_(payload.student_ids);
    else if (action === 'catalog') result = catalog_(payload.student_ids);
    else if (action === 'upsert_result') result = upsertResult_(payload.result);
    else throw new Error('unsupported_action');
    return json_({ ok: true, result });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message || error) });
  }
}

function assertSecret_(secret) {
  const expected = PropertiesService.getScriptProperties().getProperty('DEC_BACKEND_SECRET');
  if (!expected || !secret || String(secret) !== expected) throw new Error('unauthorized');
}

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('missing_spreadsheet_id');
  return SpreadsheetApp.openById(id);
}

function rows_(tabName) {
  const sheet = spreadsheet_().getSheetByName(tabName);
  if (!sheet) throw new Error('missing_tab:' + tabName);
  const values = sheet.getDataRange().getValues();
  if (!values.length) return [];
  const headers = values.shift().map(String);
  return values.filter(row => row.some(value => value !== '')).map(row => {
    const item = {};
    headers.forEach((header, index) => item[header] = row[index]);
    return item;
  });
}

function normalizeEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function active_(value) {
  return value === true || String(value).trim().toLowerCase() !== 'false';
}

function resolveAccount_(email) {
  const normalized = normalizeEmail_(email);
  if (!normalized) throw new Error('missing_email');
  const students = Object.fromEntries(rows_(TAB.students).map(row => [String(row.student_id), row]));
  const matchedStudents = rows_(TAB.accounts)
    .filter(row => active_(row.active) && normalizeEmail_(row.google_email) === normalized)
    .map(row => students[String(row.student_id)])
    .filter(row => row && active_(row.active))
    .map(row => ({
      student_id: String(row.student_id),
      display_name: String(row.display_name || row.student_id),
      class_name: String(row.class_name || ''),
    }));
  return { email: normalized, students: matchedStudents };
}

function permissions_(studentIds) {
  const allowed = new Set((studentIds || []).map(String));
  const tags = {};
  rows_(TAB.permissions).forEach(row => {
    const studentId = String(row.student_id || '');
    const tag = String(row.tag || '').trim().toLowerCase();
    if (allowed.has(studentId) && active_(row.active) && tag) {
      if (!tags[studentId]) tags[studentId] = [];
      if (!tags[studentId].includes(tag)) tags[studentId].push(tag);
    }
  });
  return tags;
}

function upsertResult_(result) {
  if (!result || !result.student_id || !result.quiz_id) throw new Error('invalid_result');
  const score = Number(result.score);
  const maxScore = Number(result.max_score);
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0 || score < 0 || score > maxScore) {
    throw new Error('invalid_score');
  }
  const sheet = spreadsheet_().getSheetByName(TAB.results);
  if (!sheet) throw new Error('missing_tab:' + TAB.results);
  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(String);
  const index = Object.fromEntries(headers.map((header, i) => [header, i]));
  ['student_id', 'quiz_id', 'score', 'max_score'].forEach(key => {
    if (index[key] === undefined) throw new Error('missing_results_column:' + key);
  });
  const rowIndex = values.findIndex(row => String(row[index.student_id]) === String(result.student_id) && String(row[index.quiz_id]) === String(result.quiz_id));
  const current = rowIndex >= 0 ? Number(values[rowIndex][index.score]) : -1;
  if (score <= current) return { updated: false, best_score: current };
  const output = headers.map(header => {
    const valuesByKey = {
      student_id: String(result.student_id),
      google_email: normalizeEmail_(result.google_email),
      quiz_id: String(result.quiz_id),
      display_title: String(result.display_title || ''),
      score,
      max_score: maxScore,
      percent: Math.round((score / maxScore) * 10000) / 100,
      class_snapshot: String(result.class_snapshot || ''),
      school_year: String(result.school_year || ''),
      best_at: new Date(),
      completed: true,
    };
    return Object.prototype.hasOwnProperty.call(valuesByKey, header)
      ? valuesByKey[header]
      : (rowIndex >= 0 ? values[rowIndex][index[header]] : '');
  });
  if (rowIndex >= 0) sheet.getRange(rowIndex + 2, 1, 1, headers.length).setValues([output]);
  else sheet.appendRow(output);
  return { updated: true, best_score: score };
}

function results_(studentIds) {
  const allowed = new Set((studentIds || []).map(String));
  const output = {};
  rows_(TAB.results).forEach(row => {
    const studentId = String(row.student_id || '');
    if (!allowed.has(studentId)) return;
    if (!output[studentId]) output[studentId] = {};
    output[studentId][String(row.quiz_id)] = {
      completed: active_(row.completed),
      score: Number(row.score),
      max_score: Number(row.max_score),
      percent: Number(row.percent),
    };
  });
  return output;
}

function catalog_(studentIds) {
  return {
    permissions: permissions_(studentIds),
    results: results_(studentIds),
  };
}

function json_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
