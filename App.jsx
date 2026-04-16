import { useEffect, useMemo, useRef, useState } from "react";

const THEME = {
  appBg: "#f0f2f5",
  accent: "#25D366",
  chatBg: "#efeae2",
  sentBubble: "#dcf8c6",
};

const BASE_TIME = Date.now();
const SYSTEM_CHAT_ID = "chat_system";
const ADMIN_CREDENTIALS = { username: "admin", password: "admin" };
const FILE_MARKER_RE = /^\[file\]\s+(.+?)\s+\(([^)]+)\)(?:\s+::\s+(\S+))?$/i;

function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `id_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatFileSize(bytes) {
  const n = Number(bytes ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`;
}

function previewForMessage(message) {
  if (!message) return "";
  switch (message.type) {
    case "text":
      return message.text;
    case "system":
      return message.text;
    case "image":
      return message.caption ? `📷 ${message.caption}` : "📷 Photo";
    case "video":
      return message.caption ? `🎥 ${message.caption}` : "🎥 Video";
    case "document":
      return `📄 ${message.fileName}`;
    case "voice":
      return "🎤 Voice message";
    default:
      return "";
  }
}

function createSystemChat() {
  return {
    id: SYSTEM_CHAT_ID,
    kind: "system",
    username: "System",
    status: "online",
    ircTarget: "system",
  };
}

function createSystemMessage(text) {
  return {
    id: uid(),
    chatId: SYSTEM_CHAT_ID,
    direction: "system",
    type: "system",
    text,
    createdAt: Date.now(),
  };
}

function parseFileMarker(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;

  const match = raw.match(FILE_MARKER_RE);
  if (!match) return null;

  const fileName = (match[1] ?? "").trim();
  const fileSize = (match[2] ?? "").trim();
  const url = (match[3] ?? "").trim();
  if (!fileName || !fileSize) return null;

  return {
    fileName,
    fileSize,
    url: url || "",
  };
}

function normalizeIncomingMessage(message) {
  if (!message || typeof message !== "object") return message;
  if (message.type !== "text") return message;

  const parsed = parseFileMarker(message.text);
  if (!parsed) return message;

  return {
    ...message,
    type: "document",
    fileName: parsed.fileName,
    fileSize: parsed.fileSize,
    url: parsed.url,
    text: undefined,
  };
}

function initialsFromName(name) {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "?";

  const words = trimmed
    .replace(/^#/, "")
    .split(/\s+/)
    .filter(Boolean);

  const first = words[0]?.[0] ?? "?";
  const last = words.length > 1 ? words[words.length - 1]?.[0] : "";
  return (first + last).toUpperCase();
}

function hashToHue(input) {
  let hash = 0;
  const str = String(input ?? "");
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

function makeSvgDataUrl({ title, subtitle, hue = 160 }) {
  const safeTitle = String(title ?? "").replace(/[<>&]/g, "");
  const safeSubtitle = String(subtitle ?? "").replace(/[<>&]/g, "");
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="480" viewBox="0 0 720 480">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 70% 45%)"/>
      <stop offset="1" stop-color="hsl(${(hue + 40) % 360} 70% 55%)"/>
    </linearGradient>
    <radialGradient id="r" cx="25%" cy="20%" r="75%">
      <stop offset="0" stop-color="rgba(255,255,255,0.55)"/>
      <stop offset="1" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
  </defs>
  <rect width="720" height="480" fill="url(#g)"/>
  <circle cx="180" cy="140" r="220" fill="url(#r)"/>
  <circle cx="640" cy="420" r="260" fill="rgba(255,255,255,0.15)"/>
  <g fill="rgba(0,0,0,0.18)" font-family="ui-sans-serif, system-ui" text-anchor="middle">
    <text x="360" y="250" font-size="44" font-weight="700">${safeTitle}</text>
    <text x="360" y="300" font-size="22" font-weight="500">${safeSubtitle}</text>
  </g>
</svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);

    onChange();

    if (mql.addEventListener) mql.addEventListener("change", onChange);
    else mql.addListener(onChange);

    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", onChange);
      else mql.removeListener(onChange);
    };
  }, [query]);

  return matches;
}

const MOCK_CHATS = [
  {
    id: "chat_alice",
    kind: "user",
    username: "Alice",
    status: "online",
    ircTarget: "alice",
  },
  {
    id: "chat_ben",
    kind: "user",
    username: "Ben",
    status: "offline",
    ircTarget: "ben",
  },
  {
    id: "chat_design",
    kind: "channel",
    username: "#design",
    status: "online",
    ircTarget: "#design",
  },
  {
    id: "chat_frontend",
    kind: "channel",
    username: "#frontend",
    status: "online",
    ircTarget: "#frontend",
  },
  {
    id: "chat_ops",
    kind: "channel",
    username: "#ops",
    status: "offline",
    ircTarget: "#ops",
  },
  {
    id: "chat_zoe",
    kind: "user",
    username: "Zoe",
    status: "online",
    ircTarget: "zoe",
  },
];

const MOCK_MESSAGES_BY_CHAT_ID = (() => {
  const img1 = makeSvgDataUrl({
    title: "Mock Image",
    subtitle: "Inline preview",
    hue: 155,
  });
  const poster1 = makeSvgDataUrl({
    title: "Mock Video",
    subtitle: "HTML5 player",
    hue: 210,
  });

  const t = (minsAgo) => BASE_TIME - minsAgo * 60 * 1000;

  return {
    [SYSTEM_CHAT_ID]: [
      {
        id: uid(),
        chatId: SYSTEM_CHAT_ID,
        direction: "system",
        type: "system",
        text: "Login to configure your onion server and connect.",
        createdAt: t(200),
      },
    ],
    chat_alice: [
      {
        id: uid(),
        chatId: "chat_alice",
        direction: "in",
        type: "text",
        text: "Hey! Did you see the latest UI draft?",
        createdAt: t(64),
      },
      {
        id: uid(),
        chatId: "chat_alice",
        direction: "out",
        type: "text",
        text: "Yep — looks great. I’m wiring up the component structure now.",
        createdAt: t(62),
      },
      {
        id: uid(),
        chatId: "chat_alice",
        direction: "in",
        type: "image",
        url: img1,
        caption: "Quick screenshot",
        createdAt: t(58),
      },
      {
        id: uid(),
        chatId: "chat_alice",
        direction: "out",
        type: "document",
        fileName: "irc-bridge-spec.pdf",
        fileSize: "482 KB",
        url: "/files/irc-bridge-spec.pdf",
        createdAt: t(51),
      },
      {
        id: uid(),
        chatId: "chat_alice",
        direction: "in",
        type: "voice",
        url: "/media/voice-note.ogg",
        durationSec: 18,
        createdAt: t(45),
      },
      {
        id: uid(),
        chatId: "chat_alice",
        direction: "in",
        type: "video",
        url: "/media/demo.mp4",
        posterUrl: poster1,
        caption: "Walkthrough",
        createdAt: t(40),
      },
      {
        id: uid(),
        chatId: "chat_alice",
        direction: "out",
        type: "text",
        text: "Perfect — I’ll match the WhatsApp spacing & bubble styles.",
        createdAt: t(38),
      },
    ],
    chat_ben: [
      {
        id: uid(),
        chatId: "chat_ben",
        direction: "in",
        type: "text",
        text: "Can we keep it minimal and fast?",
        createdAt: t(120),
      },
      {
        id: uid(),
        chatId: "chat_ben",
        direction: "out",
        type: "text",
        text: "Yep. Pure React + Tailwind, no UI libs.",
        createdAt: t(118),
      },
    ],
    chat_design: [
      {
        id: uid(),
        chatId: "chat_design",
        direction: "in",
        type: "text",
        text: "Pinned: green accent is #25D366",
        createdAt: t(240),
      },
      {
        id: uid(),
        chatId: "chat_design",
        direction: "in",
        type: "text",
        text: "Bubble radius: rounded-2xl, with subtle shadows.",
        createdAt: t(235),
      },
    ],
    chat_frontend: [
      {
        id: uid(),
        chatId: "chat_frontend",
        direction: "in",
        type: "text",
        text: "Reminder: auto-scroll to latest message + typing indicator UI.",
        createdAt: t(15),
      },
    ],
    chat_ops: [
      {
        id: uid(),
        chatId: "chat_ops",
        direction: "in",
        type: "text",
        text: "Deploy window: tonight.",
        createdAt: t(520),
      },
    ],
    chat_zoe: [
      {
        id: uid(),
        chatId: "chat_zoe",
        direction: "in",
        type: "text",
        text: "Love the new layout — feels like WhatsApp Web.",
        createdAt: t(8),
      },
    ],
  };
})();

