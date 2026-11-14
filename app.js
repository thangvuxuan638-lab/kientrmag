/* =====================================================================
   AGRI ERP · SCADA HMI khí hậu phòng trồng — web app
   Đồng bộ HMI qua Firebase Realtime Database, có chế độ DEMO offline.
   Không dùng thư viện ngoài: fetch + canvas + SVG.
   ===================================================================== */
"use strict";

/* ------------------------------ tiện ích ------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

const isNum = (v) => v !== null && v !== undefined && v !== "" && !isNaN(v);

const num = (v) => isNum(v)
  ? Number(v).toLocaleString("vi-VN", { maximumFractionDigits: 1 })
  : "--";

const fmt1 = (v) => isNum(v) ? Number(v).toFixed(1) : "--";
const money = (v) => Number(v || 0).toLocaleString("vi-VN") + " đ";
const todayISO = () => new Date().toISOString().slice(0, 10);
const pad2 = (n) => String(n).padStart(2, "0");
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, Number(v) || 0));

const clockNow = (ts = Date.now()) => new Date(ts)
  .toLocaleTimeString("vi-VN", { hour12: false });

const fmtDate = (ts) => new Date(ts).toLocaleDateString("vi-VN", {
  day: "2-digit", month: "2-digit",
});

const fmtDateTime = (ts) => `${clockNow(ts)} ${fmtDate(ts)}`;

function relTime(ts) {
  const d = Date.now() - (Number(ts) || 0);
  if (d < 45e3) return "vừa xong";
  if (d < 36e5) return Math.max(1, Math.round(d / 6e4)) + " phút trước";
  if (d < 864e5) return Math.max(1, Math.round(d / 36e5)) + " giờ trước";
  return fmtDate(ts) + " " + clockNow(ts).slice(0, 5);
}

function fmtUptime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${pad2(h)}:${pad2(m)}:${pad2(ss)}` : `${pad2(m)}:${pad2(ss)}`;
}

const setText = (sel, v) => { const el = $(sel); if (el) el.textContent = v; };
const setColor = (sel, c) => { const el = $(sel); if (el) el.style.color = c; };
const setClass = (sel, c) => { const el = $(sel); if (el) el.className = c; };

function toast(msg, kind = "") {
  const box = document.createElement("div");
  box.className = "toast " + kind;
  box.textContent = msg;
  $("#toast").appendChild(box);
  setTimeout(() => box.remove(), 3800);
}

function download(name, text, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function csvCell(v) {
  return '"' + String(v ?? "").replace(/"/g, '""') + '"';
}

/* ------------------------------ cấu hình ------------------------------ */
const CFG_KEY = "agri_erp_cfg_v1";
const SEED_KEY = "agri_erp_seeded_v1";
const FB = window.FIREBASE_CONFIG || {};

function loadCfg() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch (e) { }
  const t = saved.thresholds || {};
  return {
    url: (saved.url !== undefined ? saved.url : (FB.databaseURL || "")).replace(/\/+$/, ""),
    secret: saved.secret || "",
    device: saved.device || "vuon-1",
    sound: !!saved.sound,
    display: saved.display === "phone" ? "phone" : "laptop",
    thresholds: {
      rhOn: Number(t.rhOn ?? 40),
      rhOff: Number(t.rhOff ?? 45),
      fanOn: Number(t.fanOn ?? 32),
      fanOff: Number(t.fanOff ?? 30),
      heatOn: Number(t.heatOn ?? 22),
      heatOff: Number(t.heatOff ?? 25),
      pumpMax: Number(t.pumpMax ?? 600),
      heatMax: Number(t.heatMax ?? 1800),
      failsafe: Number(t.failsafe ?? 1),
    },
  };
}
const cfg = loadCfg();

function saveCfg() {
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
}

/* ------------------- lớp truy cập dữ liệu (Firebase / mock) ------------------- */
const MOCK_KEY = "agri_erp_mock_v1";
let mock = {};
try { mock = JSON.parse(localStorage.getItem(MOCK_KEY)) || {}; } catch (e) { mock = {}; }
const mockSave = () => localStorage.setItem(MOCK_KEY, JSON.stringify(mock));

function mget(p) {
  return p.split("/").reduce((o, k) => (o == null ? null : o[k]), mock) ?? null;
}
function mset(p, v) {
  const ks = p.split("/");
  let o = mock;
  ks.slice(0, -1).forEach((k) => { o[k] = o[k] || {}; o = o[k]; });
  o[ks[ks.length - 1]] = v;
  mockSave();
}
function mdel(p) {
  const ks = p.split("/");
  let o = mock;
  ks.slice(0, -1).forEach((k) => { o = o && o[k]; });
  if (o) delete o[ks[ks.length - 1]];
  mockSave();
}

async function fbReq(method, path, body, query) {
  const base = cfg.url.replace(/\/+$/, "");
  let url = `${base}/${path}.json`;
  const params = [];
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      params.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
    }
  });
  if (cfg.secret) params.push("auth=" + encodeURIComponent(cfg.secret));
  if (params.length) url += "?" + params.join("&");

  const opt = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) opt.body = JSON.stringify(body);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  opt.signal = ctrl.signal;

  let res;
  try {
    res = await fetch(url, opt);
  } catch (e) {
    clearTimeout(timer);
    throw new Error("Không kết nối được Firebase (mạng/URL)");
  }
  clearTimeout(timer);

  const txt = await res.text();
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("Bị chặn quyền (401/403) — mở Rules cho hmi/");
    }
    throw new Error(`Firebase lỗi ${res.status}`);
  }
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch (e) {
    throw new Error("Firebase trả dữ liệu không hợp lệ (không phải JSON)");
  }
}

const API = {
  get mock() { return !cfg.url; },
  async get(p, query) { return cfg.url ? fbReq("GET", p, undefined, query) : mget(p); },
  async put(p, v) { if (cfg.url) return fbReq("PUT", p, v); mset(p, v); return v; },
  async post(p, v) {
    if (cfg.url) return fbReq("POST", p, v);
    const id = "-m" + Math.random().toString(36).slice(2, 10);
    mset(p + "/" + id, v);
    return { name: id };
  },
  async del(p) { if (cfg.url) return fbReq("DELETE", p); mdel(p); return null; },
};

/** Firebase trả về object map {id: value} → mảng có id. */
function toList(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.map((v, i) => ({ id: String(i), ...v }));
  return Object.entries(obj).map(([id, v]) => ({ id, ...(v || {}) }));
}

/* ------------------------------ trạng thái runtime ------------------------------ */
const TEL_KEY = "agri_erp_telemetry_v2";
const ALERT_KEY = "agri_erp_alerts_v2";
const DEMO_KEY = "agri_erp_demo_v2";

let telemetry = [];
try {
  const rawTel = JSON.parse(localStorage.getItem(TEL_KEY));
  if (API.mock && Array.isArray(rawTel)) telemetry = rawTel.slice(-300);
} catch (e) { telemetry = []; }
let telemetryDirty = false;

function loadAlerts() {
  try {
    const raw = JSON.parse(localStorage.getItem(ALERT_KEY));
    if (Array.isArray(raw)) return raw.slice(0, 200);
  } catch (e) { }
  return [];
}
let alerts = loadAlerts();

function loadDemoState() {
  try {
    const raw = JSON.parse(localStorage.getItem(DEMO_KEY)) || {};
    return {
      mode: raw.mode === "MANUAL" ? "MANUAL" : "AUTO",
      fan: typeof raw.fan === "boolean" ? raw.fan : null,
      pump: typeof raw.pump === "boolean" ? raw.pump : null,
      lamp: typeof raw.lamp === "boolean" ? raw.lamp : null,
      estop: !!raw.estop,
    };
  } catch (e) {
    return { mode: "AUTO", fan: null, pump: null, lamp: null, estop: false };
  }
}
let demoOverride = loadDemoState();
const saveDemo = () => localStorage.setItem(DEMO_KEY, JSON.stringify(demoOverride));

let lastLive = null;
let lastPushTs = 0;
let polling = false;
let dashView = "twin";
let alertFilter = "all";
let pollTimer = null;
let soundOn = !!cfg.sound;
let sessionStart = Date.now();

/** Trạng thái kết nối / đồng bộ dùng chung cho Dashboard và trang Kết nối. */
const conn = {
  fetchOk: false,
  online: false,
  modbus: false,
  rtt: null,
  rttHistory: [],
  failures: 0,
  lastOkTs: 0,
  lastError: "",
  status: null,
  remoteConfig: null,
  lastCmdAck: null,
  lastCfgAck: null,
  pendingCmd: null,
  pendingCfg: null,
  events: [],
  logs: [],
  lastMeta: 0,
  lastLogs: 0,
  lastHistory: 0,
  heartbeatTs: 0,
};

const shortSeq = (seq) => (seq ? String(seq).slice(-6) : "--");
const hostOf = (url) => {
  try { return new URL(url).host; } catch (e) { return "Firebase RTDB"; }
};

/* ------------------------------ điều hướng ------------------------------ */
const PAGE_META = {
  dashboard: { label: "Dashboard", kw: "tổng quan trang chủ scada" },
  monitor:   { label: "Giám sát", kw: "telemetry lịch sử dữ liệu cảm biến" },
  alerts:    { label: "Cảnh báo", kw: "báo động nhiệt độ độ ẩm sưởi ấm sự cố" },
  devices:   { label: "Thiết bị", kw: "shtc30 relay modbus hmi firebase" },
  connection:{ label: "Kết nối", kw: "chẩn đoán firebase heartbeat latency ack đồng bộ cấu hình" },
  reports:   { label: "Báo cáo", kw: "thống kê xuất csv json" },
  settings:  { label: "Cài đặt", kw: "cấu hình ngưỡng firebase âm thanh" },
};
const TABS = Object.keys(PAGE_META);

function showTab(name, opts = {}) {
  if (!TABS.includes(name)) name = "dashboard";
  TABS.forEach((t) => {
    const page = $("#page-" + t);
    if (page) page.classList.toggle("active", t === name);
    const nav = $(`.nav[data-tab="${t}"]`);
    if (nav) nav.classList.toggle("active", t === name);
  });
  try { history.replaceState(null, "", "#" + name); } catch (e) { }
  if (!opts.keepScroll) {
    const main = $("main");
    if (main) main.scrollTop = 0;
  }
  hideSearch();

  if (name === "dashboard") loadDashboard();
  else if (name === "monitor") renderMonitor();
  else if (name === "alerts") renderAlerts();
  else if (name === "devices") renderDevices();
  else if (name === "connection") loadConnection();
  else if (name === "reports") renderReports();
  else if (name === "settings") fillSettings();
}

$$(".nav").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

/* ------------------------------ kết nối ------------------------------ */
function setConn(state, text) {
  setClass("#dot", "dot " + (state || ""));
  setText("#connText", text);

  const map = {
    ok:   ["Trực tuyến", "ok", "Ổn định"],
    err:  ["Mất kết nối", "bad", "Có sự cố"],
    wait: ["DEMO", "warn", "Đang chờ"],
  };
  const [label, tone, health] = map[state] || ["--", "warn", "Đang chờ"];

  const lat = conn.rtt != null ? Math.round(conn.rtt) : null;
  setText("#onlineChip", state === "ok" && lat != null ? `${label} · ${lat} ms` : label);
  setText("#latencyVal", lat != null ? String(lat) : "--");
  const lc = $("#latencyChip");
  if (lc) {
    lc.classList.toggle("bad", state === "err");
    lc.classList.toggle("warn", state === "wait");
  }
  const oc = $(".online-chip");
  if (oc) {
    oc.classList.toggle("bad", state === "err");
    oc.classList.toggle("demo", state === "wait");
  }
  setText("#healthFb", label === "DEMO" ? "DEMO" : label);
  setClass("#hFb", "ht-dot " + (tone === "bad" ? "bad" : tone === "warn" ? "warn" : "ok"));
  setText("#healthChip", health);
  setClass("#healthChip", "chip " + (tone === "bad" ? "bad" : tone === "warn" ? "warn" : "ok"));

  setClass("#fbChip", "chip " + (tone === "bad" ? "bad" : tone === "warn" ? "warn" : "ok"));
  setText("#fbChipText", label);
  setText("#devFbChip", label);
  setClass("#devFbChip", "chip " + (tone === "bad" ? "bad" : tone === "warn" ? "warn" : "ok"));
  setText("#devFbValue", label);

  setText("#setStatus", text);
  const ss = $("#setStatus");
  if (ss) ss.style.color = tone === "bad" ? "#b91c1c" : tone === "warn" ? "#b45309" : "#047857";

  updateSyncUI();
}

/* ------------------------------ cảnh báo ------------------------------ */
function saveAlerts() {
  try { localStorage.setItem(ALERT_KEY, JSON.stringify(alerts.slice(0, 200))); } catch (e) { }
}

