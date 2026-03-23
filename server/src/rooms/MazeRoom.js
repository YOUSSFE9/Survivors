/**
 * MazeRoom — Core game room. Plain JavaScript, Colyseus 0.15.
 * Modes: duel (1v1), squad (4v4 teams), war (20 FFA).
 *
 * Bot philosophy: Bots have REALISTIC names so players can't tell them apart.
 * No [BOT] prefix, no special indicator — they should feel like real players.
 */
const colyseus = require('colyseus');
const { MonsterAI } = require('../logic/MonsterAI');
const { MazeGenerator } = require('../logic/MazeGenerator');

const TICK_MS   = 50;     // 20 Hz
const PLAYER_SPEED = 9;
const BULLET_SPEED = 18;
const BULLET_TTL   = 40;

const TINTS = [
    0xff3333, 0x33ff88, 0x3388ff, 0xffdd33, 0xff33ff,
    0x33ffdd, 0xff8833, 0x88ff33, 0xdd33ff, 0x33ccff,
];

// Realistic player-like names (no [BOT] hint)
const REALISTIC_NAMES = [
    'ShadowX', 'NightWolf', 'DarkBlade', 'GhostFire', 'IronFang',
    'ViperX', 'StormRider', 'BlackMoon', 'RedPhantom', 'SteelClaw',
    'CyberX', 'DeathWing', 'CrimsonFox', 'VoidWalker', 'BladeEdge',
    'NeonStrike', 'QuantumAce', 'DarkMatter', 'SilentBlade', 'FuryX',
    'ShadowByte', 'LightFang', 'ColdBlood', 'HexRunner', 'ZeroX',
];

// Adds randomness so the same name doesn't appear every time
function randomBotName(seed) {
    const base = REALISTIC_NAMES[seed % REALISTIC_NAMES.length];
    const suffix = Math.floor(Math.random() * 900) + 100;
    return `${base}${suffix}`;
}

class MazeRoom extends colyseus.Room {

    onCreate(options) {
        this.options  = options;
        this.maxClients = options.maxPlayers || 20;

        const seed = Math.floor(Math.random() * 999999);
        const mazeData = MazeGenerator.generate(20, 20, 3, seed);

        // Squad team codes
        if (options.mode === 'squad') {
            this.redCode  = this.roomId + '-R';
            this.blueCode = this.roomId + '-B';
        }

        this.gs = {
            mode: options.mode,
            phase: 'waiting',
            seed,
            winner: '',
            tick: 0,
            players: {},
            monsters: {},
            bullets: [],
        };

        this.monsterAI    = new MonsterAI(mazeData, this.gs);
        this.playerInputs = {};
        this.bulletCounter = 0;
        this.botCounter    = 0;
        this._portalSpawned = false;
        this.hostSessionId  = null;
        this.countdownTimer = null;
        this._botFillTimer  = null;
        this._warFilling    = false;

        // ── Monster wave every 10 s ──
        this.clock.setInterval(() => {
            if (this.gs.phase !== 'playing') return;
            const alive = Object.values(this.gs.monsters).filter(m => m.alive).length;
            const cap   = Math.min(20, 5 + Object.keys(this.gs.players).length * 2);
            if (alive < cap) this.monsterAI.spawnWave(Math.min(5, cap - alive));
        }, 10000);

        // ── Message handlers ──
        this.onMessage('input',       (c, m) => { if (this.gs.phase === 'playing') this.playerInputs[c.sessionId] = m; });
        this.onMessage('shoot',       (c, m) => this._spawnBullet(c.sessionId, m));
        this.onMessage('pickup_key',  (c, m) => this._handlePickup(c.sessionId, m.keyId));
        this.onMessage('enter_portal',(c)     => this._handlePortal(c.sessionId));

        this.onMessage('host_start', (c) => {
            if (c.sessionId !== this.hostSessionId) return;
            if (options.mode === 'war') this._startWarFill();
            else this._triggerCountdown();
        });

        this.onMessage('kick_player', (c, { targetId }) => {
            if (c.sessionId !== this.hostSessionId) return;
            const t = this.clients.find(x => x.sessionId === targetId);
            if (t) t.leave(4000, 'kicked');
            else { delete this.gs.players[targetId]; this._broadcastLobbyState(); }
        });

        this.onMessage('move_team', (c, { targetId }) => {
            if (c.sessionId !== this.hostSessionId) return;
            const p = this.gs.players[targetId];
            if (!p) return;
            p.team = p.team === 'red' ? 'blue' : 'red';
            p.tint = p.team === 'red' ? 0xff4444 : 0x4488ff;
            this._broadcastLobbyState();
        });

        // Game tick
        this.clock.setInterval(() => this._tick(), TICK_MS);

        console.log(`[MazeRoom:${this.roomId}] created — mode:${options.mode}`);
    }

