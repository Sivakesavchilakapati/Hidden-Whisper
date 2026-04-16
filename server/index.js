import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { WebSocketServer } from "ws";
import { IrcBridge } from "./irc.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const ENV_FILE = path.join(ROOT_DIR, ".env");

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const v = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return fallback;
}

function parsePort(value, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  if (n < 1 || n > 65535) return fallback;
  return n;
}

function clampText(text, maxLen) {
  const t = String(text ?? "");
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

function isValidOnionHost(host) {
  const h = String(host ?? "").trim().toLowerCase();
  if (!h.endsWith(".onion")) return false;
  // v3 onions are 56 chars base32 + .onion
  // keep this permissive (some users paste subdomains, etc.) but safe.
  return /^[a-z2-7.-]+\.onion$/.test(h);
}

function normalizeHost(input) {
  let h = String(input ?? "").trim();
  if (!h) return "";

  h = h.replace(/^https?:\/\//i, "");
  h = h.replace(/^irc(s)?:\/\//i, "");
  h = h.replace(/\/+$/, "");

  // If user pasted host:port, strip the port.
  if (h.includes(":")) {
    const [maybeHost] = h.split(":");
    h = maybeHost;
  }

  return h.toLowerCase();
}

function safeJsonParse(str) {
  try {
    return { ok: true, value: JSON.parse(str) };
  } catch {
    return { ok: false, value: null };
  }
}

function upsertEnvValues(values) {
  const entries = Object.entries(values)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => [String(k), String(v)]);

  if (!entries.length) return;

  const source = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";
  const lines = source ? source.split(/\r?\n/) : [];
  const seen = new Set();

  const updated = lines.map((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!m) return line;

    const key = m[1];
    const found = entries.find(([k]) => k === key);
    if (!found) return line;

    seen.add(key);
    return `${key}=${found[1]}`;
  });

  for (const [k, v] of entries) {
    if (!seen.has(k)) updated.push(`${k}=${v}`);
  }

  const nextText = `${updated.join("\n").replace(/\n+$/, "")}\n`;
  if (nextText === source) return false;

  fs.writeFileSync(ENV_FILE, nextText, "utf8");
  return true;
}

function jsonSend(ws, obj) {
  // ws uses numeric readyState constants (OPEN === 1)
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify(obj));
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".map") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

const APP_HOST = process.env.HOST || "0.0.0.0";
const APP_PORT = parsePort(process.env.PORT, 3000);
const WS_PATH = process.env.WS_PATH || "/ws";

const IRC_HOST_DEFAULT = normalizeHost(process.env.IRC_HOST || "");
const IRC_PORT_DEFAULT = parsePort(process.env.IRC_PORT, 6667);
const IRC_TLS_DEFAULT = parseBoolean(process.env.IRC_TLS, false);
const IRC_TLS_REJECT_UNAUTHORIZED = parseBoolean(process.env.IRC_TLS_REJECT_UNAUTHORIZED, true);

const ALLOW_CLIENT_IRC_SETTINGS = parseBoolean(process.env.ALLOW_CLIENT_IRC_SETTINGS, false);

const TOR_ENABLED = parseBoolean(process.env.TOR_ENABLED, true);
const TOR_SOCKS_HOST = process.env.TOR_SOCKS_HOST || "127.0.0.1";
const TOR_SOCKS_PORT = parsePort(process.env.TOR_SOCKS_PORT, 9050);

const MAX_TEXT_LEN = Number.parseInt(process.env.MAX_TEXT_LEN || "900", 10) || 900;
const MAX_NICK_LEN = Number.parseInt(process.env.MAX_NICK_LEN || "24", 10) || 24;

// Optional access token for the whole app. If set, clients must authenticate.
const APP_ACCESS_TOKEN = (process.env.APP_ACCESS_TOKEN || "").trim();

function requireConfiguredIrc(session) {
  const host = session.ircHost;
  if (!host) {
    jsonSend(session.ws, {
      type: "error",
      code: "server_not_configured",
      message: "No IRC onion host configured (set IRC_HOST env var or update settings)",
    });
    return false;
  }
  if (!isValidOnionHost(host)) {
    jsonSend(session.ws, {
      type: "error",
      code: "invalid_irc_host",
      message: "IRC host must be a .onion address",
    });
    return false;
  }
  return true;
}

function makeChatId(host, target) {
  const raw = `${host}|${target}`;
  const b64 = Buffer.from(raw).toString("base64url");
  return `irc_${b64}`;
}

