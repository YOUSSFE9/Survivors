# DAHT Server (Socket.IO)

## Run

```bash
cd server
npm install
npm run dev
```

Production:

```bash
cd server
npm install --omit=dev
npm start
```

Default port: `2567`

Health checks:

- `GET /`
- `GET /health`

## Environment

- `PORT` (optional, default `2567`)
- `CORS_ORIGINS` (optional, comma-separated origins, default `*`)

Example:

```env
PORT=2567
CORS_ORIGINS=https://your-game.com,https://www.your-game.com
```

## Notes

- Server authority is enforced for movement, shots, key pickups, and win conditions.
- Room modes: `duel`, `squad`, `war`.
