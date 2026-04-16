import net from "node:net";
import tls from "node:tls";
import { EventEmitter } from "node:events";
import { SocksClient } from "socks";

function splitPrefix(prefix) {
  if (!prefix) return { nick: "", user: "", host: "" };
  const [nickAndUser, host = ""] = prefix.split("@");
  const [nick = "", user = ""] = nickAndUser.split("!");
  return { nick, user, host };
}

function parseIrcLine(line) {
  let rest = line;
  let prefix;

  if (rest.startsWith(":")) {
    const i = rest.indexOf(" ");
    if (i !== -1) {
      prefix = rest.slice(1, i);
      rest = rest.slice(i + 1);
    } else {
      prefix = rest.slice(1);
      rest = "";
    }
  }

  let trailing;
  const trailingIndex = rest.indexOf(" :");
  if (trailingIndex !== -1) {
    trailing = rest.slice(trailingIndex + 2);
    rest = rest.slice(0, trailingIndex);
  }

  const parts = rest.split(" ").filter(Boolean);
  const command = (parts.shift() ?? "").toUpperCase();
  const params = parts;
  if (trailing !== undefined) params.push(trailing);

  return { prefix, command, params };
}

function waitForEvent(emitter, eventName, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timeoutId;

    const onDone = (value) => {
      cleanup();
      resolve(value);
    };

    const onError = (err) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      emitter.off(eventName, onDone);
      emitter.off("error", onError);
      if (timeoutId) clearTimeout(timeoutId);
    };

    emitter.on(eventName, onDone);
    emitter.on("error", onError);

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for ${eventName}`));
      }, timeoutMs);
    }
  });
}

export class IrcBridge extends EventEmitter {
  /**
   * @param {{
   *  server: { host: string, port: number, tls: boolean, tlsRejectUnauthorized?: boolean },
   *  tor: { enabled: boolean, socksHost: string, socksPort: number },
   *  identity: { nick: string, username?: string, realname?: string, password?: string },
   *  timeouts?: { connectMs?: number }
   * }} opts
   */
  constructor(opts) {
    super();
    this.server = opts.server;
    this.tor = opts.tor;
    this.identity = {
      nick: opts.identity.nick,
      username: opts.identity.username ?? opts.identity.nick,
      realname: opts.identity.realname ?? opts.identity.nick,
      password: opts.identity.password ?? "",
    };
    this.timeouts = {
      connectMs: opts.timeouts?.connectMs ?? 20000,
    };

    this.socket = null;
    this.buffer = "";
    this.registered = false;
    this.currentNick = this.identity.nick;
  }

  isConnected() {
    return Boolean(this.socket && !this.socket.destroyed);
  }

  async connect() {
    if (!this.server?.host) throw new Error("IRC host is not configured");

    this.emit("status", { status: "connecting" });

    const baseSocket = await this.#createBaseSocket();
    const socket = await this.#maybeWrapTls(baseSocket);

    this.socket = socket;
    this.buffer = "";
    this.registered = false;

    socket.setNoDelay(true);

    socket.on("data", (chunk) => this.#onData(chunk));
    socket.on("close", () => {
      this.socket = null;
      this.registered = false;
      this.emit("status", { status: "disconnected" });
    });
    socket.on("error", (err) => {
      this.emit("status", { status: "error", message: err?.message || "socket error" });
      this.emit("error", err);
    });

    if (this.identity.password) {
      this.sendRaw(`PASS ${this.identity.password}`);
    }
    this.sendRaw(`NICK ${this.identity.nick}`);
    this.sendRaw(`USER ${this.identity.username} 0 * :${this.identity.realname}`);

    this.emit("status", { status: "connected" });
  }

  disconnect() {
    if (this.socket) {
      try {
        this.sendRaw("QUIT :Client disconnect");
      } catch {
        // ignore
      }
      try {
        this.socket.destroy();
      } catch {
        // ignore
      }
    }
    this.socket = null;
    this.registered = false;
  }

  setNick(nextNick) {
    const nick = String(nextNick ?? "").trim();
    if (!nick) return;

    this.identity.nick = nick;
    this.currentNick = nick;

    if (this.isConnected()) {
      this.sendRaw(`NICK ${nick}`);
    }
  }

  join(target) {
    this.sendRaw(`JOIN ${target}`);
  }

  privmsg(target, text) {
    this.sendRaw(`PRIVMSG ${target} :${text}`);
  }

  sendRaw(line) {
    if (!this.socket || this.socket.destroyed) throw new Error("IRC socket not connected");
    this.socket.write(line + "\r\n");
  }

  async #createBaseSocket() {
    const { host, port } = this.server;

    if (this.tor.enabled) {
      const res = await SocksClient.createConnection({
        proxy: {
          host: this.tor.socksHost,
          port: this.tor.socksPort,
          type: 5,
        },
        command: "connect",
        destination: {
          host,
          port,
        },
        timeout: this.timeouts.connectMs,
      });
      return res.socket;
    }

    const socket = net.connect({ host, port });
    await waitForEvent(socket, "connect", this.timeouts.connectMs);
    return socket;
  }

  async #maybeWrapTls(baseSocket) {
    if (!this.server.tls) return baseSocket;

    const socket = tls.connect({
      socket: baseSocket,
      servername: this.server.host,
      rejectUnauthorized: this.server.tlsRejectUnauthorized ?? true,
    });

    await waitForEvent(socket, "secureConnect", this.timeouts.connectMs);
    return socket;
  }

  #onData(chunk) {
    this.buffer += chunk.toString("utf8");

    while (true) {
      const idx = this.buffer.indexOf("\n");
      if (idx === -1) break;

      let line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      line = line.replace(/\r$/, "").trimEnd();

      if (!line) continue;

      this.emit("raw", line);
      this.#handleLine(line);
    }
  }

  #handleLine(line) {
    const msg = parseIrcLine(line);

    if (msg.command === "PING") {
      const payload = msg.params[0] ?? "";
      try {
        this.sendRaw(`PONG :${payload.replace(/^:/, "")}`);
      } catch {
        // ignore
      }
      return;
    }

    if (msg.command === "001") {
      this.registered = true;
      this.emit("registered", { nick: this.currentNick });
      return;
    }

    if (msg.command === "433") {
      this.emit("status", { status: "error", message: "Nickname is already in use" });
      return;
    }

    if (msg.command === "PRIVMSG") {
      const { nick: fromNick } = splitPrefix(msg.prefix);
      const to = msg.params[0] ?? "";
      const text = msg.params[1] ?? "";
      this.emit("privmsg", { from: fromNick, to, text });
      return;
    }

    if (msg.command === "NOTICE") {
      const { nick: fromNick } = splitPrefix(msg.prefix);
      const to = msg.params[0] ?? "";
      const text = msg.params[1] ?? "";
      this.emit("notice", { from: fromNick, to, text });
      return;
    }

    if (msg.command === "JOIN") {
      const { nick: fromNick } = splitPrefix(msg.prefix);
      const channel = msg.params[0] ?? msg.params[msg.params.length - 1] ?? "";
      if (channel) {
        this.emit("join", { from: fromNick, channel });
      }
      return;
    }

    if (msg.command === "PART") {
      const { nick: fromNick } = splitPrefix(msg.prefix);
      const channel = msg.params[0] ?? "";
      const reason = msg.params[1] ?? "";
      if (channel) {
        this.emit("part", { from: fromNick, channel, reason });
      }
      return;
    }

    if (msg.command === "QUIT") {
      const { nick: fromNick } = splitPrefix(msg.prefix);
      const reason = msg.params[0] ?? "";
      if (fromNick) {
        this.emit("quit", { from: fromNick, reason });
      }
      return;
    }

    if (msg.command === "NICK") {
      const { nick: fromNick } = splitPrefix(msg.prefix);
      const nextNick = msg.params[0] ?? msg.params[msg.params.length - 1] ?? "";
      if (fromNick && nextNick) {
        this.currentNick = nextNick;
        this.emit("nick", { from: fromNick, nick: nextNick });
      }
      return;
    }

    if (msg.command === "TOPIC") {
      const { nick: fromNick } = splitPrefix(msg.prefix);
      const channel = msg.params[0] ?? "";
      const topic = msg.params[1] ?? "";
      if (channel) {
        this.emit("topic", { from: fromNick, channel, topic });
      }
      return;
    }

    if (msg.command === "332") {
      const channel = msg.params[1] ?? "";
      const topic = msg.params[2] ?? "";
      if (channel) {
        this.emit("topic", { from: "", channel, topic });
      }
      return;
    }

    if (msg.command === "353") {
      const channel = msg.params[2] ?? "";
      const names = (msg.params[3] ?? "").split(/\s+/).filter(Boolean);
      if (channel) {
        this.emit("names", { channel, names });
      }
      return;
    }

    if (msg.command === "ERROR") {
      this.emit("status", { status: "error", message: msg.params[0] ?? "IRC error" });
    }
  }
}