function ensureChat(session, target, overrides = {}) {
  const chatId = makeChatId(session.ircHost, target);
  const existing = session.chats.get(chatId);
  const baseChat = {
    id: chatId,
    kind: target.startsWith("#") ? "channel" : "user",
    username: overrides.username ?? target,
    status: overrides.status ?? (target.startsWith("#") ? "online" : "offline"),
    ircTarget: target,
    onionLink: session.ircHost,
  };

  const chat = existing ? { ...existing, ...baseChat, ...overrides, id: chatId, ircTarget: target, onionLink: session.ircHost } : { ...baseChat, ...overrides };
  session.chats.set(chatId, chat);
  return chat;
}

function pushSystemMessage(session, target, text) {
  const chat = ensureChat(session, target);
  const message = {
    id: crypto.randomUUID(),
    chatId: chat.id,
    direction: "system",
    type: "system",
    text,
    createdAt: Date.now(),
  };
  jsonSend(session.ws, { type: "chat:joined", chat });
  jsonSend(session.ws, { type: "msg:new", chatId: chat.id, message });
}

function isValidTarget(target) {
  const t = String(target ?? "").trim();
  if (!t) return false;
  if (t.length > 80) return false;
  // Channel (#) or nickname (no spaces)
  if (t.startsWith("#")) return /^#[^\s,]{1,79}$/.test(t);
  return /^[^\s,]{1,80}$/.test(t);
}

function sanitizeNick(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  // keep permissive; enforce length and remove spaces.
  const noSpaces = raw.replace(/\s+/g, "");
  return noSpaces.slice(0, MAX_NICK_LEN);
}

function serveStatic(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/api/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        ok: true,
        time: Date.now(),
      })
    );
    return;
  }

  // Only serve GET/HEAD.
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    res.end("Method Not Allowed");
    return;
  }

  if (!fs.existsSync(DIST_DIR)) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end("Frontend not built. Run npm run build.");
    return;
  }

  // Prevent path traversal.
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const normalized = path.posix.normalize(rel);
  if (normalized.startsWith("..")) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Bad Request");
    return;
  }
  const filePath = path.join(DIST_DIR, normalized);

  const sendFile = (p) => {
    const stream = fs.createReadStream(p);
    res.writeHead(200, {
      "content-type": getMimeType(p),
      "x-content-type-options": "nosniff",
    });
    stream.pipe(res);
    stream.on("error", () => {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("Internal Server Error");
    });
  };

  try {
    const stat = fs.statSync(filePath);
    if (stat.isFile()) {
      sendFile(filePath);
      return;
    }
  } catch {
    // ignore
  }

  // SPA fallback.
  const indexPath = path.join(DIST_DIR, "index.html");
  try {
    const stat = fs.statSync(indexPath);
    if (stat.isFile()) {
      sendFile(indexPath);
      return;
    }
  } catch {
    // ignore
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not Found");
}

const server = http.createServer(serveStatic);

const wss = new WebSocketServer({
  server,
  path: WS_PATH,
  maxPayload: 1024 * 1024,
});

/** @type {Map<string, any>} */
const sessions = new Map();

function makeSession(ws) {
  const id = crypto.randomUUID();
  return {
    id,
    ws,
    authed: APP_ACCESS_TOKEN ? false : true,
    irc: null,
    ircStatus: "disconnected",
    ircHost: IRC_HOST_DEFAULT,
    ircPort: IRC_PORT_DEFAULT,
    ircTls: IRC_TLS_DEFAULT,
    nick: "",
    password: "",
    chats: new Map(),
    echoSuppress: new Map(),
  };
}

function setIrcStatus(session, status, message) {
  session.ircStatus = status;
  jsonSend(session.ws, { type: "irc:status", status, message });
}

function persistSessionIrcConfig(session) {
  return upsertEnvValues({
    IRC_HOST: session.ircHost,
    IRC_PORT: session.ircPort,
    IRC_TLS: session.ircTls ? "true" : "false",
    ALLOW_CLIENT_IRC_SETTINGS: "true",
  });
}

