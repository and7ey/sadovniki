/**
 * Живая синхронизация с Home Assistant.
 *
 * Работает, когда страница открыта с того же адреса, что и HA
 * (например /local/apartment/): берёт сессию из localStorage['hassTokens'].
 * Резервные варианты для отладки: ?token=<long-lived token>
 * или window.__APT_LIVE__ = { token, url }.
 *
 * Пока только чтение: свет в сцене отражает реальные состояния.
 */

const WS_PATH = "/api/websocket";

// диагностика из консоли: __live.connected / __live.states
window.__live = { connected: false, states: 0, last: null };

function hassBase() {
  const cfg = window.__APT_LIVE__ || {};
  if (cfg.url) return cfg.url.replace(/\/$/, "");
  return location.origin;
}

function readTokens() {
  const cfg = window.__APT_LIVE__ || {};
  if (cfg.token) return { access_token: cfg.token, clientId: null, fromConfig: true };
  const q = new URLSearchParams(location.search);
  if (q.get("token")) return { access_token: q.get("token"), clientId: null, fromConfig: true };
  try {
    const raw = localStorage.getItem("hassTokens");
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (!t || !t.access_token) return null;
    return t;
  } catch (e) {
    return null;
  }
}

async function refreshTokens(tokens) {
  if (!tokens.refresh_token) return null;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  });
  if (tokens.clientId) body.set("client_id", tokens.clientId);
  const res = await fetch(hassBase() + "/auth/token", { method: "POST", body });
  if (!res.ok) return null;
  const data = await res.json();
  const next = { ...tokens, ...data, expires: Date.now() + (data.expires_in || 1800) * 1000 };
  try { localStorage.setItem("hassTokens", JSON.stringify(next)); } catch (e) {}
  return next;
}

// уличная погода и температуры по комнатам
const WEATHER_ENTITY = "weather.yandex_pogoda";
const TEMP_SENSORS = {
  living: ["sensor.thermostat_hall_1_local_temperature", "sensor.thermostat_hall_2_local_temperature"],
  bedroom: ["sensor.thermostat_bedroom_local_temperature"],
  kitchen: ["sensor.thermostat_kitchen_local_temperature"],
  kids: ["sensor.thermostat_nursery_local_temperature"],
  bath: ["sensor.ble_temperature_mi_meteo_bathroom"],
  balcony: ["sensor.ble_temperature_mi_meteo_balcony"],
  hall: ["sensor.meteo_hall_temperature"],
};

const WEATHER_ICON = {
  sunny: ["sunny", "Ясно"],
  clear: ["sunny", "Ясно"],
  "clear-night": ["sunny", "Ясно"],
  partlycloudy: ["partly", "Малооблачно"],
  cloudy: ["cloudy", "Облачно"],
  fog: ["cloudy", "Туман"],
  rainy: ["rain", "Дождь"],
  pouring: ["rain", "Ливень"],
  lightning: ["rain", "Гроза"],
  "lightning-rainy": ["rain", "Гроза"],
  snowy: ["rain", "Снег"],
  "snowy-rainy": ["rain", "Мокрый снег"],
  hail: ["rain", "Град"],
  windy: ["partly", "Ветер"],
  exceptional: ["cloudy", "—"],
};