function IconButton({ title, onClick, children, className = "" }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={
        "inline-flex h-10 w-10 items-center justify-center rounded-full text-black/70 transition-colors hover:bg-black/5 hover:text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366]/50 " +
        className
      }
    >
      {children}
    </button>
  );
}

function Avatar({ name, size = 44, src }) {
  const hue = useMemo(() => hashToHue(name), [name]);
  const initials = useMemo(() => initialsFromName(name), [name]);

  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-full"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center"
          style={{ backgroundColor: `hsl(${hue} 55% 78%)` }}
        >
          <span className="select-none text-sm font-semibold text-black/70">{initials}</span>
        </div>
      )}
    </div>
  );
}

function Sidebar({
  chats,
  selectedChatId,
  onSelectChat,
  search,
  setSearch,
  lastMessageByChatId,
  hideOnMobile = false,
  onOpenSettings,
  onOpenJoin,
  connectionLabel,
}) {
  const displayClass = hideOnMobile ? "hidden md:flex" : "flex";

  return (
    <aside
      className={
        displayClass +
        " h-full w-full flex-col border-black/10 bg-white md:w-[30%] md:min-w-[320px] md:max-w-[440px] md:border-r border-b md:border-b-0"
      }
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-black/75">Hidden Whisper</div>
          {connectionLabel ? <div className="truncate text-xs text-black/45">{connectionLabel}</div> : null}
        </div>

        <div className="flex items-center gap-1">
          <IconButton title="Join chat" onClick={onOpenJoin ?? (() => {})}>
            <PlusIcon className="h-5 w-5" />
          </IconButton>
          <IconButton title="Settings" onClick={onOpenSettings ?? (() => {})}>
            <SettingsIcon className="h-5 w-5" />
          </IconButton>
        </div>
      </div>

      <div className="px-3 pb-3">
        <div className="flex items-center gap-2 rounded-full bg-[#f0f2f5] px-3 py-2 ring-1 ring-black/5 focus-within:ring-[#25D366]/40">
          <SearchIcon className="h-5 w-5 text-black/45" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search or start new chat"
            className="w-full bg-transparent text-sm text-black/80 placeholder:text-black/40 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {chats.map((chat) => {
          const last = lastMessageByChatId[chat.id];
          const isSelected = chat.id === selectedChatId;

          return (
            <ChatListItem
              key={chat.id}
              chat={chat}
              isSelected={isSelected}
              lastMessage={last}
              onClick={() => onSelectChat(chat.id)}
            />
          );
        })}
      </div>
    </aside>
  );
}

function ChatListItem({ chat, isSelected, lastMessage, onClick }) {
  const preview = previewForMessage(lastMessage);
  const time = lastMessage?.createdAt ? formatTime(lastMessage.createdAt) : "";

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "group flex w-full items-center gap-3 px-3 py-3 text-left transition-colors " +
        (isSelected ? "bg-[#f0f2f5]" : "hover:bg-black/5")
      }
    >
      <div className={"h-10 w-1 rounded-full transition-colors " + (isSelected ? "bg-[#25D366]" : "bg-transparent")} />

      <Avatar name={chat.username} size={44} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-black/85">{chat.username}</span>
            <span
              className={
                "inline-flex h-2 w-2 shrink-0 rounded-full " +
                (chat.status === "online" ? "bg-[#25D366]" : "bg-black/25")
              }
              aria-hidden
            />
          </div>

          <span className={"shrink-0 text-xs " + (isSelected ? "text-black/50" : "text-black/40")}>{time}</span>
        </div>

        <div className="mt-0.5 flex items-center justify-between gap-3">
          <span className="truncate text-sm text-black/55">{preview}</span>
        </div>
      </div>
    </button>
  );
}