function seedAlerts() {
  if (alerts.length) return;
  const now = Date.now();
  alerts = [
    {
      id: "al-seed-1", kind: "heat", title: "Nhiệt độ cao",
      msg: "Nhiệt độ 33.4°C ≥ 32.0°C — HMI đã bật quạt làm mát CH2.",
      ts: now - 11 * 60000, ack: false,
    },
    {
      id: "al-seed-2", kind: "hum", title: "Độ ẩm thấp",
      msg: "Độ ẩm 38.6 %RH < 40.0 %RH — HMI đã bật bơm phun sương CH1.",
      ts: now - 27 * 60000, ack: false,
    },
    {
      id: "al-seed-3", kind: "cold", title: "Nhiệt độ thấp",
      msg: "Nhiệt độ 21.4°C < 22.0°C — Đã bật đèn halogen sưởi ấm CH3.",
      ts: now - 54 * 60000, ack: true,
    },
    {
      id: "al-seed-4", kind: "system", title: "Mất tín hiệu cảm biến",
      msg: "SHTC30 không phản hồi trong 3 chu kỳ — giữ giá trị cuối.",
      ts: now - 96 * 60000, ack: true,
    },
  ];
  saveAlerts();
}

const ALERT_META = {
  heat:   { icon: "temp", label: "Nhiệt độ cao" },
  cold:   { icon: "shield", label: "Nhiệt độ thấp" },
  hum:    { icon: "hum", label: "Độ ẩm" },
  system: { icon: "cpu", label: "Hệ thống" },
};

function addAlert(kind, title, msg, opts = {}) {
  const now = Date.now();
  const cooldown = opts.cooldown ?? 180000;
  if (!opts.force) {
    const dup = alerts.find((a) => a.kind === kind && now - (a.ts || 0) < cooldown);
    if (dup) return null;
  }
  const a = {
    id: "al-" + now + "-" + Math.random().toString(36).slice(2, 7),
    kind: ALERT_META[kind] ? kind : "system",
    title, msg, ts: now, ack: false,
  };
  alerts.unshift(a);
  alerts = alerts.slice(0, 200);
  saveAlerts();
  renderAlerts();
  if (soundOn) beep(2);
  if (kind === "heat" || kind === "cold" || kind === "system") toast(title + " — " + msg, "err");
  return a;
}

function ackAlert(id, silent) {
  const a = alerts.find((x) => x.id === id);
  if (!a || a.ack) { if (!silent) toast("Cảnh báo đã được ACK trước đó"); return; }
  a.ack = true;
  a.ackTs = Date.now();
  saveAlerts();
  renderAlerts();
  setText("#ackState", `Đã ACK: ${a.title} · ${clockNow(a.ackTs)}`);
  if (!silent) toast("Đã ACK cảnh báo", "ok");
}

function ackAll() {
  const open = alerts.filter((a) => !a.ack);
  if (!open.length) { toast("Không có cảnh báo chưa ACK"); return; }
  open.forEach((a) => { a.ack = true; a.ackTs = Date.now(); });
  saveAlerts();
  renderAlerts();
  setText("#ackState", `Đã ACK ${open.length} cảnh báo · ${clockNow()}`);
  toast(`Đã ACK ${open.length} cảnh báo`, "ok");
}

function renderAlerts() {
  const open = alerts.filter((a) => !a.ack).length;

  setText("#navAlertBadge", open > 99 ? "99+" : String(open));
  setText("#bellBadge", open > 99 ? "99+" : String(open));
  const nb = $("#navAlertBadge");
  if (nb) nb.style.display = open ? "grid" : "none";
  const bb = $("#bellBadge");
  if (bb) bb.style.display = open ? "grid" : "none";

  setText("#alertStatTotal", alerts.length);
  setText("#alertStatOpen", open);
  setText("#alertStatAck", alerts.length - open);
  setText("#alertStatHeat", alerts.filter((a) => a.kind === "heat").length);
  setText("#dashAlertCount", `${open} chưa xử lý · ${alerts.length} tổng`);

  const recent = alerts.slice()
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, 3);
  const dash = $("#dashAlerts");
  if (dash) {
    dash.innerHTML = recent.length
      ? recent.map((a) => alertItemHTML(a, true)).join("")
      : '<div class="empty">Chưa có cảnh báo</div>';
  }

  const list = $("#alertList");
  if (list) {
    const filtered = alertFilter === "all"
      ? alerts
      : alerts.filter((a) => a.kind === alertFilter);
    list.innerHTML = filtered.length
      ? filtered.map((a) => alertItemHTML(a, false)).join("")
      : '<div class="empty">Không có cảnh báo phù hợp.</div>';
    const empty = $("#alertEmpty");
    if (empty) empty.style.display = "none";
  }
}

function alertItemHTML(a, compact) {
  const meta = ALERT_META[a.kind] || ALERT_META.system;
  return `<div class="alert-item ${a.ack ? "acked" : "unack"}">
    <span class="alert-ico ${esc(a.kind)}"><svg class="ic"><use href="#i-${meta.icon}"></use></svg></span>
    <div class="alert-body">
      <div class="alert-title"><b>${esc(a.title)}</b>
        ${a.ack ? '<span class="chip ok">Đã ACK</span>' : '<span class="chip warn">Chưa ACK</span>'}
      </div>
      <p>${esc(a.msg)}</p>
    </div>
    <span class="alert-time">${relTime(a.ts)}</span>
    ${a.ack ? "" : `<button class="alert-ack" data-ack="${esc(a.id)}">ACK</button>`}
  </div>`;
}

function detectAlerts(d) {
  if (!d) return;
  const temp = Number(d.temp);
  const hum = Number(d.humidity !== undefined ? d.humidity : d.moisture);
  const t = cfg.thresholds;
  const sensorOk = d.sensor_ok !== false;

  if (isNum(d.temp) && temp >= t.fanOn) {
    addAlert("heat", "Nhiệt độ cao",
      `Nhiệt độ ${fmt1(temp)}°C ≥ ${fmt1(t.fanOn)}°C — Đã bật quạt làm mát CH2.`,
      { cooldown: 240000 });
  }
  if (isNum(d.temp) && temp <= t.heatOn) {
    addAlert("cold", "Nhiệt độ thấp",
      `Nhiệt độ ${fmt1(temp)}°C ≤ ${fmt1(t.heatOn)}°C — Đã bật đèn halogen sưởi ấm CH3.`,
      { cooldown: 240000 });
  }
  if (isNum(hum) && hum < t.rhOn) {
    addAlert("hum", "Độ ẩm thấp",
      `Độ ẩm ${fmt1(hum)} %RH dưới ${fmt1(t.rhOn)} %RH — Bật bơm phun sương CH1.`,
      { cooldown: 300000 });
  }
  if (!sensorOk) {
    addAlert("system", "Mất tín hiệu cảm biến",
      "SHTC30 không phản hồi — giữ giá trị cuối và kiểm tra đường RS-485.",
      { cooldown: 300000 });
  }
  if (d.estop) {
    addAlert("system", "E-STOP đang kích hoạt",
      "Dừng khẩn cấp từ ERP — quạt, bơm và đèn đã tắt.",
      { force: true, cooldown: 60000 });
  }
}

/* ------------------------------ âm thanh ------------------------------ */
let audioCtx = null;
function beep(times = 2, freq = 880) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = audioCtx || new AC();
    if (audioCtx.state === "suspended") audioCtx.resume();
    for (let i = 0; i < times; i++) {
      const t = audioCtx.currentTime + i * 0.25;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.22);
    }
  } catch (e) { /* trình duyệt chặn audio */ }
}

function updateSoundUI() {
  const card = $("#soundCard");
  if (card) card.classList.toggle("on", soundOn);
  setText("#soundTitle", soundOn ? "Tắt âm thanh" : "Bật âm thanh");
  setText("#soundSwitch", soundOn ? "Tắt" : "Bật");
  setText("#soundState2", soundOn ? "Đang bật" : "Chưa bật");
  setText("#soundBtnText", soundOn ? "Tắt" : "Bật");
}

function setSound(on) {
  soundOn = !!on;
  cfg.sound = soundOn;
  saveCfg();
  updateSoundUI();
  if (soundOn) beep(1);
  toast(soundOn ? "Đã bật âm thanh cảnh báo" : "Đã tắt âm thanh cảnh báo",
    soundOn ? "ok" : "");
}

/* ============================== DASHBOARD ============================== */
function makeDemoLive() {
  const t = Date.now() / 1000;
  const spike = (t % 210) > 198 ? 2.4 : 0;
  const temp = 27.4 + 5.4 * Math.sin(t / 95) + Math.sin(t / 11) * 0.35 + spike;
  const hum = 43.2 + 5.6 * Math.sin(t / 38 + 1) + Math.sin(t / 4.5) * 0.6;
  const tCfg = cfg.thresholds;
  const mode = demoOverride.mode || "AUTO";
  const estop = !!demoOverride.estop;
  const prev = lastLive || {};
  let fan;
  let pump;
  let lamp;

  if (estop) {
    fan = false;
    pump = false;
    lamp = false;
  } else if (mode === "MANUAL") {
    fan = demoOverride.fan ?? !!prev.fan;
    pump = demoOverride.pump ?? !!prev.pump;
    lamp = demoOverride.lamp ?? !!prev.lamp;
  } else {
    fan = prev.fan ? temp >= tCfg.fanOff : temp >= tCfg.fanOn;
    pump = prev.pump ? hum <= tCfg.rhOff : hum <= tCfg.rhOn;
    lamp = prev.lamp ? temp <= tCfg.heatOff : temp <= tCfg.heatOn;
  }

  return {
    humidity: +Math.max(18, Math.min(96, hum)).toFixed(1),
    temp: +Math.max(5, temp).toFixed(1),
    fan, pump, lamp, mode, estop,
    sensor_ok: true,
    modbus_connected: true,
    rh_on: tCfg.rhOn, rh_off: tCfg.rhOff,
    fan_on: tCfg.fanOn, fan_off: tCfg.fanOff,
    heat_on: tCfg.heatOn, heat_off: tCfg.heatOff,
    pump_max_s: tCfg.pumpMax, heat_max_s: tCfg.heatMax,
    failsafe_cycles: tCfg.failsafe,
    uptime_s: Math.floor((Date.now() - sessionStart) / 1000) + 4830,
    ts: Date.now(),
  };
}

function makeDemoStatus() {
  const lat = 42 + Math.round(Math.sin(Date.now() / 9000) * 9);
  return {
    online: true, ts: Date.now(), version: "hmi-2.0-demo",
    device: cfg.device, mode: demoOverride.mode,
    estop: !!demoOverride.estop, modbus_connected: true,
    sensor_ok: true, uptime_s: Math.floor((Date.now() - sessionStart) / 1000) + 4830,
    latency_ms: lat, interval_s: 2,
  };
}

function addRtt(ms) {
  if (!Number.isFinite(Number(ms))) return;
  const v = Math.max(0, Math.round(Number(ms)));
  conn.rttHistory.push({ ts: Date.now(), ms: v });
  if (conn.rttHistory.length > 90) conn.rttHistory.shift();
}

async function loadDashboard() {
  if (API.mock) {
    lastLive = makeDemoLive();
    conn.status = makeDemoStatus();
    conn.rtt = conn.status.latency_ms;
    conn.online = true;
    conn.modbus = true;
    conn.fetchOk = true;
    conn.failures = 0;
    conn.lastOkTs = Date.now();
    conn.heartbeatTs = conn.status.ts;
    addRtt(conn.rtt);
    mset("hmi/" + cfg.device + "/live", lastLive);
    mset("hmi/" + cfg.device + "/status", conn.status);
    setConn("wait", "DEMO · dữ liệu lưu trên máy này");
    renderLive();
    detectAlerts(lastLive);
    updateSyncUI();
    return;
  }

  const t0 = performance.now();
  try {
    const [live, status] = await Promise.all([
      API.get(`hmi/${cfg.device}/live`),
      API.get(`hmi/${cfg.device}/status`),
    ]);
    const rtt = Math.round(performance.now() - t0);
    conn.rtt = rtt;
    addRtt(rtt);
    conn.status = status || null;
    conn.fetchOk = true;
    conn.failures = 0;
    conn.lastOkTs = Date.now();
    conn.lastError = "";
    conn.heartbeatTs = Number(status && status.ts) || Number(live && live.ts) || 0;
    conn.modbus = !!((status && status.modbus_connected) || (live && live.modbus_connected));
    lastLive = live;

    if (!live) {
      conn.online = false;
      setConn("wait", "Chưa có dữ liệu live từ HMI");
      updateSyncUI();
      renderConnection();
      return;
    }

    const liveAge = live.ts ? Date.now() - Number(live.ts) : Infinity;
    const statusAge = status && status.ts ? Date.now() - Number(status.ts) : Infinity;
    const online = (status && status.online && statusAge < 20000) || liveAge < 30000;
    conn.online = !!online;
    setConn(online ? "ok" : "err",
      online ? "Firebase · " + cfg.device : "HMI không trực tuyến — dùng giá trị cuối");
    renderLive();
    detectAlerts(live);
    updateSyncUI();
    renderConnection();

    loadConnMeta();
    loadHistory();
    if ($("#page-connection") && $("#page-connection").classList.contains("active")) loadLogs();
  } catch (e) {
    conn.failures += 1;
    conn.fetchOk = false;
    conn.online = false;
    conn.lastError = e.message;
    setConn("err", e.message);
    renderLive(true);
    updateSyncUI();
    renderConnection();
  }
}

/* --------------------- đồng bộ sâu: ACK / log / history --------------------- */
function pushConnEvent(ev) {
  conn.events.unshift({ ...ev, ts: Number(ev.ts) || Date.now() });
  conn.events = conn.events.slice(0, 40);
  if ($("#page-connection") && $("#page-connection").classList.contains("active")) {
    renderEvents();
  }
}

