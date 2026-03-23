/**
 * DAHT Multiplayer Server
 * Plain JavaScript — no build step, just: npm install && npm start
 * Colyseus 0.15 + Express + CORS
 *
 * Rooms:
 *   duel  → 1v1
 *   squad → up to 4v4 (red vs blue)
 *   war   → 20 FFA
 */
const express = require('express');
const cors = require('cors');
const http = require('http');
const colyseus = require('colyseus');
const { MazeRoom } = require('./rooms/MazeRoom');
const { LobbyRoom } = require('./rooms/LobbyRoom');

const PORT = process.env.PORT || 2567;

const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: false,
};

const app = express();
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Pre-flight for all routes
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

const httpServer = http.createServer(app);

const gameServer = new colyseus.Server({ server: httpServer });

gameServer.define('duel',  MazeRoom, { mode: 'duel',  maxPlayers: 2,  teams: false });
gameServer.define('squad', MazeRoom, { mode: 'squad', maxPlayers: 8,  teams: true  });
gameServer.define('war',   MazeRoom, { mode: 'war',   maxPlayers: 20, teams: false });
gameServer.define('lobby', LobbyRoom);

httpServer.listen(PORT, () => {
    console.log(`\n🚀 DAHT Server → ws://localhost:${PORT}`);
    console.log(`   Rooms: duel | squad | war`);
});
