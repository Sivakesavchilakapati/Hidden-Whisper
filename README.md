# Hidden Whisper

Hidden Whisper is a React chat UI with a Node gateway that talks to IRC through Tor. The browser connects to the gateway over WebSocket; the gateway connects to your IRC server or onion endpoint.

## What you need

- Node.js 20+.
- Tor running on the host machine or EC2 instance.
- Your IRC server reachable over a `.onion` address.
- For a self-hosted IRC server, InspIRCd is a good fit.

## Local development

1. Copy [.env.example](.env.example) to `.env`.
2. Make sure Tor is listening on `127.0.0.1:9050` or update `TOR_SOCKS_HOST` and `TOR_SOCKS_PORT`.
3. Run:

```bash
npm run dev:full
```

That starts the gateway on port `3000` and Vite on the next free port.

If you run only `npm run dev`, Vite will show `ws proxy error ECONNREFUSED` because the gateway is not running on port `3000` yet.

## One-click setup scripts

Windows:

- Run [scripts/windows/setup_and_run.bat](scripts/windows/setup_and_run.bat) as Administrator.
- Or run PowerShell setup: [scripts/windows/setup_and_run.ps1](scripts/windows/setup_and_run.ps1).
- To package a standalone `.exe`, run [scripts/windows/build_setup_exe.ps1](scripts/windows/build_setup_exe.ps1).
- Test checks: [scripts/windows/test_stack.bat](scripts/windows/test_stack.bat).
- The setup runner now verifies Tor SOCKS on `127.0.0.1:9050` and starts `tor.exe` automatically if needed.
- The setup runner no longer asks for the onion host. Enter it in the app login screen instead.
- The setup runner opens `http://localhost:3000` automatically when starting the gateway.

Linux (Ubuntu):

- Run `sudo bash scripts/linux/setup_and_run.sh`.
- Test checks: `bash scripts/linux/test_stack.sh`.
- The setup runner installs Tor/runtime pieces and leaves onion entry to the app login screen.

## Production on EC2

1. Install Node.js and Tor on the instance.
2. Clone the repo and run:

```bash
npm ci
npm run build
```

3. Create `.env` from [.env.example](.env.example) and set:

- `IRC_HOST` to your IRC onion host, or leave it blank and enter it from the app login screen.
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
- If you lock server settings, set `ALLOW_CLIENT_IRC_SETTINGS=false`.
- Put Nginx in front of the Node process if you want TLS termination and a stable public port.

## Scripts

- `npm run dev` starts Vite only.
- `npm run dev:server` starts the gateway only.
- `npm run dev:server:watch` starts the gateway in watch mode.
- `npm run dev:full` starts both gateway and UI together.
- `npm run build` builds the frontend.
- `npm run start` serves the built frontend and gateway together.