function applyAck(kind, ack) {
  if (!ack || typeof ack !== "object") return;
  // Chống trùng theo SEQ, không dùng ts của HMI: đồng hồ HMI lệch có thể
  // làm ACK hợp lệ bị bỏ qua (pendingCmd không bao giờ được khớp).
  const seqKey = (ack.seq === undefined || ack.seq === null)
    ? null : String(ack.seq);
  const ts = Number(ack.ts) || Date.now();
  const prev = kind === "cmd" ? conn.lastCmdAck : conn.lastCfgAck;
  if (prev && seqKey !== null && String(prev.seq) === seqKey) return;
  if (prev && seqKey === null && Number(prev.ts) >= ts) return;

  const item = { ...ack, ts };
  if (kind === "cmd") conn.lastCmdAck = item;
  else conn.lastCfgAck = item;
  pushConnEvent({ kind, ...item });

  const pending = kind === "cmd" ? conn.pendingCmd : conn.pendingCfg;
  if (!pending || String(pending.seq) !== String(item.seq)) return;

  if (kind === "cmd") conn.pendingCmd = null;
  else conn.pendingCfg = null;

  if (item.applied && lastLive) {
    lastLive = { ...lastLive, ...item.applied };
    renderLive();
  }

  if (kind === "cmd") {
    if (item.ok) {
      setAck(`HMI ACK #${shortSeq(item.seq)}: ${item.message}`);
      toast(`HMI xác nhận: ${item.message}`, "ok");
    } else {
      setAck(`HMI từ chối #${shortSeq(item.seq)}: ${item.message}`);
      toast(`HMI từ chối lệnh: ${item.message}`, "err");
      addAlert("system", "Lệnh bị từ chối",
        `ERP gửi lệnh #${shortSeq(item.seq)} nhưng HMI phản hồi: ${item.message}`, { force: true });
    }
  } else {
    setText("#syncAck", item.ok ? "OK" : "Lỗi");
    setText("#syncSeq", shortSeq(item.seq));
    setText("#syncState", item.ok
      ? `HMI đã áp dụng cấu hình · ${clockNow(item.ts)}`
      : `HMI từ chối cấu hình: ${item.message}`);
    if (item.ok) toast(`HMI áp dụng cấu hình: ${item.message}`, "ok");
    else toast(`Cấu hình bị từ chối: ${item.message}`, "err");
  }

  renderConnAck();
  renderConfigCompare();
  updateSyncUI();
}

function checkPendingTimeouts() {
  const now = Date.now();
  if (conn.pendingCmd && now - conn.pendingCmd.ts > 12000) {
    const p = conn.pendingCmd;
    conn.pendingCmd = null;
    setAck(`HMI không phản hồi ACK #${shortSeq(p.seq)}`);
    toast("HMI chưa phản hồi ACK — kiểm tra kết nối", "err");
    pushConnEvent({ kind: "cmd", seq: p.seq, ok: false, message: "Timeout: HMI không phản hồi ACK", ts: now });
  }
  if (conn.pendingCfg && now - conn.pendingCfg.ts > 15000) {
    const p = conn.pendingCfg;
    conn.pendingCfg = null;
    setText("#syncState", "HMI chưa phản hồi config_ack.");
    toast("HMI chưa xác nhận cấu hình", "err");
    pushConnEvent({ kind: "cfg", seq: p.seq, ok: false, message: "Timeout: HMI không phản hồi config_ack", ts: now });
  }
  renderConnAck();
}

async function loadConnMeta(force = false) {
  if (API.mock) {
    ensureDemoMeta();
    renderConnAck();
    renderConfigCompare();
    renderEvents();
    return;
  }
  if (!cfg.url) return;
  const now = Date.now();
  if (!force && now - conn.lastMeta < 4500) return;
  conn.lastMeta = now;

  try {
    const [cmdAck, cfgAck, remoteCfg] = await Promise.all([
      API.get(`hmi/${cfg.device}/command_ack`),
      API.get(`hmi/${cfg.device}/config_ack`),
      API.get(`hmi/${cfg.device}/config`),
    ]);
    applyAck("cmd", cmdAck);
    applyAck("cfg", cfgAck);
    if (remoteCfg && remoteCfg.ts) conn.remoteConfig = remoteCfg;
  } catch (e) {
    conn.lastError = e.message;
  }
  checkPendingTimeouts();
  renderConnAck();
  renderConfigCompare();
  renderConnection();
}

async function loadLogs(force = false) {
  if (API.mock) {
    ensureDemoMeta();
    renderLogs();
    return;
  }
  if (!cfg.url) return;
  const now = Date.now();
  if (!force && now - conn.lastLogs < 9000) return;
  conn.lastLogs = now;

  let data = null;
  try {
    data = await API.get(`hmi/${cfg.device}/logs`, {
      orderBy: '"ts"', limitToLast: 60,
    });
  } catch (e) {
    try { data = await API.get(`hmi/${cfg.device}/logs`); } catch (e2) { data = null; }
  }
  conn.logs = toList(data)
    .filter((x) => x && x.msg)
    .sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0))
    .slice(0, 100);
  renderLogs();
}

async function loadHistory(force = false) {
  if (!cfg.url) return;
  const now = Date.now();
  if (!force && now - conn.lastHistory < 25000) return;
  conn.lastHistory = now;

  let data = null;
  try {
    data = await API.get(`hmi/${cfg.device}/history`, {
      orderBy: '"ts"', limitToLast: 300,
    });
  } catch (e) {
    try { data = await API.get(`hmi/${cfg.device}/history`); } catch (e2) { data = null; }
  }
  const rows = toList(data).map((r) => ({
    ts: Number(r.ts) || 0,
    temp: Number(r.temp),
    hum: Number(r.humidity !== undefined ? r.humidity : r.hum),
    fan: !!r.fan, pump: !!r.pump, lamp: !!r.lamp,
    mode: r.mode || "AUTO",
    sensor_ok: r.sensor_ok !== false,
  })).filter((r) => r.ts && !isNaN(r.temp) && !isNaN(r.hum));

  if (!rows.length) return;
  const map = new Map();
  telemetry.concat(rows).forEach((r) => map.set(r.ts, r));
  telemetry = Array.from(map.values()).sort((a, b) => a.ts - b.ts).slice(-300);
  telemetryDirty = true;

  if ($("#page-monitor") && $("#page-monitor").classList.contains("active")) renderMonitor();
  if ($("#page-reports") && $("#page-reports").classList.contains("active")) renderReports();
}

function ensureDemoMeta() {
  if (!API.mock) return;
  if (!conn.status) conn.status = makeDemoStatus();
  if (!conn.remoteConfig) {
    conn.remoteConfig = {
      rh_on: cfg.thresholds.rhOn, rh_off: cfg.thresholds.rhOff,
      fan_on: cfg.thresholds.fanOn, fan_off: cfg.thresholds.fanOff,
      heat_on: cfg.thresholds.heatOn, heat_off: cfg.thresholds.heatOff,
      pump_max_s: cfg.thresholds.pumpMax, heat_max_s: cfg.thresholds.heatMax,
      failsafe_cycles: cfg.thresholds.failsafe, ts: Date.now(),
    };
  }
  if (!conn.logs.length) {
    const now = Date.now();
    conn.logs = [
      { level: "OK", msg: "Firebase trực tuyến · đồng bộ 2,0 s/chu kỳ", ts: now - 12000 },
      { level: "REMOTE", msg: `Web (web-erp): chế độ ${cfg.thresholds ? (lastLive ? lastLive.mode : "AUTO") : "AUTO"}`, ts: now - 46000 },
      { level: "INFO", msg: "SHTC30: 27,6 °C · 43,2 %RH · relay CH1/CH2/CH3 phản hồi", ts: now - 61000 },
      { level: "WARN", msg: "Độ ẩm 38,9 %RH dưới ngưỡng — bơm CH1 BẬT (AUTO)", ts: now - 122000 },
      { level: "INFO", msg: "Kết nối Modbus RS-485 9600 8N1 · slave 1 + 255", ts: now - 180000 },
      { level: "OK", msg: "Đã áp dụng cấu hình từ web · seq 884102", ts: now - 240000 },
    ];
  }
  if (!conn.events.length) {
    const now = Date.now();
    conn.events = [{
      kind: "cmd", seq: Number(String(now - 46000).slice(-6)), ok: true,
      by: "web-erp", message: "chế độ AUTO", ts: now - 45000,
    }];
  }
}

/* --------------------- render: ACK / cấu hình / log / sự kiện --------------------- */
function renderConnAck() {
  if (!$("#connCmdCard")) return;
  const cmd = conn.pendingCmd;
  const cmdAck = conn.lastCmdAck;
  const cfgPending = conn.pendingCfg;
  const cfgAck = conn.lastCfgAck;

  const cmdCard = $("#connCmdCard");
  if (cmd) {
    cmdCard.className = "ack-card pending";
    setText("#connCmdState", `Đang chờ ACK #${shortSeq(cmd.seq)}`);
    setText("#connCmdMeta", `${cmd.label} · gửi ${clockNow(cmd.ts)}`);
  } else if (cmdAck) {
    cmdCard.className = "ack-card " + (cmdAck.ok ? "ok" : "bad");
    setText("#connCmdState", cmdAck.ok ? "HMI đã xác nhận" : "HMI từ chối lệnh");
    setText("#connCmdMeta", `#${shortSeq(cmdAck.seq)} · ${cmdAck.message} · ${clockNow(cmdAck.ts)}`);
  } else {
    cmdCard.className = "ack-card";
    setText("#connCmdState", "Chưa gửi lệnh");
    setText("#connCmdMeta", "SEQ -- · --");
  }

  const cfgCard = $("#connCfgCard");
  if (cfgPending) {
    cfgCard.className = "ack-card pending";
    setText("#connCfgState", `Đang chờ config_ack #${shortSeq(cfgPending.seq)}`);
    setText("#connCfgMeta", `Gửi ${clockNow(cfgPending.ts)}`);
  } else if (cfgAck) {
    cfgCard.className = "ack-card " + (cfgAck.ok ? "ok" : "bad");
    setText("#connCfgState", cfgAck.ok ? "HMI đã áp dụng" : "HMI từ chối cấu hình");
    setText("#connCfgMeta", `#${shortSeq(cfgAck.seq)} · ${cfgAck.message} · ${clockNow(cfgAck.ts)}`);
  } else {
    cfgCard.className = "ack-card";
    setText("#connCfgState", "Chưa đồng bộ");
    setText("#connCfgMeta", "SEQ -- · --");
  }

  const chip = $("#connAckChip");
  if (chip) {
    if (cmd || cfgPending) {
      chip.textContent = "Đang chờ ACK";
      chip.className = "chip warn";
    } else if ((cmdAck && !cmdAck.ok) || (cfgAck && !cfgAck.ok)) {
      chip.textContent = "ACK lỗi";
      chip.className = "chip bad";
    } else if (cmdAck || cfgAck) {
      const last = Math.max(cmdAck ? cmdAck.ts : 0, cfgAck ? cfgAck.ts : 0);
      chip.textContent = "ACK OK · " + clockNow(last);
      chip.className = "chip ok";
    } else {
      chip.textContent = "Chưa có ACK";
      chip.className = "chip mute";
    }
  }
}

function cfgValue(v, unit) {
  return isNum(v) ? `${Number(v) % 1 === 0 ? Number(v) : fmt1(v)} ${unit}` : "--";
}

function renderConfigCompare() {
  const body = $("#cfgCompareBody");
  if (!body) return;
  const hmi = lastLive || {};
  const t = cfg.thresholds;
  const rows = [
    ["Bơm BẬT khi RH <", t.rhOn, hmi.rh_on, "%RH"],
    ["Bơm TẮT khi RH ≥", t.rhOff, hmi.rh_off, "%RH"],
    ["Quạt BẬT khi T ≥", t.fanOn, hmi.fan_on, "°C"],
    ["Quạt TẮT khi T <", t.fanOff, hmi.fan_off, "°C"],
    ["Sưởi BẬT khi T <", t.heatOn, hmi.heat_on, "°C"],
    ["Sưởi TẮT khi T ≥", t.heatOff, hmi.heat_off, "°C"],
    ["Watchdog bơm", t.pumpMax, hmi.pump_max_s, "s"],
    ["Watchdog đèn", t.heatMax, hmi.heat_max_s, "s"],
    ["Failsafe timeout", t.failsafe, hmi.failsafe_cycles, "chu kỳ"],
  ];

  let diff = 0;
  let missing = 0;
  body.innerHTML = rows.map(([label, erp, remote, unit]) => {
    const has = isNum(remote);
    const same = has && Math.abs(Number(erp) - Number(remote)) < 0.05;
    if (!has) missing += 1;
    else if (!same) diff += 1;
    const pill = !has ? '<span class="badge mute">Chưa rõ</span>'
      : same ? '<span class="badge ok">Khớp</span>'
        : '<span class="badge warn">Lệch</span>';
    return `<tr>
      <td>${esc(label)}</td>
      <td class="num">${cfgValue(erp, unit)}</td>
      <td class="num">${cfgValue(remote, unit)}</td>
      <td class="right">${pill}</td>
    </tr>`;
  }).join("");

  const chip = $("#cfgCompareChip");
  if (chip) {
    if (!lastLive) {
      chip.textContent = "Chưa có dữ liệu HMI";
      chip.className = "chip mute";
    } else if (diff) {
      chip.textContent = `${diff} giá trị lệch`;
      chip.className = "chip warn";
    } else if (missing) {
      chip.textContent = "Thiếu dữ liệu";
      chip.className = "chip mute";
    } else {
      chip.textContent = "Khớp cấu hình";
      chip.className = "chip ok";
    }
  }
  setText("#cfgCompareHint", diff
    ? "Có giá trị lệch giữa ERP và HMI — bấm “Đồng bộ ngưỡng” để áp dụng lại."
    : "ERP và HMI đang dùng cùng bộ ngưỡng và watchdog.");
  setText("#syncCompare", diff ? `${diff} lệch` : lastLive ? "Khớp" : "--");
}