    onJoin(client, opts = {}) {
        const count = Object.keys(this.gs.players).length;
        if (!this.hostSessionId) this.hostSessionId = client.sessionId;

        // Team assignment
        let team = 'none';
        let tint  = TINTS[count % TINTS.length];
        if (this.options.teams) {
            team = opts.reqTeam || opts.team ||
                (Object.values(this.gs.players).filter(p=>p.team==='red').length <=
                 Object.values(this.gs.players).filter(p=>p.team==='blue').length ? 'red' : 'blue');
            tint = team === 'red' ? 0xff4444 : 0x4488ff;
        }

        const spawn = this.monsterAI.getSpawnPos();
        this.gs.players[client.sessionId] = {
            sessionId: client.sessionId,
            uid:   opts.uid  || client.sessionId,
            name:  opts.name || 'Player',
            team, tint,
            x: spawn.x, y: spawn.y, rotation: 0,
            health: 100, maxHealth: 100,
            alive: true, keys: 0, kills: 0,
            weapon: '', isBot: false,
        };

        // Notify client of their host status
        client.send('host_status', { isHost: client.sessionId === this.hostSessionId });

        // Squad codes
        if (this.options.mode === 'squad') {
            client.send('squad_codes', { redCode: this.redCode, blueCode: this.blueCode });
        }

        this._broadcastLobbyState();

        const realCount = this._realPlayerCount();

        // ── DUEL logic ──
        if (this.options.mode === 'duel') {
            if (realCount >= 2) {
                // Two real players — start immediately (private room) or after countdown
                if (this._botFillTimer) { this._botFillTimer.clear(); this._botFillTimer = null; }
                this._triggerCountdown();
            } else if (!this._botFillTimer) {
                // Start 15-second bot timer (looks like matchmaking time)
                this._botFillTimer = this.clock.setTimeout(() => {
                    if (this._realPlayerCount() < 2) {
                        this._spawnRealisticBot('none', /* silent = */ true);
                        this._triggerCountdown();
                    }
                }, 15000);
            }
        }

        // ── WAR logic — start fill timer after 30s ──
        if (this.options.mode === 'war' && !this._botFillTimer) {
            this._botFillTimer = this.clock.setTimeout(() => {
                this._startWarFill();
            }, 30000);
        }

        // Initial monsters in DUEL and SQUAD
        if (this.options.mode !== 'war' && count === 0) {
            this.monsterAI.spawnWave(5);
        }
    }

    onLeave(client) {
        const wasHost = client.sessionId === this.hostSessionId;
        delete this.gs.players[client.sessionId];
        this.broadcast('player_left', client.sessionId);

        if (wasHost) {
            const next = Object.values(this.gs.players).find(p => !p.isBot);
            this.hostSessionId = next ? next.sessionId : null;
            if (this.hostSessionId) {
                const nc = this.clients.find(c => c.sessionId === this.hostSessionId);
                if (nc) nc.send('host_status', { isHost: true });
            }
            this.broadcast('new_host', { hostId: this.hostSessionId });
        }

        this._broadcastLobbyState();
        if (this._realPlayerCount() === 0) this.disconnect();
    }

