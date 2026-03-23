/**
 * MazeRoom — Core game room. Plain JavaScript, Colyseus 0.15.
 * Server-authoritative: collision, damage, keys, monsters.
 * 3 modes: duel (1v1), squad (4v4 teams), war (20 FFA).
 */
const colyseus = require('colyseus');
const { MonsterAI } = require('../logic/MonsterAI');
const { MazeGenerator } = require('../logic/MazeGenerator');

const TICK_MS = 50;       // 20 Hz
const PLAYER_SPEED = 9;   // px per tick (180 px/s ÷ 20 Hz)
const BULLET_SPEED = 20;  // px per tick (400 px/s ÷ 20 Hz)
const BULLET_TTL_TICKS = 40; // 2 seconds at 20 Hz

const TINTS = [
    0xff3333, 0x33ff88, 0x3388ff, 0xffdd33, 0xff33ff,
    0x33ffdd, 0xff8833, 0x88ff33, 0xdd33ff, 0x33ccff,
    0xff5533, 0x55ff88, 0xddbb33, 0x5588ff, 0xff55aa
];

const NAMES = [
    'Shadow_Ghost','Dark_Viper','NeonKiller','IronWolf','StealthX',
    'BloodMoon','QuantumZ','DeathShot','CyberFox','PhantomX'
];

class MazeRoom extends colyseus.Room {
    onCreate(options) {
        this.options = options;
        this.maxClients = options.maxPlayers || 20;

        const seed = Math.floor(Math.random() * 999999);
        const mazeData = MazeGenerator.generate(20, 20, 3, seed);

        // Squad Team Codes
        if (options.mode === 'squad') {
            this.redCode = this.roomId + '-R';
            this.blueCode = this.roomId + '-B';
        }

        // Plain JS game state (broadcast as JSON)
        this.gs = {
            mode: options.mode,
            phase: 'waiting',
            seed,
            winner: '',
            tick: 0,
            players: {},   // sessionId → PlayerState
            monsters: {},  // id → MonsterState
            bullets: [],   // BulletState[]
        };

        this.monsterAI = new MonsterAI(mazeData, this.gs);
        this.monsterAI.spawnWave(5);

        this.playerInputs = {};
        this.bulletCounter = 0;
        this._portalSpawned = false;
        
        this.hostSessionId = null; // First player to join becomes host
        this.countdownTimer = null;
        this.countdownSeconds = 0;

        // Handle messages
        this.onMessage('input', (client, msg) => {
            if (this.gs.phase === 'playing') this.playerInputs[client.sessionId] = msg;
        });

        this.onMessage('shoot', (client, msg) => {
            this._spawnBullet(client.sessionId, msg);
        });

        this.onMessage('pickup_key', (client, msg) => {
            this._handlePickup(client.sessionId, msg.keyId);
        });

        // Host controls
        this.onMessage('host_start', (client) => {
            if (client.sessionId !== this.hostSessionId) return;
            this._triggerCountdown();
        });

        this.onMessage('kick_player', (client, { targetId }) => {
            if (client.sessionId !== this.hostSessionId) return;
            const target = this.clients.find(c => c.sessionId === targetId);
            if (target) target.leave(4000, 'kicked');
        });

        this.onMessage('move_team', (client, { targetId }) => {
            if (client.sessionId !== this.hostSessionId) return;
            const p = this.gs.players[targetId];
            if (!p) return;
            p.team = p.team === 'red' ? 'blue' : 'red';
            p.tint = p.team === 'red' ? 0xff4444 : 0x4488ff;
            this._broadcastLobbyState();
        });

        this.onMessage('enter_portal', (client) => {
            this._handlePortal(client.sessionId);
        });

        // Game tick
        this.tickTimer = this.clock.setInterval(() => this._tick(), TICK_MS);

        // Monster wave every 10s
        this.clock.setInterval(() => {
            if (this.gs.phase !== 'playing') return;
            const alive = Object.values(this.gs.monsters).filter(m => m.alive).length;
            const cap = Math.min(20, 5 + Object.keys(this.gs.players).length * 2);
            if (alive < cap) this.monsterAI.spawnWave(Math.min(5, cap - alive));
        }, 10000);

        console.log(`[MazeRoom] created — mode:${options.mode} maxPlayers:${this.maxClients}`);
    }

