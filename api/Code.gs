// ============================================================
// Enliven Practice Scheduler — Google Apps Script API
// Deploy: Extensions > Apps Script > Deploy > Web App
//   Execute as: Me | Access: Anyone
// ============================================================

var SHEET_ID = 'YOUR_GOOGLE_SHEET_ID_HERE'; // ← paste after creating sheet

var SHEETS = {
  appointments: 'appointments',
  weeks: 'weeks',
  accounts_summary: 'accounts_summary',
};

var APPT_COLS = [
  'id', 'weekId', 'mondayDate', 'dayIndex', 'dayName',
  'startTime', 'endTime', 'duration', 'clientName', 'isGroup', 'type',
  'assignee', 'equipment', 'packageOn', 'sessionNum',
  'sessionTotal', 'zoom', 'amount', 'method',
  'paid', 'notes', 'status', 'createdAt', 'updatedAt',
];

var WEEK_COLS = ['id', 'mondayDate', 'label'];

var SUMMARY_COLS = [
  'weekId', 'mondayDate', 'label',
  'collected', 'otCollected', 'pilatesCollected', 'unpaidCount', 'updatedAt',
];

// ── Entry points ─────────────────────────────────────────────

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  try {
    var body = parseBody(e);
    var action = (body && body.action) || e.parameter.action;
    var result;

    if (action === 'getWeeks')               result = getWeeks();
    else if (action === 'getAppointments')   result = getAppointments(e.parameter.weekId || body.weekId);
    else if (action === 'getAllAppointments') result = getAllAppointments();
    else if (action === 'saveAppointment')   result = saveAppointment(body);
    else if (action === 'deleteAppointment') result = deleteAppointment(body);
    else if (action === 'saveWeek')          result = saveWeek(body);
    else result = { error: 'Unknown action: ' + action };

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: err.message, stack: err.stack });
  }
}

function parseBody(e) {
  // Support payload= param (GET-based POST workaround for CORS)
  if (e.parameter && e.parameter.payload) return JSON.parse(e.parameter.payload);
  if (e.postData && e.postData.contents) return JSON.parse(e.postData.contents);
  return e.parameter;
}

function jsonResponse(data) {
  var output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

// ── Sheet helpers ────────────────────────────────────────────

function getSpreadsheet() {
  return SpreadsheetApp.openById(SHEET_ID);
}

// Creates the sheet with the given headers if it doesn't exist yet.
// If it already exists, reconciles its real header row with `cols` by
// appending any columns that code now expects but the sheet doesn't have
// yet. This keeps the actual header row in the Sheet — not the `cols`
// array in code — as the authoritative column order, so a schema change
// in code can never desync from what's actually on the Sheet.
function getOrCreateSheet(name, cols) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(cols);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, cols.length)
      .setFontWeight('bold')
      .setBackground('#f3f3f3');
    return sheet;
  }

  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  var missing = cols.filter(function(c) { return headers.indexOf(c) < 0; });
  if (missing.length > 0) {
    sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
    sheet.getRange(1, lastCol + 1, 1, missing.length)
      .setFontWeight('bold')
      .setBackground('#f3f3f3');
  }
  return sheet;
}

// The real header row in the sheet, in actual column order — always use
// this for reading/writing row data instead of a hardcoded cols array.
function getHeaders(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
}

function sheetToObjects(sheet, cols) {
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return []; // header only
  var headers = data[0].map(String);
  return data.slice(1).map(function(row) {
    var obj = {};
    cols.forEach(function(col) {
      var idx = headers.indexOf(col);
      obj[col] = idx >= 0 ? row[idx] : '';
    });
    return obj;
  });
}

function findRowById(sheet, id, idColName) {
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(String);
  var idCol = headers.indexOf(idColName || 'id');
  if (idCol < 0) return -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) return i + 1; // 1-based row number
  }
  return -1;
}

// Builds a row using the sheet's REAL header order, not a fixed cols array,
// so writes always land in the column that actually matches each field name.
function objectToRow(obj, headers) {
  return headers.map(function(col) {
    var v = obj[col];
    if (v === undefined || v === null) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return v;
  });
}

// ── Weeks ────────────────────────────────────────────────────

function getWeeks() {
  var sheet = getOrCreateSheet(SHEETS.weeks, WEEK_COLS);
  var rows = sheetToObjects(sheet, WEEK_COLS);
  return { weeks: rows };
}

