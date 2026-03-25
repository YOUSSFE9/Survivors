/**
 * GameRoom — Self-contained Socket.IO game room.
 * Supports duel (1v1), squad (teams), war (20-player FFA).
 * Server-authoritative: player positions and monster AI run here.
 */
const { MazeGenerator } = require('./logic/MazeGenerator');
const { MonsterAI }     = require('./logic/MonsterAI');

let roomCounter = 0;

const MODE_CONFIG = {
    duel:  { maxPlayers: 2,  botAfterSec: 15, monstersPerWave: 3  },
    squad: { maxPlayers: 8,  botAfterSec: -1, monstersPerWave: 6  },
    war:   { maxPlayers: 20, botAfterSec: 1,  monstersPerWave: 12 },
};

// Pool of realistic-sounding Arabic/international bot names
const BOT_NAMES = [
    'shadowXZ', 'ViperKing', 'DarkSoul', 'PhantomX', 'NightHawk',
    'BloodMoon', 'IronFist', 'GhostRider', 'StormBreaker', 'DeathBlade',
    'RedDevil', 'BlackWolf', 'SilentKill', 'WarMachine', 'CrimsonAce',
    'FrostBite', 'ThunderBolt', 'SteelSerpent', 'MadBull', 'RavenClaw',
];
let _botNameIdx = 0;

const PLAYER_SPEED = 5.4;    // px per tick (matched to client 180px/sec at 33Hz)
const TICK_MS      = 30;     // 33 Hz for smoother movement

class GameRoom {
    constructor(roomType, isPrivate = false) {
        this.id         = `${roomType}_${++roomCounter}_${Date.now().toString(36)}`;
        this.roomType   = roomType;
        this.isPrivate  = isPrivate;
        this.cfg        = MODE_CONFIG[roomType] || MODE_CONFIG.duel;
        this.phase      = 'lobby'; // lobby | playing | ended

        this.sockets    = new Map(); // socket.id → socket
        this.players    = {};        // socket.id → player state
        this.monsters   = {};
        this.bullets     = [];
        this.playerInputs = {};

        this.tickTimer  = null;
        this.monsterAI  = null;
        this.mazeData   = null;
        this.mazeSeed   = 0;

        // squad
        this.redCode    = '';
        this.blueCode   = '';
        this.hostId     = null;

        // duel random
        this._duelTimer     = null;
        this._duelElapsed   = 0;

        // war bot fill
        this._botFillTimer    = null;
        this._botShootTimer   = {};  // botId → last shoot ms
        this._monsterTimer    = null; // periodic monster spawn
        this._warEliminated   = new Set(); // real player IDs who have received their loss message
        this._countdownTimer  = null;
        this._lastShotAt      = {};
        this.collectedKeyIds  = new Set();
        this.portalSpawned    = false;
        this.portalPos        = null;
    }

    /* ═══════════ PLAYER MANAGEMENT ═══════════ */

    addPlayer(socket, opts, silent = false) {
        this.sockets.set(socket.id, socket);

        let team = 'none';
        if (this.roomType === 'squad') {
            team = opts.reqTeam || 'red';
        }

        const spawn = this.mazeData?.playerSpawn;
        const ts = 32;
        const spawnX = spawn ? spawn.x * ts + ts / 2 : 100;
        const spawnY = spawn ? spawn.y * ts + ts / 2 : 100;

        this.players[socket.id] = {
            sessionId: socket.id,
            uid:  opts.uid  || '',
            name: opts.name || 'Player',
            avatarUrl: opts.avatarUrl || '',
            team,
            x: spawnX, y: spawnY,
            rotation: 0,
            health: 100,
            alive: true,
            kills: 0,
            isBot: false,
        };
        this.playerInputs[socket.id] = { dx: 0, dy: 0, rotation: 0 };

        // First player is host
        if (!this.hostId) {
            this.hostId = socket.id;
        }

        // Squad codes (generate but don't broadcast yet if silent)
        if (this.roomType === 'squad' && !this.redCode) {
            this.redCode  = this.id + '-R';
            this.blueCode = this.id + '-B';
        }

        // If not silent, broadcast immediately (used for mid-game joins)
        if (!silent) {
            this._sendPlayerInitialState(socket.id);
        }
    }