    onJoin(client, opts = {}) {
        const playerCount = Object.keys(this.gs.players).length;
        
        // First player becomes host
        if (!this.hostSessionId) {
            this.hostSessionId = client.sessionId;
        }

        let team = 'none';
        let tint = TINTS[playerCount % TINTS.length];

        if (this.options.teams) {
            if (opts.reqTeam === 'red' || opts.reqTeam === 'blue' || opts.team === 'red' || opts.team === 'blue') {
                team = opts.reqTeam || opts.team;
            } else {
                // Auto balance
                const red  = Object.values(this.gs.players).filter(p => p.team === 'red').length;
                const blue = Object.values(this.gs.players).filter(p => p.team === 'blue').length;
                team = red <= blue ? 'red' : 'blue';
            }
            tint = team === 'red' ? 0xff4444 : 0x4488ff;
        }

        const spawn = this.monsterAI.getSpawnPos();

        this.gs.players[client.sessionId] = {
            sessionId: client.sessionId,
            uid: opts.uid || client.sessionId,
            name: opts.name || NAMES[playerCount % NAMES.length],
            team,
            tint,
            x: spawn.x,
            y: spawn.y,
            rotation: 0,
            health: 100,
            maxHealth: 100,
            alive: true,
            keys: 0,
            kills: 0,
            weapon: '',
        };

        // Send team codes if squad
        if (this.options.mode === 'squad') {
            client.send('red_room_code', { code: this.redCode });
            client.send('blue_room_code', { code: this.blueCode });
        }
        
        // Tell client if they are host
        client.send('host_status', { isHost: client.sessionId === this.hostSessionId });

        // Broadcast updated lobby/state
        this._broadcastLobbyState();
        this._broadcastState();
        this._checkStart();

        console.log(`[MazeRoom] ${opts.name} joined (${team})`);
    }

    onLeave(client) {
        const wasHost = client.sessionId === this.hostSessionId;
        delete this.gs.players[client.sessionId];
        this.broadcast('player_left', client.sessionId);

        // Transfer host to next player if host left
        if (wasHost) {
            const remaining = Object.keys(this.gs.players);
            this.hostSessionId = remaining.length > 0 ? remaining[0] : null;
            if (this.hostSessionId) {
                const newHost = this.clients.find(c => c.sessionId === this.hostSessionId);
                if (newHost) newHost.send('host_status', { isHost: true });
            }
            this.broadcast('new_host', { hostId: this.hostSessionId });
        }

        this._broadcastLobbyState();
        if (Object.keys(this.gs.players).length === 0) this.disconnect();
    }

    onDispose() {
        console.log('[MazeRoom] disposed');
    }

    _broadcastLobbyState() {
        if (this.gs.phase !== 'waiting') return;
        const list = Object.values(this.gs.players).map(p => ({
            sessionId: p.sessionId,
            name: p.name,
            team: p.team
        }));
        this.broadcast('lobby_players', list);
    }

    _checkStart() {
        // Cancels countdown if room falls below minimum players
        if (!this.countdownTimer) return;
        const all = Object.values(this.gs.players);
        let stillValid = false;
        if (this.options.mode === 'duel' && all.length >= 2) stillValid = true;
        if (this.options.mode === 'war' && all.length >= 2) stillValid = true;
        if (this.options.mode === 'squad') {
            const red = all.filter(p => p.team === 'red').length;
            const blue = all.filter(p => p.team === 'blue').length;
            if (red > 0 && blue > 0) stillValid = true;
        }
        if (!stillValid) {
            this.countdownTimer.clear();
            this.countdownTimer = null;
            this.broadcast('countdown', { seconds: null });
        }
    }

    _triggerCountdown() {
        if (this.gs.phase !== 'waiting' || this.countdownTimer) return;
        const all = Object.values(this.gs.players);
        let countdownTime = 5;
        if (this.options.mode === 'war') countdownTime = 10;
        if (this.options.mode === 'squad') countdownTime = 10;
        
        this.countdownSeconds = countdownTime;
        this.broadcast('countdown', { seconds: this.countdownSeconds });
        this.countdownTimer = this.clock.setInterval(() => {
            this.countdownSeconds--;
            if (this.countdownSeconds <= 0) {
                this.countdownTimer.clear();
                this.countdownTimer = null;
                this._startGame();
            } else {
                this.broadcast('countdown', { seconds: this.countdownSeconds });
            }
        }, 1000);
    }

    _startGame() {
        if (this.gs.phase !== 'waiting') return;
        this.gs.phase = 'playing';
        this.broadcast('game_started', {
            seed: this.gs.seed,
            mode: this.gs.mode,
            players: Object.values(this.gs.players),
        });
        console.log(`[MazeRoom] STARTED — mode:${this.gs.mode} players:${Object.keys(this.gs.players).length}`);
    }

    // ══════════════════════
    //  TICK (20 Hz)
    // ══════════════════════
    _tick() {
        if (this.gs.phase !== 'playing') return;
        this.gs.tick++;

        // Apply inputs
        for (const [sid, input] of Object.entries(this.playerInputs)) {
            const p = this.gs.players[sid];
            if (!p || !p.alive) continue;
            const len = Math.sqrt(input.dx * input.dx + input.dy * input.dy);
            if (len > 0.01) {
                p.x += (input.dx / len) * PLAYER_SPEED;
                p.y += (input.dy / len) * PLAYER_SPEED;
                p.rotation = input.rotation;
                p.x = Math.max(0, Math.min(p.x, this.monsterAI.worldW));
                p.y = Math.max(0, Math.min(p.y, this.monsterAI.worldH));
            }
        }

        // Move bullets + check hits
        for (let i = this.gs.bullets.length - 1; i >= 0; i--) {
            const b = this.gs.bullets[i];
            b.x += b.vx; b.y += b.vy;
            b.ttl--;
            if (b.ttl <= 0) { this.gs.bullets.splice(i, 1); continue; }
            if (this._checkBulletHit(b)) { this.gs.bullets.splice(i, 1); }
        }

        // Monster AI
        this.monsterAI.update(TICK_MS, this.gs.players);

        // Broadcast compact state diff
        this._broadcastCompact();
    }

