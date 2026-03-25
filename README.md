# DAHT

Top-down survival shooter built with React + Phaser and a Socket.IO multiplayer server.

## Local Development

Client:

```bash
npm install
npm run dev
```

Server:

```bash
cd server
npm install
npm run dev
```

## Production Build

Client:

```bash
npm run build
```

Server:

```bash
npm run server:build
npm run server:start
```

## Environment

Create `.env.local` from `.env.example` and set:

- `VITE_SERVER_URL` (Socket.IO endpoint, `http(s)://...`)
- Firebase keys (if online auth/prizes are enabled)

## PWA / Mobile Install

- Manifest: `public/manifest.json`
- Service worker: `public/sw.js`
- Icons: `public/icon-192.png`, `public/icon-512.png`

Installable requirements:

- Serve over HTTPS (or localhost in development)
- Valid manifest + service worker + icons
- User opens the app in a supported mobile browser (Chrome/Edge/Safari)