function ensureIrc(session) {
  if (session.irc) return session.irc;
  const bridge = new IrcBridge({
    server: {
      host: session.ircHost,
      port: session.ircPort,
      tls: session.ircTls,
      tlsRejectUnauthorized: IRC_TLS_REJECT_UNAUTHORIZED,
    },
    tor: {
      enabled: TOR_ENABLED,
      socksHost: TOR_SOCKS_HOST,
      socksPort: TOR_SOCKS_PORT,
    },
    identity: {
      nick: session.nick,
      password: session.password,
    },
  });

  bridge.on("status", ({ status, message }) => {
    setIrcStatus(session, status, message);
  });

  bridge.on("registered", () => {
    // no-op for now
  });

  bridge.on("privmsg", ({ from, to, text }) => {
    const now = Date.now();
    const myNick = session.nick;

    const isFromSelf = from && myNick && from.toLowerCase() === myNick.toLowerCase();

    // Determine chat target.
    const chatTarget = to.toLowerCase() === myNick.toLowerCase() ? from : to;
    const chatId = makeChatId(session.ircHost, chatTarget);

    // Drop echo duplicates for origin session.
    if (isFromSelf) {
      const sig = `${chatTarget}|${text}`;
      const until = session.echoSuppress.get(sig);
      if (until && until > now) {
        session.echoSuppress.delete(sig);
        return;
      }
    }

    if (!session.chats.has(chatId)) {
      const kind = chatTarget.startsWith("#") ? "channel" : "user";
      const chat = {
        id: chatId,
        kind,
        username: chatTarget,
        status: "online",
        ircTarget: chatTarget,
        onionLink: session.ircHost,
      };
      session.chats.set(chatId, chat);
      jsonSend(session.ws, { type: "chat:joined", chat });
    }

    const message = {
      id: crypto.randomUUID(),
      chatId,
      direction: isFromSelf ? "out" : "in",
      type: "text",
      text,
      createdAt: now,
    };

    jsonSend(session.ws, { type: "msg:new", chatId, message });
  });

  bridge.on("notice", ({ from, to, text }) => {
    const myNick = session.nick || "";
    const target = (to || "").toLowerCase() === myNick.toLowerCase() ? from : to;
    pushSystemMessage(session, target, `NOTICE ${from ? `<${from}> ` : ""}${text}`);
  });

  bridge.on("join", ({ from, channel }) => {
    const myNick = session.nick || "";
    const isSelf = (from || "").toLowerCase() === myNick.toLowerCase();
    ensureChat(session, channel, {
      username: channel,
      status: "online",
    });
    pushSystemMessage(session, channel, isSelf ? `You joined ${channel}` : `${from} joined ${channel}`);
  });

  bridge.on("part", ({ from, channel, reason }) => {
    const myNick = session.nick || "";
    const isSelf = (from || "").toLowerCase() === myNick.toLowerCase();
    const chat = ensureChat(session, channel, { username: channel, status: isSelf ? "offline" : "online" });
    if (isSelf) chat.status = "offline";
    pushSystemMessage(session, channel, isSelf ? `You left ${channel}${reason ? ` (${reason})` : ""}` : `${from} left ${channel}${reason ? ` (${reason})` : ""}`);
  });

  bridge.on("quit", ({ from, reason }) => {
    for (const chat of session.chats.values()) {
      if (chat.kind !== "user") continue;
      if ((chat.ircTarget || "").toLowerCase() !== (from || "").toLowerCase()) continue;
      chat.status = "offline";
      pushSystemMessage(session, chat.ircTarget, `${from} quit${reason ? ` (${reason})` : ""}`);
    }
  });

  bridge.on("nick", ({ from, nick }) => {
    for (const chat of session.chats.values()) {
      if (chat.kind !== "user") continue;
      if ((chat.ircTarget || "").toLowerCase() !== (from || "").toLowerCase()) continue;
      chat.username = nick;
      chat.ircTarget = nick;
      chat.status = "online";
      pushSystemMessage(session, nick, `${from} is now known as ${nick}`);
    }

    if ((from || "").toLowerCase() === (session.nick || "").toLowerCase()) {
      session.nick = nick;
    }
  });

  bridge.on("topic", ({ from, channel, topic }) => {
    const cleanTopic = String(topic ?? "").trim();
    ensureChat(session, channel, { username: channel, status: "online" });
    pushSystemMessage(session, channel, cleanTopic ? `${from || "Server"} set topic: ${cleanTopic}` : `${from || "Server"} cleared the topic`);
  });

  bridge.on("names", ({ channel, names }) => {
    ensureChat(session, channel, { username: channel, status: "online" });
    if (Array.isArray(names) && names.length) {
      pushSystemMessage(session, channel, `Users here: ${names.join(", ")}`);
    }
  });

  bridge.on("error", (err) => {
    jsonSend(session.ws, { type: "error", code: "irc_error", message: err?.message || "IRC error" });
  });

  session.irc = bridge;
  return bridge;
}

async function connectIfNeeded(session) {
  if (session.irc && session.irc.isConnected()) return;

  if (!requireConfiguredIrc(session)) return;

  if (!session.nick) {
    jsonSend(session.ws, {
      type: "error",
      code: "nick_required",
      message: "Set a nickname before connecting",
    });
    return;
  }

  const bridge = ensureIrc(session);

  try {
    await bridge.connect();
  } catch (err) {
    jsonSend(session.ws, { type: "error", code: "connect_failed", message: err?.message || "Connect failed" });
    bridge.disconnect();
  }
}

