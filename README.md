# EDDN Live Feed Blocks

A static, browser-only dashboard for viewing live Elite Dangerous Data Network messages.

## Goals

- Run from GitHub Pages as plain HTML/CSS/JavaScript.
- Keep this repository backend-free.
- Show incoming EDDN messages grouped into separate presentation blocks by schema/message type.
- Show the full message content inside that type-specific block.
- Provide a top-level filter that applies on every keystroke.
- Keep the UI readable for fast-moving live data.

## Important architecture note

The official EDDN listener feed is ZeroMQ. Browsers on GitHub Pages cannot connect to ZeroMQ directly.

This app therefore expects a browser-compatible WebSocket endpoint carrying EDDN messages. By default it uses:

```text
wss://ws.eddn-realtime.space/eddn
```

That keeps this project static: there is no backend in this repository and nothing to deploy except GitHub Pages. If a different EDDN WebSocket relay is preferred, use:

```text
https://c2technology.github.io/eddn-live-feed/?ws=wss://example.com/eddn
```

## Local development

Because the app uses JavaScript modules, serve it over HTTP:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/
```

## Deployment

This is a static site. After merge, configure GitHub Pages to deploy from the `main` branch root. No project backend or build step is required.