    onDispose() {
        console.log(`[MazeRoom:${this.roomId}] disposed`);
    }

    // ───────────────────────────────────────
    // Bot helpers
    // ───────────────────────────────────────

    _realPlayerCount() {
        return Object.values(this.gs.players).filter(p => !p.isBot).length;
    }

    _spawnRealisticBot(team = 'none', silent = false) {
        const idx   = this.botCounter++;
        const botId = `bot_${idx}_${Date.now()}`;
        const name  = randomBotName(idx);
        const spawn = this.monsterAI.getSpawnPos();

        let tint = TINTS[idx % TINTS.length];
        if (team === 'red') tint = 0xff4444;
        if (team === 'blue') tint = 0x4488ff;

        this.gs.players[botId] = {
            sessionId: botId,
            uid: botId, name, team, tint,
            x: spawn.x, y: spawn.y, rotation: 0,
            health: 100, maxHealth: 100,
            alive: true, keys: 0, kills: 0,
            weapon: '', isBot: true,
            _shootCooldown: Math.floor(Math.random() * 20),
        };

        if (!silent) this._broadcastLobbyState();
        return botId;
    }

    _botAI() {
        for (const [sid, p] of Object.entries(this.gs.players)) {
            if (!p.isBot || !p.alive) continue;

            // Find nearest enemy
            let nearest = null, bestDist = Infinity;
            for (const [oid, op] of Object.entries(this.gs.players)) {
                if (oid === sid || !op.alive) continue;
                if (this.options.teams && op.team === p.team) continue;
                const dx = op.x - p.x, dy = op.y - p.y;
                const d = Math.sqrt(dx*dx + dy*dy);
                if (d < bestDist) { bestDist = d; nearest = op; }
            }

            if (!nearest) continue;
            const dx = nearest.x - p.x, dy = nearest.y - p.y;
            const dist = Math.sqrt(dx*dx + dy*dy);

            // Move toward player (jitter to look human)
            if (dist > 80) {
                const jitter = (Math.random() - 0.5) * 2;
                p.x += ((dx / dist) + jitter * 0.15) * (PLAYER_SPEED * 0.85);
                p.y += ((dy / dist) + jitter * 0.15) * (PLAYER_SPEED * 0.85);
            }

            p.rotation = Math.atan2(dy, dx);
            p.x = Math.max(16, Math.min(p.x, (this.monsterAI.worldW || 2000) - 16));
            p.y = Math.max(16, Math.min(p.y, (this.monsterAI.worldH || 2000) - 16));

            // Shoot with human-like cooldown variance
            p._shootCooldown = (p._shootCooldown || 0) - 1;
            if (p._shootCooldown <= 0 && dist < 380) {
                // Add a small aim variance
                const aimNoise = (Math.random() - 0.5) * 0.3;
                this._spawnBullet(sid, {
                    vx: (dx / dist + aimNoise) * 400,
                    vy: (dy / dist + aimNoise) * 400,
                    damage: 10 + Math.floor(Math.random() * 6),
                    isExplosive: false,
                });
                p._shootCooldown = 20 + Math.floor(Math.random() * 30);
            }
        }
    }

    // War: gradually fill empty slots with realistic bots
    _startWarFill() {
        if (this._warFilling) return;
        this._warFilling = true;
        this.broadcast('war_fill_started', {});
        this.monsterAI.spawnWave(8); // Spawn monsters for war

        const fillNext = () => {
            const count = Object.keys(this.gs.players).length;
            if (count >= 20) {
                // Roster full — start countdown then game
                this._triggerCountdown();
                return;
            }
            // Spawn with realistic message delay (simulates player joining)
            this._spawnRealisticBot('none', false);
            this.broadcast('war_roster', { players: this._getRosterList(), total: Object.keys(this.gs.players).length });
            this.clock.setTimeout(fillNext, 2000);
        };

        fillNext();
    }

