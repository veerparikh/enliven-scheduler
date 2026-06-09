// ── Google Apps Script API client ────────────────────────────
// All network calls go through here. Falls back to an offline queue
// when the device has no connectivity; flushes automatically on reconnect.

var API = (function () {
  var QUEUE_KEY = 'enliven_offline_queue';

  // ── Low-level fetch ───────────────────────────────────────

  function get(params) {
    var url = CONFIG.API_URL + '?' + encodeParams(params);
    return fetch(url).then(function (r) { return r.json(); });
  }

  function post(body) {
    // Apps Script doesn't handle CORS preflight for JSON POSTs from external origins.
    // Workaround: send as GET with the payload base64-encoded in a URL param.
    var encoded = encodeURIComponent(JSON.stringify(body));
    var url = CONFIG.API_URL + '?payload=' + encoded;
    return fetch(url).then(function (r) { return r.json(); });
  }

  function encodeParams(obj) {
    return Object.keys(obj)
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]); })
      .join('&');
  }

  // ── Offline queue ─────────────────────────────────────────

  function loadQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function saveQueue(q) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  }

  function enqueue(body) {
    var q = loadQueue();
    q.push({ body: body, at: new Date().toISOString() });
    saveQueue(q);
    notifyQueueState(q.length);
  }

  // Flush queued writes. Runs automatically on load if online, and whenever
  // the browser fires the "online" event.
  function flush() {
    if (!navigator.onLine) return Promise.resolve();
    var q = loadQueue();
    if (q.length === 0) return Promise.resolve();

    var chain = Promise.resolve();
    q.forEach(function (item) {
      chain = chain.then(function () { return post(item.body); });
    });

    return chain
      .then(function () {
        saveQueue([]);
        notifyQueueState(0);
      })
      .catch(function (err) {
        console.warn('Flush failed, will retry later:', err);
      });
  }

  // Expose queue count so the UI can show a pending-writes indicator.
  function notifyQueueState(count) {
    var evt = new CustomEvent('offlineQueueChange', { detail: { count: count } });
    window.dispatchEvent(evt);
  }

  window.addEventListener('online', flush);

  // ── Public API ────────────────────────────────────────────

  return {
    // Fetch all weeks from Sheets
    getWeeks: function () {
      return get({ action: 'getWeeks' });
    },

    // Fetch appointments for one week
    getAppointments: function (weekId) {
      return get({ action: 'getAppointments', weekId: weekId });
    },

    // Fetch every appointment across all weeks (Cases tab, monthly Accounts)
    getAllAppointments: function () {
      return get({ action: 'getAllAppointments' });
    },

    // Upsert a week row (call whenever a new week is created)
    saveWeek: function (week) {
      var body = { action: 'saveWeek', week: week };
      if (!navigator.onLine) { enqueue(body); return Promise.resolve({ ok: true, queued: true }); }
      return post(body).catch(function () { enqueue(body); return { ok: true, queued: true }; });
    },

    // Upsert an appointment (add, edit, cancel, toggle-paid all go here)
    saveAppointment: function (appt) {
      var body = { action: 'saveAppointment', appointment: appt };
      if (!navigator.onLine) { enqueue(body); return Promise.resolve({ ok: true, queued: true }); }
      return post(body).catch(function () { enqueue(body); return { ok: true, queued: true }; });
    },

    // Soft-delete an appointment
    deleteAppointment: function (id) {
      var body = { action: 'deleteAppointment', id: id };
      if (!navigator.onLine) { enqueue(body); return Promise.resolve({ ok: true, queued: true }); }
      return post(body).catch(function () { enqueue(body); return { ok: true, queued: true }; });
    },

    // Attempt to flush queued writes (also called on app init)
    flush: flush,

    // Number of writes waiting to be sent
    pendingCount: function () { return loadQueue().length; },
  };
})();
