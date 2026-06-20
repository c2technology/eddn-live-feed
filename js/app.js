const DEFAULT_WS_URL = "wss://ws.eddn-realtime.space/eddn";
const MAX_TOTAL_MESSAGES = 500;
const MAX_MESSAGES_PER_TYPE = 18;

const DISPLAY_NAMES = new Map(Object.entries({
  commodity: "Commodity",
  codexentry: "Codex Entry",
  dockingcancelled: "Docking Cancelled",
  dockingdenied: "Docking Denied",
  dockinggranted: "Docking Granted",
  fssallbodiesfound: "FSS All Bodies Found",
  fssbodysignals: "FSS Body Signals",
  fssdiscoveryscan: "FSS Discovery Scan",
  fsssignaldiscovered: "FSS Signal Discovered",
  fsdjump: "FSD Jump",
  journal: "Journal",
  navroute: "Nav Route",
  outfitting: "Outfitting",
  scan: "Scan",
  scanbarycentre: "Scan Barycentre",
  shipyard: "Shipyard",
}));

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
  const eventName = message.event || schemaRefToType(schemaRef);
  const schemaType = schemaRefToType(schemaRef, eventName);
  const timestamp = message.timestamp || header.gatewayTimestamp || header.gatewaytimestamp || new Date().toISOString();
  const software = [header.softwareName, header.softwareVersion].filter(Boolean).join(" ") || "unknown uploader";
  const summary = summarizePayload(payload, schemaType, eventName);
  const searchable = [JSON.stringify(payload), summary.title, summary.facts.map((fact) => `${fact.label} ${fact.value}`).join(" ")]
    .join(" ")
    .toLowerCase();

  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    schemaRef,
    schemaType,
    schemaVersion: schemaVersion(schemaRef),
    eventName: humanizeType(eventName),
    timestamp,
    software,
    payload,
    summary,
    searchable,
  };
}

function schemaRefToType(schemaRef, eventName = "unknown") {
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

function schemaVersion(schemaRef) {
  const parts = String(schemaRef).split("/").filter(Boolean);
  const version = parts.at(-1);
  return /^\d+$/.test(version || "") ? `v${version}` : "";
}

function humanizeType(value) {
  const raw = String(value || "unknown");
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (DISPLAY_NAMES.has(key)) return DISPLAY_NAMES.get(key);
  return raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bFsd\b/g, "FSD")
    .replace(/\bFss\b/g, "FSS");
}

function summarizePayload(payload, schemaType, eventName) {
  const message = payload.message || {};
  const schema = schemaType.toLowerCase().replace(/\s+/g, "");
  const event = String(eventName || message.event || "").toLowerCase();
  const context = { schema, event };

  const facts = compactFacts([
    fact("System", first(message.StarSystem, message.System, message.systemName)),
    fact("Body", first(message.BodyName, message.Body, message.PlanetName, message.bodyName)),
    fact("Station", first(message.StationName, message.stationName, message.Name)),
    fact("Type", first(message.StationType, message.BodyType, message.PlanetClass, message.StarType, message.Type, message.event)),
    fact("Allegiance", message.SystemAllegiance),
    fact("Faction", getName(message.SystemFaction) || getName(message.StationFaction) || message.Faction),
    fact("Population", formatNumber(message.Population)),
    fact("Economy", cleanToken(first(message.SystemEconomy, message.StationEconomy, message.Economy))),
    fact("Government", cleanToken(first(message.SystemGovernment, message.StationGovernment, message.Government))),
    fact("Security", cleanToken(message.SystemSecurity)),
    fact("Class", first(message.StarType, message.PlanetClass, message.BodyType)),
    fact("Atmosphere", cleanToken(message.Atmosphere)),
    fact("Landable", formatBool(message.Landable)),
    fact("Scan", message.ScanType),
    fact("From", message.From),
    fact("To", message.To),
    fact("Jumps", message.JumpCount),
    fact("Distance", formatLy(message.RouteDistance || message.DistanceFromArrivalLS || message.JumpDist)),
    fact("Pad", message.LandingPad),
    fact("Reason", message.Reason),
    fact("Commodity", cleanToken(message.Commodity)),
    fact("Price", formatNumber(first(message.BuyPrice, message.SellPrice, message.Price))),
    fact("Demand", formatNumber(message.Demand)),
    fact("Supply", formatNumber(message.Supply)),
    fact("Category", cleanToken(first(message.Category, message.SubCategory))),
    fact("Region", cleanToken(message.Region)),
    fact("Value", formatNumber(first(message.VoucherAmount, message.Reward))),
  ]);

  return {
    title: chooseTitle(message, context),
    facts: prioritizeFacts(facts, context),
  };
}

