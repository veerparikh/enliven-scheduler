// ── Constants ─────────────────────────────────────────────────
var TEAM = [
  {name:'Kosha',role:'OT',initials:'KO'},
  {name:'Preksha',role:'OT',initials:'PR'},
  {name:'Farhanaz',role:'OT',initials:'FA'},
  {name:'Divya',role:'OT',initials:'DI'},
  {name:'Husain',role:'Pilates',initials:'HU'},
  {name:'Persis',role:'Pilates',initials:'PE'},
];

var TIMES = [];
for (var h = 7; h <= 19; h++) {
  TIMES.push(h + ':00');
  if (h < 19) TIMES.push(h + ':30');
}

var DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat'];

// ── State ─────────────────────────────────────────────────────
var state = {
  weeks: [],          // [{id, mondayDate (Date), label, appointments:[]}]
  currentWeekIdx: 0,
  calView: 'weekly',  // 'weekly' | 'daily'
  dailyDayIdx: 0,     // which day is active in daily view
  allAppointments: [], // flat list, loaded for Cases/Accounts-monthly
  allAptsLoaded: false,
};

// ── Formatting helpers ────────────────────────────────────────
function fmt(n) { return (n || 0).toLocaleString('en-IN'); }
function fmtAmt(n) { return '₹' + fmt(n); }
function fmtTime(t) {
  // "14:30" → "2:30 PM"
  var parts = t.split(':').map(Number);
  var h = parts[0], m = parts[1];
  var ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + String(m).padStart(2, '0') + ' ' + ampm;
}
function formatDate(d) { return d.toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'}); }
function formatWeekLabel(w) {
  var dates = getWeekDates(w.mondayDate);
  return formatDate(dates[0]) + ' – ' + formatDate(dates[5]);
}
function timeToMinutes(t) { var p = t.split(':').map(Number); return p[0]*60+p[1]; }
function minutesToTime(m) { return Math.floor(m/60) + ':' + String(m%60).padStart(2,'0'); }

// ── Date helpers ──────────────────────────────────────────────
function getWeekDates(mondayDate) {
  var d = new Date(mondayDate);
  var dates = [];
  for (var i = 0; i < 6; i++) { var dd = new Date(d); dd.setDate(d.getDate()+i); dates.push(dd); }
  return dates;
}
function getMondayOfWeek(date) {
  var d = new Date(date);
  var day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0,0,0,0);
  return d;
}
function addDays(date, n) { var d = new Date(date); d.setDate(d.getDate()+n); return d; }

// Deterministic week id derived from the Monday date itself, so any device
// computing "the week starting <date>" always lands on the exact same id —
// this prevents two sessions from ever minting separate week records (and
// therefore orphaned appointments) for the same calendar week.
function weekIdForMonday(mondayDate) {
  var d = new Date(mondayDate);
  return 'w' + d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
}

// Index of the week (Mon–Sat) that contains the given date, or -1 if none.
function indexOfWeekContaining(weeks, date) {
  for (var i = 0; i < weeks.length; i++) {
    var monday = new Date(weeks[i].mondayDate);
    var diffDays = Math.floor((date - monday) / 86400000);
    if (diffDays >= 0 && diffDays <= 6) return i;
  }
  return -1;
}
function todayDayIndex() {
  var w = currentWeek();
  if (!w) return -1;
  var today = new Date();
  var dates = getWeekDates(w.mondayDate);
  return dates.findIndex(function(d) {
    return d.getFullYear()===today.getFullYear() && d.getMonth()===today.getMonth() && d.getDate()===today.getDate();
  });
}

// ── Current week accessor ─────────────────────────────────────
function currentWeek() { return state.weeks[state.currentWeekIdx] || null; }

// ── PIN gate ──────────────────────────────────────────────────
var pinBuffer = '';

function pinKey(digit) {
  if (pinBuffer.length >= 4) return;
  pinBuffer += digit;
  updatePinDots();
  if (pinBuffer.length === 4) checkPin();
}

function pinClear() {
  pinBuffer = pinBuffer.slice(0, -1);
  updatePinDots();
  document.getElementById('pin-error').textContent = '';
}

function updatePinDots() {
  for (var i = 0; i < 4; i++) {
    document.getElementById('dot-' + i).classList.toggle('filled', i < pinBuffer.length);
  }
}

function checkPin() {
  if (pinBuffer === CONFIG.PIN) {
    document.getElementById('pin-gate').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    initApp();
  } else {
    document.getElementById('pin-error').textContent = 'Incorrect PIN, try again';
    pinBuffer = '';
    updatePinDots();
  }
}

// ── App init ──────────────────────────────────────────────────
function initApp() {
  // Load from offline cache first so the UI isn't blank
  loadLocalCache();
  if (state.weeks.length > 0) render();

  // Then sync from Sheets
  syncFromSheets();

  // Flush any queued offline writes
  API.flush();

  // Offline/online banner
  updateOfflineBanner();
  window.addEventListener('offline', updateOfflineBanner);
  window.addEventListener('online', updateOfflineBanner);
  window.addEventListener('offlineQueueChange', updateOfflineBanner);
}

// ── Local cache (fast startup + offline fallback) ─────────────
var CACHE_KEY = 'enliven_cache_v1';

function loadLocalCache() {
  try {
    var raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    var cached = JSON.parse(raw);
    cached.weeks.forEach(function(w) { w.mondayDate = new Date(w.mondayDate); });
    state.weeks = cached.weeks;
    state.currentWeekIdx = Math.min(cached.currentWeekIdx || 0, cached.weeks.length - 1);
    state.allAppointments = cached.allAppointments || [];
    state.allAptsLoaded = !!state.allAppointments.length;
  } catch(e) { /* ignore */ }
}

function saveLocalCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      weeks: state.weeks,
      currentWeekIdx: state.currentWeekIdx,
      allAppointments: state.allAppointments,
    }));
  } catch(e) { /* quota exceeded — ignore */ }
}