function ChatHeader({ chat, ircSettings, showBack, onBack, onOpenSettings, onOpenJoin }) {
  const connectionLabel =
    ircSettings && ircSettings.host
      ? `${ircSettings.host}:${ircSettings.port}${ircSettings.tls ? " · TLS" : ""}`
      : "";

  return (
    <header className="flex min-h-16 items-center justify-between gap-3 border-b border-black/10 bg-[#f0f2f5] px-3 py-2 md:px-4">
      <div className="flex min-w-0 items-center gap-2 md:gap-3">
        {showBack ? (
          <IconButton title="Back" onClick={onBack} className="md:hidden">
            <ArrowLeftIcon className="h-5 w-5" />
          </IconButton>
        ) : null}

        <Avatar name={chat.username} size={40} />

        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-black/85">{chat.username}</div>

          <div className="flex min-w-0 items-center gap-2 text-xs text-black/50">
            <span
              className={
                "h-2 w-2 shrink-0 rounded-full " +
                (chat.status === "online" ? "bg-[#25D366]" : "bg-black/25")
              }
              aria-hidden
            />
            <span className="capitalize">{chat.status}</span>
            {connectionLabel ? <span className="text-black/30">•</span> : null}
            {connectionLabel ? <span className="truncate">{connectionLabel}</span> : null}
          </div>

          {chat.onionLink ? (
            <div className="mt-0.5 truncate text-[11px] text-black/45">Onion: {chat.onionLink}</div>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <IconButton title="Join chat" onClick={onOpenJoin ?? (() => {})} className="md:hidden">
          <PlusIcon className="h-5 w-5" />
        </IconButton>

        <IconButton title="Call" onClick={() => {}} className="hidden sm:inline-flex">
          <PhoneIcon className="h-5 w-5" />
        </IconButton>
        <IconButton title="Video" onClick={() => {}} className="hidden sm:inline-flex">
          <VideoIcon className="h-5 w-5" />
        </IconButton>
        <IconButton title="Menu" onClick={onOpenSettings ?? (() => {})}>
          <MenuIcon className="h-5 w-5" />
        </IconButton>
      </div>
    </header>
  );
}

function MessageList({ messages, isTyping, bottomRef }) {
  return (
    <div
      className="flex-1 overflow-y-auto px-4 py-4"
      style={{ backgroundColor: THEME.chatBg }}
    >
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-2">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}

        {isTyping ? <TypingIndicator /> : null}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function MessageBubble({ message }) {
  const isOut = message.direction === "out";

  const wrapperClass = "flex w-full " + (isOut ? "justify-end" : "justify-start");
  const bubbleClass =
    "relative max-w-[78%] rounded-2xl px-3 py-2 shadow-sm ring-1 ring-black/5 transition-shadow " +
    (isOut
      ? "bg-[#dcf8c6] rounded-tr-md"
      : "bg-white rounded-tl-md") +
    " hover:shadow";

  return (
    <div className={wrapperClass}>
      <div className={bubbleClass}>
        <MessageContent message={message} />

        <div className="mt-1 flex items-center justify-end gap-1 text-[11px] leading-none text-black/45">
          <span>{formatTime(message.createdAt)}</span>
          {isOut ? <DoubleCheckIcon className="h-3.5 w-3.5 text-black/45" /> : null}
        </div>
      </div>
    </div>
  );
}

function MessageContent({ message }) {
  switch (message.type) {
    case "text":
      return <p className="whitespace-pre-wrap break-words text-sm text-black/80">{message.text}</p>;

    case "system":
      return <p className="whitespace-pre-wrap break-words text-xs font-medium text-black/55">{message.text}</p>;

    case "image":
      return (
        <div className="space-y-2">
          <img
            src={message.url}
            alt={message.caption ?? "Image"}
            className="max-h-[320px] w-full max-w-[360px] rounded-xl object-cover"
            loading="lazy"
          />
          {message.caption ? (
            <p className="whitespace-pre-wrap break-words text-sm text-black/80">{message.caption}</p>
          ) : null}
        </div>
      );

    case "video":
      return (
        <div className="space-y-2">
          <video
            controls
            className="w-full max-w-[360px] rounded-xl bg-black/90"
            poster={message.posterUrl}
          >
            <source src={message.url} />
          </video>
          {message.caption ? (
            <p className="whitespace-pre-wrap break-words text-sm text-black/80">{message.caption}</p>
          ) : null}
        </div>
      );

    case "document":
      return message.url ? (
        <a
          href={message.url}
          target="_blank"
          rel="noreferrer noopener"
          download={message.fileName || true}
          className="block rounded-xl bg-black/5 p-3 transition-colors hover:bg-black/10"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white ring-1 ring-black/10">
              <DocIcon className="h-5 w-5 text-black/60" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-black/80">{message.fileName}</div>
              <div className="text-xs text-black/50">{message.fileSize}</div>
            </div>
            <span className="text-xs font-semibold text-[#25D366]">Download</span>
          </div>
        </a>
      ) : (
        <div className="block rounded-xl bg-black/5 p-3 ring-1 ring-black/5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white ring-1 ring-black/10">
              <DocIcon className="h-5 w-5 text-black/60" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-black/80">{message.fileName}</div>
              <div className="text-xs text-black/50">{message.fileSize}</div>
            </div>
            <span className="text-xs font-semibold text-black/45">Unavailable</span>
          </div>
        </div>
      );

    case "voice":
      return <VoiceMessage url={message.url} durationSec={message.durationSec} />;

    default:
      return null;
  }
}

function VoiceMessage({ url, durationSec }) {
  const label = durationSec ? `${durationSec}s` : "Voice";

  return (
    <div className="flex items-center gap-3 rounded-xl bg-black/5 p-2">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white ring-1 ring-black/10">
        <PlayIcon className="h-4 w-4 text-black/65" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="h-2 w-full overflow-hidden rounded-full bg-black/10">
          <div className="h-full w-[40%] rounded-full" style={{ backgroundColor: THEME.accent }} />
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-black/50">
          <span className="truncate">Voice message</span>
          <span className="shrink-0">{label}</span>
        </div>
      </div>

      {url ? (
        <audio controls className="hidden" preload="none">
          <source src={url} />
        </audio>
      ) : null}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex w-full justify-start">
      <div className="rounded-2xl rounded-tl-md bg-white px-3 py-2 shadow-sm ring-1 ring-black/5">
        <div className="flex items-center gap-1" aria-label="Typing">
          <span className="h-2 w-2 rounded-full bg-black/30 animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="h-2 w-2 rounded-full bg-black/30 animate-bounce" style={{ animationDelay: "120ms" }} />
          <span className="h-2 w-2 rounded-full bg-black/30 animate-bounce" style={{ animationDelay: "240ms" }} />
        </div>
      </div>
    </div>
  );
}

function ChatInput({
  draft,
  setDraft,
  onSend,
  emojiOpen,
  setEmojiOpen,
  attachOpen,
  setAttachOpen,
  onInsertMock,
  onUploadFile,
}) {
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  return (
    <div className="border-t border-black/10 bg-[#f0f2f5] px-3 py-2">
      <div className="relative mx-auto flex w-full max-w-4xl items-center gap-2">
        <IconButton
          title="Emoji"
          onClick={() => {
            setEmojiOpen((v) => !v);
            setAttachOpen(false);
          }}
        >
          <EmojiIcon className="h-5 w-5" />
        </IconButton>

        <IconButton
          title="Attach"
          onClick={() => {
            setAttachOpen((v) => !v);
            setEmojiOpen(false);
          }}
        >
          <AttachIcon className="h-5 w-5" />
        </IconButton>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
            inputRef.current?.focus();
          }}
          className="flex min-w-0 flex-1 items-center gap-2"
        >
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a message"
            className="h-11 w-full min-w-0 rounded-full bg-white px-4 text-sm text-black/80 ring-1 ring-black/5 placeholder:text-black/40 focus:outline-none focus:ring-2 focus:ring-[#25D366]/40"
          />

          <IconButton title="Voice" onClick={() => {}} className="hidden sm:inline-flex">
            <MicIcon className="h-5 w-5" />
          </IconButton>

          <button
            type="submit"
            className={
              "inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366]/50 " +
              (draft.trim() ? "bg-[#25D366] hover:bg-[#1fb75a]" : "bg-black/20 cursor-not-allowed")
            }
            disabled={!draft.trim()}
            aria-label="Send"
          >
            <SendIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Send</span>
          </button>
        </form>

        {emojiOpen ? (
          <Popover onClose={() => setEmojiOpen(false)} align="left">
            <div className="grid grid-cols-6 gap-1 p-2">
              {["😀", "😂", "😊", "😍", "👍", "🎉", "🔥", "✅", "💬", "📎", "🟢", "👀"].map((e) => (
                <button
                  key={e}
                  type="button"
                  className="h-9 w-9 rounded-lg text-lg transition-colors hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366]/40"
                  onClick={() => {
                    setDraft((d) => d + e);
                    inputRef.current?.focus();
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          </Popover>
        ) : null}

        {attachOpen ? (
          <Popover onClose={() => setAttachOpen(false)} align="left">
            <div className="w-56 p-2">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadFile?.(file);
                  e.target.value = "";
                  setAttachOpen(false);
                  inputRef.current?.focus();
                }}
              />

              <AttachmentRow
                label="Upload file"
                hint="Image, video, doc, audio"
                onClick={() => {
                  fileInputRef.current?.click();
                }}
              />

              <AttachmentRow
                label="Photo"
                hint="Mock image message"
                onClick={() => {
                  onInsertMock("image");
                  setAttachOpen(false);
                  inputRef.current?.focus();
                }}
              />
              <AttachmentRow
                label="Video"
                hint="Mock HTML5 video"
                onClick={() => {
                  onInsertMock("video");
                  setAttachOpen(false);
                  inputRef.current?.focus();
                }}
              />
              <AttachmentRow
                label="Document"
                hint="Mock file card"
                onClick={() => {
                  onInsertMock("document");
                  setAttachOpen(false);
                  inputRef.current?.focus();
                }}
              />
              <AttachmentRow
                label="Voice"
                hint="Mock voice UI"
                onClick={() => {
                  onInsertMock("voice");
                  setAttachOpen(false);
                  inputRef.current?.focus();
                }}
              />
            </div>
          </Popover>
        ) : null}
      </div>
    </div>
  );
}

function AttachmentRow({ label, hint, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366]/40"
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-black/80">{label}</div>
        <div className="truncate text-xs text-black/50">{hint}</div>
      </div>
      <ChevronRightIcon className="h-4 w-4 text-black/35" />
    </button>
  );
}

function Popover({ children, onClose, align = "left" }) {
  return (
    <div className="absolute bottom-[56px] left-0 z-20">
      <div className="fixed inset-0" onMouseDown={onClose} aria-hidden />
      <div
        className={
          "relative rounded-2xl bg-white shadow-lg ring-1 ring-black/10 " +
          (align === "left" ? "" : "")
        }
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [mobilePanel, setMobilePanel] = useState("list");

  const [chats, setChats] = useState([createSystemChat()]);
  const [messagesByChatId, setMessagesByChatId] = useState(() => ({
    [SYSTEM_CHAT_ID]: MOCK_MESSAGES_BY_CHAT_ID[SYSTEM_CHAT_ID] ?? [createSystemMessage("Login to configure your onion server and connect.")],
  }));
  const [selectedChatId, setSelectedChatId] = useState(SYSTEM_CHAT_ID);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [typingByChatId, setTypingByChatId] = useState(() => ({}));
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(true);
  const [loginRole, setLoginRole] = useState("user");
  const [loginDraft, setLoginDraft] = useState(() => ({
    username: "",
    password: "",
    displayName: "",
    nick: "",
    host: "",
    port: "6667",
    tls: false,
  }));

  const [ircSettings, setIrcSettings] = useState(() => ({
    host: "",
    port: 6667,
    tls: false,
    nick: "whisper",
    password: "",
  }));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userProfile, setUserProfile] = useState(() => ({
    role: "user",
    displayName: "",
    nick: "whisper",
  }));
  const isAuthenticatedRef = useRef(isAuthenticated);

  const wsRef = useRef(null);
  const ircSettingsRef = useRef(ircSettings);
  const chatsRef = useRef(chats);

  const [wsStatus, setWsStatus] = useState("disconnected");
  const [ircConn, setIrcConn] = useState(() => ({ status: "disconnected", message: "" }));
  const [authState, setAuthState] = useState(() => ({ requiresAuth: false, authed: true }));
  const [lastError, setLastError] = useState("");

  const bottomRef = useRef(null);
  const typingTimerRef = useRef(null);

  useEffect(() => {
    ircSettingsRef.current = ircSettings;
  }, [ircSettings]);

  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated]);

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  const connectionLabel = useMemo(() => {
    const wsPart =
      wsStatus === "open"
        ? "Gateway: connected"
        : wsStatus === "connecting"
          ? "Gateway: connecting"
          : "Gateway: disconnected";

    const ircPart = ircConn.status ? `IRC: ${ircConn.status}` : "";

    const serverPart = ircSettings.host
      ? `${ircSettings.host}:${ircSettings.port}${ircSettings.tls ? " · TLS" : ""}`
      : "";

    const nickPart = ircSettings.nick?.trim() ? `nick: ${ircSettings.nick.trim()}` : "";

    const authPart = authState.requiresAuth ? (authState.authed ? "auth: ok" : "auth: required") : "";

    const errPart = lastError ? `Error: ${lastError}` : "";

    return [wsPart, ircPart, serverPart, nickPart, authPart, errPart].filter(Boolean).join(" · ");
  }, [wsStatus, ircConn.status, ircSettings, authState.requiresAuth, authState.authed, lastError]);

  const selectedChat = useMemo(
    () => chats.find((c) => c.id === selectedChatId) ?? chats[0],
    [chats, selectedChatId]
  );

  const messages = useMemo(
    () => messagesByChatId[selectedChatId] ?? [],
    [messagesByChatId, selectedChatId]
  );

  const lastMessageByChatId = useMemo(() => {
    const out = {};
    for (const chat of chats) {
      const list = messagesByChatId[chat.id] ?? [];
      out[chat.id] = list.length ? list[list.length - 1] : undefined;
    }
    return out;
  }, [messagesByChatId, chats]);

  const filteredChats = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return chats;

    return chats.filter((c) => {
      const last = lastMessageByChatId[c.id];
      const hay = `${c.username} ${previewForMessage(last)} ${c.ircTarget ?? ""} ${c.onionLink ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [chats, search, lastMessageByChatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [selectedChatId, messages.length, typingByChatId[selectedChatId]]);

  useEffect(() => {
    setEmojiOpen(false);
    setAttachOpen(false);
  }, [selectedChatId]);

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    };
  }, []);

  function wsSend(payload) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }

  function appendSystemMessage(text) {
    setMessagesByChatId((prev) => {
      const existing = prev[SYSTEM_CHAT_ID] ?? [];
      return {
        ...prev,
        [SYSTEM_CHAT_ID]: [...existing, createSystemMessage(text)],
      };
    });
  }

  function connectWithProfile(profile) {
    const nextSettings = {
      host: profile.host ?? "",
      port: profile.port ?? 6667,
      tls: Boolean(profile.tls),
      nick: profile.nick?.trim() || "whisper",
      password: profile.password ?? "",
    };

    setIrcSettings(nextSettings);
    setUserProfile({
      role: profile.role,
      displayName: profile.displayName ?? "",
      nick: nextSettings.nick,
    });
    setSelectedChatId(SYSTEM_CHAT_ID);
    setMobilePanel("list");
    setIsAuthenticated(true);
    setLoginOpen(false);
    appendSystemMessage(`${profile.role === "admin" ? "Admin" : "User"} login accepted.`);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsSend({ type: "settings:update", ...nextSettings, persist: true });
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const pageUrl = new URL(window.location.href);
    const token = pageUrl.searchParams.get("token");
    const wsUrl = `${proto}://${window.location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ""}`;

    setWsStatus("connecting");
    setLastError("");

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const handleOpen = () => {
      setWsStatus("open");
      setLastError("");

      if (isAuthenticatedRef.current) {
        const s = ircSettingsRef.current;
        wsSend({
          type: "settings:update",
          host: s.host,
          port: s.port,
          tls: s.tls,
          nick: s.nick,
          password: s.password,
          persist: true,
        });
      }
    };

    const handleClose = () => {
      setWsStatus("disconnected");
      setIrcConn({ status: "disconnected", message: "" });
      appendSystemMessage("Gateway disconnected.");
    };

    const handleError = () => {
      setLastError("WebSocket error");
      appendSystemMessage("Gateway WebSocket error.");
    };

    const handleMessage = (event) => {
      const raw = typeof event.data === "string" ? event.data : "";
      if (!raw) return;

      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }

      if (!data || typeof data !== "object") return;

      switch (data.type) {
        case "hello": {
          setAuthState({ requiresAuth: Boolean(data.requiresAuth), authed: Boolean(data.authed) });
          appendSystemMessage(`Gateway ready. Tor: ${data.irc?.tor ? "enabled" : "disabled"}.`);

          if (data.irc && typeof data.irc === "object") {
            setIrcSettings((prev) => ({
              ...prev,
              host: typeof data.irc.host === "string" ? data.irc.host : prev.host,
              port: typeof data.irc.port === "number" ? data.irc.port : prev.port,
              tls: typeof data.irc.tls === "boolean" ? data.irc.tls : prev.tls,
            }));
          }
          return;
        }

        case "irc:status": {
          setIrcConn({ status: String(data.status ?? "unknown"), message: String(data.message ?? "") });
          if (data.message) appendSystemMessage(`IRC ${String(data.status ?? "status")}: ${String(data.message)}`);
          return;
        }

        case "settings:applied": {
          const eff = data.effective;
          if (eff && typeof eff === "object") {
            setIrcSettings((prev) => ({
              ...prev,
              host: typeof eff.host === "string" ? eff.host : prev.host,
              port: typeof eff.port === "number" ? eff.port : prev.port,
              tls: typeof eff.tls === "boolean" ? eff.tls : prev.tls,
              nick: typeof eff.nick === "string" ? eff.nick : prev.nick,
            }));
          }
          return;
        }

        case "chats:reset": {
          setChats([createSystemChat()]);
          setMessagesByChatId((prev) => ({
            [SYSTEM_CHAT_ID]: prev[SYSTEM_CHAT_ID] ?? [],
          }));
          setTypingByChatId({});
          setSelectedChatId(SYSTEM_CHAT_ID);
          setMobilePanel("list");
          return;
        }

        case "chat:joined": {
          const chat = data.chat;
          if (!chat || typeof chat !== "object" || typeof chat.id !== "string") return;

          setChats((prev) => {
            const idx = prev.findIndex((c) => c.id === chat.id);
            if (idx !== -1) {
              const next = prev.slice();
              next[idx] = { ...prev[idx], ...chat };
              return next;
            }
            return [chat, ...prev];
          });

          setMessagesByChatId((prev) => ({ ...prev, [chat.id]: prev[chat.id] ?? [] }));
          setTypingByChatId((prev) => ({ ...prev, [chat.id]: false }));
          return;
        }

        case "chat:selected": {
          const chatId = typeof data.chatId === "string" ? data.chatId : "";
          if (!chatId) return;
          setSelectedChatId(chatId);
          setMobilePanel("chat");
          return;
        }

        case "msg:new": {
          const chatId = typeof data.chatId === "string" ? data.chatId : "";
          const message = data.message;
          if (!chatId || !message || typeof message !== "object") return;
          appendMessage(chatId, normalizeIncomingMessage(message));
          return;
        }

        case "irc:notice": {
          const target = typeof data.to === "string" ? data.to : "";
          const from = typeof data.from === "string" ? data.from : "";
          const text = typeof data.text === "string" ? data.text : "";
          const myNick = (ircSettingsRef.current.nick ?? "").trim().toLowerCase();
          const chatTarget = target && target.toLowerCase() === myNick ? from : target;
          const chat = chatsRef.current.find((c) => c.ircTarget?.toLowerCase() === chatTarget.toLowerCase());
          if (chat) {
            appendMessage(chat.id, {
              id: uid(),
              chatId: chat.id,
              direction: "system",
              type: "system",
              text: `NOTICE ${from ? `<${from}> ` : ""}${text}`,
              createdAt: Date.now(),
            });
          }
          return;
        }

        case "error": {
          const message = typeof data.message === "string" ? data.message : "Error";
          setLastError(message);
          appendSystemMessage(message);
          return;
        }

        default:
          return;
      }
    };

    ws.addEventListener("open", handleOpen);
    ws.addEventListener("close", handleClose);
    ws.addEventListener("error", handleError);
    ws.addEventListener("message", handleMessage);

    return () => {
      ws.removeEventListener("open", handleOpen);
      ws.removeEventListener("close", handleClose);
      ws.removeEventListener("error", handleError);
      ws.removeEventListener("message", handleMessage);
      try {
        ws.close();
      } catch {
        // ignore
      }
    };
  }, []);

  function openSettings() {
    setSettingsOpen(true);
  }

  function openJoin() {
    setJoinOpen(true);
  }

  function applyIrcSettings(next) {
    setIrcSettings(next);
    setLastError("");

    const ok = wsSend({ type: "settings:update", ...next, persist: true });
    if (!ok) {
      setLastError("Not connected to gateway");
      appendSystemMessage("Not connected to gateway.");
    }
  }

  function submitLogin() {
    const role = loginRole;
    const nextNick = loginDraft.nick.trim() || (role === "admin" ? "admin" : "whisper");
    const host = loginDraft.host.trim();
    const parsedPort = Number.parseInt(loginDraft.port, 10);
    const port = Number.isFinite(parsedPort) ? Math.min(65535, Math.max(1, parsedPort)) : 6667;

    if (!host) {
      setLastError("Please enter the IRC onion host.");
      appendSystemMessage("Please enter the IRC onion host.");
      return;
    }

    if (role === "admin") {
      if (loginDraft.username.trim() !== ADMIN_CREDENTIALS.username || loginDraft.password !== ADMIN_CREDENTIALS.password) {
        setLastError("Admin login failed.");
        appendSystemMessage("Admin login failed.");
        return;
      }
    }

    connectWithProfile({
      role,
      displayName: loginDraft.displayName.trim(),
      nick: nextNick,
      host,
      port,
      tls: Boolean(loginDraft.tls),
      password: loginDraft.password,
    });
  }

  function handleSelectChat(id) {
    setSelectedChatId(id);
    if (isMobile) setMobilePanel("chat");
  }

  function joinChat({ target, displayName }) {
    const tgt = target.trim();
    const dn = (displayName ?? "").trim();
    if (!tgt) return;

    setLastError("");

    const ok = wsSend({ type: "chat:join", target: tgt, displayName: dn });
    if (!ok) {
      setLastError("Not connected to gateway");
      appendSystemMessage("Not connected to gateway.");
      return;
    }

    setSearch("");
  }

  function appendMessage(chatId, message) {
    setMessagesByChatId((prev) => {
      const existing = prev[chatId] ?? [];
      return {
        ...prev,
        [chatId]: [...existing, message],
      };
    });
  }

  function sendTextMessage() {
    const text = draft.trim();
    if (!text || !selectedChatId) return;

    setLastError("");

    const ok = wsSend({ type: "msg:send", chatId: selectedChatId, text });
    if (!ok) {
      setLastError("Not connected to gateway");
      appendSystemMessage("Not connected to gateway.");
      return;
    }

    setDraft("");
  }

  function insertMockAttachment(kind) {
    if (!selectedChatId) return;
    setLastError(`Attachments (${kind}) not supported yet`);
  }

  async function uploadFile(file) {
    if (!selectedChatId || !file) return;

    const now = Date.now();
    const fileName = file.name || "file";
    const fileSize = formatFileSize(file.size);
    const mime = String(file.type || "").toLowerCase();
    let uploadedUrl = "";

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: {
          "content-type": file.type || "application/octet-stream",
          "x-file-name": encodeURIComponent(fileName),
        },
        body: file,
      });

      if (!res.ok) {
        throw new Error(`upload_failed_${res.status}`);
      }

      const payload = await res.json();
      uploadedUrl = typeof payload?.url === "string" ? payload.url : "";
      if (!uploadedUrl) throw new Error("missing_upload_url");
    } catch {
      setLastError("File upload failed");
      appendSystemMessage("File upload failed. Please try again.");
      return;
    }

    if (mime.startsWith("image/")) {
      appendMessage(selectedChatId, {
        id: uid(),
        chatId: selectedChatId,
        direction: "out",
        type: "image",
        url: uploadedUrl,
        caption: fileName,
        createdAt: now,
      });
    } else if (mime.startsWith("video/")) {
      appendMessage(selectedChatId, {
        id: uid(),
        chatId: selectedChatId,
        direction: "out",
        type: "video",
        url: uploadedUrl,
        caption: fileName,
        createdAt: now,
      });
    } else if (mime.startsWith("audio/")) {
      appendMessage(selectedChatId, {
        id: uid(),
        chatId: selectedChatId,
        direction: "out",
        type: "voice",
        url: uploadedUrl,
        createdAt: now,
      });
    } else {
      appendMessage(selectedChatId, {
        id: uid(),
        chatId: selectedChatId,
        direction: "out",
        type: "document",
        fileName,
        fileSize,
        url: uploadedUrl,
        createdAt: now,
      });
    }

    wsSend({
      type: "msg:send",
      chatId: selectedChatId,
      text: `[file] ${fileName} (${fileSize}) :: ${uploadedUrl}`,
    });
  }

  if (!isAuthenticated) {
    return (
      <LoginScreen
        role={loginRole}
        setRole={setLoginRole}
        draft={loginDraft}
        setDraft={setLoginDraft}
        onSubmit={submitLogin}
        connectionHint={connectionLabel}
      />
    );
  }

  const chatPanelDisplay = mobilePanel === "list" ? "hidden md:flex" : "flex";

  return (
    <div className="w-full h-[100dvh]" style={{ backgroundColor: THEME.appBg }}>
      <div className="flex h-full w-full overflow-hidden flex-col md:flex-row">
        <Sidebar
          chats={filteredChats}
          selectedChatId={selectedChatId}
          onSelectChat={handleSelectChat}
          search={search}
          setSearch={setSearch}
          lastMessageByChatId={lastMessageByChatId}
          hideOnMobile={mobilePanel === "chat"}
          onOpenSettings={openSettings}
          onOpenJoin={openJoin}
          connectionLabel={connectionLabel}
        />

        <main className={chatPanelDisplay + " h-full w-full min-w-0 flex-1 flex-col"}>
          {selectedChat ? (
            <>
              <ChatHeader
                chat={selectedChat}
                ircSettings={ircSettings}
                showBack={isMobile && mobilePanel === "chat"}
                onBack={() => setMobilePanel("list")}
                onOpenSettings={openSettings}
                onOpenJoin={openJoin}
              />
              <MessageList
                messages={messages}
                isTyping={Boolean(typingByChatId[selectedChatId])}
                bottomRef={bottomRef}
              />
              <ChatInput
                draft={draft}
                setDraft={setDraft}
                onSend={sendTextMessage}
                emojiOpen={emojiOpen}
                setEmojiOpen={setEmojiOpen}
                attachOpen={attachOpen}
                setAttachOpen={setAttachOpen}
                onInsertMock={insertMockAttachment}
                onUploadFile={uploadFile}
              />
            </>
          ) : (
            <div className="flex h-full items-center justify-center bg-white">
              <div className="text-center">
                <div className="text-lg font-semibold text-black/70">Select a chat</div>
                <div className="mt-1 text-sm text-black/45">Your messages will appear here.</div>
              </div>
            </div>
          )}
        </main>
      </div>

      <IrcSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        value={ircSettings}
        onSave={applyIrcSettings}
      />

      <JoinChatModal
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
        connectionLabel={connectionLabel}
        onJoin={joinChat}
      />
    </div>
  );
}

