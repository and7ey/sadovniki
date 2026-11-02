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

export async function startLive() {
  const viewer = await waitViewer();
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
        console.info("[live] подключено к Home Assistant");
        ws.send(JSON.stringify({ id: 1, type: "get_states" }));
        ws.send(JSON.stringify({ id: 2, type: "subscribe_events", event_type: "state_changed" }));
        return;
      }
      if (msg.type === "result" && msg.id === 1 && Array.isArray(msg.result)) {
        for (const s of msg.result) states[s.entity_id] = s;
        window.__live.states = msg.result.length;
        applyStates(viewer, states);
        return;
      }
      if (msg.type === "event" && msg.event && msg.event.event_type === "state_changed") {
        const d = msg.event.data;
        states[d.entity_id] = d.new_state;
        window.__live.last = d.entity_id + '=' + d.new_state.state;
        applyStates(viewer, states);
      }
    });

    ws.addEventListener("close", () => {
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