// ── Sync from Google Sheets ───────────────────────────────────
function syncFromSheets() {
  showSyncIndicator(true);
  API.getWeeks()
    .then(function(res) {
      if (res.error) throw new Error(res.error);
      var serverWeeks = res.weeks || [];
      // Build week objects, preserving any locally-held appointments
      var merged = serverWeeks.map(function(w) {
        var existing = state.weeks.find(function(x) { return String(x.id) === String(w.id); });
        return {
          id: w.id,
          mondayDate: new Date(w.mondayDate),
          label: w.label || '',
          appointments: existing ? existing.appointments : [],
        };
      });
      // Keep any local weeks not yet pushed (created while offline)
      state.weeks.forEach(function(lw) {
        var onServer = serverWeeks.find(function(sw) { return String(sw.id) === String(lw.id); });
        if (!onServer) merged.push(lw);
      });
      merged.sort(function(a,b) { return new Date(a.mondayDate) - new Date(b.mondayDate); });
      if (merged.length === 0) {
        createInitialWeek();
        return Promise.resolve();
      }
      // Always land on the week containing today, regardless of whatever
      // index happened to be cached — creating it if it doesn't exist yet.
      var todayIdx = indexOfWeekContaining(merged, new Date());
      if (todayIdx < 0) {
        var monday = getMondayOfWeek(new Date());
        var todayWeek = { id: weekIdForMonday(monday), mondayDate: monday, label: '', appointments: [] };
        todayWeek.label = formatWeekLabel(todayWeek);
        merged.push(todayWeek);
        merged.sort(function(a,b) { return new Date(a.mondayDate) - new Date(b.mondayDate); });
        persistWeek(todayWeek);
        todayIdx = indexOfWeekContaining(merged, new Date());
      }
      state.weeks = merged;
      state.currentWeekIdx = todayIdx;

      // Now fetch appointments for the current week
      return fetchWeekAppointments(currentWeek().id);
    })
    .then(function() {
      showSyncIndicator(false);
      saveLocalCache();
      render();
    })
    .catch(function(err) {
      console.warn('Sync failed:', err);
      if (state.weeks.length === 0) {
        // Nothing cached and nothing loaded — show a clear, recoverable error instead of hanging
        showSyncError();
      } else {
        showSyncIndicator(false);
        render();
      }
    });
}

function fetchWeekAppointments(weekId) {
  return API.getAppointments(weekId).then(function(res) {
    if (res.error) return;
    var w = state.weeks.find(function(x) { return String(x.id) === String(weekId); });
    if (w) {
      w.appointments = res.appointments || [];
      saveLocalCache();
    }
  });
}

function showSyncIndicator(on) {
  var lbl = document.getElementById('week-label');
  if (!lbl) return;
  if (on) lbl.textContent = 'Syncing…';
}

function showSyncError() {
  var lbl = document.getElementById('week-label');
  if (!lbl) return;
  lbl.innerHTML = '<span style="color:#E24B4A">Sync failed</span> — <a href="#" onclick="syncFromSheets();return false;" style="text-decoration:underline">tap to retry</a>';
}

// ── Offline banner ────────────────────────────────────────────
function updateOfflineBanner() {
  var banner = document.getElementById('offline-banner');
  var msg = document.getElementById('offline-msg');
  var q = API.pendingCount();
  var show = !navigator.onLine || q > 0;
  banner.classList.toggle('show', show);
  if (!navigator.onLine) {
    msg.textContent = q > 0
      ? 'Offline — ' + q + ' change' + (q>1?'s':'') + ' queued to sync'
      : 'You\'re offline — changes will sync when reconnected';
  } else if (q > 0) {
    msg.textContent = q + ' change' + (q>1?'s':'') + ' syncing…';
  }
}

// ── Week management ───────────────────────────────────────────
function createInitialWeek() {
  var monday = getMondayOfWeek(new Date());
  var week = {
    id: weekIdForMonday(monday),
    mondayDate: monday,
    label: '',
    appointments: [],
  };
  week.label = formatWeekLabel(week);
  state.weeks = [week];
  state.currentWeekIdx = 0;
  persistWeek(week);
  // The deterministic id may already have appointments saved by another
  // device/session — fetch them rather than assuming this week is empty.
  fetchWeekAppointments(week.id).then(function() { saveLocalCache(); render(); });
}

function navigateWeek(dir) {
  var newIdx = state.currentWeekIdx + dir;
  if (newIdx >= 0 && newIdx < state.weeks.length) {
    state.currentWeekIdx = newIdx;
    var w = currentWeek();
    if (!w.appointments || w.appointments.length === 0) {
      fetchWeekAppointments(w.id).then(render);
    } else {
      render();
    }
  } else if (dir === -1) {
    // Create (or recover) the week for the previous Monday. The id is
    // derived from the date itself, so if another device already created
    // this same calendar week, we land on the exact same id and fetch its
    // existing appointments instead of starting a duplicate, empty record.
    var firstWeek = state.weeks[0];
    var prevMonday = addDays(firstWeek.mondayDate, -7);
    var week = { id: weekIdForMonday(prevMonday), mondayDate: prevMonday, label: '', appointments: [] };
    week.label = formatWeekLabel(week);
    state.weeks.unshift(week);
    state.currentWeekIdx = 0;
    persistWeek(week);
    fetchWeekAppointments(week.id).then(function() { saveLocalCache(); render(); });
  }
}

function newWeek() {
  var lastWeek = state.weeks[state.weeks.length - 1];
  var newMonday = addDays(lastWeek.mondayDate, 7);
  var existingIdx = state.weeks.findIndex(function(w) {
    return new Date(w.mondayDate).getTime() === newMonday.getTime();
  });
  if (existingIdx >= 0) {
    state.currentWeekIdx = existingIdx;
    saveLocalCache();
    render();
  } else {
    var week = { id: weekIdForMonday(newMonday), mondayDate: newMonday, label: '', appointments: [] };
    week.label = formatWeekLabel(week);
    state.weeks.push(week);
    state.currentWeekIdx = state.weeks.length - 1;
    persistWeek(week);
    // Same deterministic-id recovery as navigateWeek's back-fill.
    fetchWeekAppointments(week.id).then(function() { saveLocalCache(); render(); });
  }
}

function persistWeek(week) {
  API.saveWeek({
    id: week.id,
    mondayDate: week.mondayDate.toISOString(),
    label: week.label,
  });
}

// ── Render orchestrator ───────────────────────────────────────
function render() {
  renderStats();
  if (state.calView === 'weekly') renderWeeklySchedule();
  else renderDailySchedule();
  // Other tabs re-render when switched to
}

// ── Stats bar ─────────────────────────────────────────────────
function renderStats() {
  var w = currentWeek();
  document.getElementById('week-label').textContent = w ? formatWeekLabel(w) : '';
  if (!w) { document.getElementById('schedule-stats').innerHTML = ''; return; }
  var appts = w.appointments.filter(function(a) { return a.status !== 'cancelled' && a.status !== 'deleted'; });
  var collected = appts.filter(function(a) { return a.paid; }).reduce(function(s,a) { return s+(a.amount||0); }, 0);
  var unpaid = appts.filter(function(a) { return !a.paid; }).length;
  document.getElementById('schedule-stats').innerHTML =
    '<div class="stat-card"><div class="s-label">My OT</div><div class="s-val purple">' + appts.filter(function(a){return a.type==='ot';}).length + '</div></div>' +
    '<div class="stat-card"><div class="s-label">My Pilates</div><div class="s-val green">' + appts.filter(function(a){return a.type==='pilates';}).length + '</div></div>' +
    '<div class="stat-card"><div class="s-label">Collected</div><div class="s-val">' + fmtAmt(collected) + '</div></div>' +
    '<div class="stat-card"><div class="s-label">Unpaid</div><div class="s-val ' + (unpaid>0?'red':'') + '">' + unpaid + '</div></div>';
}