    /**
     * Send initial state to a specific player.
     * Called AFTER the join ack so the client has handlers registered.
     */
    sendInitialState(socketId) {
        const socket = this.sockets.get(socketId);
        if (!socket) return;

        // Host status
        if (this.hostId === socketId) {
            socket.emit('host_status', { isHost: true });
        }

        // Squad codes
        if (this.roomType === 'squad' && this.redCode) {
            socket.emit('squad_codes', { redCode: this.redCode, blueCode: this.blueCode });
        }

        // Send lobby players to ALL (includes the new player)
        this._broadcastLobbyPlayers();

        // Notify others about the new player
        const p = this.players[socketId];
        if (p) {
            this._broadcastAll('player_joined', {
                sessionId: socketId, name: p.name, team: p.team,
                x: p.x, y: p.y, avatarUrl: p.avatarUrl,
            });
        }

        // Duel auto-start logic
        if (this.roomType === 'duel') {
            this._checkDuelStart();
        }

        // War: start bot fill as soon as 1st real player joins
        if (this.roomType === 'war' && !this._botFillTimer) {
            this._startWarBotFill();
        }
    }

    removePlayer(socket) {
        const sid = socket.id;
        if (!this.sockets.has(sid)) return;

        this.sockets.delete(sid);
        delete this.players[sid];
        delete this.playerInputs[sid];

        // Notify others
        this._broadcastAll('player_left', sid);
        this._broadcastLobbyPlayers();

        // Transfer host
        if (this.hostId === sid) {
            const next = this.sockets.keys().next().value;
            this.hostId = next || null;
            if (next) {
                this.sockets.get(next)?.emit('new_host', { hostId: next });
                this.sockets.get(next)?.emit('host_status', { isHost: true });
            }
        }
    }

    playerCount() { return this.sockets.size; }
    realCount()   { return Object.values(this.players).filter(p => !p.isBot).length; }
    isFull()      { return this.playerCount() >= this.cfg.maxPlayers; }

    /* ═══════════ MESSAGES FROM CLIENT ═══════════ */

    onMessage(socket, type, data) {
        switch (type) {
            case 'input': {
                const dx = Number.isFinite(Number(data?.dx)) ? Number(data.dx) : 0;
                const dy = Number.isFinite(Number(data?.dy)) ? Number(data.dy) : 0;
                const rotation = Number.isFinite(Number(data?.rotation)) ? Number(data.rotation) : 0;
                this.playerInputs[socket.id] = {
                    dx: Math.max(-1, Math.min(1, dx)),
                    dy: Math.max(-1, Math.min(1, dy)),
                    rotation,
                };
                break;
            }
            case 'shoot':
                this._handleShoot(socket.id, data);
                break;
            case 'host_start':
                if (socket.id === this.hostId && this.phase === 'lobby') {
                    this._startGame();
                }
                break;
            case 'move_team':
                this._moveTeam(socket.id, data?.targetId);
                break;
            case 'kick_player':
                this._kickPlayer(socket.id, data?.targetId);
                break;
            case 'pickup_key': {
                const pk = this.players[socket.id];
                const keyId = Number(data?.keyId);
                if (
                    pk &&
                    pk.alive &&
                    this.phase === 'playing' &&
                    this.mazeData?.keyPositions &&
                    Number.isInteger(keyId) &&
                    keyId >= 0 &&
                    keyId < this.mazeData.keyPositions.length &&
                    !this.collectedKeyIds.has(keyId)
                ) {
                    const keyTile = this.mazeData.keyPositions[keyId];
                    const ts = 32;
                    const keyX = keyTile.x * ts + ts / 2;
                    const keyY = keyTile.y * ts + ts / 2;
                    const dx = pk.x - keyX;
                    const dy = pk.y - keyY;
                    // Server-side pickup validation radius
                    if (dx * dx + dy * dy <= 90 * 90) {
                        this.collectedKeyIds.add(keyId);
                        this._broadcastAll('key_collected', { keyId, sessionId: socket.id });
                    } else {
                        break;
                    }

                    pk.keys = (pk.keys || 0) + 1;
                    if (pk.keys >= 10 && !this.portalSpawned) {
                        this.portalSpawned = true;
                        // Pick a random room floor for portal
                        const rooms = this.mazeData.rooms || [];
                        const floor = rooms.length > 0 ? rooms[Math.floor(Math.random() * rooms.length)] : { x: 5, y: 5, w: 2, h: 2 };
                        const ts = 32;
                        this.portalPos = {
                            x: (floor.x + floor.w / 2) * ts,
                            y: (floor.y + floor.h / 2) * ts
                        };
                        this._broadcastAll('portal_spawned', this.portalPos);
                    }
                }
                break;
            }
            case 'enter_portal': {
                const ep = this.players[socket.id];
                if (ep && ep.alive && ep.keys >= 10 && this.portalPos) {
                    const dx = ep.x - this.portalPos.x, dy = ep.y - this.portalPos.y;
                    if (Math.sqrt(dx*dx+dy*dy) < 80) { // Validated distance
                        const winnerStats = ep;
                        const finalStats = {};
                        for (const [id, p] of Object.entries(this.players)) {
                            finalStats[id] = {
                                kills: p.kills || 0,
                                killDetails: p.killStats || {},
                                deathDetails: p.deathStats || {},
                            };
                        }
                        this._broadcastAll('game_over', { 
                            winner: socket.id, 
                            winnerName: winnerStats?.name,
                            stats: finalStats
                        });
                        this.phase = 'ended';
                        this._stopTick();
                    }
                }
                break;
            }
            case 'request_respawn':
                console.log(`[GameRoom] request_respawn from ${socket.id}, alive: ${this.players[socket.id]?.alive}, phase: ${this.phase}`);
                if (this.players[socket.id] && !this.players[socket.id].alive) {
                    const rp = this.players[socket.id];
                    const ts = 32;
                    const floor = this._getRandomWalkableFloor();
                    rp.x = floor.x * ts + ts / 2;
                    rp.y = floor.y * ts + ts / 2;
                    rp.health = 100;
                    rp.alive = true;
                    if (this.phase === 'ended') {
                        console.log('[GameRoom] Restarting tick loop for respawn');
                        this.phase = 'playing';
                        this._startTick();
                    }
                }
                break;
            case 'pickup_item':
                // Broadcast pickup removal to all clients
                if (data?.pickupIndex !== undefined) {
                    this._broadcastAll('pickup_collected', {
                        pickupIndex: data.pickupIndex,
                        type: data.type,
                        sessionId: socket.id,
                    });
                }
                break;
            case 'ready':
                break;
        }
    }

