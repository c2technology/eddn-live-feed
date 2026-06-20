const DEFAULT_WS_URL = "wss://ws.eddn-realtime.space/eddn";
const MAX_TOTAL_MESSAGES = 500;
const MAX_MESSAGES_PER_TYPE = 40;

const state = {
  ws: null,
  messages: [],
  blocks: new Map(),
  totalReceived: 0,
  endpoint: new URLSearchParams(location.search).get("ws") || localStorage.getItem("eddn.ws") || DEFAULT_WS_URL,
  filter: "",
};

const els = {
  blocks: document.querySelector("#blocks"),
  blockTemplate: document.querySelector("#block-template"),
  cardTemplate: document.querySelector("#card-template"),
  filter: document.querySelector("#filter-input"),
  endpoint: document.querySelector("#endpoint-input"),
  connect: document.querySelector("#connect-button"),
  status: document.querySelector("#connection-status"),
  total: document.querySelector("#total-count"),
  visible: document.querySelector("#visible-count"),
  types: document.querySelector("#type-count"),
  empty: document.querySelector("#empty-state"),
};

els.endpoint.value = state.endpoint;
els.filter.addEventListener("input", () => {
  state.filter = els.filter.value.trim().toLowerCase();
  applyFilter();
});
els.connect.addEventListener("click", () => {
  state.endpoint = els.endpoint.value.trim() || DEFAULT_WS_URL;
  localStorage.setItem("eddn.ws", state.endpoint);
  connect();
});

function setStatus(value, tone = "") {
  els.status.textContent = value;
  els.status.dataset.tone = tone;
}

function connect() {
  if (state.ws) state.ws.close(1000, "reconnect");
  setStatus("connecting");

  try {
    const ws = new WebSocket(state.endpoint);
    state.ws = ws;

    ws.addEventListener("open", () => setStatus("live", "good"));
    ws.addEventListener("message", (event) => handleRawMessage(event.data));
    ws.addEventListener("error", () => setStatus("error", "bad"));
    ws.addEventListener("close", () => {
      if (state.ws === ws) {
        setStatus("closed", "warn");
        window.setTimeout(() => {
          if (state.ws === ws) connect();
        }, 2500);
      }
    });
  } catch (error) {
    console.error(error);
    setStatus("invalid endpoint", "bad");
  }
}

function handleRawMessage(raw) {
  const parsed = parseMessage(raw);
  if (!parsed) return;

  const normalized = normalizeMessage(parsed);
  state.totalReceived += 1;
  state.messages.unshift(normalized);
  if (state.messages.length > MAX_TOTAL_MESSAGES) state.messages.pop();

  renderMessage(normalized);
  trimBlocks();
  applyFilter();
}

function parseMessage(raw) {
  if (raw instanceof Blob) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : JSON.parse(String(raw));
  } catch (error) {
    console.warn("Dropped non-JSON message", error);
    return null;
  }
}

function normalizeMessage(payload) {
  const schemaRef = payload.$schemaRef || payload.schemaRef || "unknown";
  const message = payload.message || {};
  const header = payload.header || {};
  const schemaType = schemaRefToType(schemaRef, message.event);
  const timestamp = message.timestamp || header.gatewayTimestamp || header.gatewaytimestamp || new Date().toISOString();
  const software = [header.softwareName, header.softwareVersion].filter(Boolean).join(" ") || "unknown uploader";
  const searchable = JSON.stringify(payload).toLowerCase();

  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    schemaRef,
    schemaType,
    timestamp,
    software,
    payload,
    pretty: JSON.stringify(payload, null, 2),
    searchable,
  };
}

function schemaRefToType(schemaRef, eventName) {
  try {
    const url = new URL(schemaRef);
    const parts = url.pathname.split("/").filter(Boolean);
    const schemaIndex = parts.findIndex((part) => part === "schemas");
    const name = parts[schemaIndex + 1] || parts.at(-2) || parts.at(-1) || "unknown";
    return humanizeType(name || eventName || "unknown");
  } catch {
    const compact = String(schemaRef).split("/").filter(Boolean).at(-2) || String(schemaRef).split("/").pop() || eventName || "unknown";
    return humanizeType(compact);
  }
}

function humanizeType(value) {
  return String(value)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function renderMessage(message) {
  const block = ensureBlock(message);
  const card = els.cardTemplate.content.firstElementChild.cloneNode(true);
  card.dataset.messageId = message.id;
  card.dataset.searchable = message.searchable;
  card.querySelector(".timestamp").textContent = formatTime(message.timestamp);
  card.querySelector(".software").textContent = message.software;
  card.querySelector("pre").textContent = message.pretty;
  block.cards.prepend(card);
  block.total += 1;
}

function ensureBlock(message) {
  if (state.blocks.has(message.schemaType)) return state.blocks.get(message.schemaType);

  const blockEl = els.blockTemplate.content.firstElementChild.cloneNode(true);
  blockEl.dataset.type = message.schemaType;
  blockEl.querySelector("h2").textContent = message.schemaType;
  blockEl.querySelector(".schema-path").textContent = message.schemaRef;
  els.blocks.append(blockEl);

  const block = { el: blockEl, cards: blockEl.querySelector(".cards"), total: 0 };
  state.blocks.set(message.schemaType, block);
  return block;
}

function trimBlocks() {
  for (const block of state.blocks.values()) {
    while (block.cards.children.length > MAX_MESSAGES_PER_TYPE) {
      block.cards.lastElementChild.remove();
    }
  }
}

function applyFilter() {
  let visibleMessages = 0;
  for (const block of state.blocks.values()) {
    let blockVisible = 0;
    for (const card of block.cards.children) {
      const visible = !state.filter || card.dataset.searchable.includes(state.filter);
      card.hidden = !visible;
      if (visible) blockVisible += 1;
    }
    block.el.hidden = blockVisible === 0;
    block.el.querySelector(".visible").textContent = `${blockVisible} shown`;
    block.el.querySelector(".total").textContent = `${block.total} total`;
    visibleMessages += blockVisible;
  }

  els.total.textContent = state.totalReceived.toLocaleString();
  els.visible.textContent = visibleMessages.toLocaleString();
  els.types.textContent = state.blocks.size.toLocaleString();
  els.empty.hidden = state.blocks.size > 0;
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "unknown time");
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

connect();