function renderLogs() {
  const box = $("#connLogs");
  if (!box) return;
  if (!conn.logs.length) {
    box.innerHTML = '<div class="log-empty">Chưa có nhật ký từ HMI.</div>';
    return;
  }
  box.innerHTML = conn.logs.slice(0, 60).map((l) => {
    const lvl = String(l.level || "INFO").toUpperCase();
    return `<div class="log-row lv-${esc(lvl.toLowerCase())}">
      <span class="lg-time">${clockNow(l.ts)}</span>
      <span class="lg-level">${esc(lvl)}</span>
      <span class="lg-msg">${esc(l.msg)}</span>
    </div>`;
  }).join("");
}

function renderEvents() {
  const box = $("#connEvents");
  if (!box) return;
  setText("#connEventCount", String(conn.events.length));
  if (!conn.events.length) {
    box.innerHTML = '<div class="empty">Chưa có sự kiện.</div>';
    return;
  }
  box.innerHTML = conn.events.slice(0, 20).map((e) => {
    const kind = e.kind === "cfg" ? "CẤU HÌNH" : "LỆNH";
    return `<div class="conn-event ${e.ok ? "ok" : "bad"}">
      <span class="ce-dot"></span>
      <div class="ce-body">
        <b>${kind} #${shortSeq(e.seq)} · ${e.ok ? "ACK OK" : "ACK lỗi"}</b>
        <span>${esc(e.message || "--")}</span>
      </div>
      <time>${clockNow(e.ts)}</time>
    </div>`;
  }).join("");
}

function drawLatencyChart() {
  const cv = $("#connLatency");
  if (!cv) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth || 520;
  const h = cv.clientHeight || 150;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const rows = conn.rttHistory.slice(-60);
  const padL = 34;
  const padR = 12;
  const padT = 14;
  const padB = 20;
  const x0 = padL;
  const x1 = w - padR;
  const y0 = padT;
  const y1 = h - padB;

  ctx.font = '9.5px "Segoe UI", Arial, sans-serif';
  ctx.lineWidth = 1;
  const max = Math.max(120, ...rows.map((r) => r.ms));
  const steps = 3;
  for (let i = 0; i <= steps; i++) {
    const y = y0 + (y1 - y0) * (i / steps);
    ctx.strokeStyle = "#eef2f8";
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.fillStyle = "#94a3b8";
    ctx.textAlign = "right";
    ctx.fillText(String(Math.round(max - (max * i) / steps)), x0 - 6, y + 3);
  }

  if (rows.length < 2) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = '11px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("Đang chờ dữ liệu RTT…", (x0 + x1) / 2, (y0 + y1) / 2);
    return;
  }

  const px = (i) => x0 + (x1 - x0) * (i / (rows.length - 1));
  const py = (v) => y1 - (y1 - y0) * (Math.max(0, v) / max);

  ctx.beginPath();
  ctx.moveTo(px(0), py(rows[0].ms));
  rows.forEach((r, i) => ctx.lineTo(px(i), py(r.ms)));
  ctx.lineTo(px(rows.length - 1), y1);
  ctx.lineTo(px(0), y1);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, "rgba(37, 99, 235, .22)");
  g.addColorStop(1, "rgba(37, 99, 235, 0)");
  ctx.fillStyle = g;
  ctx.fill();

  ctx.beginPath();
  rows.forEach((r, i) => (i ? ctx.lineTo(px(i), py(r.ms)) : ctx.moveTo(px(i), py(r.ms))));
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();

  const last = rows[rows.length - 1];
  ctx.beginPath();
  ctx.arc(px(rows.length - 1), py(last.ms), 3.2, 0, Math.PI * 2);
  ctx.fillStyle = "#2563eb";
  ctx.fill();

  ctx.fillStyle = "#94a3b8";
  ctx.textAlign = "left";
  ctx.fillText("ms", 6, y0 + 4);
}

function updateSyncUI() {
  if (!$("#syncPath")) return;
  const live = lastLive || {};
  const status = conn.status || {};
  const hbAge = conn.heartbeatTs ? Date.now() - conn.heartbeatTs : Infinity;
  const hbOk = conn.online && hbAge < 20000;
  const fbOk = conn.fetchOk;
  const busOk = !!conn.modbus;

  const node = (key, tone, sub) => {
    const el = $(`.sync-node[data-node="${key}"]`);
    if (!el) return;
    el.classList.remove("ok", "warn", "bad", "demo");
    if (tone) el.classList.add(tone);
    if (sub) {
      const s = el.querySelector("small");
      if (s) s.textContent = sub;
    }
  };
  const link = (key, tone) => {
    const el = $(`.sync-link[data-link="${key}"]`);
    if (!el) return;
    el.classList.remove("ok", "warn", "bad");
    if (tone) el.classList.add(tone);
  };

  node("erp", "ok", API.mock ? "DEMO local" : (location.host || "file://"));
  node("fb", API.mock ? "demo" : fbOk ? "ok" : "bad",
    API.mock ? "localStorage" : fbOk ? hostOf(cfg.url) : "lỗi kết nối");
  node("hmi", hbOk ? "ok" : API.mock ? "demo" : "bad",
    hbOk ? `online · ${Math.max(0, Math.round(hbAge / 1000))} s` : "chờ heartbeat");
  node("modbus", busOk ? "ok" : fbOk ? "warn" : "bad",
    busOk ? "SHTC30 · relay OK" : live.sensor_ok === false ? "mất tín hiệu" : "chưa phản hồi");

  link("web", API.mock ? "warn" : fbOk ? "ok" : "bad");
  link("hmi", hbOk ? "ok" : API.mock ? "warn" : "bad");
  link("modbus", busOk ? "ok" : fbOk ? "warn" : "bad");

  setText("#syncFbSub", API.mock ? "localStorage" : hostOf(cfg.url));
  setText("#syncHmiSub", hbOk ? (live.mode || "online") : "chờ heartbeat");
  setText("#syncBusSub", busOk ? "SHTC30 · relay OK" : "chưa phản hồi");
  setText("#syncHeartbeat", conn.heartbeatTs ? (hbAge < 3000 ? "vừa xong" : `${Math.round(hbAge / 1000)} s trước`) : "--");
  setText("#syncLatency", conn.rtt != null ? `${Math.round(conn.rtt)} ms` : "--");

  const ack = conn.pendingCmd || conn.pendingCfg ? "chờ..."
    : conn.lastCmdAck || conn.lastCfgAck
      ? (conn.lastCmdAck && !conn.lastCmdAck.ok) || (conn.lastCfgAck && !conn.lastCfgAck.ok) ? "lỗi" : "OK"
      : "--";
  setText("#syncAck", ack);
  setText("#syncAckSettings", ack);   // ô ACK ở trang Cài đặt
  setText("#syncSub", API.mock
    ? "DEMO · dữ liệu mô phỏng lưu trên máy này"
    : fbOk && hbOk ? `Đồng bộ 2 giây · ${hostOf(cfg.url)}`
      : !fbOk ? "Không kết nối được Firebase"
        : "Firebase OK nhưng HMI chưa gửi heartbeat");

  const dot = $("#navConnDot");
  if (dot) {
    dot.className = "nav-dot " + (API.mock ? "warn" : fbOk && hbOk ? "ok" : "bad");
  }

  const estop = !!live.estop;
  const banner = $("#estopBanner");
  if (banner) {
    banner.classList.toggle("hidden", !estop);
    if (estop && !conn.estopSince) conn.estopSince = Date.now();
    if (!estop) conn.estopSince = 0;
    setText("#estopBannerText", estop
      ? "Toàn bộ quạt, bơm và đèn đã bị khóa. Kiểm tra hiện trường trước khi giải phóng."
      : "");
    setText("#estopSince", estop && conn.estopSince ? clockNow(conn.estopSince) : "--:--:--");
  }
  if (estop) document.body.classList.add("estop-mode");
  else document.body.classList.remove("estop-mode");
}

function renderConnection() {
  const page = $("#page-connection");
  if (!page) return;

  const live = lastLive || {};
  const status = conn.status || {};
  const hbAge = conn.heartbeatTs ? Date.now() - conn.heartbeatTs : Infinity;
  const hbOk = conn.online && hbAge < 20000;
  const busOk = !!conn.modbus;
  const estop = !!live.estop;

  setText("#connUpdated", "Cập nhật " + clockNow());
  setText("#connHb", conn.heartbeatTs ? (hbAge < 3000 ? "Vừa xong" : `${Math.round(hbAge / 1000)} s`) : "--");
  setText("#connHbSub", conn.heartbeatTs ? "Nhận lúc " + clockNow(conn.heartbeatTs) : "Chưa có tín hiệu");
  setText("#connRtt", conn.rtt != null ? Math.round(conn.rtt) + " ms" : "--");
  setText("#connRttSub", API.mock ? "DEMO · mô phỏng" : "Web ↔ " + hostOf(cfg.url));
  setText("#connUptime", status.uptime_s ? fmtUptime(Number(status.uptime_s) * 1000) : "--");
  setText("#connUptimeSub", "HMI đã chạy liên tục");
  setText("#connVersion", status.version || "--");
  setText("#connVersionSub", status.device || cfg.device);

  const setNode = (sel, tone, value) => {
    const el = $(sel);
    if (!el) return;
    el.classList.remove("ok", "warn", "bad", "demo");
    if (tone) el.classList.add(tone);
    if (value !== undefined) {
      const v = el.querySelector(".tn-body span");
      if (v) v.textContent = value;
    }
  };
  const setLink = (sel, tone) => {
    const el = $(sel);
    if (!el) return;
    el.classList.remove("ok", "warn", "bad");
    if (tone) el.classList.add(tone);
  };

  setNode("#topoErp", "ok", API.mock ? "DEMO local" : (location.host || "file://"));
  setNode("#topoFb", API.mock ? "demo" : conn.fetchOk ? "ok" : "bad",
    API.mock ? "localStorage" : conn.fetchOk ? `${hostOf(cfg.url)} · ${conn.rtt != null ? Math.round(conn.rtt) + " ms" : "--"}` : "Không truy cập được");
  setNode("#topoHmi", hbOk ? "ok" : API.mock ? "demo" : "bad",
    hbOk ? `Heartbeat ${hbAge < 3000 ? "vừa xong" : Math.round(hbAge / 1000) + " s trước"}` : "Chờ heartbeat");
  setNode("#topoBus", busOk ? "ok" : live.sensor_ok === false ? "bad" : "warn",
    busOk ? `Đã kết nối · ${fmt1(live.temp)} °C / ${fmt1(live.humidity ?? live.moisture)} %RH` : "Chưa có dữ liệu bus");

  setLink("#linkWeb", API.mock ? "warn" : conn.fetchOk ? "ok" : "bad");
  setLink("#linkHmi", hbOk ? "ok" : API.mock ? "warn" : "bad");
  setLink("#linkBus", busOk ? "ok" : "warn");

  const topoChip = $("#connTopoChip");
  if (topoChip) {
    const ok = conn.fetchOk && hbOk && busOk;
    topoChip.textContent = API.mock ? "DEMO" : ok ? "Toàn tuyến OK" : estop ? "E-STOP" : "Cần kiểm tra";
    topoChip.className = "chip " + (ok ? "ok" : API.mock ? "warn" : estop ? "bad" : "warn");
  }
  setText("#connProfile", cfg.device);
  setText("#connPath", `hmi/${cfg.device}`);
  setText("#topoPath", cfg.device);
  setText("#connMode", (live.mode || "--") + (estop ? " · E-STOP" : ""));

  const quality = $("#connQualityChip");
  if (quality) {
    const r = conn.rtt;
    if (API.mock) { quality.textContent = "DEMO"; quality.className = "chip warn"; }
    else if (r == null) { quality.textContent = "Chưa đo"; quality.className = "chip mute"; }
    else if (r < 300) { quality.textContent = "Tốt"; quality.className = "chip ok"; }
    else if (r < 800) { quality.textContent = "Trung bình"; quality.className = "chip warn"; }
    else { quality.textContent = "Chậm"; quality.className = "chip bad"; }
  }
  setText("#connLatStat", conn.rtt != null ? Math.round(conn.rtt) + " ms" : "--");
  const avg = conn.rttHistory.length
    ? Math.round(conn.rttHistory.reduce((s, x) => s + x.ms, 0) / conn.rttHistory.length)
    : null;
  setText("#connLatAvg", avg != null ? avg + " ms" : "--");
  setText("#connHbStat", conn.heartbeatTs ? (hbAge < 3000 ? "Vừa xong" : Math.round(hbAge / 1000) + " s trước") : "--");
  setText("#connFailStat", String(conn.failures));

  const eBtn = $("#btnConnEstop");
  if (eBtn) eBtn.disabled = estop;
  const aBtn = $("#btnConnAuto");
  if (aBtn) aBtn.disabled = estop || (live.mode || "AUTO") === "AUTO";

  renderConnAck();
  renderConfigCompare();
  renderLogs();
  renderEvents();
  drawLatencyChart();
  updateSyncUI();
}

