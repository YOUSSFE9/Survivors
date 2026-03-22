# DAHT — Multiplayer Server (Colyseus)

## Quick Start (Local Dev)

```bash
# 1. Install dependencies
cd server
npm install

# 2. Start server (TypeScript hot-reload)
npm run dev
```

Server runs on: `ws://localhost:2567`  
Monitor panel: `http://localhost:2567/colyseus` (dev only)

---

## Game Modes

| Room Name | Mode       | Players | Teams |
|-----------|------------|---------|-------|
| `duel`    | 1v1        | 2       | No    |
| `squad`   | Team vs Team | 4–8  | Red vs Blue |
| `war`     | Free-for-All | 2–20 | No    |

All modes have **monsters + enemies** spawned and managed by the server.

---

## Deployment — Oracle Cloud (Free Forever)

1. Create an **Oracle Cloud Always Free** Compute instance (ARM)
2. SSH into it and run:
```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 process manager
npm install -g pm2

# Clone your repo
git clone <your-repo> daht && cd daht/server
npm install && npm run build

# Start with PM2
pm2 start build/index.js --name daht-server
pm2 startup && pm2 save
```

3. Open firewall port `2567` (TCP) in Oracle Cloud Security List
4. Set client env: `VITE_SERVER_URL=wss://YOUR_IP:2567`

---

## Client Environment

Copy `.env.example` to `.env.local` and fill in:
```env
VITE_SERVER_URL=ws://localhost:2567
```

For production replace with your Oracle Cloud server URL.

---

## Architecture

```
Client (Vercel)              Server (Oracle Cloud)
────────────────             ─────────────────────
Phaser + React               Node.js + Colyseus
OnlineSync.ts           ←→   MazeRoom.ts
NetworkManager.ts            MonsterAI.ts (authoritative)
RemotePlayer.ts              GameState schema (delta sync)
OnlineLobby.tsx              LobbyRoom.ts
```

**Server is authoritative** — all collision, damage, death, and key collection is calculated server-side. Clients only send inputs.