function chooseTitle(message, { schema, event }) {
  if (schema.includes("fssdiscoveredsignal")) return first(message.SignalName, message.StarSystem, "Discovered Signal");
  if (schema.includes("scanbarycentre")) return first(message.StarSystem, "Barycentre Scan");
  if (schema.includes("commodity")) return first(message.StationName, message.MarketID, "Commodity Update");
  if (schema.includes("outfitting") || schema.includes("shipyard")) return first(message.StationName, message.MarketID, "Station Update");
  if (schema.includes("codex")) return cleanToken(first(message.Name, message.SubCategory, "Codex Entry"));
  if (event.includes("fsdjump") || event.includes("location")) return first(message.StarSystem, message.System, "System Visit");
  if (event.includes("carrierjump")) return first(message.StationName, message.StarSystem, "Carrier Jump");
  if (event.includes("docked") || schema.includes("docking")) return first(message.StationName, message.StarSystem, "Docking Event");
  if (event.includes("scan") || schema.includes("scan")) return first(message.BodyName, message.Body, message.StarSystem, "Body Scan");
  return first(message.StarSystem, message.System, message.StationName, message.BodyName, message.Body, message.Name, message.event, "EDDN Message");
}

function prioritizeFacts(facts, { schema, event }) {
  const labelsByContext = [
    [schema.includes("commodity"), ["Station", "System", "Commodity", "Price", "Demand", "Supply"]],
    [schema.includes("shipyard") || schema.includes("outfitting"), ["Station", "System", "Type", "Commodity"]],
    [schema.includes("codex"), ["System", "Body", "Category", "Region", "Value"]],
    [schema.includes("route"), ["From", "To", "Jumps", "Distance"]],
    [event.includes("fsdjump") || event.includes("location"), ["System", "Population", "Allegiance", "Faction", "State"]],
    [event.includes("scan") || schema.includes("scan"), ["Body", "Class", "Atmosphere", "Landable", "Scan"]],
    [event.includes("docked") || schema.includes("docking"), ["Station", "Type", "System", "Pad", "Reason"]],
  ];

  const priority = labelsByContext.find(([matches]) => matches)?.[1] || ["System", "Station", "Body", "Type", "Class", "Region"];
  const byLabel = new Map(facts.map((item) => [item.label, item]));
  const ordered = priority.map((label) => byLabel.get(label)).filter(Boolean);
  const remainder = facts.filter((item) => !priority.includes(item.label));
  return [...ordered, ...remainder].slice(0, 5);
}

function renderMessage(message) {
  const block = ensureBlock(message);
  const card = els.cardTemplate.content.firstElementChild.cloneNode(true);
  card.dataset.messageId = message.id;
  card.dataset.searchable = message.searchable;
  card.querySelector(".event-pill").textContent = message.eventName;
  card.querySelector(".timestamp").textContent = formatTime(message.timestamp);
  card.querySelector(".timestamp").dateTime = message.timestamp;
  card.querySelector("h3").textContent = cleanToken(message.summary.title);
  card.querySelector(".software").textContent = compactSoftware(message.software);
  card.querySelector(".schema-version").textContent = message.schemaVersion;

  const facts = card.querySelector(".facts");
  for (const item of message.summary.facts) {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = item.label;
    dd.textContent = cleanToken(item.value);
    facts.append(dt, dd);
  }

  if (!message.summary.facts.length) {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = "Event";
    dd.textContent = message.eventName;
    facts.append(dt, dd);
  }

  block.cards.prepend(card);
  block.total += 1;
}

function ensureBlock(message) {
  if (state.blocks.has(message.schemaType)) return state.blocks.get(message.schemaType);

  const blockEl = els.blockTemplate.content.firstElementChild.cloneNode(true);
  blockEl.dataset.type = message.schemaType;
  blockEl.querySelector("h2").textContent = message.schemaType;
  blockEl.querySelector(".schema-path").textContent = message.schemaVersion || "live";
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

function compactFacts(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item || item.value === undefined || item.value === null || item.value === "" || item.value === "—") return false;
    const key = `${item.label}:${item.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fact(label, value) {
  return { label, value };
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "") || "";
}

function getName(value) {
  if (!value) return "";
  return typeof value === "object" ? value.Name || value.name || "" : value;
}

function cleanToken(value) {
  return String(value ?? "")
    .replace(/^\$/, "")
    .replace(/;$/, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactSoftware(value) {
  return String(value)
    .replace("E:D Market Connector", "EDMC")
    .replace("Elite Dangerous Market Connector", "EDMC")
    .replace(/\s+\[(Windows|Linux|Mac)\]/i, "")
    .trim();
}

function formatNumber(value) {
  if (value === undefined || value === null || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : value;
}

function formatLy(value) {
  if (value === undefined || value === null || value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return `${number.toLocaleString(undefined, { maximumFractionDigits: 2 })} ly`;
}

function formatBool(value) {
  if (value === undefined || value === null) return "";
  return value ? "Yes" : "No";
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "unknown time");
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

connect();