    /* ═══════════ DUEL ═══════════ */

    _checkDuelStart() {
        const real = this.realCount();
        if (real >= 2 && this.phase === 'lobby') {
            // Show preview then start
            const pp = Object.values(this.players).map(p => ({
                name: p.name, sessionId: p.sessionId, avatarUrl: p.avatarUrl, team: p.team,
            }));
            this._broadcastAll('match_preview', { players: pp, seconds: 3 });
            setTimeout(() => {
                if (this.phase === 'lobby') this._startGame();
            }, 3000);
            return;
        }

        // Start duel timer for bot
        if (real === 1 && !this.isPrivate && !this._duelTimer) {
            this._duelElapsed = 0;
            this._duelTimer = setInterval(() => {
                this._duelElapsed++;
                if (this._duelElapsed >= 15) {
                    clearInterval(this._duelTimer);
                    this._duelTimer = null;
                    // Add bot and start
                    this._addBot();
                    this._startGame();
                }
            }, 1000);
        }
    }

    _addBot(nameOverride) {
        const botId   = `bot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,5)}`;
        const botName = nameOverride || BOT_NAMES[_botNameIdx++ % BOT_NAMES.length];
        const spawn   = this.mazeData?.playerSpawn;
        const ts      = 32;
        const spawnX  = spawn ? spawn.x * ts + ts / 2 + (Math.random() - 0.5) * 80 : 100 + Math.random() * 60;
        const spawnY  = spawn ? spawn.y * ts + ts / 2 + (Math.random() - 0.5) * 80 : 100 + Math.random() * 60;
        this.players[botId] = {
            sessionId: botId, uid: 'bot', name: botName, avatarUrl: '',
            team: 'none',
            x: spawnX, y: spawnY,
            rotation: 0, health: 100, alive: true, kills: 0, isBot: true,
            // roam state
            _roamTarget: null, _roamTick: 0,
        };
        this._botShootTimer[botId] = 0;
        return botId;
    }

    /* ═══════════ WAR BOT FILL ═══════════ */

    _startWarBotFill() {
        this._broadcastAll('war_fill_started', {});
        this._botFillTimer = setInterval(() => {
            if (this.phase !== 'lobby') {
                clearInterval(this._botFillTimer);
                this._botFillTimer = null;
                return;
            }
            const total = Object.keys(this.players).length;
            if (total < this.cfg.maxPlayers) {
                this._addBot();
                this._broadcastWarRoster();
            }
            if (Object.keys(this.players).length >= this.cfg.maxPlayers) {
                clearInterval(this._botFillTimer);
                this._botFillTimer = null;
                // Small delay so player can see the full roster, then countdown
                setTimeout(() => {
                    if (this.phase === 'lobby') this._startCountdown(5);
                }, 1500);
            }
        }, 1000);
    }