async function loadConnection() {
  ensureDemoMeta();
  renderConnection();
  await Promise.all([loadConnMeta(true), loadLogs(true), loadHistory(true)]);
  renderConnection();
}

function renderLive(failed) {
  const d = lastLive;
  if (!d) return;

  const t = cfg.thresholds;
  const humRaw = (d.humidity !== undefined && d.humidity !== null) ? d.humidity : d.moisture;
  const hum = Number(humRaw);
  const temp = Number(d.temp);
  const humOk = isNum(humRaw) && !isNaN(hum);
  const tempOk = isNum(d.temp) && !isNaN(temp);

  const mode = d.mode || demoOverride.mode || "AUTO";
  const fan = d.fan !== undefined ? !!d.fan : (tempOk && temp >= t.fanOn);
  const pump = d.pump !== undefined ? !!d.pump : (humOk && hum <= t.rhOn);
  const lamp = d.lamp !== undefined ? !!d.lamp : (tempOk && temp <= t.heatOn);
  const estop = !!d.estop;
  const sensorOk = d.sensor_ok !== false && !failed;
  const hot = tempOk && temp >= t.fanOn;
  const cold = tempOk && temp <= t.heatOn;
  const dry = humOk && hum < t.rhOn;
  const ts = Number(d.ts) || Date.now();

  /* ---- KPI ---- */
  setText("#kpiTemp", tempOk ? fmt1(temp) : "--");
  const tc = $("#tempChip");
  if (tc) {
    tc.textContent = hot ? "Cao" : cold ? "Thấp" : "Bình thường";
    tc.className = "chip " + (hot ? "bad" : cold ? "warn" : "ok");
  }
  const tb = $("#tempBar");
  if (tb) {
    tb.style.width = (tempOk ? clamp(temp / 60) * 100 : 0) + "%";
    tb.className = hot ? "hot" : "temp";
  }
  setText("#tempSub", hot
    ? `Quạt CH2 đang chạy · ngưỡng ${fmt1(t.fanOn)} °C`
    : cold
      ? `Đèn sưởi CH3 đang chạy · ngưỡng ${fmt1(t.heatOn)} °C`
      : `Quạt ON ≥ ${fmt1(t.fanOn)} °C · OFF < ${fmt1(t.fanOff)} °C`);

  setText("#kpiHum", humOk ? fmt1(hum) : "--");
  const hc = $("#humChip");
  if (hc) {
    const high = humOk && hum > 80;
    hc.textContent = dry ? "Khô" : high ? "Ẩm cao" : "Bình thường";
    hc.className = "chip " + (dry || high ? "warn" : "ok");
  }
  const hb = $("#humBar");
  if (hb) hb.style.width = (humOk ? clamp(hum / 100) * 100 : 0) + "%";
  setText("#humSub", `Bơm ON < ${fmt1(t.rhOn)} % · OFF ≥ ${fmt1(t.rhOff)} %RH`);

  setText("#kpiFan", fan ? "ON" : "OFF");
  const kf = $("#kpiFan");
  if (kf) kf.classList.toggle("on", fan);
  const fb = $("#fanBar");
  if (fb) fb.style.width = fan ? "100%" : "0%";
  setText("#fanSub", mode === "AUTO" ? `Tự động khi ≥ ${fmt1(t.fanOn)} °C` : "Điều khiển thủ công");

  setText("#kpiPump", pump ? "ON" : "OFF");
  const kp = $("#kpiPump");
  if (kp) kp.classList.toggle("on", pump);
  const pb = $("#pumpBar");
  if (pb) pb.style.width = pump ? "100%" : "0%";
  setText("#pumpSub", pump ? "Đang phun sương · relay CH1" : `Bơm ON < ${fmt1(t.rhOn)} %RH`);

  /* ---- Digital twin ---- */
  setText("#twinTemp", `${tempOk ? fmt1(temp) : "--"} °C`);
  setText("#twinHum", `${humOk ? fmt1(hum) : "--"} %`);
  setText("#twinUpdated", `Cập nhật ${clockNow(ts)}`);
  const tf = $("#twinFanPill");
  if (tf) {
    tf.textContent = fan ? "Quạt ON" : "Quạt OFF";
    tf.classList.toggle("on", fan);
  }
  const tp = $("#twinPumpPill");
  if (tp) {
    tp.textContent = pump ? "Bơm ON" : "Bơm OFF";
    tp.classList.toggle("on", pump);
  }
  const tl = $("#twinLampPill");
  if (tl) {
    tl.textContent = lamp ? "Đèn ON" : "Đèn OFF";
    tl.classList.toggle("on", lamp);
  }
  const tsd = $("#twinSensorDot");
  if (tsd) tsd.className = "tc-dot" + (sensorOk ? "" : " bad");
  setText("#twinSensorText", sensorOk ? "SHTC30 · hoạt động" : "SHTC30 · mất tín hiệu");

  const fanG = $(".twin-fan");
  if (fanG) fanG.classList.toggle("on", fan);
  const pumpG = $(".twin-pump");
  if (pumpG) pumpG.classList.toggle("on", pump);
  $$(".twin-lamp").forEach((g) => g.classList.toggle("on", lamp));

  const heat = $("#twinHeat");
  if (heat) heat.classList.toggle("hidden", !hot);
  const stage = $("#twinStage");
  if (stage) {
    stage.classList.toggle("hot", hot);
    stage.classList.toggle("cold", cold);
  }

  /* ---- System health ---- */
  setText("#healthRs", sensorOk ? "OK" : "Mất tín hiệu");
  setClass("#hRs", "ht-dot " + (sensorOk ? "ok" : "bad"));
  setText("#healthFail", estop ? "E-STOP" : sensorOk ? "Bình thường" : "Kiểm tra");
  setClass("#hFail", "ht-dot " + (estop ? "bad" : sensorOk ? "ok" : "warn"));
  setText("#healthMode", mode);
  setClass("#hMode", "ht-dot " + (mode === "MANUAL" ? "warn" : "info"));

  if (failed || !sensorOk || estop) {
    setText("#healthChip", failed ? "Mất kết nối" : estop ? "E-STOP" : "Cảnh báo");
    setClass("#healthChip", "chip " + (failed || estop ? "bad" : "warn"));
  } else {
    setText("#healthChip", "Ổn định");
    setClass("#healthChip", "chip ok");
  }

  /* ---- Controls ---- */
  $$("#modeSeg .seg-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
    b.disabled = estop;          // E-STOP khóa cả nút chọn chế độ
  });
  setText("#modeHint", mode === "AUTO"
    ? "HMI tự điều khiển theo ngưỡng nhiệt độ / độ ẩm."
    : "Đang ở MANUAL — lệnh từ ERP được gửi trực tiếp xuống relay.");

  const fanT = $("#fanToggle");
  if (fanT) {
    fanT.classList.toggle("on", fan);
    fanT.setAttribute("aria-pressed", String(fan));
    fanT.disabled = estop;
  }
  setText("#fanToggleLabel", fan ? "ON" : "OFF");
  const fd = $("#fanDot");
  if (fd) fd.classList.toggle("on", fan);

  const pumpT = $("#pumpToggle");
  if (pumpT) {
    pumpT.classList.toggle("on", pump);
    pumpT.setAttribute("aria-pressed", String(pump));
    pumpT.disabled = estop;
  }
  setText("#pumpToggleLabel", pump ? "ON" : "OFF");
  const pd = $("#pumpDot");
  if (pd) pd.classList.toggle("on", pump);

  const lampT = $("#lampToggle");
  if (lampT) {
    lampT.classList.toggle("on", lamp);
    lampT.setAttribute("aria-pressed", String(lamp));
    lampT.disabled = estop;
  }
  setText("#lampToggleLabel", lamp ? "ON" : "OFF");
  const ld = $("#lampDot");
  if (ld) ld.classList.toggle("on", lamp);

  const es = $("#estopState");
  if (es) {
    es.textContent = estop ? "E-STOP đang kích hoạt" : "Hệ thống an toàn";
    es.classList.toggle("bad", estop);
  }
  setText("#actuatorHint", estop
    ? "E-STOP đang khóa — giải phóng trước khi điều khiển."
    : mode === "AUTO"
      ? "Chuyển MANUAL để điều khiển thủ công."
      : "Đang điều khiển thủ công — thao tác ghi xuống relay.");

  const chain = $("#chainState");
  if (chain) {
    const bad = failed || estop;
    chain.textContent = estop ? "E-STOP" : failed ? "Mất kết nối" : "Sẵn sàng";
    chain.className = "chip " + (bad ? "bad" : "ok");
  }

  /* ---- Load distribution ---- */
  const lt = $("#loadTemp");
  if (lt) lt.style.width = (tempOk ? clamp(temp / 60) * 100 : 0) + "%";
  setText("#loadTempVal", tempOk ? `${fmt1(temp)} °C` : "--");
  const lh = $("#loadHum");
  if (lh) lh.style.width = (humOk ? clamp(hum / 100) * 100 : 0) + "%";
  setText("#loadHumVal", humOk ? `${fmt1(hum)} %` : "--");
  const lf = $("#loadFan");
  if (lf) lf.style.width = fan ? "100%" : "5%";
  setText("#loadFanVal", fan ? "ON" : "OFF");
  const lp = $("#loadPump");
  if (lp) lp.style.width = pump ? "100%" : "5%";
  setText("#loadPumpVal", pump ? "ON" : "OFF");
  const ll = $("#loadLamp");
  if (ll) ll.style.width = lamp ? "100%" : "5%";
  setText("#loadLampVal", lamp ? "ON" : "OFF");
  setText("#loadStamp", `Cập nhật ${clockNow(ts)}`);
  setText("#liveUpdated", `Cập nhật ${clockNow(ts)} · ${cfg.device}`);

  /* ---- devices + telemetry ---- */
  renderDevices();
  updateSyncUI();
  if (!failed && tempOk && humOk) pushTelemetry(d);
}

function pushTelemetry(d) {
  const ts = Number(d.ts) || Date.now();
  if (lastPushTs && ts <= lastPushTs) return;
  lastPushTs = ts;

  const humRaw = (d.humidity !== undefined && d.humidity !== null) ? d.humidity : d.moisture;
  telemetry.push({
    ts,
    temp: Number(d.temp),
    hum: Number(humRaw),
    fan: !!d.fan,
    pump: !!d.pump,
    lamp: !!d.lamp,
    mode: d.mode || "AUTO",
    sensor_ok: d.sensor_ok !== false,
  });
  if (telemetry.length > 300) telemetry.shift();
  telemetryDirty = true;

  if ($("#page-monitor") && $("#page-monitor").classList.contains("active")) renderMonitor();
  if ($("#page-reports") && $("#page-reports").classList.contains("active")) renderReports();
}

function seedTelemetry() {
  if (telemetry.length >= 10) return;
  const now = Date.now();
  telemetry = [];
  for (let i = 119; i >= 0; i--) {
    const t = (now - i * 4000) / 1000;
    const temp = 27.4 + 5.4 * Math.sin(t / 95) + Math.sin(t / 11) * 0.35 + (i % 43 === 0 ? 1.8 : 0);
    const hum = 43.2 + 5.6 * Math.sin(t / 38 + 1) + Math.sin(t / 4.5) * 0.6;
    telemetry.push({
      ts: now - i * 4000,
      temp: +temp.toFixed(1),
      hum: +hum.toFixed(1),
      fan: temp >= cfg.thresholds.fanOn,
      pump: hum <= cfg.thresholds.rhOn,
      lamp: temp <= cfg.thresholds.heatOn,
      mode: "AUTO",
      sensor_ok: true,
    });
  }
  telemetryDirty = true;
}

/** Trạng thái 1 dòng telemetry theo ngưỡng HMI. */
function rowStatus(r) {
  const t = cfg.thresholds;
  if (isNum(r.temp) && r.temp >= t.fanOn + 2) return "Cảnh báo";
  if (isNum(r.temp) && r.temp >= t.fanOn) return "Làm mát";
  if (isNum(r.hum) && r.hum < t.rhOn) return "Tưới";
  if (isNum(r.temp) && r.temp <= t.heatOn) return "Sưởi";
  return "Bình thường";
}

/* ------------------------------ biểu đồ ------------------------------ */
function setDashView(view) {
  dashView = view === "chart" ? "chart" : "twin";
  $$(".twin-tab").forEach((b) => {
    const on = b.dataset.view === dashView;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
  });
  const tv = $("#viewTwin");
  const cv = $("#viewChart");
  if (tv) tv.classList.toggle("hidden", dashView !== "twin");
  if (cv) cv.classList.toggle("hidden", dashView !== "chart");
  if (dashView === "chart") requestAnimationFrame(drawChart);
}

function drawChart() {
  drawLineChart($("#chart"), telemetry.slice(-60));
}

function drawReportChart() {
  drawLineChart($("#repChart"), telemetry);
}

