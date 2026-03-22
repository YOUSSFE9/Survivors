/**
 * DAHT Multiplayer Server — Entry Point
 * Uses the 'colyseus' package (v0.15) which bundles the WS transport.
 */
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'colyseus';
import { MazeRoom } from './rooms/MazeRoom';
import { LobbyRoom } from './rooms/LobbyRoom';

const PORT = Number(process.env.PORT) || 2567;

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

const httpServer = createServer(app);

const gameServer = new Server({ server: httpServer });

// Register rooms for each mode
gameServer.define('duel',  MazeRoom, { mode: 'duel',  maxPlayers: 2,  teams: false });
gameServer.define('squad', MazeRoom, { mode: 'squad', maxPlayers: 8,  teams: true  });
gameServer.define('war',   MazeRoom, { mode: 'war',   maxPlayers: 20, teams: false });
gameServer.define('lobby', LobbyRoom);

httpServer.listen(PORT, () => {
    console.log(`\n🚀 DAHT Server running on port ${PORT}`);
    console.log(`   Rooms: duel | squad | war`);
});