function saveWeek(body) {
  var sheet = getOrCreateSheet(SHEETS.weeks, WEEK_COLS);
  var week = body.week;
  if (!week || !week.id) return { error: 'Missing week data' };

  var headers = getHeaders(sheet);
  var rowNum = findRowById(sheet, week.id);
  var row = objectToRow(week, headers);

  if (rowNum > 0) {
    sheet.getRange(rowNum, 1, 1, headers.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
  return { ok: true, weekId: week.id };
}

// ── Appointments ─────────────────────────────────────────────

function getAppointments(weekId) {
  if (!weekId) return { error: 'weekId required' };
  var sheet = getOrCreateSheet(SHEETS.appointments, APPT_COLS);
  var all = sheetToObjects(sheet, APPT_COLS);
  var appts = all.filter(function(a) { return String(a.weekId) === String(weekId); });
  return { appointments: appts.map(normaliseAppt) };
}

function getAllAppointments() {
  var sheet = getOrCreateSheet(SHEETS.appointments, APPT_COLS);
  var all = sheetToObjects(sheet, APPT_COLS);
  return { appointments: all.map(normaliseAppt) };
}

function saveAppointment(body) {
  var appt = body.appointment;
  if (!appt || !appt.id) return { error: 'Missing appointment data' };

  appt.updatedAt = new Date().toISOString();

  var sheet = getOrCreateSheet(SHEETS.appointments, APPT_COLS);
  var headers = getHeaders(sheet);
  var rowNum = findRowById(sheet, appt.id);
  var row = objectToRow(appt, headers);

  if (rowNum > 0) {
    sheet.getRange(rowNum, 1, 1, headers.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  refreshAccountsSummary(appt.weekId);
  return { ok: true, id: appt.id };
}

function deleteAppointment(body) {
  var id = body.id;
  if (!id) return { error: 'Missing id' };

  var sheet = getOrCreateSheet(SHEETS.appointments, APPT_COLS);
  var rowNum = findRowById(sheet, id);
  if (rowNum < 0) return { error: 'Appointment not found' };

  // Soft delete: set status=deleted and updatedAt
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(String);
  var statusCol = headers.indexOf('status') + 1;
  var updatedCol = headers.indexOf('updatedAt') + 1;
  var weekIdCol = headers.indexOf('weekId') + 1;
  var weekId = sheet.getRange(rowNum, weekIdCol).getValue();

  sheet.getRange(rowNum, statusCol).setValue('deleted');
  if (updatedCol > 0) sheet.getRange(rowNum, updatedCol).setValue(new Date().toISOString());

  refreshAccountsSummary(weekId);
  return { ok: true };
}

// ── Accounts summary (auto-refresh) ──────────────────────────

function refreshAccountsSummary(weekId) {
  if (!weekId) return;

  var apptSheet = getOrCreateSheet(SHEETS.appointments, APPT_COLS);
  var all = sheetToObjects(apptSheet, APPT_COLS);
  var appts = all.filter(function(a) {
    return String(a.weekId) === String(weekId) && a.status !== 'deleted' && a.status !== 'cancelled';
  });

  var collected = 0, otCollected = 0, pilatesCollected = 0, unpaidCount = 0;
  appts.forEach(function(a) {
    var amt = parseFloat(a.amount) || 0;
    var paid = a.paid === 'TRUE' || a.paid === true;
    if (paid) {
      collected += amt;
      if (a.type === 'ot') otCollected += amt;
      if (a.type === 'pilates') pilatesCollected += amt;
    } else {
      unpaidCount++;
    }
  });

  // Get week label from weeks sheet
  var weekSheet = getOrCreateSheet(SHEETS.weeks, WEEK_COLS);
  var weeks = sheetToObjects(weekSheet, WEEK_COLS);
  var week = weeks.filter(function(w) { return String(w.id) === String(weekId); })[0] || {};

  var summary = {
    weekId: weekId,
    mondayDate: week.mondayDate || '',
    label: week.label || '',
    collected: collected,
    otCollected: otCollected,
    pilatesCollected: pilatesCollected,
    unpaidCount: unpaidCount,
    updatedAt: new Date().toISOString(),
  };

  var sumSheet = getOrCreateSheet(SHEETS.accounts_summary, SUMMARY_COLS);
  var sumHeaders = getHeaders(sumSheet);
  var rowNum = findRowById(sumSheet, weekId, 'weekId');
  var row = objectToRow(summary, sumHeaders);

  if (rowNum > 0) {
    sumSheet.getRange(rowNum, 1, 1, sumHeaders.length).setValues([row]);
  } else {
    sumSheet.appendRow(row);
  }
}

// ── Data normalisation ────────────────────────────────────────
// Sheets stores booleans as 'TRUE'/'FALSE' strings — convert back to JS booleans/numbers

// Sheets can auto-convert "10:30" strings to Date objects. This extracts H:MM safely.
function formatTimeValue(v) {
  if (!v && v !== 0) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return v.getHours() + ':' + String(v.getMinutes()).padStart(2, '0');
  }
  var s = String(v);
  // If Sheets returned a fractional day number (e.g. 0.4375 = 10:30)
  var num = parseFloat(s);
  if (!isNaN(num) && s.indexOf(':') === -1) {
    var totalMins = Math.round(num * 24 * 60);
    return Math.floor(totalMins / 60) + ':' + String(totalMins % 60).padStart(2, '0');
  }
  return s;
}

function normaliseAppt(a) {
  return {
    id: String(a.id),
    weekId: String(a.weekId),
    mondayDate: String(a.mondayDate),
    dayIndex: parseInt(a.dayIndex) || 0,
    dayName: String(a.dayName || ''),
    startTime: formatTimeValue(a.startTime),
    endTime: formatTimeValue(a.endTime),
    duration: parseInt(a.duration) || 60,
    clientName: String(a.clientName),
    isGroup: a.isGroup === 'TRUE' || a.isGroup === true,
    type: String(a.type),
    assignee: String(a.assignee || ''),
    equipment: String(a.equipment || ''),
    packageOn: a.packageOn === 'TRUE' || a.packageOn === true,
    sessionNum: a.sessionNum !== '' ? parseInt(a.sessionNum) : null,
    sessionTotal: a.sessionTotal !== '' ? parseInt(a.sessionTotal) : null,
    zoom: a.zoom === 'TRUE' || a.zoom === true,
    amount: parseFloat(a.amount) || 0,
    method: String(a.method || ''),
    paid: a.paid === 'TRUE' || a.paid === true,
    notes: String(a.notes || ''),
    status: String(a.status || 'active'),
    createdAt: String(a.createdAt || ''),
    updatedAt: String(a.updatedAt || ''),
  };
}

// ── Manual trigger: initialise all sheet tabs ─────────────────
// Run once from the Apps Script editor to create all tabs with correct headers.

function initialiseSheets() {
  getOrCreateSheet(SHEETS.appointments, APPT_COLS);
  getOrCreateSheet(SHEETS.weeks, WEEK_COLS);
  getOrCreateSheet(SHEETS.accounts_summary, SUMMARY_COLS);
  Logger.log('All sheets initialised.');
}