function drawLineChart(cv, rows) {
  if (!cv || cv.offsetParent === null) return;
  const data = (rows || []).filter((r) => isNum(r.temp) && isNum(r.hum));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth || 640;
  const h = cv.clientHeight || 300;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const x0 = 42;
  const x1 = w - 44;
  const y0 = 16;
  const y1 = h - 28;

  ctx.font = '10px "Segoe UI", Arial, sans-serif';
  ctx.lineWidth = 1;

  for (let i = 0; i <= 4; i++) {
    const y = y0 + (y1 - y0) * (i / 4);
    ctx.strokeStyle = "#eef2f8";
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();

    ctx.fillStyle = "#94a3b8";
    ctx.textAlign = "right";
    ctx.fillText(String(100 - i * 25), x0 - 7, y + 3);
    ctx.textAlign = "left";
    ctx.fillText(String(60 - i * 15), x1 + 7, y + 3);
  }

  ctx.fillStyle = "#60a5fa";
  ctx.textAlign = "right";
  ctx.fillText("%RH", x0 - 7, y0 - 4);
  ctx.fillStyle = "#f59e0b";
  ctx.textAlign = "left";
  ctx.fillText("°C", x1 + 7, y0 - 4);
  ctx.textAlign = "left";

  const tCfg = cfg.thresholds;
  const humY = (v) => y1 - (y1 - y0) * clamp(v / 100);
  const tempY = (v) => y1 - (y1 - y0) * clamp(v / 60);

  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = "rgba(37, 99, 235, .45)";
  ctx.beginPath();
  ctx.moveTo(x0, humY(tCfg.rhOn));
  ctx.lineTo(x1, humY(tCfg.rhOn));
  ctx.stroke();
  ctx.strokeStyle = "rgba(239, 68, 68, .5)";
  ctx.beginPath();
  ctx.moveTo(x0, tempY(tCfg.fanOn));
  ctx.lineTo(x1, tempY(tCfg.fanOn));
  ctx.stroke();
  ctx.strokeStyle = "rgba(16, 185, 129, .45)";
  ctx.beginPath();
  ctx.moveTo(x0, tempY(tCfg.heatOn));
  ctx.lineTo(x1, tempY(tCfg.heatOn));
  ctx.stroke();
  ctx.setLineDash([]);

  if (data.length < 2) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = '12px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("Đang chờ dữ liệu từ HMI…", (x0 + x1) / 2, (y0 + y1) / 2);
    return;
  }

  const px = (i) => x0 + (x1 - x0) * (i / (data.length - 1));

  /* vùng độ ẩm */
  ctx.beginPath();
  ctx.moveTo(px(0), humY(data[0].hum));
  data.forEach((r, i) => ctx.lineTo(px(i), humY(r.hum)));
  ctx.lineTo(px(data.length - 1), y1);
  ctx.lineTo(px(0), y1);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, y0, 0, y1);
  grad.addColorStop(0, "rgba(37, 99, 235, .16)");
  grad.addColorStop(1, "rgba(37, 99, 235, 0)");
  ctx.fillStyle = grad;
  ctx.fill();

  /* đường độ ẩm */
  ctx.beginPath();
  data.forEach((r, i) => (i ? ctx.lineTo(px(i), humY(r.hum)) : ctx.moveTo(px(i), humY(r.hum))));
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();

  /* đường nhiệt độ */
  ctx.beginPath();
  data.forEach((r, i) => (i ? ctx.lineTo(px(i), tempY(r.temp)) : ctx.moveTo(px(i), tempY(r.temp))));
  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = 2;
  ctx.stroke();

  /* điểm cuối */
  const last = data[data.length - 1];
  [[humY(last.hum), "#2563eb"], [tempY(last.temp), "#f59e0b"]].forEach(([y, color]) => {
    ctx.beginPath();
    ctx.arc(px(data.length - 1), y, 3.4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px(data.length - 1), y, 6, 0, Math.PI * 2);
    ctx.strokeStyle = color + "33";
    ctx.lineWidth = 3;
    ctx.stroke();
  });

  /* nhãn thời gian */
  ctx.fillStyle = "#94a3b8";
  ctx.font = '9.5px "Segoe UI", Arial, sans-serif';
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const idx = Math.round((data.length - 1) * (i / ticks));
    const r = data[idx];
    if (!r) continue;
    const x = px(idx);
    ctx.textAlign = i === 0 ? "left" : i === ticks ? "right" : "center";
    ctx.fillText(clockNow(r.ts).slice(0, 5), x, y1 + 16);
  }
}

/* ============================== GIÁM SÁT ============================== */
function renderMonitor() {
  const body = $("#monBody");
  if (!body) return;
  const filter = ($("#monFilter") ? $("#monFilter").value : "").trim().toLowerCase();
  const arr = telemetry.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const enriched = arr.map((r) => {
    const status = rowStatus(r);
    const hay = [
      fmtDateTime(r.ts), r.temp, r.hum, r.mode, status,
      r.fan ? "quạt on bật" : "quạt off tắt",
      r.pump ? "bơm on bật" : "bơm off tắt",
      r.lamp ? "đèn on bật" : "đèn off tắt",
    ].join(" ").toLowerCase();
    return { r, status, hay };
  }).filter((x) => !filter || x.hay.includes(filter));

  const rows = enriched.slice(0, 250);
  setText("#monCount", telemetry.length);
  const last = telemetry[telemetry.length - 1];
  setText("#monLast", last ? clockNow(last.ts) : "--:--:--");
  setText("#monLastDate", last ? fmtDate(last.ts) : "--");
  setText("#monDevice", cfg.device);

  body.innerHTML = rows.map(({ r, status }) => {
    const tone = status === "Cảnh báo" ? "bad" : status === "Bình thường" ? "ok" : "warn";
    return `<tr>
      <td>${fmtDateTime(r.ts)}</td>
      <td class="num">${fmt1(r.temp)} °C</td>
      <td class="num">${fmt1(r.hum)} %</td>
      <td><span class="state-pill ${r.fan ? "" : "off"}">${r.fan ? "ON" : "OFF"}</span></td>
      <td><span class="state-pill ${r.pump ? "" : "off"}">${r.pump ? "ON" : "OFF"}</span></td>
      <td><span class="state-pill ${r.lamp ? "" : "off"}">${r.lamp ? "ON" : "OFF"}</span></td>
      <td><span class="badge ${r.mode === "MANUAL" ? "warn" : "info"}">${esc(r.mode)}</span></td>
      <td><span class="badge ${tone}">${status}</span></td>
    </tr>`;
  }).join("");

  const empty = $("#monEmpty");
  if (empty) empty.style.display = rows.length ? "none" : "block";
}

/* ============================== BÁO CÁO ============================== */
function renderReports() {
  const data = telemetry.filter((r) => isNum(r.temp) && isNum(r.hum));
  const n = data.length;

  if (!n) {
    ["#repTempAvg", "#repHumAvg", "#repTempMax"].forEach((s) => setText(s, "--"));
    setText("#repTempRange", "--");
    setText("#repHumRange", "--");
    setText("#repFanPct", "0%");
    setText("#repPumpPct", "0%");
    setText("#repLampPct", "0%");
    setText("#repPoints", "0");
    setText("#repUptime", "00:00");
    drawReportChart();
    return;
  }

  const temps = data.map((r) => r.temp);
  const hums = data.map((r) => r.hum);
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const tAvg = avg(temps);
  const hAvg = avg(hums);
  const tMax = Math.max(...temps);
  const tMin = Math.min(...temps);
  const hMax = Math.max(...hums);
  const hMin = Math.min(...hums);
  const fanPct = Math.round(data.filter((r) => r.fan).length / n * 100);
  const pumpPct = Math.round(data.filter((r) => r.pump).length / n * 100);
  const lampPct = Math.round(data.filter((r) => r.lamp).length / n * 100);

  setText("#repTempAvg", fmt1(tAvg));
  setText("#repTempRange", `${fmt1(tMin)} – ${fmt1(tMax)} °C`);
  setText("#repHumAvg", fmt1(hAvg));
  setText("#repHumRange", `${fmt1(hMin)} – ${fmt1(hMax)} %`);
  setText("#repUptime", fmtUptime(Date.now() - sessionStart));
  setText("#repPoints", n);
  setText("#repFanPct", fanPct + "%");
  setText("#repPumpPct", pumpPct + "%");
  setText("#repLampPct", lampPct + "%");
  setText("#repTempMax", fmt1(tMax));
  setText("#reportRange", `${fmtDateTime(data[0].ts)} → ${fmtDateTime(data[n - 1].ts)}`);

  drawReportChart();
}

/* ============================== THIẾT BỊ ============================== */
function renderDevices() {
  if (!$("#page-devices")) return;
  const d = lastLive;
  const recent = d && d.ts && Date.now() - Number(d.ts) < 20000;
  const sensorOk = !!d && d.sensor_ok !== false && recent;
  const fan = !!(d && d.fan);
  const pump = !!(d && d.pump);
  const lamp = !!(d && d.lamp);

  setText("#devSensorChip", sensorOk ? "Hoạt động" : "Mất tín hiệu");
  setClass("#devSensorChip", "chip " + (sensorOk ? "ok" : "bad"));
  setText("#devRelayChip", d ? "Trực tuyến" : "Chờ dữ liệu");
  setClass("#devRelayChip", "chip " + (d ? "ok" : "warn"));
  setText("#devBridgeChip", recent ? "Trực tuyến" : "Ngoại tuyến");
  setClass("#devBridgeChip", "chip " + (recent ? "ok" : "bad"));

  setText("#devSensorValue", d
    ? `${fmt1(d.temp)} °C · ${fmt1(d.humidity ?? d.moisture)} %RH`
    : "--");
  setText("#devRelayValue", d
    ? `CH1 ${pump ? "ON" : "OFF"} · CH2 ${fan ? "ON" : "OFF"} · CH3 ${lamp ? "ON" : "OFF"}`
    : "--");
  setText("#devBridgeId", cfg.device);
  setText("#devLastSeen", d ? `${relTime(d.ts)} · ${clockNow(d.ts)}` : "--");

  setText("#ch1State", pump ? "ON" : "OFF");
  const c1 = $("#ch1State");
  if (c1) c1.className = "state-pill" + (pump ? "" : " off");
  setText("#ch2State", fan ? "ON" : "OFF");
  const c2 = $("#ch2State");
  if (c2) c2.className = "state-pill" + (fan ? "" : " off");
  setText("#ch3State", lamp ? "ON" : "OFF");
  const c3 = $("#ch3State");
  if (c3) c3.className = "state-pill" + (lamp ? "" : " off");

  setText("#monDevice", cfg.device);
  setText("#setDeviceText", cfg.device);

  // E-STOP khóa mọi nút điều khiển tải (kể cả ở trang Thiết bị).
  const lock = estopActive();
  ["#ch1Toggle", "#ch2Toggle", "#ch3Toggle"].forEach((sel) => {
    const b = $(sel);
    if (b) b.disabled = lock;
  });
}

/* ============================== ĐIỀU KHIỂN ============================== */
function setAck(msg) {
  setText("#ackState", msg ? `${msg} · ${clockNow()}` : "Chưa có lệnh.");
}

/**
 * E-STOP đang hoạt động? Kiểm tra CẢ chế độ demo lẫn trạng thái thật từ HMI.
 * Bug cũ: chỉ xét demoOverride.estop nên ở chế độ thật (đã cấu hình Firebase)
 * các nút BẬT/TẮT tải vẫn gửi lệnh dù HMI đang E-STOP.
 */
function estopActive() {
  return !!demoOverride.estop || !!(lastLive && lastLive.estop);
}

async function applyControl(patch, msg) {
  const label = msg || "Lệnh điều khiển";

  if (API.mock) {
    Object.assign(demoOverride, patch);
    if (patch.mode === "AUTO") {
      demoOverride.fan = null;
      demoOverride.pump = null;
      demoOverride.lamp = null;
    }
    if (patch.estop === true) {
      demoOverride.mode = "MANUAL";
      demoOverride.fan = false;
      demoOverride.pump = false;
      demoOverride.lamp = false;
    }
    saveDemo();
    await loadDashboard();

    const seq = Date.now();
    const applied = {
      mode: demoOverride.mode, estop: !!demoOverride.estop,
      fan: !!(lastLive && lastLive.fan), pump: !!(lastLive && lastLive.pump),
      lamp: !!(lastLive && lastLive.lamp), connected: true, sensor_ok: true,
    };
    conn.pendingCmd = { seq, label, ts: seq };
    conn.lastCmdAck = {
      seq, ok: true, by: "hmi-demo", message: msg || "đã áp dụng",
      applied, ts: Date.now(),
    };
    conn.pendingCmd = null;
    pushConnEvent({ kind: "cmd", ...conn.lastCmdAck });
    setAck(`HMI ACK #${shortSeq(seq)}: ${msg || "đã áp dụng"}`);
    renderConnAck();
    updateSyncUI();
    renderConnection();
    if (msg) toast(msg, "ok");
    return true;
  }

  if (lastLive) lastLive = { ...lastLive, ...patch };
  renderLive();

  const seq = Date.now();
  conn.pendingCmd = { seq, label, ts: seq };
  setAck(`Đang chờ HMI ACK #${shortSeq(seq)}…`);
  renderConnAck();
  updateSyncUI();

  try {
    await API.put(`hmi/${cfg.device}/control`, {
      ...patch, by: "web-erp", ts: seq, seq,
    });
  } catch (e) {
    conn.pendingCmd = null;
    renderConnAck();
    toast("Không gửi được lệnh: " + e.message, "err");
    return false;
  }

  if (msg) toast(msg + " — đang chờ HMI xác nhận");
  loadDashboard();
  [400, 1200, 2600].forEach((ms) => {
    setTimeout(() => { loadConnMeta(true).catch(() => { }); }, ms);
  });
  return true;
}

