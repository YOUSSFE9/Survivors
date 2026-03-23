/**
 * MazeRoom — Core game room. Plain JavaScript, Colyseus 0.15.
 * Server-authoritative: collision, damage, keys, monsters, bots.
 * 3 modes: duel (1v1), squad (4v4 teams), war (20 FFA).
 */
const colyseus = require('colyseus');
const { MonsterAI } = require('../logic/MonsterAI');
const { MazeGenerator } = require('../logic/MazeGenerator');

const TICK_MS = 50;       // 20 Hz
const PLAYER_SPEED = 9;   // px per tick
const BULLET_SPEED = 20;
const BULLET_TTL_TICKS = 40;

const TINTS = [
    0xff3333, 0x33ff88, 0x3388ff, 0xffdd33, 0xff33ff,
    0x33ffdd, 0xff8833, 0x88ff33, 0xdd33ff, 0x33ccff,
    0xff5533, 0x55ff88, 0xddbb33, 0x5588ff, 0xff55aa
];

const BOT_NAMES = [
    'Shadow_Ghost','Dark_Viper','NeonKiller','IronWolf','StealthX',
    'BloodMoon','QuantumZ','DeathShot','CyberFox','PhantomX',
    'DarkReaper','VoidHunter','SteelFang','NightBlaze','GhostByte',
    'SkullCrush','IronGhost','RedDagger','NeonShadow','DeathStrike'
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

        this.monsterAI = new MonsterAI(mazeData, this.gs);
        this.monsterAI.spawnWave(5);

        this.playerInputs = {};
        this.bulletCounter = 0;
        this.botCounter = 0;
        this._portalSpawned = false;

        this.hostSessionId = null;
        this.countdownTimer = null;
        this.countdownSeconds = 0;
        this._botFillTimer = null;
        this._duelBotTimer = null;

        // ── Message Handlers ──
        this.onMessage('input', (client, msg) => {
            if (this.gs.phase === 'playing') this.playerInputs[client.sessionId] = msg;
        });

        this.onMessage('shoot', (client, msg) => {
            this._spawnBullet(client.sessionId, msg);
        });

        this.onMessage('pickup_key', (client, msg) => {
            this._handlePickup(client.sessionId, msg.keyId);
        });

        this.onMessage('enter_portal', (client) => {
            this._handlePortal(client.sessionId);
        });

        // Host controls
        this.onMessage('host_start', (client) => {
            if (client.sessionId !== this.hostSessionId) return;
            if (this.options.mode === 'war') {
                this._startWarFill();
            } else {
                this._triggerCountdown();
            }
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

        if (!this.hostSessionId) {
            this.hostSessionId = client.sessionId;
        }

        let team = 'none';
        let tint = TINTS[playerCount % TINTS.length];

        if (this.options.teams) {
            if (opts.reqTeam === 'red' || opts.reqTeam === 'blue' || opts.team === 'red' || opts.team === 'blue') {
                team = opts.reqTeam || opts.team;
            } else {
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
            name: opts.name || BOT_NAMES[playerCount % BOT_NAMES.length],
            team, tint,
            x: spawn.x, y: spawn.y, rotation: 0,
            health: 100, maxHealth: 100,
            alive: true, keys: 0, kills: 0,
            weapon: '', isBot: false,
        };

        if (this.options.mode === 'squad') {
            client.send('red_room_code', { code: this.redCode });
            client.send('blue_room_code', { code: this.blueCode });
        }

        client.send('host_status', { isHost: client.sessionId === this.hostSessionId });

        this._broadcastLobbyState();
        this._broadcastState();

        // Duel mode: if 2 real players → start countdown, else start 30s bot timer
        if (this.options.mode === 'duel') {
            const realPlayers = Object.values(this.gs.players).filter(p => !p.isBot);
            if (realPlayers.length >= 2) {
                if (this._duelBotTimer) { this._duelBotTimer.clear(); this._duelBotTimer = null; }
                this._triggerCountdown();
            } else if (!this._duelBotTimer) {
                this._duelBotTimer = this.clock.setTimeout(() => {
                    const real = Object.values(this.gs.players).filter(p => !p.isBot);
                    if (real.length < 2) {
                        this._spawnBot('none');
                        this._triggerCountdown();
                    }
                }, 30000);
            }
        }

        // War mode: auto-start fill after 30s
        if (this.options.mode === 'war' && !this._botFillTimer) {
            this._botFillTimer = this.clock.setTimeout(() => {
                this._startWarFill();
            }, 30000);
        }

        console.log(`[MazeRoom] ${opts.name} joined (${team}) — total: ${Object.keys(this.gs.players).length}`);
    }

    onLeave(client) {
        const wasHost = client.sessionId === this.hostSessionId;
        delete this.gs.players[client.sessionId];
        this.broadcast('player_left', client.sessionId);

        if (wasHost) {
            // Pass host to next real player
            const remaining = Object.values(this.gs.players).filter(p => !p.isBot);
            this.hostSessionId = remaining.length > 0 ? remaining[0].sessionId : null;
            if (this.hostSessionId) {
                const newHost = this.clients.find(c => c.sessionId === this.hostSessionId);
                if (newHost) newHost.send('host_status', { isHost: true });
            }
            this.broadcast('new_host', { hostId: this.hostSessionId });
        }

        this._broadcastLobbyState();
        const realPlayers = Object.values(this.gs.players).filter(p => !p.isBot);
        if (realPlayers.length === 0) this.disconnect();
    }

    onDispose() {
        console.log('[MazeRoom] disposed');
    }

    // ── Bot System ──

    _spawnBot(team = 'none') {
        const botId = `bot_${this.botCounter++}`;
        const spawn = this.monsterAI.getSpawnPos();
        const name = '[BOT] ' + BOT_NAMES[this.botCounter % BOT_NAMES.length];

        let tint = TINTS[this.botCounter % TINTS.length];
        if (team === 'red') tint = 0xff4444;
        if (team === 'blue') tint = 0x4488ff;

        this.gs.players[botId] = {
            sessionId: botId,
            uid: botId,
            name, team, tint,
            x: spawn.x, y: spawn.y, rotation: 0,
            health: 100, maxHealth: 100,
            alive: true, keys: 0, kills: 0,
            weapon: '', isBot: true,
            _shootCooldown: 0,
        };

        this._broadcastLobbyState();
        this._broadcastState();
        console.log(`[MazeRoom] Bot spawned: ${name} (${team})`);
        return botId;
    }

    _botAI() {
        for (const [sid, p] of Object.entries(this.gs.players)) {
            if (!p.isBot || !p.alive) continue;

            // Find nearest non-bot player
            let nearest = null, nearestDist = Infinity;
            for (const [oid, op] of Object.entries(this.gs.players)) {
                if (oid === sid || !op.alive || op.isBot) continue;
                if (this.options.teams && op.team === p.team) continue;
                const dx = op.x - p.x, dy = op.y - p.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < nearestDist) { nearestDist = dist; nearest = op; }
            }

            if (!nearest) continue;

            const dx = nearest.x - p.x, dy = nearest.y - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Move toward player (stop at 80px)
            if (dist > 80) {
                p.x += (dx / dist) * (PLAYER_SPEED * 0.8);
                p.y += (dy / dist) * (PLAYER_SPEED * 0.8);
            }

            p.rotation = Math.atan2(dy, dx);
            p.x = Math.max(0, Math.min(p.x, this.monsterAI.worldW));
            p.y = Math.max(0, Math.min(p.y, this.monsterAI.worldH));

            // Shoot at player (every ~1.5s = 30 ticks)
            p._shootCooldown = (p._shootCooldown || 0) - 1;
            if (p._shootCooldown <= 0 && dist < 350) {
                this._spawnBullet(sid, {
                    vx: (dx / dist) * 400,
                    vy: (dy / dist) * 400,
                    damage: 12,
                    isExplosive: false,
                });
                p._shootCooldown = 25 + Math.floor(Math.random() * 15);
            }
        }
    }

    _startWarFill() {
        if (this._warFilling) return;
        this._warFilling = true;
        const total = 20;

        const fillNext = () => {
            const count = Object.keys(this.gs.players).length;
            if (count >= total) {
                this._triggerCountdown();
                return;
            }
            this._spawnBot('none');
            this.broadcast('war_roster', { players: this._getRosterList() });
            this.clock.setTimeout(fillNext, 2000);
        };

        fillNext();
    }

    _getRosterList() {
        return Object.values(this.gs.players).map(p => ({
            name: p.name,
            isBot: p.isBot,
            sessionId: p.sessionId,
        }));
    }

    // ── Lobby ──

    _broadcastLobbyState() {
        if (this.gs.phase !== 'waiting') return;
        const list = Object.values(this.gs.players).map(p => ({
            sessionId: p.sessionId,
            name: p.name,
            team: p.team,
            isBot: p.isBot,
        }));
        this.broadcast('lobby_players', list);

        // War roster
        if (this.options.mode === 'war') {
            this.broadcast('war_roster', { players: list });
        }

        // Squad codes
        if (this.options.mode === 'squad') {
            this.broadcast('squad_codes', { redCode: this.redCode, blueCode: this.blueCode });
        }
    }

    _triggerCountdown() {
        if (this.gs.phase !== 'waiting' || this.countdownTimer) return;
        let countdownTime = 5;
        if (this.options.mode === 'war') countdownTime = 5;
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

    // ── Tick ──

    _tick() {
        if (this.gs.phase !== 'playing') return;
        this.gs.tick++;

        // Bot AI
        this._botAI();

        // Apply inputs (real players)
        for (const [sid, input] of Object.entries(this.playerInputs)) {
            const p = this.gs.players[sid];
            if (!p || !p.alive || p.isBot) continue;
            const len = Math.sqrt(input.dx * input.dx + input.dy * input.dy);
            if (len > 0.01) {
                p.x += (input.dx / len) * PLAYER_SPEED;
                p.y += (input.dy / len) * PLAYER_SPEED;
                p.rotation = input.rotation;
                p.x = Math.max(0, Math.min(p.x, this.monsterAI.worldW));
                p.y = Math.max(0, Math.min(p.y, this.monsterAI.worldH));
            }
        }

        // Bullets
        for (let i = this.gs.bullets.length - 1; i >= 0; i--) {
            const b = this.gs.bullets[i];
            b.x += b.vx; b.y += b.vy;
            b.ttl--;
            if (b.ttl <= 0) { this.gs.bullets.splice(i, 1); continue; }
            if (this._checkBulletHit(b)) { this.gs.bullets.splice(i, 1); }
        }

        // Monsters
        this.monsterAI.update(TICK_MS, this.gs.players);

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
            ownerId, isExplosive: msg.isExplosive || false,
            ttl: BULLET_TTL_TICKS,
        });
    }

    _checkBulletHit(bullet) {
        const R2 = 18 * 18;

        for (const [sid, p] of Object.entries(this.gs.players)) {
            if (sid === bullet.ownerId || !p.alive) continue;
            if (this.options.teams) {
                const owner = this.gs.players[bullet.ownerId];
                if (owner && owner.team === p.team) continue;
            }
            const dx = bullet.x - p.x, dy = bullet.y - p.y;
            if (dx * dx + dy * dy < R2) {
                this._damagePlayer(p, bullet.damage, bullet.ownerId);
                return true;
            }
        }

        for (const m of Object.values(this.gs.monsters)) {
            if (!m.alive) continue;
            const dx = bullet.x - m.x, dy = bullet.y - m.y;
            if (dx * dx + dy * dy < R2) {
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

    _broadcastState() {
        this.broadcast('state_full', this.gs);
    }

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