function LoginScreen({ role, setRole, draft, setDraft, onSubmit, connectionHint }) {
  const isAdmin = role === "admin";

  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(37,211,102,0.16),_transparent_34%),linear-gradient(180deg,#0f172a_0%,#0f172a_28%,#f0f2f5_28%,#f0f2f5_100%)] px-4 py-6">
      <div className="grid w-full max-w-6xl gap-6 rounded-[28px] bg-white shadow-2xl ring-1 ring-black/10 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
        <div className="hidden min-w-0 flex-col justify-between rounded-[28px] bg-[#0f172a] p-8 text-white lg:flex">
          <div>
            <div className="text-sm uppercase tracking-[0.3em] text-white/50">Hidden Whisper</div>
            <h1 className="mt-4 max-w-lg text-4xl font-semibold leading-tight">Log in as admin or user, then connect to your onion IRC server.</h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-white/70">
              Enter your details in the app. The gateway will verify Tor connectivity and show connection errors in the System chat.
            </p>
          </div>
          <div className="min-w-0 rounded-2xl bg-white/5 p-4 text-sm text-white/70 ring-1 ring-white/10">
            {connectionHint ? <div className="truncate">Current gateway: {connectionHint}</div> : <div>No gateway connection yet.</div>}
          </div>
        </div>

        <div className="min-w-0 p-6 sm:p-8">
          <div className="mb-6 lg:hidden">
            <div className="text-sm uppercase tracking-[0.3em] text-black/45">Hidden Whisper</div>
            <h1 className="mt-2 text-2xl font-semibold text-black/85">Login to continue</h1>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-black/5 p-1 ring-1 ring-black/5">
            <button
              type="button"
              onClick={() => setRole("user")}
              className={
                "rounded-xl px-4 py-3 text-sm font-semibold transition-colors " +
                (role === "user" ? "bg-white text-black shadow-sm" : "text-black/55 hover:text-black/75")
              }
            >
              User
            </button>
            <button
              type="button"
              onClick={() => setRole("admin")}
              className={
                "rounded-xl px-4 py-3 text-sm font-semibold transition-colors " +
                (role === "admin" ? "bg-white text-black shadow-sm" : "text-black/55 hover:text-black/75")
              }
            >
              Admin
            </button>
          </div>

          <div className="mt-6 grid gap-4">
            {isAdmin ? (
              <>
                <Field label="Admin Username" value={draft.username} onChange={(v) => setDraft((d) => ({ ...d, username: v }))} placeholder="admin" />
                <Field label="Admin Password" value={draft.password} onChange={(v) => setDraft((d) => ({ ...d, password: v }))} placeholder="admin" type="password" />
                <Field label="IRC Onion Host" value={draft.host} onChange={(v) => setDraft((d) => ({ ...d, host: v }))} placeholder="examplehiddenservice.onion" />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Port" value={draft.port} onChange={(v) => setDraft((d) => ({ ...d, port: v }))} placeholder="6667" type="number" />
                  <label className="flex items-center gap-2 rounded-xl bg-black/5 px-3 py-3 ring-1 ring-black/5">
                    <input
                      type="checkbox"
                      checked={draft.tls}
                      onChange={(e) => setDraft((d) => ({ ...d, tls: e.target.checked }))}
                      className="h-4 w-4 rounded border-black/20 text-[#25D366] focus:ring-[#25D366]/40"
                    />
                    <span className="text-sm font-semibold text-black/70">Use TLS</span>
                  </label>
                </div>
              </>
            ) : (
              <>
                <Field label="Display Name" value={draft.displayName} onChange={(v) => setDraft((d) => ({ ...d, displayName: v }))} placeholder="Your name" />
                <Field label="Nickname" value={draft.nick} onChange={(v) => setDraft((d) => ({ ...d, nick: v }))} placeholder="yourNick" />
                <Field label="IRC Onion Host" value={draft.host} onChange={(v) => setDraft((d) => ({ ...d, host: v }))} placeholder="examplehiddenservice.onion" />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Port" value={draft.port} onChange={(v) => setDraft((d) => ({ ...d, port: v }))} placeholder="6667" type="number" />
                  <label className="flex items-center gap-2 rounded-xl bg-black/5 px-3 py-3 ring-1 ring-black/5">
                    <input
                      type="checkbox"
                      checked={draft.tls}
                      onChange={(e) => setDraft((d) => ({ ...d, tls: e.target.checked }))}
                      className="h-4 w-4 rounded border-black/20 text-[#25D366] focus:ring-[#25D366]/40"
                    />
                    <span className="text-sm font-semibold text-black/70">Use TLS</span>
                  </label>
                </div>
              </>
            )}

            <button
              type="button"
              onClick={onSubmit}
              className="mt-2 inline-flex h-12 items-center justify-center rounded-full bg-[#25D366] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#1fb75a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366]/50"
            >
              Continue
            </button>

            <p className="text-xs leading-5 text-black/45">
              For now, admin credentials are <span className="font-semibold">admin / admin</span>. Onion link entry happens here in the app, not in the setup script.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-semibold text-black/70">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        className="h-11 w-full rounded-xl bg-white px-3 text-sm text-black/80 ring-1 ring-black/10 placeholder:text-black/40 focus:outline-none focus:ring-2 focus:ring-[#25D366]/40"
      />
    </label>
  );
}