    /* ═══════════ GAME LIFECYCLE ═══════════ */

    _startCountdown(seconds) {
        if (this._countdownTimer) {
            clearInterval(this._countdownTimer);
            this._countdownTimer = null;
        }
        let t = seconds;
        this._countdownTimer = setInterval(() => {
            this._broadcastAll('countdown', { seconds: t });
            t--;
            if (t < 0) {
                clearInterval(this._countdownTimer);
                this._countdownTimer = null;
                this._startGame();
            }
        }, 1000);
    }

    _startGame() {
        if (this.phase !== 'lobby') return;
        if (this._duelTimer) { clearInterval(this._duelTimer); this._duelTimer = null; }
        if (this._countdownTimer) { clearInterval(this._countdownTimer); this._countdownTimer = null; }

        this.phase = 'playing';
        this.portalSpawned = false;
        this.portalPos = null;
        this.collectedKeyIds.clear();
        this._warEliminated.clear();

        // Generate maze
        this.mazeSeed  = Math.floor(Math.random() * 999999);
        this.mazeData  = MazeGenerator.generate(20, 20, 3, this.mazeSeed);

        // Position players on separate walkable tiles
        const usedSpawns = new Set();
        for (const [, p] of Object.entries(this.players)) {
            // Find a unique walkable tile far from others
            const floor = this._getUniqueSpawn(usedSpawns);
            p.x = floor.x;
            p.y = floor.y;
            p.health = 100;
            p.alive = true;
        }

        // Monster AI
        this.monsterAI = new MonsterAI(this.mazeData, { monsters: this.monsters });
        this.monsterAI.spawnWave(this.cfg.monstersPerWave);

        // Build player list for clients
        const playerList = Object.values(this.players).map(p => ({
            sessionId: p.sessionId, name: p.name, team: p.team,
            x: p.x, y: p.y, avatarUrl: p.avatarUrl,
        }));

        // Generate authoritative wormholes (10 random locations)
        this._generateWormholes();

        this._broadcastAll('game_started', {
            seed: this.mazeSeed,
            grid: this.mazeData.grid,
            wormholes: this.wormholesData,
            players: playerList,
            trapPositions: this.mazeData.trapPositions || [],
        });

        // Start tick loop
        this._startTick();

        // War: spawn 1 new monster every 5 seconds
        if (this.roomType === 'war') {
            this._monsterTimer = setInterval(() => {
                if (this.phase !== 'playing') {
                    clearInterval(this._monsterTimer);
                    this._monsterTimer = null;
                    return;
                }
                if (this.monsterAI) this.monsterAI.spawnOne();
            }, 5000);
        }
    }