function setMode(mode) {
  if (estopActive()) {
    toast("E-STOP đang kích hoạt — hãy giải phóng trước", "err");
    return;
  }
  const current = lastLive ? (lastLive.mode || "AUTO") : demoOverride.mode;
  if (mode === current && !demoOverride.estop) return;
  applyControl({ mode }, `Đã chuyển chế độ ${mode}`);
}

function toggleFan() {
  if (estopActive()) {
    toast("E-STOP đang kích hoạt — hãy giải phóng trước", "err");
    return;
  }
  const next = !(lastLive && lastLive.fan);
  applyControl({ mode: "MANUAL", fan: next },
    `Đã gửi lệnh ${next ? "BẬT" : "TẮT"} quạt 12V`);
}

function togglePump() {
  if (estopActive()) {
    toast("E-STOP đang kích hoạt — hãy giải phóng trước", "err");
    return;
  }
  const next = !(lastLive && lastLive.pump);
  applyControl({ mode: "MANUAL", pump: next },
    `Đã gửi lệnh ${next ? "BẬT" : "TẮT"} bơm phun sương CH1`);
}

function toggleLamp() {
  if (estopActive()) {
    toast("E-STOP đang kích hoạt — hãy giải phóng trước", "err");
    return;
  }
  const next = !(lastLive && lastLive.lamp);
  applyControl({ mode: "MANUAL", lamp: next },
    `Đã gửi lệnh ${next ? "BẬT" : "TẮT"} đèn halogen CH3`);
}

async function estopNow() {
  const ok = await applyControl(
    { estop: true, mode: "MANUAL", fan: false, pump: false, lamp: false },
    "E-STOP: đã dừng quạt, bơm và đèn"
  );
  if (ok) {
    addAlert("system", "E-STOP kích hoạt",
      "Dừng khẩn cấp từ ERP — quạt, bơm và đèn đã tắt.", { force: true });
  }
}

function releaseEstop() {
  if (!demoOverride.estop && lastLive && !lastLive.estop) {
    toast("Hệ thống không ở trạng thái E-STOP");
    return;
  }
  applyControl({ estop: false, mode: "AUTO" },
    "Đã giải phóng E-STOP — chuyển về AUTO");
}

function ackLatest() {
  const a = alerts.find((x) => !x.ack);
  if (!a) {
    setAck("");
    toast("Không có cảnh báo chưa ACK");
    return;
  }
  ackAlert(a.id, true);
  setAck(`Đã ACK: ${a.title}`);
  toast("Đã ACK cảnh báo", "ok");
}

/* ============================== CÀI ĐẶT ============================== */
function fillSettings() {
  if (!$("#setUrl")) return;
  $("#setUrl").value = cfg.url;
  $("#setSecret").value = cfg.secret;
  $("#setDevice").value = cfg.device;
  $("#setRegion").value = "asia-southeast1";
  $("#setRhOn").value = cfg.thresholds.rhOn;
  $("#setRhOff").value = cfg.thresholds.rhOff;
  $("#setFanOn").value = cfg.thresholds.fanOn;
  $("#setFanOff").value = cfg.thresholds.fanOff;
  $("#setHeatOn").value = cfg.thresholds.heatOn;
  $("#setHeatOff").value = cfg.thresholds.heatOff;
  $("#setPumpMax").value = cfg.thresholds.pumpMax;
  $("#setHeatMax").value = cfg.thresholds.heatMax;
  $("#setFailsafe").value = cfg.thresholds.failsafe;
  setText("#setDeviceText", cfg.device);
  setText("#syncAckSettings", conn.lastCfgAck ? (conn.lastCfgAck.ok ? "OK" : "Lỗi") : "--");
  setText("#syncSeq", conn.lastCfgAck ? shortSeq(conn.lastCfgAck.seq) : "--");

  setText("#dispModeText", cfg.display === "phone" ? "Phone / Tablet" : "Laptop / Desktop");
  $$("#displaySeg .seg-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.display === cfg.display);
  });

  $("#cfgHint").innerHTML = cfg.url
    ? `Đang dùng <code>${esc(cfg.url)}</code> · thiết bị <code>${esc(cfg.device)}</code>`
    : "Chưa có URL → app chạy ở chế độ DEMO (dữ liệu lưu trong trình duyệt).";

  updateSoundUI();
  setText("#setStatus", cfg.url ? "Đã cấu hình Firebase" : "DEMO (localStorage)");
  const ss = $("#setStatus");
  if (ss) ss.style.color = cfg.url ? "#047857" : "#b45309";
}

function readThresholds() {
  const t = {
    rhOn: Number($("#setRhOn").value),
    rhOff: Number($("#setRhOff").value),
    fanOn: Number($("#setFanOn").value),
    fanOff: Number($("#setFanOff").value),
    heatOn: Number($("#setHeatOn").value),
    heatOff: Number($("#setHeatOff").value),
    pumpMax: Number($("#setPumpMax").value),
    heatMax: Number($("#setHeatMax").value),
    failsafe: Number($("#setFailsafe").value),
  };
  if (Object.values(t).some((v) => isNaN(v))) {
    toast("Ngưỡng phải là số", "err");
    return null;
  }
  if (t.rhOff <= t.rhOn) {
    toast("Ngưỡng RH TẮT phải lớn hơn ngưỡng RH BẬT", "err");
    return null;
  }
  if (t.fanOff >= t.fanOn) {
    toast("Ngưỡng quạt TẮT phải nhỏ hơn ngưỡng BẬT", "err");
    return null;
  }
  if (t.heatOff <= t.heatOn) {
    toast("Ngưỡng sưởi TẮT phải lớn hơn ngưỡng BẬT", "err");
    return null;
  }
  if (t.pumpMax < 30 || t.pumpMax > 7200) {
    toast("Watchdog bơm phải trong khoảng 30 – 7200 giây", "err");
    return null;
  }
  if (t.heatMax < 30 || t.heatMax > 7200) {
    toast("Watchdog đèn phải trong khoảng 30 – 7200 giây", "err");
    return null;
  }
  if (t.failsafe < 1 || t.failsafe > 999) {
    toast("Failsafe timeout phải trong khoảng 1 – 999 chu kỳ", "err");
    return null;
  }
  if (t.heatOff >= t.fanOff) {
    toast("Ngưỡng đèn TẮT phải nhỏ hơn ngưỡng quạt TẮT", "err");
    return null;
  }
  return t;
}

async function syncThresholds() {
  const t = readThresholds();
  if (!t) return;
  cfg.thresholds = t;
  saveCfg();

  const payload = {
    rh_on: t.rhOn,
    rh_off: t.rhOff,
    fan_on: t.fanOn,
    fan_off: t.fanOff,
    heat_on: t.heatOn,
    heat_off: t.heatOff,
    pump_max_s: t.pumpMax,
    heat_max_s: t.heatMax,
    failsafe_cycles: t.failsafe,
  };
  const applied = { ...payload };
  const seq = Date.now();

  if (API.mock) {
    conn.remoteConfig = { ...payload, ts: seq, by: "web-erp" };
    if (lastLive) lastLive = { ...lastLive, ...payload };
    conn.lastCfgAck = {
      seq, ok: true, by: "hmi-demo", message: "Đã áp dụng ngưỡng (DEMO)",
      applied, ts: Date.now(),
    };
    pushConnEvent({ kind: "cfg", ...conn.lastCfgAck });
    setText("#syncAck", "OK");
    setText("#syncSeq", shortSeq(seq));
    setText("#syncState", `Đã áp dụng cấu hình lúc ${clockNow()}`);
    renderConnAck();
    renderConfigCompare();
    renderLive();
    renderConnection();
    fillSettings();
    toast("Đã đồng bộ cấu hình sang HMI (DEMO)", "ok");
    return;
  }

  conn.pendingCfg = { seq, ts: seq };
  setText("#syncState", `Đang gửi cấu hình #${shortSeq(seq)} — chờ HMI xác nhận…`);
  setText("#syncAck", "Đang chờ");
  setText("#syncSeq", shortSeq(seq));
  renderConnAck();
  updateSyncUI();

  try {
    await API.put(`hmi/${cfg.device}/config`, {
      ...payload, ts: seq, seq, by: "web-erp",
    });
    toast("Đã gửi cấu hình — đang chờ HMI xác nhận");
    [400, 1200, 2600, 5000].forEach((ms) => {
      setTimeout(() => { loadConnMeta(true).catch(() => { }); }, ms);
    });
  } catch (e) {
    conn.pendingCfg = null;
    setText("#syncState", "Gửi cấu hình thất bại: " + e.message);
    renderConnAck();
    toast("Không đồng bộ được: " + e.message, "err");
  }
}

function setDisplay(mode) {
  cfg.display = mode === "phone" ? "phone" : "laptop";
  saveCfg();
  document.body.classList.toggle("phone-mode", cfg.display === "phone");
  $$("#displaySeg .seg-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.display === cfg.display);
  });
  setText("#dispModeText", cfg.display === "phone" ? "Phone / Tablet" : "Laptop / Desktop");
  setTimeout(() => {
    drawChart();
    drawReportChart();
  }, 120);
}

/* ============================== XUẤT DỮ LIỆU ============================== */
function exportTelemetryCsv() {
  if (!telemetry.length) { toast("Chưa có dữ liệu telemetry", "err"); return; }
  const lines = ["Thời gian,Nhiệt độ (°C),Độ ẩm (%RH),Quạt,Bơm,Đèn,Chế độ,Trạng thái"];
  telemetry.forEach((r) => {
    const status = rowStatus(r);
    lines.push([
      fmtDateTime(r.ts), fmt1(r.temp), fmt1(r.hum),
      r.fan ? "ON" : "OFF", r.pump ? "ON" : "OFF", r.lamp ? "ON" : "OFF",
      r.mode, status,
    ].map(csvCell).join(","));
  });
  download(`telemetry-${todayISO()}.csv`,
    "\uFEFF" + lines.join("\r\n"), "text/csv;charset=utf-8");
  toast("Đã xuất CSV telemetry", "ok");
}

function exportAlertsCsv() {
  if (!alerts.length) { toast("Chưa có cảnh báo để xuất", "err"); return; }
  const lines = ["Thời gian,Loại,Tiêu đề,Nội dung,ACK"];
  alerts.forEach((a) => {
    lines.push([
      fmtDateTime(a.ts),
      (ALERT_META[a.kind] || ALERT_META.system).label,
      a.title, a.msg, a.ack ? "Đã ACK" : "Chưa ACK",
    ].map(csvCell).join(","));
  });
  download(`canh-bao-${todayISO()}.csv`,
    "\uFEFF" + lines.join("\r\n"), "text/csv;charset=utf-8");
  toast("Đã xuất CSV cảnh báo", "ok");
}