function Modal({ open, title, onClose, children, footer }) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-x-hidden px-3 md:items-center md:px-4">
      <div className="absolute inset-0 bg-black/30" onMouseDown={onClose} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-xl overflow-hidden rounded-t-2xl bg-white shadow-xl ring-1 ring-black/10 md:rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-black/10 px-4 py-3">
          <div className="truncate text-sm font-semibold text-black/80">{title}</div>
          <IconButton title="Close" onClick={onClose}>
            <XIcon className="h-5 w-5" />
          </IconButton>
        </div>

        <div className="min-w-0 max-h-[70vh] overflow-y-auto px-4 py-4 md:max-h-[75vh]">
          {children}
        </div>

        {footer ? <div className="border-t border-black/10 px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

function IrcSettingsModal({ open, onClose, value, onSave }) {
  const [draft, setDraft] = useState(() => ({
    port: String(value.port ?? 6667),
    tls: Boolean(value.tls),
    nick: value.nick ?? "",
    password: value.password ?? "",
  }));

  useEffect(() => {
    if (!open) return;
    setDraft({
      port: String(value.port ?? 6667),
      tls: Boolean(value.tls),
      nick: value.nick ?? "",
      password: value.password ?? "",
    });
  }, [open, value]);

  const previewProto = draft.tls ? "ircs" : "irc";
  const previewHost = value.host?.trim() || "(set on login)";
  const previewPort = draft.port || "6667";

  return (
    <Modal
      open={open}
      title="IRC Settings"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-semibold text-black/70 transition-colors hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366]/40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              const parsed = Number.parseInt(draft.port, 10);
              const port = Number.isFinite(parsed) ? Math.min(65535, Math.max(1, parsed)) : 6667;
              onSave({
                host: value.host ?? "",
                port,
                tls: Boolean(draft.tls),
                nick: draft.nick.trim(),
                password: draft.password,
              });
              onClose();
            }}
            className="inline-flex h-10 items-center justify-center rounded-full bg-[#25D366] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1fb75a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366]/50"
          >
            Save
          </button>
        </div>
      }
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <label className="text-xs font-semibold text-black/70">Port</label>
            <input
              value={draft.port}
              onChange={(e) => setDraft((d) => ({ ...d, port: e.target.value }))}
              type="number"
              min={1}
              max={65535}
              inputMode="numeric"
              placeholder="6667"
              className="h-11 w-full rounded-xl bg-white px-3 text-sm text-black/80 ring-1 ring-black/10 placeholder:text-black/40 focus:outline-none focus:ring-2 focus:ring-[#25D366]/40"
            />
          </div>

          <label className="flex items-center gap-2 rounded-xl bg-black/5 px-3 py-3 ring-1 ring-black/5">
            <input
              type="checkbox"
              checked={draft.tls}
              onChange={(e) => setDraft((d) => ({ ...d, tls: e.target.checked }))}
              className="h-4 w-4 rounded border-black/20 text-[#25D366] focus:ring-[#25D366]/40"
            />
            <span className="text-sm font-semibold text-black/70">Use TLS</span>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <label className="text-xs font-semibold text-black/70">Nickname</label>
            <input
              value={draft.nick}
              onChange={(e) => setDraft((d) => ({ ...d, nick: e.target.value }))}
              placeholder="yourNick"
              className="h-11 w-full rounded-xl bg-white px-3 text-sm text-black/80 ring-1 ring-black/10 placeholder:text-black/40 focus:outline-none focus:ring-2 focus:ring-[#25D366]/40"
            />
          </div>

          <div className="grid gap-1.5">
            <label className="text-xs font-semibold text-black/70">Password (optional)</label>
            <input
              value={draft.password}
              onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))}
              type="password"
              placeholder="server password"
              className="h-11 w-full rounded-xl bg-white px-3 text-sm text-black/80 ring-1 ring-black/10 placeholder:text-black/40 focus:outline-none focus:ring-2 focus:ring-[#25D366]/40"
            />
          </div>
        </div>

        <div className="rounded-xl bg-[#f0f2f5] px-3 py-2 text-xs text-black/55 ring-1 ring-black/5">
          <div className="font-semibold text-black/65">Preview</div>
          <div className="mt-0.5 break-all whitespace-normal">
            {previewProto}://{previewHost}:{previewPort}
            {draft.nick.trim() ? ` · nick: ${draft.nick.trim()}` : ""}
          </div>
        </div>

        <div className="text-xs text-black/45">
          Onion host is set from login only. These settings update connection identity/options.
        </div>
      </div>
    </Modal>
  );
}