    _spawnBullet(ownerId, msg) {
        if (this.gs.phase !== 'playing') return;
        const p = this.gs.players[ownerId];
        if (!p || !p.alive) return;

        this.gs.bullets.push({
            id: `b${this.bulletCounter++}`,
            x: p.x, y: p.y,
            vx: (msg.vx / 400) * BULLET_SPEED * 20,
            vy: (msg.vy / 400) * BULLET_SPEED * 20,
            damage: msg.damage || 10,
            ownerId,
            isExplosive: msg.isExplosive || false,
            ttl: BULLET_TTL_TICKS,
        });
    }

    _checkBulletHit(bullet) {
        const R2 = 18 * 18;

        // vs players
        for (const [sid, p] of Object.entries(this.gs.players)) {
            if (sid === bullet.ownerId || !p.alive) continue;
            if (this.options.teams) {
                const owner = this.gs.players[bullet.ownerId];
                if (owner && owner.team === p.team) continue; // no friendly fire
            }
            const dx = bullet.x - p.x, dy = bullet.y - p.y;
            if (dx*dx + dy*dy < R2) {
                this._damagePlayer(p, bullet.damage, bullet.ownerId);
                return true;
            }
        }

        // vs monsters
        for (const m of Object.values(this.gs.monsters)) {
            if (!m.alive) continue;
            const dx = bullet.x - m.x, dy = bullet.y - m.y;
            if (dx*dx + dy*dy < R2) {
                m.health -= bullet.damage;
                if (m.health <= 0) {
                    m.alive = false;
                    const p = this.gs.players[bullet.ownerId];
                    if (p) p.kills++;
                }
                return true;
            }
        }

        return false;
    }

    _damagePlayer(target, dmg, killerId) {
        target.health -= dmg;
        if (target.health <= 0) {
            target.health = 0;
            target.alive = false;
            const killer = this.gs.players[killerId];
            if (killer) killer.kills++;
            this._checkWinCondition();
        }
    }

    _handlePickup(sid, keyId) {
        const p = this.gs.players[sid];
        if (!p || !p.alive) return;
        p.keys++;
        this.broadcast('key_collected', { keyId, by: sid, team: p.team });
        this._checkPortalSpawn();
    }

    _checkPortalSpawn() {
        const total = Object.values(this.gs.players).reduce((s, p) => s + p.keys, 0);
        if (total >= 10 && !this._portalSpawned) {
            this._portalSpawned = true;
            const pos = this.monsterAI.getSpawnPos();
            this.broadcast('portal_spawned', pos);
        }
    }

    _handlePortal(sid) {
        if (!this._portalSpawned) return;
        const p = this.gs.players[sid];
        if (!p || !p.alive) return;
        const winner = this.options.teams ? p.team : p.uid;
        this._endGame(winner, p.name);
    }

    _checkWinCondition() {
        const alive = Object.values(this.gs.players).filter(p => p.alive);
        if (this.options.mode === 'duel' && alive.length === 1) {
            this._endGame(alive[0].uid, alive[0].name);
            return;
        }
        if (this.options.teams) {
            const red  = alive.filter(p => p.team === 'red').length;
            const blue = alive.filter(p => p.team === 'blue').length;
            if (red === 0 && blue > 0) this._endGame('blue', 'الفريق الأزرق');
            if (blue === 0 && red > 0) this._endGame('red', 'الفريق الأحمر');
        }
        if (this.options.mode === 'war' && alive.length === 1) {
            this._endGame(alive[0].uid, alive[0].name);
        }
    }

    _endGame(winner, killerName) {
        if (this.gs.phase === 'ended') return;
        this.gs.phase = 'ended';
        this.gs.winner = winner;
        this.broadcast('game_over', { winner, killerName, mode: this.gs.mode });
        this.clock.setTimeout(() => this.disconnect(), 5000);
    }

    // Broadcast full state
    _broadcastState() {
        this.broadcast('state_full', this.gs);
    }

    // Broadcast compact positions + health
    _broadcastCompact() {
        this.broadcast('state_tick', {
            tick: this.gs.tick,
            players: Object.fromEntries(
                Object.entries(this.gs.players).map(([sid, p]) => [sid, {
                    x: p.x, y: p.y, rotation: p.rotation,
                    health: p.health, alive: p.alive, keys: p.keys, kills: p.kills,
                }])
            ),
            monsters: Object.fromEntries(
                Object.entries(this.gs.monsters).map(([id, m]) => [id, {
                    x: m.x, y: m.y, health: m.health, alive: m.alive,
                }])
            ),
            bullets: this.gs.bullets.map(b => ({ id: b.id, x: b.x, y: b.y })),
        });
    }
}

module.exports = { MazeRoom };
