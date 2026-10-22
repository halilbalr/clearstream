/* Everything the app remembers stays in this browser on this device: small settings in localStorage,
 * the larger channel-list cache in IndexedDB. Both can be missing (private windows, blocked storage),
 * so every read and write is guarded and the app still works without them. */
(function (root) {
  'use strict';
  var CS = root.CS = root.CS || {};

  var memory = {};

  function getJSON(key, fallback) {
    try {
      var raw = root.localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return key in memory ? memory[key] : fallback;
    }
  }

  function setJSON(key, value) {
    memory[key] = value;
    try {
      root.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  var dbPromise = null;

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        if (!root.indexedDB) return reject(new Error('no IndexedDB'));
        var req = root.indexedDB.open('clearstream', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
      dbPromise.catch(function () {});
    }
    return dbPromise;
  }

  function idbGet(key) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var req = d.transaction('kv', 'readonly').objectStore('kv').get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    }).catch(function () { return memory['idb:' + key]; });
  }

  function idbSet(key, value) {
    memory['idb:' + key] = value;
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    }).catch(function () { return false; });
  }

  // --- settings -----------------------------------------------------------------------------------

  // The countries the Windows app shows, plus the country this device is set to.
  var DEFAULT_COUNTRIES = ['UK', 'US', 'IN', 'PK', 'BD', 'AU', 'AE', 'SA', 'QA', 'KW', 'BH', 'OM'];

  function localCountry() {
    var lang = (root.navigator && (root.navigator.language || '')) || '';
    var m = /-([A-Za-z]{2})$/.exec(lang);
    var code = m ? m[1].toUpperCase() : '';
    return code === 'GB' ? 'UK' : code;    // iptv-org uses UK, not GB
  }

  function defaults() {
    var countries = DEFAULT_COUNTRIES.slice();
    var local = localCountry();
    if (local && countries.indexOf(local) < 0) countries.push(local);
    return {
      lang: 'auto',
      theme: 'dark',
      countries: countries,
      favourites: [],
      logos: true,          // show channel logos (loaded from the addresses iptv-org lists)
      sources: [],          // the user's own paid playlists (kept only on this device)
      fit: {},              // channel key -> picture shape chosen for that channel
      buffer: 'normal',
      volume: 1,
      muted: false,
      lastGroup: 'Football',
      lastChannel: ''
    };
  }

  var SETTINGS_KEY = 'cs.settings.v1';

  function loadSettings() {
    var s = defaults(), stored = getJSON(SETTINGS_KEY, null);
    if (stored && typeof stored === 'object') {
      Object.keys(s).forEach(function (k) { if (k in stored) s[k] = stored[k]; });
    }
    return s;
  }

  function saveSettings(s) {
    return setJSON(SETTINGS_KEY, s);
  }

  CS.store = {
    getJSON: getJSON, setJSON: setJSON, idbGet: idbGet, idbSet: idbSet,
    loadSettings: loadSettings, saveSettings: saveSettings, DEFAULT_COUNTRIES: DEFAULT_COUNTRIES
  };
})(this);