// ── View toggle ───────────────────────────────────────────────
function setCalView(v) {
  state.calView = v;
  document.getElementById('view-weekly').style.display = v === 'weekly' ? '' : 'none';
  document.getElementById('view-daily').style.display  = v === 'daily'  ? '' : 'none';
  document.getElementById('btn-weekly').classList.toggle('active', v === 'weekly');
  document.getElementById('btn-daily').classList.toggle('active', v === 'daily');
  if (v === 'daily') {
    // Default to today's day if in current week, else Mon
    var todayIdx = todayDayIndex();
    state.dailyDayIdx = todayIdx >= 0 ? todayIdx : 0;
    renderDailySchedule();
  } else {
    renderWeeklySchedule();
  }
}

// ── Weekly grid ───────────────────────────────────────────────
function renderWeeklySchedule() {
  var w = currentWeek();
  if (!w) return;
  var dates = getWeekDates(w.mondayDate);
  var todayIdx = todayDayIndex();
  var html = '<div style="display:grid;grid-template-columns:54px repeat(6,minmax(86px,1fr));position:relative">';
  html += '<div class="hcell time-col"></div>';
  dates.forEach(function(d, i) {
    html += '<div class="hcell day-col' + (i===todayIdx?' today':'') + '">' + DAYS[i] + '<br><span style="font-size:10px;font-weight:400;color:var(--color-text-tertiary)">' + d.getDate() + '/' + (d.getMonth()+1) + '</span></div>';
  });
  TIMES.forEach(function(time) {
    html += '<div class="tcell">' + fmtTime(time) + '</div>';
    dates.forEach(function(d, di) {
      var slotAppts = w.appointments.filter(function(a) {
        if (a.status === 'cancelled' || a.status === 'deleted') return false;
        return timeToMinutes(a.startTime) === timeToMinutes(time) && a.dayIndex === di;
      });
      var cellContent = slotAppts.map(pillHtml).join('');
      html += '<div class="scell' + (di===todayIdx?' today-col':'') + '" onclick="openAddModal(' + di + ',\'' + time + '\')">' + cellContent + '</div>';
    });
  });
  html += '</div>';
  document.getElementById('schedule-grid').innerHTML = html;
}

// ── Daily view ────────────────────────────────────────────────
function renderDailySchedule() {
  var w = currentWeek();
  if (!w) return;
  var dates = getWeekDates(w.mondayDate);
  var todayIdx = todayDayIndex();
  var di = state.dailyDayIdx;

  // Day tab strip
  var tabsHtml = DAYS.map(function(day, i) {
    return '<button class="day-tab' + (i===di?' active':'') + (i===todayIdx?' today':'') + '" onclick="setDailyDay(' + i + ')">' +
      day + ' ' + dates[i].getDate() + '</button>';
  }).join('');
  document.getElementById('day-tabs').innerHTML = tabsHtml;

  var html = '<div style="display:grid;grid-template-columns:54px 1fr">';
  TIMES.forEach(function(time) {
    var slotAppts = w.appointments.filter(function(a) {
      if (a.status === 'cancelled' || a.status === 'deleted') return false;
      return timeToMinutes(a.startTime) === timeToMinutes(time) && a.dayIndex === di;
    });
    html += '<div class="daily-tcell">' + fmtTime(time) + '</div>';
    html += '<div class="daily-scell" onclick="openAddModal(' + di + ',\'' + time + '\')">' + slotAppts.map(pillHtml).join('') + '</div>';
  });
  html += '</div>';
  document.getElementById('daily-grid').innerHTML = html;
}

function setDailyDay(idx) {
  state.dailyDayIdx = idx;
  renderDailySchedule();
}