function JoinChatModal({ open, onClose, onJoin, connectionLabel }) {
  const [target, setTarget] = useState("");
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    if (!open) return;
    setTarget("");
    setDisplayName("");
  }, [open]);

  const canJoin = target.trim().length > 0;

  return (
    <Modal
      open={open}
      title="Join chat"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-semibold text-black/70 transition-colors hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366]/40"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canJoin}
            onClick={() => {
              if (!canJoin) return;
              onJoin({ target, displayName });
              onClose();
            }}
            className={
              "inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-semibold text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366]/50 " +
              (canJoin ? "bg-[#25D366] hover:bg-[#1fb75a]" : "bg-black/20 cursor-not-allowed")
            }
          >
            Join
          </button>
        </div>
      }
    >
      <div className="grid gap-3">
        {connectionLabel ? (
          <div className="min-w-0 rounded-xl bg-black/5 px-3 py-2 text-xs text-black/55 ring-1 ring-black/5">
            <div className="font-semibold text-black/65">Current server</div>
            <div className="mt-0.5 break-all whitespace-normal">{connectionLabel}</div>
          </div>
        ) : null}

        <div className="grid gap-1.5">
          <label className="text-xs font-semibold text-black/70">Chat target</label>
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="#channel or nickname"
            className="h-11 w-full rounded-xl bg-white px-3 text-sm text-black/80 ring-1 ring-black/10 placeholder:text-black/40 focus:outline-none focus:ring-2 focus:ring-[#25D366]/40"
          />
        </div>

        <div className="grid gap-1.5">
          <label className="text-xs font-semibold text-black/70">Display name (optional)</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Shown in sidebar"
            className="h-11 w-full rounded-xl bg-white px-3 text-sm text-black/80 ring-1 ring-black/10 placeholder:text-black/40 focus:outline-none focus:ring-2 focus:ring-[#25D366]/40"
          />
        </div>

        <div className="text-xs text-black/45">
          Joining sends a request to the gateway using the onion host configured at login.
        </div>
      </div>
    </Modal>
  );
}

function SearchIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.3-4.3m1.8-5.2a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

function PlusIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SettingsIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.4 15a8 8 0 00.1-2l2-1.5-2-3.5-2.4 1a8 8 0 00-1.7-1l-.3-2.6h-4l-.3 2.6a8 8 0 00-1.7 1L6.7 8l-2 3.5 2 1.5a8 8 0 000 2l-2 1.5 2 3.5 2.4-1a8 8 0 001.7 1l.3 2.6h4l.3-2.6a8 8 0 001.7-1l2.4 1 2-3.5-2-1.5z"
      />
    </svg>
  );
}

function ArrowLeftIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function XIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function PhoneIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M22 16.9v2a2 2 0 01-2.2 2A19.7 19.7 0 013 5.2 2 2 0 015 3h2a2 2 0 012 1.7c.1 1 .4 2 .8 2.9a2 2 0 01-.5 2.1L8.9 11a16 16 0 006.1 6.1l1.3-1.2a2 2 0 012.1-.5c.9.4 1.9.7 2.9.8A2 2 0 0122 16.9z"
      />
    </svg>
  );
}

function VideoIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4-2v8l-4-2v2a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h8a2 2 0 012 2v2z" />
    </svg>
  );
}

function MenuIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  );
}

function EmojiIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 22a10 10 0 110-20 10 10 0 010 20z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 14s1.5 2 4 2 4-2 4-2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 10h.01M15 10h.01" />
    </svg>
  );
}

function AttachIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21.4 11.6l-8.8 8.8a5 5 0 01-7.1-7.1l9.5-9.5a3.5 3.5 0 015 5l-9.5 9.5a2 2 0 11-2.8-2.8l8.8-8.8"
      />
    </svg>
  );
}

function MicIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 21h8" />
    </svg>
  );
}

function SendIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M2.3 12.1a1 1 0 01.6-1.2l18-8a1 1 0 011.4 1.1l-4.2 18a1 1 0 01-1.5.6l-5.3-3.2-3.2 3.6a1 1 0 01-1.7-.7v-4.3l9.6-10.3-12.1 8.7 4.4 1.7-6.4-2.5a1 1 0 01-.6-.7z" />
    </svg>
  );
}

function DoubleCheckIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 13l3 3L17 9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13l3 3" />
    </svg>
  );
}

function DocIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 2v6h6" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 13h8" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 17h6" />
    </svg>
  );
}

function PlayIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M8 5.5v13a1 1 0 001.6.8l10-6.5a1 1 0 000-1.6l-10-6.5A1 1 0 008 5.5z" />
    </svg>
  );
}

function ChevronRightIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
    </svg>
  );
}