    _generateWormholes() {
        const { grid, width, height } = this.mazeData;
        const candidates = [];
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                if (grid[y][x] === 0) candidates.push({ x, y });
            }
        }
        // Shuffle and pick 10
        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }
        const colors = [0xff2222, 0x22ff22, 0x2222ff, 0xffff22, 0xff22ff, 0x22ffff, 0xff8822, 0xff2288, 0x88ff22, 0xffffff];
        this.wormholesData = candidates.slice(0, 10).map((pos, i) => ({
            x: pos.x, y: pos.y, color: colors[i % colors.length]
        }));
    }

    /* ═══════════ TICK LOOP (20 Hz) ═══════════ */

    _startTick() {
        if (this.tickTimer) return;
        this.tickTimer = setInterval(() => this._tick(), TICK_MS);
    }

    _stopTick() {
        if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
    }

    _tick() {
        if (this.phase !== 'playing') return;

        // 1. Move players based on inputs
        for (const [sid, input] of Object.entries(this.playerInputs)) {
            const p = this.players[sid];
            if (!p || !p.alive || p.isBot) continue;
            const len = Math.sqrt(input.dx * input.dx + input.dy * input.dy);
            if (len > 0.01) {
                const nx = p.x + (input.dx / len) * PLAYER_SPEED;
                const ny = p.y + (input.dy / len) * PLAYER_SPEED;
                if (this._isWalkable(nx, ny)) {
                    p.x = nx; p.y = ny;
                } else if (this._isWalkable(nx, p.y)) {
                    p.x = nx;
                } else if (this._isWalkable(p.x, ny)) {
                    p.y = ny;
                }
                p.rotation = input.rotation || 0;

                // 1b. Check wormhole collision
                this._checkWormhole(p);
            }
        }

        // 1c. Push out any player that ended up inside a wall
        for (const [, p] of Object.entries(this.players)) {
            if (!p.alive) continue;
            if (!this._isWalkable(p.x, p.y)) {
                const safe = this._pushOutOfWall(p.x, p.y);
                p.x = safe.x;
                p.y = safe.y;
            }
        }

        // 2. Move bots
        this._botAI();

        // 3. Monster AI
        if (this.monsterAI) {
            this.monsterAI.update(TICK_MS, this.players);
        }

        // 4. Process bullets
        this._processBullets();

        // 5. Check win conditions
        this._checkWin();

        // 6. Broadcast state
        const statePlayers = {};
        for (const [sid, p] of Object.entries(this.players)) {
            statePlayers[sid] = {
                x: Math.round(p.x * 10) / 10,
                y: Math.round(p.y * 10) / 10,
                rotation: Math.round(p.rotation * 100) / 100,
                health: p.health,
                alive: p.alive,
                name: p.name,
                team: p.team,
                kills: p.kills,
            };
        }

        const stateMonsters = {};
        for (const [id, m] of Object.entries(this.monsters)) {
            if (!m.alive) continue;
            stateMonsters[id] = {
                x: Math.round(m.x * 10) / 10,
                y: Math.round(m.y * 10) / 10,
                health: m.health, maxHealth: m.maxHealth,
                type: m.type, alive: m.alive,
            };
        }

        this._broadcastAll('state_tick', {
            players: statePlayers,
            monsters: stateMonsters,
        });
    }

    _checkWormhole(p) {
        if (!this.wormholesData || (p._tpCooldown && Date.now() < p._tpCooldown)) return;
        const ts = 32;
        for (const wh of this.wormholesData) {
            const wx = wh.x * ts + ts/2, wy = wh.y * ts + ts/2;
            const dx = p.x - wx, dy = p.y - wy;
            if (dx*dx+dy*dy < 500) { // ~22px radius
                // Teleport to a DIFFERENT wormhole
                const exits = this.wormholesData.filter(w => w !== wh);
                if (exits.length === 0) return;
                const exit  = exits[Math.floor(Math.random() * exits.length)];
                p.x = exit.x * ts + ts/2;
                p.y = exit.y * ts + ts/2;
                p._tpCooldown = Date.now() + 3000;
                this._broadcastAll('teleport', { sessionId: p.sessionId, x: p.x, y: p.y, color: exit.color });
                break;
            }
        }
    }

    /* ═══════════ WALL COLLISION ═══════════ */

    _getRandomWalkableFloor() {
        if (!this.mazeData || !this.mazeData.grid) return { x: 5, y: 5 };
        const { grid, width, height } = this.mazeData;
        const candidates = [];
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                if (grid[y][x] === 0) candidates.push({ x, y });
            }
        }
        if (candidates.length === 0) return { x: Math.floor(width/2), y: Math.floor(height/2) };
        const tile = candidates[Math.floor(Math.random() * candidates.length)];
        const ts = this.mazeData.tileSize;
        return { x: tile.x * ts + ts/2, y: tile.y * ts + ts/2 };
    }

    /**
     * Returns a safe spawn position not already used by another player.
     * Tries to spread players across the map at least 5 tiles apart.
     */
    _getUniqueSpawn(usedSpawns) {
        if (!this.mazeData) return { x: 96, y: 96 };
        const { grid, width, height, tileSize: ts } = this.mazeData;
        const candidates = [];
        for (let y = 2; y < height - 2; y++)
            for (let x = 2; x < width - 2; x++)
                if (grid[y][x] === 0) candidates.push({ x, y });

        // Shuffle
        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }

        for (const c of candidates) {
            const wx = c.x * ts + ts/2, wy = c.y * ts + ts/2;
            const key = `${c.x}_${c.y}`;
            if (usedSpawns.has(key)) continue;
            // Ensure at least 4 tiles separation from existing spawns
            let tooClose = false;
            for (const s of usedSpawns) {
                const [sx, sy] = s.split('_').map(Number);
                if (Math.abs(sx - c.x) + Math.abs(sy - c.y) < 4) { tooClose = true; break; }
            }
            if (!tooClose) {
                usedSpawns.add(key);
                return { x: wx, y: wy };
            }
        }
        // Fallback: just take a non-collision floor
        const fb = candidates[0] || { x: 2, y: 2 };
        return { x: fb.x * ts + ts/2, y: fb.y * ts + ts/2 };
    }

    _isWalkable(wx, wy) {
        if (!this.mazeData) return true;
        const { grid, width, height, tileSize } = this.mazeData;
        const MARGIN = 12;
        const corners = [
            [wx - MARGIN, wy - MARGIN], [wx + MARGIN, wy - MARGIN],
            [wx - MARGIN, wy + MARGIN], [wx + MARGIN, wy + MARGIN],
        ];
        for (const [px, py] of corners) {
            const gx = Math.floor(px / tileSize);
            const gy = Math.floor(py / tileSize);
            if (gx < 0 || gy < 0 || gx >= width || gy >= height) return false;
            if (grid[gy][gx] !== 0) return false;
        }
        return true;
    }

    /* ═══════════ BOT AI ═══════════ */

    _botAI() {
        const now = Date.now();
        const allPlayers = Object.values(this.players).filter(p => p.alive);
        const realAlive  = allPlayers.filter(p => !p.isBot);

        for (const [sid, p] of Object.entries(this.players)) {
            if (!p.isBot || !p.alive) continue;

            // Find nearest target (prefer real players, fallback to other bots)
            let targets = realAlive.length > 0 ? realAlive : allPlayers.filter(b => b.sessionId !== sid);
            let nearest = null, nearestD = Infinity;
            for (const t of targets) {
                const dx = t.x - p.x, dy = t.y - p.y;
                const d2 = dx * dx + dy * dy;
                if (d2 < nearestD) { nearestD = d2; nearest = t; }
            }

            const CHASE_RANGE  = 250; // px — close enough to chase
            const SHOOT_RANGE  = 320; // px — shoot if in range
            const BOT_SPEED    = PLAYER_SPEED * 0.78;
            const SHOOT_CD     = 1800 + Math.random() * 800; // ms between shots

            if (nearest) {
                const dx   = nearest.x - p.x;
                const dy   = nearest.y - p.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                p.rotation = Math.atan2(dy, dx);

                // ── SHOOT at target ──
                if (dist < SHOOT_RANGE) {
                    const lastShot = this._botShootTimer[sid] || 0;
                    if (now - lastShot > SHOOT_CD) {
                        this._botShootTimer[sid] = now;
                        // Add aim jitter so bots aren't 100% accurate
                        const jitter  = (Math.random() - 0.5) * 0.3;
                        const angle   = Math.atan2(dy, dx) + jitter;
                        const SPEED   = 800;
                        this.bullets.push({
                            ownerId: sid,
                            x: p.x, y: p.y,
                            vx: Math.cos(angle) * SPEED,
                            vy: Math.sin(angle) * SPEED,
                            damage: 12,
                            ttl: 60,
                        });
                        this._broadcastAll('bullet_fired', {
                            x: p.x, y: p.y,
                            vx: Math.cos(angle) * SPEED,
                            vy: Math.sin(angle) * SPEED,
                            damage: 12, ownerId: sid,
                        });
                    }
                }

                // ── MOVE toward target (stop at CHASE_RANGE/2 to orbit) ──
                if (dist > CHASE_RANGE * 0.4) {
                    const jx  = (Math.random() - 0.5) * 0.25;
                    const jy  = (Math.random() - 0.5) * 0.25;
                    const ldx = (dx / dist) + jx;
                    const ldy = (dy / dist) + jy;
                    const bnx = p.x + ldx * BOT_SPEED;
                    const bny = p.y + ldy * BOT_SPEED;
                    if (this._isWalkable(bnx, bny))      { p.x = bnx; p.y = bny; }
                    else if (this._isWalkable(bnx, p.y)) { p.x = bnx; }
                    else if (this._isWalkable(p.x, bny)) { p.y = bny; }
                }
            } else {
                // ── ROAM randomly when no target ──
                p._roamTick = (p._roamTick || 0) - 1;
                if (p._roamTick <= 0 || !p._roamTarget) {
                    const roam = this._getRandomWalkableFloor();
                    p._roamTarget = roam;
                    p._roamTick   = 40 + Math.floor(Math.random() * 40);
                }
                const tdx  = p._roamTarget.x - p.x;
                const tdy  = p._roamTarget.y - p.y;
                const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
                if (tdist > 10) {
                    const bnx = p.x + (tdx / tdist) * BOT_SPEED;
                    const bny = p.y + (tdy / tdist) * BOT_SPEED;
                    if (this._isWalkable(bnx, bny))      { p.x = bnx; p.y = bny; }
                    else if (this._isWalkable(bnx, p.y)) { p.x = bnx; }
                    else if (this._isWalkable(p.x, bny)) { p.y = bny; }
                    p.rotation = Math.atan2(tdy, tdx);
                } else {
                    p._roamTarget = null; // reached, pick new
                }
            }
        }
    }

    /* ═══════════ SHOOTING ═══════════ */

    _handleShoot(sid, data) {
        const p = this.players[sid];
        if (!p || !p.alive || this.phase !== 'playing') return;

        const now = Date.now();
        const rawVx = Number.isFinite(Number(data?.vx)) ? Number(data.vx) : 0;
        const rawVy = Number.isFinite(Number(data?.vy)) ? Number(data.vy) : 0;
        const isExplosive = !!data?.isExplosive;
        const cooldown = isExplosive ? 900 : 110;
        const lastShot = this._lastShotAt[sid] || 0;
        if (now - lastShot < cooldown) return;

        const mag = Math.sqrt(rawVx * rawVx + rawVy * rawVy);
        if (mag < 10) return;

        const maxSpeed = isExplosive ? 650 : 850;
        const clampedMag = Math.min(mag, maxSpeed);
        const dirX = rawVx / mag;
        const dirY = rawVy / mag;
        const vx = dirX * clampedMag;
        const vy = dirY * clampedMag;
        const damage = isExplosive ? 60 : 35;

        this._lastShotAt[sid] = now;

        if (this.bullets.length > 1600) {
            this.bullets.splice(0, this.bullets.length - 1200);
        }

        this.bullets.push({
            ownerId: sid,
            x: p.x, y: p.y,
            vx, vy,
            damage,
            ttl: 60, // 3 seconds at 20Hz
        });

        // Broadcast shot effect to others
        this._broadcastAll('bullet_fired', {
            x: p.x, y: p.y, vx, vy, damage, ownerId: sid,
        });
    }

    _processBullets() {
        const toRemove = [];
        const dt = 0.05; // 20Hz tick rate = 0.05s per tick
        
        for (let i = 0; i < this.bullets.length; i++) {
            const b = this.bullets[i];
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.ttl--;

            // Wall check
            if (!this._isWalkable(b.x, b.y)) { toRemove.push(i); continue; }
            if (b.ttl <= 0) { toRemove.push(i); continue; }

            // Hit other players
            for (const [sid, p] of Object.entries(this.players)) {
                if (sid === b.ownerId || !p.alive) continue;
                const dx = p.x - b.x, dy = p.y - b.y;
                if (dx * dx + dy * dy < 784) { // 28px radius — wider to handle 20Hz tick jumps
                    p.health -= b.damage;
                    if (p.health <= 0) {
                        p.health = 0;
                        p.alive  = false;
                        
                        // Kills & Deaths Tracking
                        const killer = this.players[b.ownerId];
                        if (killer) {
                            killer.kills++;
                            killer.killStats = killer.killStats || {};
                            killer.killStats[sid] = (killer.killStats[sid] || 0) + 1;
                        }
                        p.deathStats = p.deathStats || {};
                        p.deathStats[b.ownerId] = (p.deathStats[b.ownerId] || 0) + 1;
                        
                        // Respawn is now triggered by client clicking "Retry" via "request_respawn"
                    }
                    toRemove.push(i);
                    break;
                }
            }

            // Hit monsters
            for (const [, m] of Object.entries(this.monsters)) {
                if (!m.alive) continue;
                const dx = m.x - b.x, dy = m.y - b.y;
                if (dx * dx + dy * dy < 400) {
                    m.health -= b.damage;
                    if (m.health <= 0) { m.health = 0; m.alive = false; }
                    toRemove.push(i);
                    break;
                }
            }
        }

        // Remove hit bullets (reverse order)
        for (let i = toRemove.length - 1; i >= 0; i--) {
            this.bullets.splice(toRemove[i], 1);
        }
    }

    /* ═══════════ WIN CONDITIONS ═══════════ */

    _checkWin() {
        if (this.phase !== 'playing') return;

        if (this.roomType === 'duel') {
            const alive = Object.values(this.players).filter(p => p.alive);
            if (alive.length <= 1 && Object.keys(this.players).length > 1) {
                console.log(`[GameRoom] Duel ended! Alive: ${alive.length}`);
                this._endGame(alive[0]);
            }
        } else if (this.roomType === 'war') {
            // Notify each newly-dead real player individually (loss screen)
            const realPlayers = Object.values(this.players).filter(p => !p.isBot);
            for (const p of realPlayers) {
                if (!p.alive && !this._warEliminated.has(p.sessionId)) {
                    this._warEliminated.add(p.sessionId);
                    const sock = this.sockets.get(p.sessionId);
                    if (sock) {
                        const finalStats = {};
                        for (const [id, pl] of Object.entries(this.players)) {
                            finalStats[id] = { kills: pl.kills || 0, killDetails: pl.killStats || {}, deathDetails: pl.deathStats || {} };
                        }
                        // Send ONLY to this player — game continues for others!
                        sock.emit('player_eliminated', { stats: finalStats });
                    }
                }
            }

            // End the war only when ALL real players are eliminated
            const aliveReal = realPlayers.filter(p => p.alive);
            if (aliveReal.length === 0 && realPlayers.length > 0) {
                // Last real player wins (could be the final one standing)
                // Actually everyone has been eliminated — show general game over
                console.log('[GameRoom] War ended — all real players eliminated');
                const topKiller = realPlayers.sort((a, b) => (b.kills||0) - (a.kills||0))[0];
                this._endGame(topKiller);
            } else if (aliveReal.length === 1 && realPlayers.length > 1) {
                // One real player remains — they WIN
                console.log('[GameRoom] War ended — last real player standing!');
                this._endGame(aliveReal[0]);
            }
        }
    }

    _endGame(winner) {
        const finalStats = {};
        for (const [id, p] of Object.entries(this.players)) {
            finalStats[id] = {
                kills: p.kills || 0,
                killDetails: p.killStats || {},
                deathDetails: p.deathStats || {},
            };
        }
        this._broadcastAll('game_over', {
            winner: winner?.sessionId || '',
            winnerName: winner?.name || '',
            stats: finalStats,
        });
        this.phase = 'ended';
        this._stopTick();
    }

    /* ═══════════ SQUAD UTILS ═══════════ */

    _moveTeam(actorId, targetId) {
        if (actorId !== this.hostId || this.phase !== 'lobby') return;
        const p = this.players[targetId];
        if (p) {
            p.team = p.team === 'red' ? 'blue' : 'red';
            this._broadcastLobbyPlayers();
        }
    }

    _kickPlayer(actorId, targetId) {
        if (actorId !== this.hostId || this.phase !== 'lobby' || actorId === targetId) return;
        const sock = this.sockets.get(targetId);
        if (sock) {
            sock.emit('kicked');
            this.removePlayer(sock);
        }
    }

    /* ═══════════ BROADCAST ═══════════ */

    _broadcastAll(event, data) {
        for (const [, sock] of this.sockets) {
            sock.emit(event, data);
        }
    }

    _broadcastLobbyPlayers() {
        const realList = Object.values(this.players)
            .filter(p => !p.isBot)
            .map(p => ({ name: p.name, team: p.team, sessionId: p.sessionId, avatarUrl: p.avatarUrl }));
        this._broadcastAll('lobby_players', realList);

        if (this.roomType === 'war') {
            this._broadcastWarRoster();
        }
    }

    _broadcastWarRoster() {
        // War roster shows BOTH real players and bots (bots look like real players)
        const fullList = Object.values(this.players)
            .map(p => ({ name: p.name, team: p.team, sessionId: p.sessionId, avatarUrl: p.avatarUrl }));
        this._broadcastAll('war_roster', { players: fullList });
    }

    /* ═══════════ CLEANUP ═══════════ */

    dispose() {
        this._stopTick();
        if (this._duelTimer)    clearInterval(this._duelTimer);
        if (this._botFillTimer) clearInterval(this._botFillTimer);
        if (this._monsterTimer) clearInterval(this._monsterTimer);
        if (this._countdownTimer) clearInterval(this._countdownTimer);
        this.sockets.clear();
        this.players  = {};
        this.monsters = {};
        this.playerInputs = {};
        this.bullets = [];
        this._lastShotAt = {};
        this.collectedKeyIds.clear();
    }
}

module.exports = { GameRoom };