    _getRosterList() {
        return Object.values(this.gs.players).map(p => ({
            name: p.name,
            sessionId: p.sessionId,
            isBot: p.isBot,
        }));
    }

    // ───────────────────────────────────────
    // Lobby broadcasting
    // ───────────────────────────────────────

    _broadcastLobbyState() {
        if (this.gs.phase !== 'waiting') return;
        const list = Object.values(this.gs.players).map(p => ({
            sessionId: p.sessionId,
            name: p.name,
            team: p.team,
            isBot: p.isBot,
        }));
        this.broadcast('lobby_players', list);

        if (this.options.mode === 'war') {
            this.broadcast('war_roster', { players: list, total: list.length });
        }
        if (this.options.mode === 'squad') {
            this.broadcast('squad_codes', { redCode: this.redCode, blueCode: this.blueCode });
        }
    }

    _triggerCountdown() {
        if (this.gs.phase !== 'waiting' || this.countdownTimer) return;
        let sec = this.options.mode === 'war' ? 3 : 5;
        this.broadcast('countdown', { seconds: sec });
        this.countdownTimer = this.clock.setInterval(() => {
            sec--;
            if (sec <= 0) {
                this.countdownTimer.clear();
                this.countdownTimer = null;
                this._startGame();
            } else {
                this.broadcast('countdown', { seconds: sec });
            }
        }, 1000);
    }

    _startGame() {
        if (this.gs.phase !== 'waiting') return;
        this.gs.phase = 'playing';

        // Ensure monsters are spawned
        const monsterCount = Object.values(this.gs.monsters).filter(m => m.alive).length;
        if (monsterCount < 5) this.monsterAI.spawnWave(8);

        this.broadcast('game_started', {
            seed: this.gs.seed,
            mode: this.gs.mode,
            players: Object.values(this.gs.players),
        });
        console.log(`[MazeRoom:${this.roomId}] GAME STARTED — ${this.gs.mode} — ${Object.keys(this.gs.players).length} players`);
    }

    // ───────────────────────────────────────
    // Tick
    // ───────────────────────────────────────

    _tick() {
        if (this.gs.phase !== 'playing') return;
        this.gs.tick++;

        // Bot AI
        this._botAI();

        // Real player inputs
        for (const [sid, input] of Object.entries(this.playerInputs)) {
            const p = this.gs.players[sid];
            if (!p || !p.alive || p.isBot) continue;
            const len = Math.sqrt(input.dx * input.dx + input.dy * input.dy);
            if (len > 0.01) {
                p.x += (input.dx / len) * PLAYER_SPEED;
                p.y += (input.dy / len) * PLAYER_SPEED;
                p.rotation = input.rotation;
                p.x = Math.max(16, Math.min(p.x, this.monsterAI.worldW || 2000));
                p.y = Math.max(16, Math.min(p.y, this.monsterAI.worldH || 2000));
            }
        }

        // Bullets
        for (let i = this.gs.bullets.length - 1; i >= 0; i--) {
            const b = this.gs.bullets[i];
            b.x += b.vx; b.y += b.vy; b.ttl--;
            if (b.ttl <= 0 || this._checkBulletHit(b)) { this.gs.bullets.splice(i, 1); }
        }

        // Monsters
        this.monsterAI.update(TICK_MS, this.gs.players);

        this._broadcastCompact();
    }

    _spawnBullet(ownerId, msg) {
        if (this.gs.phase !== 'playing') return;
        const p = this.gs.players[ownerId];
        if (!p || !p.alive) return;
        const spd = BULLET_SPEED;
        const len = Math.sqrt(msg.vx * msg.vx + msg.vy * msg.vy) || 1;
        this.gs.bullets.push({
            id: `b${this.bulletCounter++}`,
            x: p.x, y: p.y,
            vx: (msg.vx / len) * spd,
            vy: (msg.vy / len) * spd,
            damage: msg.damage || 10,
            ownerId, isExplosive: !!msg.isExplosive,
            ttl: BULLET_TTL,
        });
    }