// ── Pill HTML ─────────────────────────────────────────────────
function pillHtml(a) {
  var cls = a.type === 'ot' ? 'ot' : a.type === 'pilates' ? 'pilates' : 'delegated';
  var extra = (!a.paid ? ' unpaid' : '') + (a.status === 'cancelled' ? ' cancelled' : '');
  var displayName = (a.clientName || '–').trim();
  return '<div class="pill ' + cls + extra + '" onclick="event.stopPropagation();openDetail(\'' + a.id + '\')" style="margin-bottom:1px">' +
    '<div class="pill-name">' + esc(displayName) + '</div>' +
    '<div class="pill-meta">' +
    (a.isGroup ? '<span class="badge g">G</span>' : '') +
    (a.amount ? '<span style="font-size:9px">' + fmtAmt(a.amount) + '</span>' : '') +
    (a.zoom ? '<span class="badge z">Z</span>' : '') +
    (a.packageOn ? '<span class="badge p">P ' + (a.sessionNum||'') + '/' + (a.sessionTotal||'') + '</span>' : '') +
    (a.assignee ? '<span style="font-size:9px;opacity:0.8">' + esc(a.assignee) + '</span>' : '') +
    '</div></div>';
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Patient autocomplete ──────────────────────────────────────
function getPatients() {
  var seen = {};
  state.weeks.forEach(function(w) {
    w.appointments.forEach(function(a) {
      var name = (a.clientName || '').trim();
      if (name) seen[name] = true;
    });
  });
  return Object.keys(seen).sort(function(a, b) { return a.localeCompare(b); });
}

function patientInputHtml(existingValue) {
  return '<div class="field" style="position:relative">' +
    '<label>Patient</label>' +
    '<input id="m-client" type="text" value="' + esc(existingValue||'') + '" placeholder="Type to search or add patient…" autocomplete="off">' +
    '<div id="m-patient-dropdown" class="tag-dropdown" style="display:none"></div>' +
  '</div>';
}

function initPatientInput() {
  var input = document.getElementById('m-client');
  var dropdown = document.getElementById('m-patient-dropdown');
  if (!input || !dropdown) return;

  function showDropdown(val) {
    var patients = getPatients();
    var lower = val.toLowerCase();
    var matches = patients.filter(function(p) { return p.toLowerCase().indexOf(lower) >= 0; });
    var html = matches.map(function(p) {
      return '<div class="tag-option" data-name="' + esc(p) + '">' + esc(p) + '</div>';
    }).join('');
    var exact = patients.some(function(p) { return p.toLowerCase() === lower; });
    if (!exact && val) html += '<div class="tag-option tag-option-new" data-name="' + esc(val) + '">+ New: "' + esc(val) + '"</div>';
    dropdown.innerHTML = html;
    dropdown.style.display = html ? 'block' : 'none';
    dropdown.querySelectorAll('.tag-option').forEach(function(el) {
      el.addEventListener('mousedown', function(e) {
        e.preventDefault();
        input.value = el.dataset.name;
        dropdown.style.display = 'none';
      });
    });
  }

  input.addEventListener('input', function() {
    var val = input.value.trim();
    if (val) showDropdown(val); else dropdown.style.display = 'none';
  });
  input.addEventListener('focus', function() { if (input.value.trim()) showDropdown(input.value.trim()); });
  input.addEventListener('blur', function() { setTimeout(function() { dropdown.style.display = 'none'; }, 150); });
}

function updateGroupButtons() {
  var isGroup = document.getElementById('m-is-group');
  var btn = document.getElementById('m-save-next');
  if (isGroup && btn) btn.style.display = isGroup.checked ? 'inline-flex' : 'none';
}

// ── Add modal ─────────────────────────────────────────────────
function openAddModal(dayIdx, time, prefill, rescheduleFrom) {
  var p = prefill || {};
  var modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.id = 'add-modal';
  modal.innerHTML =
    '<div class="modal">' +
    '<h3>' + (rescheduleFrom ? 'Reschedule' : 'Add') + ' — ' + DAYS[dayIdx] + ', ' + fmtTime(time) + '</h3>' +
    patientInputHtml(p.clientName || '') +
    '<div class="check-row"><input type="checkbox" id="m-is-group" onchange="updateGroupButtons()"' + (p.isGroup?' checked':'') + '><label for="m-is-group">Group class</label></div>' +
    '<div class="field"><label>Type</label><select id="m-type" onchange="updateTypeFields()">' +
      '<option value="ot"' + (p.type==='ot'?' selected':'') + '>My OT session</option>' +
      '<option value="pilates"' + (p.type==='pilates'?' selected':'') + '>My Pilates session</option>' +
      '<option value="delegated"' + (p.type==='delegated'?' selected':'') + '>Delegate to team</option>' +
    '</select></div>' +
    '<div id="m-delegate-row" class="field" style="display:none"><label>Assign to</label>' +
      '<select id="m-assignee">' + TEAM.map(function(t){ return '<option value="' + t.name + '"' + (p.assignee===t.name?' selected':'') + '>' + t.name + ' (' + t.role + ')</option>'; }).join('') + '</select></div>' +
    '<div class="row2">' +
      '<div class="field"><label>Start time</label><select id="m-start">' + TIMES.map(function(t){ return '<option value="' + t + '"' + ((p.startTime||time)===t?' selected':'') + '>' + fmtTime(t) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>Duration</label><select id="m-dur">' +
        '<option value="30"' + (p.duration===30?' selected':'') + '>30 min</option>' +
        '<option value="45"' + (p.duration===45?' selected':'') + '>45 min</option>' +
        '<option value="60"' + ((p.duration||60)===60?' selected':'') + '>1 hour</option>' +
      '</select></div>' +
    '</div>' +
    '<div id="m-pilates-fields" style="display:none">' +
      '<div class="section-title">Pilates details</div>' +
      '<div class="field"><label>Equipment</label><select id="m-equip"><option value="Mat"' + (p.equipment==='Mat'?' selected':'') + '>Mat</option><option value="Equipment"' + (p.equipment==='Equipment'?' selected':'') + '>Equipment</option></select></div>' +
    '</div>' +
    '<div class="check-row"><input type="checkbox" id="m-pkg" onchange="updatePkgFields()"' + (p.packageOn?' checked':'') + '><label for="m-pkg">Package client</label></div>' +
    '<div id="m-pkg-fields" style="display:none">' +
      '<div class="row2">' +
        '<div class="field"><label>Session #</label><input id="m-sess-num" type="number" min="1" value="' + (p.sessionNum||1) + '"></div>' +
        '<div class="field"><label>Total sessions</label><input id="m-sess-total" type="number" min="1" value="' + (p.sessionTotal||10) + '"></div>' +
      '</div>' +
    '</div>' +
    '<div class="section-title">Payment</div>' +
    '<div class="row2">' +
      '<div class="field"><label>Amount (₹)</label><input id="m-amount" type="number" min="0" value="' + (p.amount||0) + '"></div>' +
      '<div class="field"><label>Method</label><select id="m-method">' +
        '<option value="">–</option>' +
        ['Cash','GPay','Online','Card'].map(function(m){ return '<option value="' + m + '"' + (p.method===m?' selected':'') + '>' + m + '</option>'; }).join('') +
      '</select></div>' +
    '</div>' +
    '<div class="check-row"><input type="checkbox" id="m-paid"' + (p.paid!==false?' checked':'') + '><label for="m-paid">Session covered (paid)</label></div>' +
    '<div class="check-row"><input type="checkbox" id="m-zoom"' + (p.zoom?' checked':'') + '><label for="m-zoom">Zoom call</label></div>' +
    '<div class="field"><label>Notes (optional)</label><textarea id="m-notes">' + esc(p.notes||'') + '</textarea></div>' +
    '<div class="modal-actions">' +
      '<button class="btn" onclick="closeModal()">Cancel</button>' +
      '<button id="m-save-next" class="btn" style="display:none" onclick="saveAppt(' + dayIdx + ',\'' + time + '\',null,true)">Save &amp; add next</button>' +
      '<button class="btn primary" onclick="saveAppt(' + dayIdx + ',\'' + time + '\',' + (rescheduleFrom ? '\'' + rescheduleFrom + '\'' : 'null') + ')">Save</button>' +
    '</div>' +
    '</div>';
  document.getElementById('modal-container').appendChild(modal);
  initPatientInput();
  updateTypeFields();
  updatePkgFields();
  updateGroupButtons();
}

function updateTypeFields() {
  var t = document.getElementById('m-type').value;
  document.getElementById('m-delegate-row').style.display = t === 'delegated' ? 'block' : 'none';
  document.getElementById('m-pilates-fields').style.display = t === 'pilates' ? 'block' : 'none';
}

function updatePkgFields() {
  var on = document.getElementById('m-pkg').checked;
  document.getElementById('m-pkg-fields').style.display = on ? 'block' : 'none';
}

function saveAppt(dayIdx, time, rescheduleFrom, addNext) {
  var clientName = (document.getElementById('m-client').value || '').trim();
  if (!clientName) { alert('Please enter a patient name'); return; }
  var type = document.getElementById('m-type').value;
  var isGroup = document.getElementById('m-is-group').checked;
  var w = currentWeek();
  var now = new Date().toISOString();
  var startTime = document.getElementById('m-start').value;
  var dur = parseInt(document.getElementById('m-dur').value);
  var appt = {
    id: 'a' + Date.now() + Math.random().toString(36).slice(2),
    weekId: w.id,
    mondayDate: w.mondayDate.toISOString(),
    dayIndex: dayIdx,
    dayName: DAYS[dayIdx],
    startTime: startTime,
    endTime: minutesToTime(timeToMinutes(startTime) + dur),
    duration: dur,
    clientName: clientName,
    isGroup: isGroup,
    type: type,
    assignee: type === 'delegated' ? document.getElementById('m-assignee').value : '',
    equipment: type === 'pilates' ? document.getElementById('m-equip').value : '',
    packageOn: document.getElementById('m-pkg').checked,
    sessionNum: document.getElementById('m-pkg').checked ? parseInt(document.getElementById('m-sess-num').value) : null,
    sessionTotal: document.getElementById('m-pkg').checked ? parseInt(document.getElementById('m-sess-total').value) : null,
    zoom: document.getElementById('m-zoom').checked,
    amount: parseInt(document.getElementById('m-amount').value) || 0,
    method: document.getElementById('m-method').value,
    paid: document.getElementById('m-paid').checked,
    notes: document.getElementById('m-notes').value.trim(),
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  if (rescheduleFrom) {
    var orig = w.appointments.find(function(a) { return a.id === rescheduleFrom; });
    if (orig) {
      orig.status = 'rescheduled';
      orig.updatedAt = now;
      API.saveAppointment(orig);
    }
  }
  w.appointments.push(appt);
  API.saveAppointment(appt);
  saveLocalCache();
  if (addNext) {
    // Reopen modal for same slot to add next group participant, pre-filling shared fields
    closeModal();
    render();
    var prefill = { type: type, startTime: startTime, duration: dur, isGroup: true,
      equipment: appt.equipment, assignee: appt.assignee,
      packageOn: appt.packageOn, sessionNum: appt.sessionNum, sessionTotal: appt.sessionTotal,
      zoom: appt.zoom, method: appt.method, paid: appt.paid };
    setTimeout(function() { openAddModal(dayIdx, time, prefill, null); }, 50);
  } else {
    closeModal();
    render();
  }
  updateOfflineBanner();
}

// ── Detail modal ──────────────────────────────────────────────
function openDetail(id) {
  var w = currentWeek();
  var a = w.appointments.find(function(x) { return x.id === id; });
  if (!a) return;
  var cls = a.type === 'ot' ? 'ot' : a.type === 'pilates' ? 'pilates' : 'delegated';
  var modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.id = 'detail-modal';
  modal.innerHTML =
    '<div class="modal">' +
    '<h3><span class="pill ' + cls + '" style="display:inline-flex;padding:3px 7px;margin-bottom:6px">' + esc(a.clientName) + '</span></h3>' +
    dr('Day & time', DAYS[a.dayIndex] + ', ' + fmtTime(a.startTime) + ' (' + a.duration + ' min)') +
    dr('Type', a.type==='ot'?'My OT':a.type==='pilates'?'My Pilates':'Delegated') +
    (a.assignee ? dr('Assigned to', a.assignee) : '') +
    (a.equipment ? dr('Equipment', a.equipment) : '') +
    (a.isGroup ? dr('Class type', 'Group') : '') +
    (a.packageOn ? dr('Package', 'Session ' + a.sessionNum + '/' + a.sessionTotal) : '') +
    dr('Amount', fmtAmt(a.amount) + (a.method ? ' · ' + a.method : '')) +
    dr('Paid', '<span class="paid-chip ' + (a.paid?'paid':'unpaid') + '">' + (a.paid?'Paid':'Unpaid') + '</span>') +
    (a.zoom ? dr('Zoom', '<span class="badge z">Z</span>') : '') +
    (a.notes ? dr('Notes', '<span style="max-width:180px;display:inline-block;text-align:right">' + esc(a.notes) + '</span>') : '') +
    (a.status !== 'active' ? dr('Status', a.status) : '') +
    '<div class="modal-actions" style="flex-wrap:wrap;gap:6px;justify-content:flex-start;margin-top:12px">' +
      '<button class="btn" onclick="editAppt(\'' + a.id + '\')"><i class="ti ti-edit"></i>Edit</button>' +
      '<button class="btn" onclick="rescheduleAppt(\'' + a.id + '\')"><i class="ti ti-calendar-event"></i>Reschedule</button>' +
      '<button class="btn" onclick="togglePaid(\'' + a.id + '\')">' + (a.paid ? 'Mark unpaid' : 'Mark paid') + '</button>' +
      '<button class="btn" onclick="cancelAppt(\'' + a.id + '\')"><i class="ti ti-ban"></i>Cancel</button>' +
      '<button class="btn danger" onclick="deleteAppt(\'' + a.id + '\')"><i class="ti ti-trash"></i>Delete</button>' +
      '<button class="btn" onclick="closeModal()">Close</button>' +
    '</div></div>';
  document.getElementById('modal-container').appendChild(modal);
}

function dr(k, v) {
  return '<div class="detail-row"><span class="dk">' + k + '</span><span class="dv">' + v + '</span></div>';
}

// ── Edit appointment ──────────────────────────────────────────
function editAppt(id) {
  var w = currentWeek();
  var a = w.appointments.find(function(x) { return x.id === id; });
  if (!a) return;
  closeModal();
  setTimeout(function() {
    var modal = document.createElement('div');
    modal.className = 'modal-bg';
    modal.id = 'add-modal';
    var p = a;
    modal.innerHTML =
      '<div class="modal">' +
      '<h3>Edit — ' + DAYS[a.dayIndex] + ', ' + fmtTime(a.startTime) + '</h3>' +
      patientInputHtml(p.clientName || '') +
      '<div class="check-row"><input type="checkbox" id="m-is-group"' + (p.isGroup?' checked':'') + '><label for="m-is-group">Group class</label></div>' +
      '<div class="field"><label>Type</label><select id="m-type" onchange="updateTypeFields()">' +
        '<option value="ot"' + (p.type==='ot'?' selected':'') + '>My OT session</option>' +
        '<option value="pilates"' + (p.type==='pilates'?' selected':'') + '>My Pilates session</option>' +
        '<option value="delegated"' + (p.type==='delegated'?' selected':'') + '>Delegate to team</option>' +
      '</select></div>' +
      '<div id="m-delegate-row" class="field"><label>Assign to</label><select id="m-assignee">' + TEAM.map(function(t){ return '<option value="' + t.name + '"' + (p.assignee===t.name?' selected':'') + '>' + t.name + ' (' + t.role + ')</option>'; }).join('') + '</select></div>' +
      '<div class="row2">' +
        '<div class="field"><label>Start time</label><select id="m-start">' + TIMES.map(function(t){ return '<option value="' + t + '"' + (p.startTime===t?' selected':'') + '>' + fmtTime(t) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label>Duration</label><select id="m-dur"><option value="30"' + (p.duration===30?' selected':'') + '>30 min</option><option value="45"' + (p.duration===45?' selected':'') + '>45 min</option><option value="60"' + (p.duration===60?' selected':'') + '>1 hour</option></select></div>' +
      '</div>' +
      '<div id="m-pilates-fields"><div class="section-title">Pilates details</div><div class="field"><label>Equipment</label><select id="m-equip"><option value="Mat"' + (p.equipment==='Mat'?' selected':'') + '>Mat</option><option value="Equipment"' + (p.equipment==='Equipment'?' selected':'') + '>Equipment</option></select></div></div>' +
      '<div class="check-row"><input type="checkbox" id="m-pkg" onchange="updatePkgFields()"' + (p.packageOn?' checked':'') + '><label for="m-pkg">Package client</label></div>' +
      '<div id="m-pkg-fields"><div class="row2"><div class="field"><label>Session #</label><input id="m-sess-num" type="number" min="1" value="' + (p.sessionNum||1) + '"></div><div class="field"><label>Total sessions</label><input id="m-sess-total" type="number" min="1" value="' + (p.sessionTotal||10) + '"></div></div></div>' +
      '<div class="section-title">Payment</div>' +
      '<div class="row2"><div class="field"><label>Amount (₹)</label><input id="m-amount" type="number" min="0" value="' + (p.amount||0) + '"></div><div class="field"><label>Method</label><select id="m-method"><option value="">–</option>' + ['Cash','GPay','Online','Card'].map(function(m){ return '<option value="' + m + '"' + (p.method===m?' selected':'') + '>' + m + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="check-row"><input type="checkbox" id="m-paid"' + (p.paid?' checked':'') + '><label for="m-paid">Session covered (paid)</label></div>' +
      '<div class="check-row"><input type="checkbox" id="m-zoom"' + (p.zoom?' checked':'') + '><label for="m-zoom">Zoom call</label></div>' +
      '<div class="field"><label>Notes (optional)</label><textarea id="m-notes">' + esc(p.notes||'') + '</textarea></div>' +
      '<div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="updateAppt(\'' + a.id + '\',' + a.dayIndex + ')">Update</button></div>' +
      '</div>';
    document.getElementById('modal-container').appendChild(modal);
    initPatientInput();
    updateTypeFields();
    updatePkgFields();
  }, 50);
}

function updateAppt(id, dayIdx) {
  var w = currentWeek();
  var a = w.appointments.find(function(x) { return x.id === id; });
  if (!a) return;
  var clientName = (document.getElementById('m-client').value || '').trim();
  if (!clientName) { alert('Please enter a patient name'); return; }
  var type = document.getElementById('m-type').value;
  a.clientName = clientName;
  a.isGroup = document.getElementById('m-is-group').checked;
  a.type = type;
  a.dayIndex = dayIdx;
  a.dayName = DAYS[dayIdx];
  a.startTime = document.getElementById('m-start').value;
  a.duration = parseInt(document.getElementById('m-dur').value);
  a.endTime = minutesToTime(timeToMinutes(a.startTime) + a.duration);
  a.assignee = type === 'delegated' ? document.getElementById('m-assignee').value : '';
  a.equipment = type === 'pilates' ? document.getElementById('m-equip').value : '';
  a.packageOn = document.getElementById('m-pkg').checked;
  a.sessionNum = a.packageOn ? parseInt(document.getElementById('m-sess-num').value) : null;
  a.sessionTotal = a.packageOn ? parseInt(document.getElementById('m-sess-total').value) : null;
  a.amount = parseInt(document.getElementById('m-amount').value) || 0;
  a.method = document.getElementById('m-method').value;
  a.paid = document.getElementById('m-paid').checked;
  a.zoom = document.getElementById('m-zoom').checked;
  a.notes = document.getElementById('m-notes').value.trim();
  a.updatedAt = new Date().toISOString();
  API.saveAppointment(a);
  saveLocalCache();
  closeModal();
  render();
  updateOfflineBanner();
}

function rescheduleAppt(id) {
  var w = currentWeek();
  var a = w.appointments.find(function(x) { return x.id === id; });
  if (!a) return;
  closeModal();
  setTimeout(function() { openAddModal(a.dayIndex, a.startTime, a, id); }, 50);
}

function togglePaid(id) {
  var w = currentWeek();
  var a = w.appointments.find(function(x) { return x.id === id; });
  if (!a) return;
  a.paid = !a.paid;
  a.updatedAt = new Date().toISOString();
  API.saveAppointment(a);
  saveLocalCache();
  closeModal();
  render();
  updateOfflineBanner();
}

function cancelAppt(id) {
  var w = currentWeek();
  var a = w.appointments.find(function(x) { return x.id === id; });
  if (!a) return;
  a.status = 'cancelled';
  a.updatedAt = new Date().toISOString();
  API.saveAppointment(a);
  saveLocalCache();
  closeModal();
  render();
  updateOfflineBanner();
}

function deleteAppt(id) {
  if (!confirm('Delete this appointment?')) return;
  var w = currentWeek();
  var a = w.appointments.find(function(x) { return x.id === id; });
  if (!a) return;
  a.status = 'deleted';
  API.deleteAppointment(id);
  w.appointments = w.appointments.filter(function(x) { return x.id !== id; });
  saveLocalCache();
  closeModal();
  render();
  updateOfflineBanner();
}

function closeModal() {
  document.querySelectorAll('.modal-bg').forEach(function(m) { m.remove(); });
}

document.addEventListener('click', function(e) {
  var modal = document.getElementById('add-modal') || document.getElementById('detail-modal');
  if (modal && e.target === modal) closeModal();
});

// ── Accounts tab ──────────────────────────────────────────────
function renderAccounts() {
  var view = window._accView || 'weekly';
  document.getElementById('acc-weekly-btn').style.fontWeight = view === 'weekly' ? '600' : '400';
  document.getElementById('acc-monthly-btn').style.fontWeight = view === 'monthly' ? '600' : '400';
  var container = document.getElementById('accounts-content');
  if (view === 'weekly') renderAccountsWeekly(container);
  else renderAccountsMonthly(container);
}

function setAccView(v) { window._accView = v; renderAccounts(); }

function getWeekStats(w) {
  var appts = w.appointments.filter(function(a) { return a.status !== 'cancelled' && a.status !== 'deleted'; });
  var collected = appts.filter(function(a) { return a.paid; }).reduce(function(s,a) { return s+(a.amount||0); }, 0);
  var otCollected = appts.filter(function(a) { return a.paid && a.type==='ot'; }).reduce(function(s,a) { return s+(a.amount||0); }, 0);
  var pilatesCollected = appts.filter(function(a) { return a.paid && a.type==='pilates'; }).reduce(function(s,a) { return s+(a.amount||0); }, 0);
  var unpaid = appts.filter(function(a) { return !a.paid; });
  return { collected:collected, otCollected:otCollected, pilatesCollected:pilatesCollected, unpaid:unpaid, appts:appts };
}

function renderAccountsWeekly(container) {
  var w = currentWeek();
  var s = getWeekStats(w);
  var html = '<div class="accounts-section">';
  if (s.unpaid.length > 0) html += '<div class="warn-banner"><i class="ti ti-alert-triangle"></i>' + s.unpaid.length + ' unpaid session' + (s.unpaid.length>1?'s':'') + ' this week</div>';
  html += '<div class="acc-cards">' +
    accCard('Total collected', fmtAmt(s.collected), '') +
    accCard('OT collected', fmtAmt(s.otCollected), 'purple') +
    accCard('Pilates collected', fmtAmt(s.pilatesCollected), 'green') +
    accCard('Unpaid', s.unpaid.length, s.unpaid.length>0?'red':'') +
    '</div>';
  if (s.unpaid.length > 0) {
    html += '<h4>Outstanding unpaid</h4><table class="breakdown-table"><thead><tr><th>Client</th><th>Day</th><th>Time</th><th>Amount</th></tr></thead><tbody>';
    s.unpaid.forEach(function(a) { html += '<tr><td>' + esc(a.clientName) + '</td><td>' + DAYS[a.dayIndex] + '</td><td>' + fmtTime(a.startTime) + '</td><td>' + fmtAmt(a.amount) + '</td></tr>'; });
    html += '</tbody></table>';
  }
  html += '<h4 style="margin-top:12px">Day-by-day</h4><table class="breakdown-table"><thead><tr><th>Day</th><th>Client</th><th>Type</th><th>Amount</th><th>Status</th></tr></thead><tbody>';
  var sorted = s.appts.slice().sort(function(a,b) { return a.dayIndex-b.dayIndex || timeToMinutes(a.startTime)-timeToMinutes(b.startTime); });
  sorted.forEach(function(a) {
    html += '<tr><td>' + DAYS[a.dayIndex] + '</td><td>' + esc(a.clientName) + '</td><td>' + (a.type==='ot'?'OT':a.type==='pilates'?'Pilates':'Delegated') + (a.assignee?' · '+esc(a.assignee):'') + '</td><td>' + fmtAmt(a.amount) + '</td><td><span class="paid-chip ' + (a.paid?'paid':'unpaid') + '">' + (a.paid?'Paid':'Unpaid') + '</span></td></tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function renderAccountsMonthly(container) {
  var w = currentWeek();
  var mon = new Date(w.mondayDate);
  var month = mon.getMonth(), year = mon.getFullYear();
  var monthWeeks = state.weeks.filter(function(wk) {
    var d = new Date(wk.mondayDate);
    return d.getMonth()===month && d.getFullYear()===year;
  });
  var allAppts = [];
  monthWeeks.forEach(function(wk) { allAppts = allAppts.concat(wk.appointments.filter(function(a) { return a.status!=='cancelled'&&a.status!=='deleted'; })); });
  var collected = allAppts.filter(function(a){return a.paid;}).reduce(function(s,a){return s+(a.amount||0);},0);
  var otC = allAppts.filter(function(a){return a.paid&&a.type==='ot';}).reduce(function(s,a){return s+(a.amount||0);},0);
  var pilC = allAppts.filter(function(a){return a.paid&&a.type==='pilates';}).reduce(function(s,a){return s+(a.amount||0);},0);
  var unpaid = allAppts.filter(function(a){return !a.paid;});
  var monthName = mon.toLocaleDateString('en-IN',{month:'long',year:'numeric'});
  var html = '<div class="accounts-section"><h4>Monthly summary — ' + monthName + '</h4>';
  if (unpaid.length>0) html += '<div class="warn-banner"><i class="ti ti-alert-triangle"></i>' + unpaid.length + ' unpaid this month</div>';
  html += '<div class="acc-cards">' +
    accCard('Total collected', fmtAmt(collected), '') +
    accCard('OT collected', fmtAmt(otC), 'purple') +
    accCard('Pilates collected', fmtAmt(pilC), 'green') +
    accCard('Unpaid', unpaid.length, unpaid.length>0?'red':'') +
    '</div></div>';
  container.innerHTML = html;
}

function accCard(label, val, color) {
  return '<div class="acc-card"><div class="ac-l">' + label + '</div><div class="ac-v' + (color?' '+color:'') + '">' + val + '</div></div>';
}

// ── History tab ───────────────────────────────────────────────
function renderHistory() {
  var container = document.getElementById('history-content');
  if (state.weeks.length === 0) { container.innerHTML = '<p style="padding:12px;color:var(--color-text-secondary)">No weeks yet.</p>'; return; }
  var sorted = state.weeks.map(function(w,i){return Object.assign({},w,{origIdx:i});})
    .sort(function(a,b){return new Date(b.mondayDate)-new Date(a.mondayDate);});
  var html = '';
  sorted.forEach(function(w) {
    var s = getWeekStats(w);
    var isCurrent = w.origIdx === state.currentWeekIdx;
    html += '<div class="hist-week' + (isCurrent?' current':'') + '" onclick="jumpToWeek(' + w.origIdx + ')">' +
      '<div><div class="hw-label">' + formatWeekLabel(w) + (isCurrent?' <span style="font-size:10px;color:#7F77DD">(current)</span>':'') + '</div></div>' +
      '<div class="hw-stats"><span>' + s.appts.length + ' sessions</span><span>' + fmtAmt(s.collected) + ' collected</span>' +
      (s.unpaid.length>0?'<span style="color:#E24B4A">' + s.unpaid.length + ' unpaid</span>':'') +
      '</div></div>';
  });
  container.innerHTML = html;
}

function jumpToWeek(idx) {
  state.currentWeekIdx = idx;
  var w = currentWeek();
  if (!w.appointments || w.appointments.length === 0) {
    fetchWeekAppointments(w.id).then(render);
  }
  switchTab('schedule');
  render();
}

// ── Team tab ──────────────────────────────────────────────────
function renderTeam() {
  var container = document.getElementById('team-content');
  var html = '<div style="padding:12px"><div class="team-grid">';
  TEAM.forEach(function(t) {
    var count = 0;
    state.weeks.forEach(function(w) {
      count += w.appointments.filter(function(a){ return a.assignee===t.name && a.status!=='cancelled' && a.status!=='deleted'; }).length;
    });
    html += '<div class="team-card"><div class="avatar ' + (t.role==='OT'?'ot':'pilates') + '">' + t.initials + '</div>' +
      '<div class="team-info"><div class="tm-name">' + t.name + '</div><div class="tm-role">' + t.role + '</div><div class="tm-count">' + count + ' case' + (count!==1?'s':'') + ' delegated</div></div></div>';
  });
  html += '</div></div>';
  container.innerHTML = html;
}

// ── Cases tab ─────────────────────────────────────────────────
function renderCases() {
  var filters = document.getElementById('cases-filters');
  if (!filters.dataset.init) {
    filters.dataset.init = '1';
    filters.innerHTML =
      '<select id="f-type" onchange="renderCases()"><option value="">All types</option><option value="ot">My OT</option><option value="pilates">My Pilates</option><option value="delegated">Delegated</option></select>' +
      '<select id="f-day" onchange="renderCases()"><option value="">All days</option>' + DAYS.map(function(d,i){return '<option value="'+i+'">'+d+'</option>';}).join('') + '</select>' +
      '<select id="f-paid" onchange="renderCases()"><option value="">All</option><option value="paid">Paid</option><option value="unpaid">Unpaid</option></select>' +
      '<select id="f-patient" onchange="renderCases()"><option value="">All patients</option></select>';
  }
  // Rebuild patient options dynamically (new patients may have been added)
  var patientSel = document.getElementById('f-patient');
  if (patientSel) {
    var currentPatient = patientSel.value;
    patientSel.innerHTML = '<option value="">All patients</option>' +
      getPatients().map(function(p) {
        return '<option value="' + esc(p) + '"' + (currentPatient === p ? ' selected' : '') + '>' + esc(p) + '</option>';
      }).join('');
  }
  var typeF = (document.getElementById('f-type')||{}).value || '';
  var dayF = (document.getElementById('f-day')||{}).value || '';
  var paidF = (document.getElementById('f-paid')||{}).value || '';
  var patientF = (document.getElementById('f-patient')||{}).value || '';
  var allAppts = [];
  state.weeks.forEach(function(w) {
    w.appointments.forEach(function(a) { allAppts.push(Object.assign({},a,{weekObj:w})); });
  });
  allAppts = allAppts.filter(function(a){return a.status!=='cancelled'&&a.status!=='deleted';});
  if (typeF) allAppts = allAppts.filter(function(a){return a.type===typeF;});
  if (dayF!=='') allAppts = allAppts.filter(function(a){return a.dayIndex===parseInt(dayF);});
  if (paidF==='paid') allAppts = allAppts.filter(function(a){return a.paid;});
  if (paidF==='unpaid') allAppts = allAppts.filter(function(a){return !a.paid;});
  if (patientF) allAppts = allAppts.filter(function(a) {
    return (a.clientName||'').split(',').map(function(n){return n.trim();}).indexOf(patientF) >= 0;
  });
  allAppts.sort(function(a,b){return new Date(b.weekObj.mondayDate)-new Date(a.weekObj.mondayDate)||a.dayIndex-b.dayIndex||timeToMinutes(a.startTime)-timeToMinutes(b.startTime);});
  var container = document.getElementById('cases-list');
  if (allAppts.length===0){container.innerHTML='<p style="color:var(--color-text-secondary);font-size:12px">No cases match these filters.</p>';return;}
  var html = '<table class="breakdown-table" style="width:100%"><thead><tr><th>Client</th><th>Week</th><th>Day & time</th><th>Type</th><th>Assignee</th><th>Amount</th><th>Status</th></tr></thead><tbody>';
  allAppts.forEach(function(a) {
    var weekIdx = state.weeks.findIndex(function(w){return w.id===a.weekObj.id;});
    html += '<tr onclick="jumpToWeekAndOpenDetail(\'' + a.id + '\',' + weekIdx + ')">' +
      '<td>' + esc(a.clientName) + '</td>' +
      '<td style="font-size:11px;color:var(--color-text-secondary)">' + formatWeekLabel(a.weekObj) + '</td>' +
      '<td>' + DAYS[a.dayIndex] + ', ' + fmtTime(a.startTime) + '</td>' +
      '<td>' + (a.type==='ot'?'OT':a.type==='pilates'?'Pilates':'Delegated') + '</td>' +
      '<td>' + esc(a.assignee||'–') + '</td>' +
      '<td>' + fmtAmt(a.amount) + '</td>' +
      '<td><span class="paid-chip ' + (a.paid?'paid':'unpaid') + '">' + (a.paid?'Paid':'Unpaid') + '</span></td></tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

function jumpToWeekAndOpenDetail(apptId, weekIdx) {
  state.currentWeekIdx = weekIdx;
  switchTab('schedule');
  render();
  setTimeout(function(){ openDetail(apptId); }, 100);
}

// ── Tab switcher ──────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(function(el){el.classList.remove('active');});
  document.querySelectorAll('.tab').forEach(function(el){el.classList.remove('active');});
  document.getElementById('tab-'+name).classList.add('active');
  var idx = ['schedule','accounts','history','team','cases'].indexOf(name);
  document.querySelectorAll('.tab')[idx].classList.add('active');
  if (name==='accounts') renderAccounts();
  if (name==='history') renderHistory();
  if (name==='team') renderTeam();
  if (name==='cases') renderCases();
}

// ── CSV exports ───────────────────────────────────────────────
function exportCSV() {
  var w = currentWeek();
  var dates = getWeekDates(w.mondayDate);
  var headers = ['Week','Day','Date','Client','Group','Type','Assignee','Start','End','Duration(min)','Equipment','Package','Session#','SessionTotal','Zoom','Amount(₹)','Method','Paid','Notes','Status'];
  var rows = [headers.join(',')];
  var weekLabel = formatWeekLabel(w);
  w.appointments.forEach(function(a) {
    var endMins = timeToMinutes(a.startTime) + a.duration;
    var date = dates[a.dayIndex];
    var dateStr = date.getDate() + '/' + (date.getMonth()+1) + '/' + date.getFullYear();
    rows.push([
      '"'+weekLabel+'"', DAYS[a.dayIndex], dateStr,
      '"'+a.clientName+'"', a.isGroup?'Yes':'No',
      a.type==='ot'?'My OT':a.type==='pilates'?'My Pilates':'Delegated',
      a.assignee||'', a.startTime, minutesToTime(endMins), a.duration,
      a.equipment||'',
      a.packageOn?'Yes':'No', a.sessionNum||'', a.sessionTotal||'',
      a.zoom?'Yes':'No', a.amount||0, a.method||'', a.paid?'Yes':'No',
      '"'+(a.notes||'').replace(/"/g,'""')+'"', a.status
    ].join(','));
  });
  downloadCSV(rows.join('\n'), 'schedule_'+weekLabel.replace(/[^a-zA-Z0-9]/g,'_')+'.csv');
}

function exportAccountsCSV() {
  var view = window._accView || 'weekly';
  var w = currentWeek();
  var appts;
  if (view === 'weekly') {
    appts = getWeekStats(w).appts;
  } else {
    var mon = new Date(w.mondayDate);
    var month = mon.getMonth(), year = mon.getFullYear();
    var monthWeeks = state.weeks.filter(function(wk){var d=new Date(wk.mondayDate);return d.getMonth()===month&&d.getFullYear()===year;});
    appts = [];
    monthWeeks.forEach(function(wk){appts=appts.concat(wk.appointments.filter(function(a){return a.status!=='cancelled'&&a.status!=='deleted';}));});
  }
  var headers = ['Client','Day','Time','Type','Amount(₹)','Method','Paid'];
  var rows = [headers.join(',')];
  appts.forEach(function(a) {
    rows.push(['"'+a.clientName+'"',DAYS[a.dayIndex],a.startTime,a.type,a.amount||0,a.method||'',a.paid?'Yes':'No'].join(','));
  });
  downloadCSV(rows.join('\n'), 'accounts_'+view+'_'+new Date().toISOString().slice(0,10)+'.csv');
}

function downloadCSV(csv, filename) {
  var blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(function(){URL.revokeObjectURL(url);}, 1000);
}

// ── Bootstrap ─────────────────────────────────────────────────
// Show PIN gate immediately; initApp() is called after correct PIN.
// If PIN is empty string in config, skip the gate.
(function() {
  if (!CONFIG.PIN) {
    document.getElementById('pin-gate').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    initApp();
  }
})();
