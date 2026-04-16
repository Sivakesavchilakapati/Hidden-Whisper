# Hidden Whisper

Hidden Whisper is a React chat UI with a Node gateway that talks to IRC through Tor. The browser connects to the gateway over WebSocket; the gateway connects to your IRC server or onion endpoint.

## What you need

- Node.js 20+.
- Tor running on the host machine or EC2 instance.
- Your IRC server reachable over a `.onion` address.
- For a self-hosted IRC server, InspIRCd is a good fit.

## Local development

1. Copy [.env.example](.env.example) to `.env`.
2. Set `IRC_HOST` to your onion IRC host.
3. Make sure Tor is listening on `127.0.0.1:9050` or update `TOR_SOCKS_HOST` and `TOR_SOCKS_PORT`.
4. Run:

```bash
npm run dev:full
```

That starts the gateway on port `3000` and Vite on the next free port.

## Production on EC2

1. Install Node.js and Tor on the instance.
2. Clone the repo and run:

```bash
npm ci
npm run build
```

3. Create `.env` from [.env.example](.env.example) and set:

- `IRC_HOST` to your IRC onion host.
- `IRC_PORT` to your IRC server port.
- `IRC_TLS=true` if the onion endpoint expects TLS.
- `TOR_ENABLED=true`.
- `TOR_SOCKS_HOST` and `TOR_SOCKS_PORT` to your Tor SOCKS listener.

4. Start the app:

```bash
npm run start
```

The built UI and WebSocket gateway will be served from the same process.

## Optional hardening

- Set `APP_ACCESS_TOKEN` and pass it in the URL as `?token=...`.
- Keep `ALLOW_CLIENT_IRC_SETTINGS=false` unless you want the UI to override the server IRC host per session.
- Put Nginx in front of the Node process if you want TLS termination and a stable public port.

## Scripts

- `npm run dev` starts Vite only.
- `npm run dev:server` starts the gateway only.
- `npm run dev:server:watch` starts the gateway in watch mode.
- `npm run dev:full` starts both gateway and UI together.
- `npm run build` builds the frontend.
- `npm run start` serves the built frontend and gateway together.