    _checkBulletHit(b) {
        const R2 = 18 * 18;
        for (const [sid, p] of Object.entries(this.gs.players)) {
            if (sid === b.ownerId || !p.alive) continue;
            if (this.options.teams) {
                const owner = this.gs.players[b.ownerId];
                if (owner && owner.team === p.team && owner.team !== 'none') continue;
            }
            const dx = b.x - p.x, dy = b.y - p.y;
            if (dx*dx + dy*dy < R2) { this._damagePlayer(p, b.damage, b.ownerId); return true; }
        }
        for (const m of Object.values(this.gs.monsters)) {
            if (!m.alive) continue;
            const dx = b.x - m.x, dy = b.y - m.y;
            if (dx*dx + dy*dy < R2) {
                m.health -= b.damage;
                if (m.health <= 0) { m.alive = false; const p=this.gs.players[b.ownerId]; if(p) p.kills++; }
                return true;
            }
        }
        return false;
    }

    _damagePlayer(target, dmg, killerId) {
        target.health -= dmg;
        if (target.health <= 0) {
            target.health = 0; target.alive = false;
            const k = this.gs.players[killerId];
            if (k) k.kills++;
            this._checkWinCondition();
        }
    }

    _checkWinCondition() {
        const alive = Object.values(this.gs.players).filter(p => p.alive);
        if (this.options.mode === 'duel' && alive.length <= 1) {
            const winner = alive[0] || { uid: 'draw', name: 'Draw' };
            this._endGame(winner.uid, winner.name); return;
        }
        if (this.options.teams) {
            const red  = alive.filter(p => p.team === 'red').length;
            const blue = alive.filter(p => p.team === 'blue').length;
            if (red === 0 && blue > 0) { this._endGame('blue', 'الفريق الأزرق'); return; }
            if (blue === 0 && red > 0) { this._endGame('red',  'الفريق الأحمر'); return; }
        }
        if (this.options.mode === 'war' && alive.length <= 1) {
            const winner = alive[0] || { uid: 'draw', name: 'Draw' };
            this._endGame(winner.uid, winner.name);
        }
    }

    _handlePickup(sid, keyId) {
        const p = this.gs.players[sid];
        if (!p || !p.alive) return;
        p.keys++;
        this.broadcast('key_collected', { keyId, by: sid, team: p.team });
        const total = Object.values(this.gs.players).reduce((s,p)=>s+p.keys, 0);
        if (total >= 10 && !this._portalSpawned) {
            this._portalSpawned = true;
            this.broadcast('portal_spawned', this.monsterAI.getSpawnPos());
        }
    }

    _handlePortal(sid) {
        if (!this._portalSpawned) return;
        const p = this.gs.players[sid];
        if (!p || !p.alive) return;
        const winner = this.options.teams ? p.team : p.uid;
        this._endGame(winner, p.name);
    }

    _endGame(winner, name) {
        if (this.gs.phase === 'ended') return;
        this.gs.phase = 'ended'; this.gs.winner = winner;
        this.broadcast('game_over', { winner, killerName: name, mode: this.gs.mode });
        this.clock.setTimeout(() => this.disconnect(), 6000);
    }

    _broadcastCompact() {
        this.broadcast('state_tick', {
            tick: this.gs.tick,
            players: Object.fromEntries(Object.entries(this.gs.players).map(([sid, p]) => [sid, {
                x: p.x, y: p.y, rotation: p.rotation,
                health: p.health, alive: p.alive, keys: p.keys, kills: p.kills,
            }])),
            monsters: Object.fromEntries(Object.entries(this.gs.monsters).map(([id, m]) => [id, {
                x: m.x, y: m.y, health: m.health, alive: m.alive,
            }])),
            bullets: this.gs.bullets.map(b => ({ id: b.id, x: b.x, y: b.y })),
        });
    }
}

module.exports = { MazeRoom };