function num(v) {
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function syncWeather(viewer, states) {
  const w = states[WEATHER_ENTITY];
  if (!w) return;
  const meta = WEATHER_ICON[w.state] || ["cloudy", ""];
  const temp = w.attributes && w.attributes.temperature;
  viewer.weather({ temp, state: meta[1] || w.state, icon: meta[0] });
}

const AVG_TEMP_ENTITY = "sensor.apartment_average_temperature";

// пылесос: показываем только когда он реально убирается
const VACUUM_ENTITY = "vacuum.roborock_s7";
const VACUUM_ROOM_ENTITY = "sensor.roborock_s7_current_room";
const VACUUM_ACTIVE = new Set(["cleaning", "returning", "paused", "spot_cleaning", "zone_cleaning", "segment_cleaning"]);
const ROOM_BY_NAME = {
  "Гостиная": "living",
  "Спальня": "bedroom",
  "Детская": "kids",
  "Кухня": "kitchen",
  "Ванная": "bath",
  "Туалет": "wc",
  "Санузел": "wc",
  "Прихожая": "hall",
  "Коридор": "hall",
  "Гардероб": "bedroom",
};

// координаты робота: roborock.get_vacuum_current_position (единицы карты)
const POS_SERVICE = { domain: "roborock", service: "get_vacuum_current_position" };
let posMsgId = 500;
let vacuumActive = false;
let posTimer = null;

// калибровка «единицы карты -> мировые координаты сцены»:
// xw = ox + (x * cos + y * sin) * scale ; zw = oz + (-x * sin + y * cos) * scale
function loadCal() {
  try {
    const raw = localStorage.getItem('apt-vacuum-cal');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return (window.__APT_LIVE__ || {}).vacuumCal || null;
}

function mapToWorld(x, y) {
  const cal = loadCal();
  if (!cal) return;
  const rad = (cal.rot || 0) * Math.PI / 180;
  const c = Math.cos(rad), s2 = Math.sin(rad);
  return [cal.ox + (x * c + y * s2) * cal.scale, cal.oz + (-x * s2 + y * c) * cal.scale];
}

function requestPosition() {
  if (!socket || socket.readyState !== 1) return;
  socket.send(JSON.stringify({
    id: posMsgId++,
    type: "call_service",
    domain: POS_SERVICE.domain,
    service: POS_SERVICE.service,
    service_data: {},
    target: { entity_id: "vacuum.roborock_s7" },
    return_response: true,
  }));
}

function syncVacuum(viewer, states) {
  const v = states[VACUUM_ENTITY];
  if (!v) return;
  const active = VACUUM_ACTIVE.has(v.state);
  if (viewer.setVacuumVisible) viewer.setVacuumVisible(active);
  if (active !== vacuumActive) {
    vacuumActive = active;
    if (active) {
      requestPosition();
      if (posTimer) clearInterval(posTimer);
      posTimer = setInterval(requestPosition, 10000);
    } else if (posTimer) {
      clearInterval(posTimer);
      posTimer = null;
    }
  }
  if (!active) return;
  const room = states[VACUUM_ROOM_ENTITY];
  if (room) window.__live.vacuumRoom = room.state;
  if (room && viewer.vacuumToRoom) {
    const id = ROOM_BY_NAME[room.state];
    if (id) viewer.vacuumToRoom(id);
  }
}

function syncTemps(viewer, states) {
  const avg = states[AVG_TEMP_ENTITY];
  if (avg) {
    const v = num(avg.state);
    if (v !== null && viewer.setApartmentAverage) viewer.setApartmentAverage(v);
  }
  for (const [room, sensors] of Object.entries(TEMP_SENSORS)) {
    const vals = [];
    for (const e of sensors) {
      const s = states[e];
      if (!s) continue;
      const v = num(s.state);
      if (v !== null) vals.push(v);
    }
    if (!vals.length) continue;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    viewer.setRoomTemp(room, Math.round(avg * 10) / 10);
  }
}

function stateOf(states, entity) {
  const s = states[entity];
  return s ? s.state : undefined;
}

const SYNC_KEYS = [
  ["led", "living", "switch.light_hall_l2"],
  ["track", "living", "switch.light_hall_l1"],
  ["led", "kids", "switch.light_nursery_l2"],
  ["track", "kids", "switch.light_nursery_l1"],
  ["led", "kitchen", "light.switch_kitchen_led"],
  ["track", "kitchen", "switch.switch_kitchen_set_light_l1"],
  ["led", "hall", "switch.light_bedroom"],
  ["track", "corridor", "switch.light_lobby_track"],
  ["track", "bath", "switch.switch_bathroom_l1"],
  ["led", "bath", "switch.switch_bathroom_l2"],
  ["track", "wc", "switch.light_toilet_l2"],
  ["led", "wc", "switch.light_toilet_l1"],
  ["track", "balcony", "light.light_balcony_1"],
];

function stateKey(kind, room) {
  return kind + room[0].toUpperCase() + room.slice(1);
}

function applyStates(viewer, states) {
  for (const [kind, room, entity] of SYNC_KEYS) {
    const st = stateOf(states, entity);
    if (st === undefined) continue;
    if (st !== "on" && st !== "off") continue; // unavailable/unknown не трогаем
    const on = st === "on";
    if (viewer.lightState[stateKey(kind, room)] === on) continue;
    viewer.setLight(kind, room, on);
  }
}

function waitViewer() {
  return new Promise((resolve) => {
    let n = 0;
    const tick = () => {
      if (window.__viewer) return resolve(window.__viewer);
      if (++n > 600) return resolve(null);   // ~2 минуты
      setTimeout(tick, 200);
    };
    tick();
  });
}

let socket = null;
let msgId = 10;

function send(payload) {
  if (!socket || socket.readyState !== 1) return false;
  socket.send(JSON.stringify(payload));
  return true;
}

/* Калибровка по точкам.
   Пока пылесос стоит в известном месте, набрать в консоли:
     __viewer.calibPoint(мировойX, мировойZ)
   два раза в разных местах — матрица посчитается и запомнится. */
const calibPairs = [];

function fitSimilarity(pairs) {
  // pairs: [[mapX, mapY, worldX, worldZ], ...]
  const n = pairs.length;
  const mx = pairs.reduce((a,p)=>a+p[0],0)/n, my = pairs.reduce((a,p)=>a+p[1],0)/n;
  const wx = pairs.reduce((a,p)=>a+p[2],0)/n, wz = pairs.reduce((a,p)=>a+p[3],0)/n;
  let num = 0, den = 0;
  for (const [px, py, qx, qz] of pairs) {
    num += (px-mx)*(qx-wx) + (py-my)*(qz-wz);
    den += (px-mx)**2 + (py-my)**2;
  }
  if (den < 1e-6) return null;
  const scale = num/den;
  // поворот: R * (p - m) = q - w  (2D similarity, без отражения)
  let sa = 0, ca = 0;
  for (const [px, py, qx, qz] of pairs) {
    const ux = px-mx, uy = py-my, vx = qx-wx, vz = qz-wz;
    sa += ux*vz - uy*vx;
    ca += ux*vx + uy*vz;
  }
  const ang = Math.atan2(sa, ca);
  const ox = wx - scale*(Math.cos(ang)*mx - Math.sin(ang)*my);
  const oz = wz - scale*(Math.sin(ang)*mx + Math.cos(ang)*my);
  return { scale, rot: ang*180/Math.PI, ox, oz };
}

window.__viewer = window.__viewer || {};
function attachCalib(viewer) {
  viewer.calibPoint = (wx, wz) => {
    const p = window.__live && window.__live.vacuumPos;
    if (!p) { console.warn('[calib] нет координат пылесоса — он должен убираться'); return null; }
    calibPairs.push([p.map[0], p.map[1], wx, wz]);
    console.info('[calib] точка', calibPairs.length, 'map', p.map, '-> world', [wx, wz]);
    if (calibPairs.length >= 2) {
      const cal = fitSimilarity(calibPairs);
      if (cal) {
        localStorage.setItem('apt-vacuum-cal', JSON.stringify(cal));
        console.info('[calib] готово', cal, '— сохранено в localStorage');
      }
    }
    return calibPairs.length;
  };
  viewer.calibReset = () => { calibPairs.length = 0; localStorage.removeItem('apt-vacuum-cal'); console.info('[calib] сброшено'); };
}

// доступно сцене: управление реальными реле
window.__ha = {
  connected: false,
  call(domain, service, entity, data) {
    return send({
      id: msgId++,
      type: "call_service",
      domain,
      service,
      service_data: data || {},
      target: entity ? { entity_id: entity } : undefined,
    });
  },
  runScript(entity) {
    const ok = this.call("script", "turn_on", entity);
    console.info("[live] script", entity, ok ? "" : "(нет соединения)");
    return ok;
  },
  toggle(entity, on) {
    const domain = entity.split(".")[0];
    const ok = send({
      id: msgId++,
      type: "call_service",
      domain,
      service: on ? "turn_on" : "turn_off",
      target: { entity_id: entity },
    });
    console.info("[live] ->", entity, on ? "on" : "off", ok ? "" : "(нет соединения)");
    return ok;
  },
};

export async function startLive() {
  const viewer = await waitViewer();
  if (viewer && !viewer.calibPoint) attachCalib(viewer);
  if (!viewer) {
    console.info("[live] сцена не загрузилась — синхронизация не запущена");
    return;
  }
  let tokens = readTokens();
  if (!tokens) {
    console.info("[live] нет сессии Home Assistant — работаем без синхронизации");
    return;
  }
  if (tokens.expires && tokens.expires < Date.now() + 30000) {
    tokens = (await refreshTokens(tokens)) || tokens;
  }

  const base = hassBase();
  const wsUrl = base.replace(/^http/, "ws") + WS_PATH;
  const states = {};

  const connect = () => {
    const ws = new WebSocket(wsUrl);
    socket = ws;
    window.__ha.connected = false;

    ws.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }

      if (msg.type === "auth_required") {
        ws.send(JSON.stringify({ type: "auth", access_token: tokens.access_token }));
        return;
      }
      if (msg.type === "auth_invalid") {
        console.warn("[live] токен отклонён");
        ws.close();
        return;
      }
      if (msg.type === "auth_ok") {
        window.__live.connected = true;
        window.__ha.connected = true;
        console.info("[live] подключено к Home Assistant");
        ws.send(JSON.stringify({ id: 1, type: "get_states" }));
        ws.send(JSON.stringify({ id: 2, type: "subscribe_events", event_type: "state_changed" }));
        return;
      }
      if (msg.type === "result" && msg.id >= 500 && msg.id < 600) {
        const resp = (msg.result && msg.result.response) || {};
        const pos = resp["vacuum.roborock_s7"];
        if (pos && typeof pos.x === "number") {
          const w = mapToWorld(pos.x, pos.y);
          window.__live.vacuumPos = { map: [pos.x, pos.y], world: w };
          const room = window.__live.vacuumRoom || '?';
          console.info('[vacuum] map', pos.x, pos.y, 'room', room);
          if (w && viewer.setVacuumPosition) viewer.setVacuumPosition(w[0], w[1]);
        }
        return;
      }
      if (msg.type === "result" && msg.id >= 10) {
        window.__ha.lastResult = { id: msg.id, success: !!msg.success, error: msg.error || null };
        return;
      }
      if (msg.type === "result" && msg.id === 1 && Array.isArray(msg.result)) {
        for (const s of msg.result) states[s.entity_id] = s;
        window.__live.states = msg.result.length;
        applyStates(viewer, states);
        syncTemps(viewer, states);
        syncWeather(viewer, states);
        syncVacuum(viewer, states);
        setInterval(() => { syncTemps(viewer, states); syncWeather(viewer, states); }, 60000);
        return;
      }
      if (msg.type === "event" && msg.event && msg.event.event_type === "state_changed") {
        const d = msg.event.data;
        states[d.entity_id] = d.new_state;
        window.__live.last = d.entity_id + '=' + d.new_state.state;
        applyStates(viewer, states);
        if (d.entity_id === WEATHER_ENTITY) syncWeather(viewer, states);
        if (d.entity_id === VACUUM_ENTITY || d.entity_id === VACUUM_ROOM_ENTITY) syncVacuum(viewer, states);
        syncTemps(viewer, states);
      }
    });

    ws.addEventListener("close", () => {
      window.__ha.connected = false;
      setTimeout(async () => {
        tokens = (await refreshTokens(tokens)) || tokens;
        connect();
      }, 5000);
    });
    ws.addEventListener("error", () => {});
  };

  connect();
}

startLive();