async function exportAllJson() {
  const payload = {
    exportedAt: new Date().toISOString(),
    device: cfg.device,
    thresholds: cfg.thresholds,
    telemetry,
    alerts,
  };
  download(`agri-erp-${todayISO()}.json`,
    JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
  toast("Đã xuất JSON toàn bộ", "ok");
}

/* ============================== TÌM KIẾM ============================== */
const SEARCH_DEVICES = [
  { title: "SHTC30", sub: "Cảm biến nhiệt độ / độ ẩm · RS-485", icon: "hum" },
  { title: "Relay 3 kênh", sub: "CH1 bơm · CH2 quạt · CH3 đèn · Modbus slave 255", icon: "cpu" },
  { title: "HMI Bridge", sub: "Laptop vận hành · Python + PyQt5", icon: "monitor" },
  { title: "Firebase RTDB", sub: "Đồng bộ đám mây ERP ↔ HMI", icon: "db" },
];

function hideSearch() {
  const box = $("#searchResults");
  if (box) box.classList.add("hidden");
}

function doSearch() {
  const input = $("#globalSearch");
  const box = $("#searchResults");
  if (!input || !box) return;
  const q = input.value.trim().toLowerCase();
  if (!q) { hideSearch(); return; }

  const items = [];
  Object.entries(PAGE_META).forEach(([tab, meta]) => {
    if ((meta.label + " " + meta.kw).toLowerCase().includes(q)) {
      items.push({
        icon: tab === "dashboard" ? "grid" : tab === "monitor" ? "monitor"
          : tab === "alerts" ? "bell" : tab === "devices" ? "cpu"
          : tab === "reports" ? "chart" : tab === "settings" ? "settings"
          : "grid",
        title: meta.label, sub: "Đi tới trang", go: "page:" + tab,
      });
    }
  });
  alerts.forEach((a) => {
    if (items.length >= 9) return;
    if ((a.title + " " + a.msg).toLowerCase().includes(q)) {
      items.push({
        icon: (ALERT_META[a.kind] || ALERT_META.system).icon,
        title: a.title, sub: `${relTime(a.ts)} · ${a.ack ? "Đã ACK" : "Chưa ACK"}`,
        go: "alerts",
      });
    }
  });
  SEARCH_DEVICES.forEach((d) => {
    if (items.length >= 11) return;
    if ((d.title + " " + d.sub).toLowerCase().includes(q)) {
      items.push({ icon: d.icon, title: d.title, sub: d.sub, go: "devices" });
    }
  });

  box.innerHTML = items.length
    ? items.slice(0, 10).map((it) => `
      <button class="search-item" data-go="${esc(it.go)}">
        <span class="si-ico"><svg class="ic"><use href="#i-${it.icon}"></use></svg></span>
        <span><b>${esc(it.title)}</b><small>${esc(it.sub)}</small></span>
      </button>`).join("")
    : '<div class="search-empty">Không tìm thấy kết quả phù hợp.</div>';
  box.classList.remove("hidden");
}

/* ============================== MODAL ============================== */
let modalSave = null;

function field(label, inputHtml) {
  return `<label class="f"><span>${label}</span>${inputHtml}</label>`;
}

function openModal(title, html, onSave, onMount) {
  setText("#modalTitle", title);
  $("#modalBody").innerHTML = html;
  $("#modalSave").style.display = onSave ? "" : "none";
  setText("#modalCancel", onSave ? "Hủy" : "Đóng");
  $("#modal").classList.remove("hidden");
  modalSave = onSave;
  if (onMount) onMount();
  setTimeout(() => {
    const first = $("#modalBody input, #modalBody select");
    if (first) first.focus();
  }, 40);
}

function closeModal() {
  $("#modal").classList.add("hidden");
  modalSave = null;
}

/* ============================== VÒNG QUAY / KHỞI ĐỘNG ============================== */
function tickClock() {
  setText("#clock", clockNow());
  if ($("#page-reports") && $("#page-reports").classList.contains("active")) {
    setText("#repUptime", fmtUptime(Date.now() - sessionStart));
  }
}

function saveTelemetryTick() {
  if (!telemetryDirty) return;
  try {
    localStorage.setItem(TEL_KEY, JSON.stringify(telemetry.slice(-300)));
    telemetryDirty = false;
  } catch (e) { }
}

async function poll() {
  if (document.hidden || polling) return;
  polling = true;
  try {
    await loadDashboard();
    checkPendingTimeouts();
  } catch (e) { } finally { polling = false; }
}

function init() {
  document.body.classList.toggle("phone-mode", cfg.display === "phone");
  updateSoundUI();

  if (API.mock) {
    setConn("wait", "DEMO · dữ liệu lưu trên máy này");
    seedTelemetry();
    seedAlerts();
    ensureDemoMeta();
  } else {
    setConn("wait", "Đang kết nối Firebase…");
  }
  fillSettings();
  renderAlerts();

  const hashTab = location.hash.replace(/^#/, "");
  showTab(TABS.includes(hashTab) ? hashTab : "dashboard", { keepScroll: true });
  loadDashboard();

  tickClock();
  clearInterval(window.__pvClock);
  window.__pvClock = setInterval(tickClock, 1000);

  clearInterval(pollTimer);
  pollTimer = setInterval(poll, 2000);
  setInterval(saveTelemetryTick, 5000);
  setInterval(() => {
    if ($("#page-alerts").classList.contains("active")) renderAlerts();
  }, 15000);

  setInterval(() => {
    if (!$("#page-connection") || !$("#page-connection").classList.contains("active")) return;
    loadLogs();
    loadConnMeta();
    drawLatencyChart();
  }, 6000);
  setInterval(loadHistory, 30000);

  window.addEventListener("resize", () => {
    if (dashView === "chart") drawChart();
    drawReportChart();
    drawLatencyChart();
  });

  setTimeout(() => {
    drawChart();
    drawReportChart();
  }, 200);
}

/* ============================== SỰ KIỆN ============================== */
$$(".twin-tab").forEach((b) => {
  b.addEventListener("click", () => setDashView(b.dataset.view));
});

$$("#modeSeg .seg-btn").forEach((b) => {
  b.addEventListener("click", () => setMode(b.dataset.mode));
});

$$("#displaySeg .seg-btn").forEach((b) => {
  b.addEventListener("click", () => setDisplay(b.dataset.display));
});

$$("#alertFilters .filter-chip").forEach((b) => {
  b.addEventListener("click", () => {
    alertFilter = b.dataset.filter;
    $$("#alertFilters .filter-chip").forEach((x) => x.classList.toggle("active", x === b));
    renderAlerts();
  });
});

document.addEventListener("click", (e) => {
  const ack = e.target.closest("[data-ack]");
  if (ack) ackAlert(ack.dataset.ack);
});

$("#btnAllAlerts").addEventListener("click", () => showTab("alerts"));
$("#btnBell").addEventListener("click", () => showTab("alerts"));
$("#btnAckAll").addEventListener("click", ackAll);
$("#btnAck").addEventListener("click", ackLatest);
$("#btnEstop").addEventListener("click", estopNow);
$("#btnRelease").addEventListener("click", releaseEstop);
$("#fanToggle").addEventListener("click", toggleFan);
$("#pumpToggle").addEventListener("click", togglePump);
$("#lampToggle").addEventListener("click", toggleLamp);
$("#ch1Toggle").addEventListener("click", togglePump);
$("#ch2Toggle").addEventListener("click", toggleFan);
$("#ch3Toggle").addEventListener("click", toggleLamp);
$("#soundCard").addEventListener("click", () => setSound(!soundOn));
$("#btnSound2").addEventListener("click", () => setSound(!soundOn));
$("#btnTestSound").addEventListener("click", () => { beep(1); toast("Đã phát bíp thử", "ok"); });

$("#btnCopyRules").addEventListener("click", async () => {
  const text = ($("#rulesCode")?.textContent || "").trim();
  try {
    await navigator.clipboard.writeText(text);
    toast("Đã sao chép Rules — dán vào Firebase Console", "ok");
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast("Đã sao chép Rules — dán vào Firebase Console", "ok");
    } catch (err) {
      toast("Không sao chép được — chọn thủ công trong khung Rules", "err");
    }
    ta.remove();
  }
});

$("#btnTopRefresh").addEventListener("click", async () => {
  await loadDashboard();
  renderMonitor();
  renderReports();
  toast("Đã làm mới dữ liệu", "ok");
});

$("#btnMonRefresh").addEventListener("click", () => { renderMonitor(); toast("Đã làm mới bảng telemetry", "ok"); });
$("#btnMonExport").addEventListener("click", exportTelemetryCsv);
$("#monFilter").addEventListener("input", renderMonitor);
$("#btnDevRefresh").addEventListener("click", async () => {
  await loadDashboard();
  renderDevices();
  toast("Đã quét lại thiết bị", "ok");
});

/* ---- trang Kết nối ---- */
$("#btnSyncDetail").addEventListener("click", () => showTab("connection"));
$("#btnReleaseBanner").addEventListener("click", releaseEstop);

$("#btnConnRefresh").addEventListener("click", async () => {
  await loadConnection();
  toast("Đã làm mới chẩn đoán kết nối", "ok");
});

$("#btnConnPing").addEventListener("click", async () => {
  const btn = $("#btnConnPing");
  btn.disabled = true;
  try {
    conn.lastMeta = 0;
    conn.lastLogs = 0;
    await loadDashboard();
    await loadConnMeta(true);
    await loadLogs(true);
    renderConnection();
    if (conn.fetchOk) toast(`Firebase OK · ${conn.rtt != null ? Math.round(conn.rtt) + " ms" : "--"}`, "ok");
    else toast(conn.lastError || "Không kết nối được Firebase", "err");
  } finally {
    btn.disabled = false;
  }
});

$("#btnConnLogs").addEventListener("click", () => loadLogs(true));
$("#btnConnAuto").addEventListener("click", () => setMode("AUTO"));
$("#btnConnEstop").addEventListener("click", estopNow);
$("#btnConnSync").addEventListener("click", syncThresholds);
$("#btnOpenConnection").addEventListener("click", () => showTab("connection"));

$("#btnExpTelemetry").addEventListener("click", exportTelemetryCsv);
$("#btnExpAlerts").addEventListener("click", exportAlertsCsv);
$("#btnExpAll").addEventListener("click", exportAllJson);

$("#btnSaveCfg").addEventListener("click", async () => {
  cfg.url = $("#setUrl").value.trim().replace(/\/+$/, "");
  cfg.secret = $("#setSecret").value.trim();
  cfg.device = $("#setDevice").value.trim() || "vuon-1";
  saveCfg();
  fillSettings();
  lastPushTs = 0;
  conn.fetchOk = false;
  conn.online = false;
  conn.rtt = null;
  conn.rttHistory = [];
  conn.status = null;
  conn.remoteConfig = null;
  conn.lastCmdAck = null;
  conn.lastCfgAck = null;
  conn.logs = [];
  conn.events = [];
  conn.lastMeta = 0;
  conn.lastLogs = 0;
  conn.lastHistory = 0;

  if (!cfg.url) {
    setConn("wait", "DEMO · dữ liệu lưu trên máy này");
    toast("Chưa có URL → đang dùng DEMO", "ok");
    await loadDashboard();
    return;
  }

  setConn("wait", "Đang kiểm tra…");
  try {
    await API.put("hmi/" + cfg.device + "/web_ping", { ts: Date.now() });
    setConn("ok", "Firebase OK · " + cfg.device);
    toast("Kết nối Firebase thành công", "ok");
    await loadDashboard();
  } catch (e) {
    setConn("err", e.message);
    toast(e.message, "err");
  }
});

$("#btnMock").addEventListener("click", () => {
  cfg.url = "";
  cfg.secret = "";
  saveCfg();
  demoOverride = { mode: "AUTO", fan: null, pump: null, lamp: null, estop: false };
  saveDemo();
  telemetry = [];
  lastPushTs = 0;
  conn.status = null;
  conn.remoteConfig = null;
  conn.lastCmdAck = null;
  conn.lastCfgAck = null;
  conn.pendingCmd = null;
  conn.pendingCfg = null;
  conn.logs = [];
  conn.events = [];
  conn.rttHistory = [];
  conn.rtt = null;
  conn.lastMeta = 0;
  conn.lastLogs = 0;
  conn.lastHistory = 0;
  try { localStorage.removeItem(TEL_KEY); } catch (e) { }
  seedTelemetry();
  seedAlerts();
  ensureDemoMeta();
  fillSettings();
  setConn("wait", "DEMO · dữ liệu lưu trên máy này");
  loadDashboard();
  renderAlerts();
  renderMonitor();
  renderReports();
  renderConnection();
  toast("Đang chạy DEMO — dữ liệu lưu trên máy này", "ok");
});

$("#btnSyncCfg").addEventListener("click", syncThresholds);

$("#btnHelp").addEventListener("click", () => {
  openModal("Trợ giúp nhanh", `
    <div class="hint" style="font-size:12px;line-height:1.75">
      <p><b>AGRI ERP · SCADA HMI khí hậu</b> giám sát phòng trồng qua HMI SHTC30 và Firebase.</p>
      <p style="margin-top:8px">• <b>Dashboard</b>: KPI, Digital Twin nhà trồng, System Health, điều khiển từ xa.</p>
      <p>• <b>Giám sát</b>: bảng telemetry mới nhất, lọc và xuất CSV.</p>
      <p>• <b>Cảnh báo</b>: phân loại nhiệt độ cao / nhiệt độ thấp / độ ẩm / hệ thống, ACK từng mục.</p>
      <p>• <b>Thiết bị</b>: trạng thái SHTC30, relay 3 kênh (bơm / quạt / đèn), HMI Bridge, Firebase.</p>
      <p>• <b>Báo cáo</b>: thống kê vận hành, xuất CSV/JSON.</p>
      <p>• <b>Cài đặt</b>: URL Firebase, ngưỡng AUTO (RH 40/45 · quạt 32/30 · sưởi 22/25), âm thanh.</p>
      <p style="margin-top:10px;color:#94a3b8">Phím tắt: Ctrl+K để tìm kiếm · Esc để đóng.</p>
    </div>`);
});

$("#modalCancel").addEventListener("click", closeModal);
$("#modalClose").addEventListener("click", closeModal);
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
$("#modalSave").addEventListener("click", async () => {
  if (!modalSave) return;
  const btn = $("#modalSave");
  btn.disabled = true;
  try {
    const r = await modalSave();
    if (r !== false) closeModal();
  } catch (e) {
    toast(e.message, "err");
  } finally {
    btn.disabled = false;
  }
});

$("#globalSearch").addEventListener("input", doSearch);
$("#globalSearch").addEventListener("focus", doSearch);
$("#searchResults").addEventListener("click", (e) => {
  const b = e.target.closest("[data-go]");
  if (!b) return;
  const go = b.dataset.go;
  if (go.startsWith("page:")) showTab(go.slice(5));
  else if (go === "alerts") showTab("alerts");
  else if (go === "devices") showTab("devices");
  $("#globalSearch").value = "";
  hideSearch();
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".searchbox")) hideSearch();
});

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    $("#globalSearch").focus();
    $("#globalSearch").select();
  }
  if (e.key === "Escape") {
    hideSearch();
    if (!$("#modal").classList.contains("hidden")) closeModal();
  }
});

window.addEventListener("beforeunload", saveTelemetryTick);

/* chạy */
init();