wss.on("connection", (ws, req) => {
  const session = makeSession(ws);
  sessions.set(session.id, session);

  const url = new URL(req.url ?? WS_PATH, `http://${req.headers.host || "localhost"}`);
  const token = (url.searchParams.get("token") || "").trim();
  if (APP_ACCESS_TOKEN) {
    session.authed = token && token === APP_ACCESS_TOKEN;
  }

  jsonSend(ws, {
    type: "hello",
    version: 1,
    sessionId: session.id,
    irc: {
      host: session.ircHost,
      port: session.ircPort,
      tls: session.ircTls,
      tor: TOR_ENABLED,
      allowClientSettings: ALLOW_CLIENT_IRC_SETTINGS,
    },
    requiresAuth: Boolean(APP_ACCESS_TOKEN),
    authed: session.authed,
  });

  ws.on("message", async (data) => {
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data ?? "");
    const parsed = safeJsonParse(text);
    if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") {
      jsonSend(ws, { type: "error", code: "bad_json", message: "Invalid JSON" });
      return;
    }

    const msg = parsed.value;
    const type = String(msg.type ?? "");
    if (!type) {
      jsonSend(ws, { type: "error", code: "missing_type", message: "Missing message type" });
      return;
    }

    if (type === "auth") {
      const t = String(msg.token ?? "").trim();
      session.authed = APP_ACCESS_TOKEN ? t === APP_ACCESS_TOKEN : true;
      jsonSend(ws, { type: "auth:result", authed: session.authed });
      return;
    }

    // Non-authenticated users can still chat if APP_ACCESS_TOKEN isn't set.
    if (APP_ACCESS_TOKEN && !session.authed) {
      jsonSend(ws, { type: "error", code: "unauthorized", message: "Unauthorized" });
      return;
    }

    if (type === "settings:update") {
      const nick = sanitizeNick(msg.nick);
      const password = String(msg.password ?? "");

      const prevServer = { host: session.ircHost, port: session.ircPort, tls: session.ircTls };

      // Identity settings always apply per session.
      session.nick = nick;
      session.password = password;

      // Server settings are optional and controlled by env.
      if (ALLOW_CLIENT_IRC_SETTINGS) {
        const hostIn = normalizeHost(msg.host ?? "");
        if (hostIn) {
          if (!isValidOnionHost(hostIn)) {
            jsonSend(ws, { type: "error", code: "invalid_irc_host", message: "IRC host must be a .onion address" });
            return;
          }
          session.ircHost = hostIn;
        }

        if (msg.port !== undefined) {
          const p = parsePort(msg.port, null);
          if (p === null) {
            jsonSend(ws, { type: "error", code: "invalid_irc_port", message: "Invalid IRC port" });
            return;
          }
          session.ircPort = p;
        }

        if (msg.tls !== undefined) {
          session.ircTls = parseBoolean(msg.tls, session.ircTls);
        }
      } else {
        const attemptedHost = normalizeHost(msg.host ?? "");
        if (attemptedHost && attemptedHost !== session.ircHost) {
          jsonSend(ws, { type: "error", code: "host_not_allowed", message: "IRC host is locked on this server" });
        }
      }

      const persistRequested = msg.persist === true;

      if (ALLOW_CLIENT_IRC_SETTINGS && persistRequested) {
        try {
          const changed = persistSessionIrcConfig(session);
          jsonSend(ws, { type: "settings:persisted", ok: true, changed: Boolean(changed) });
        } catch (err) {
          jsonSend(ws, {
            type: "error",
            code: "persist_failed",
            message: err?.message || "Failed to persist settings to .env",
          });
        }
      }

      const serverChanged =
        prevServer.host !== session.ircHost || prevServer.port !== session.ircPort || prevServer.tls !== session.ircTls;

      if (serverChanged) {
        if (session.irc) session.irc.disconnect();
        session.irc = null;
        session.chats.clear();
        session.echoSuppress.clear();
        setIrcStatus(session, "disconnected", "IRC settings changed");
        jsonSend(ws, { type: "chats:reset" });
      }

      jsonSend(ws, {
        type: "settings:applied",
        effective: {
          host: session.ircHost,
          port: session.ircPort,
          tls: session.ircTls,
          nick: session.nick,
          allowClientSettings: ALLOW_CLIENT_IRC_SETTINGS,
        },
      });

      if (session.irc) {
        session.irc.setNick(session.nick);
      }

      await connectIfNeeded(session);
      return;
    }

    if (type === "disconnect") {
      if (session.irc) session.irc.disconnect();
      session.irc = null;
      setIrcStatus(session, "disconnected");
      return;
    }

    if (type === "chat:join") {
      const onionLink = normalizeHost(msg.onionLink ?? "");
      const target = String(msg.target ?? "").trim();
      const displayName = String(msg.displayName ?? "").trim();

      if (!isValidTarget(target)) {
        jsonSend(ws, { type: "error", code: "bad_target", message: "Invalid channel/nickname" });
        return;
      }

      if (onionLink) {
        if (!isValidOnionHost(onionLink)) {
          jsonSend(ws, { type: "error", code: "invalid_onion", message: "Onion link must be a .onion address" });
          return;
        }

        if (ALLOW_CLIENT_IRC_SETTINGS) {
          if (onionLink !== session.ircHost) {
            // Switch server for this session.
            session.ircHost = onionLink;
            if (session.irc) session.irc.disconnect();
            session.irc = null;
            session.chats.clear();
            session.echoSuppress.clear();
            setIrcStatus(session, "disconnected", "IRC server changed");
            jsonSend(ws, { type: "chats:reset" });

            try {
              const changed = persistSessionIrcConfig(session);
              jsonSend(ws, { type: "settings:persisted", ok: true, changed: Boolean(changed) });
            } catch (err) {
              jsonSend(ws, {
                type: "error",
                code: "persist_failed",
                message: err?.message || "Failed to persist settings to .env",
              });
            }
          }
        } else if (session.ircHost && onionLink !== session.ircHost) {
          jsonSend(ws, {
            type: "error",
            code: "onion_not_allowed",
            message: "Onion link must match the server IRC host",
          });
          return;
        }
      }

      await connectIfNeeded(session);
      if (!session.irc || !session.irc.isConnected()) return;

      const chatTarget = target;
      const chat = ensureChat(session, chatTarget, {
        username: displayName || chatTarget,
        status: chatTarget.startsWith("#") ? "online" : "offline",
      });

      if (chat.kind === "channel") {
        try {
          session.irc.join(chatTarget);
        } catch (err) {
          jsonSend(ws, { type: "error", code: "join_failed", message: err?.message || "Join failed" });
          return;
        }
      }

      jsonSend(ws, { type: "chat:joined", chat });

      jsonSend(ws, { type: "chat:selected", chatId: chat.id });
      return;
    }

    if (type === "msg:send") {
      const chatId = String(msg.chatId ?? "");
      const chat = session.chats.get(chatId);
      if (!chat) {
        jsonSend(ws, { type: "error", code: "unknown_chat", message: "Chat not found" });
        return;
      }

      const textRaw = String(msg.text ?? "");
      const textClean = clampText(textRaw, MAX_TEXT_LEN).trim();
      if (!textClean) return;

      await connectIfNeeded(session);
      if (!session.irc || !session.irc.isConnected()) return;

      const target = chat.ircTarget;

      const now = Date.now();
      const sig = `${target}|${textClean}`;
      session.echoSuppress.set(sig, now + 5000);

      try {
        session.irc.privmsg(target, textClean);
      } catch (err) {
        jsonSend(ws, { type: "error", code: "send_failed", message: err?.message || "Send failed" });
        return;
      }

      const message = {
        id: crypto.randomUUID(),
        chatId,
        direction: "out",
        type: "text",
        text: textClean,
        createdAt: now,
      };

      jsonSend(ws, { type: "msg:new", chatId, message });
      return;
    }

    jsonSend(ws, { type: "error", code: "unknown_type", message: `Unknown type: ${type}` });
  });

  ws.on("close", () => {
    try {
      if (session.irc) session.irc.disconnect();
    } catch {
      // ignore
    }
    sessions.delete(session.id);
  });
});

server.listen(APP_PORT, APP_HOST, () => {
  const banner = {
    host: APP_HOST,
    port: APP_PORT,
    wsPath: WS_PATH,
    ircHostDefault: IRC_HOST_DEFAULT || "(unset)",
    ircPortDefault: IRC_PORT_DEFAULT,
    ircTlsDefault: IRC_TLS_DEFAULT,
    allowClientIrcSettings: ALLOW_CLIENT_IRC_SETTINGS,
    torEnabled: TOR_ENABLED,
    torSocks: `${TOR_SOCKS_HOST}:${TOR_SOCKS_PORT}`,
  };

  // eslint-disable-next-line no-console
  console.log("Hidden Whisper server listening", banner);
});
