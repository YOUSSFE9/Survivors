/**
 * MazeRoom — v4
 * - Duel random: 15s then bot (realistic name, treated as human)
 * - Duel private: ONLY starts when 2 real players join — NO bot timer EVER
 * - Duel: monsters spawn (like offline mode)
 * - War: gradual bot fill every 2s
 * - Squad: host controls, no bots
 */
const colyseus = require('colyseus');
const { MonsterAI } = require('../logic/MonsterAI');
const { MazeGenerator } = require('../logic/MazeGenerator');

const TICK_MS      = 50;
const PLAYER_SPEED = 9;
const BULLET_SPEED = 18;
const BULLET_TTL   = 40;

const TINTS = [0xff3333, 0x33ff88, 0x3388ff, 0xffdd33, 0xff33ff, 0x33ffdd, 0xff8833, 0x88ff33];

const BOT_NAMES = [
    'ShadowX', 'NightWolf', 'DarkBlade', 'GhostFire', 'IronFang',
    'ViperX', 'StormRider', 'BlackMoon', 'RedPhantom', 'SteelClaw',
    'CyberX', 'DeathWing', 'CrimsonFox', 'VoidWalker', 'BladeEdge',
    'NeonStrike', 'QuantumAce', 'DarkMatter', 'SilentKill', 'FuryX',
    'ShadowByte', 'LightFang', 'HexRunner', 'ZeroX', 'Vendetta',
];

function makeBotName(i) {
    return BOT_NAMES[i % BOT_NAMES.length] + (100 + Math.floor(Math.random() * 900));
}

class MazeRoom extends colyseus.Room {

    onCreate(options) {
        this.options    = options;
        this.maxClients = options.maxPlayers || 20;
        this.isPrivateDuel = !!options.isPrivate; // private friend rooms: NO bot timer

        const seed     = Math.floor(Math.random() * 999999);
        const mazeData = MazeGenerator.generate(20, 20, 3, seed);

        if (options.mode === 'squad') {
            this.redCode  = this.roomId + '-R';
            this.blueCode = this.roomId + '-B';
        }

        this.gs = {
            mode: options.mode,
            phase: 'waiting',
            seed, winner: '', tick: 0,
            players: {}, monsters: {}, bullets: [],
        };

        this.monsterAI     = new MonsterAI(mazeData, this.gs);
        this.playerInputs  = {};
        this.bulletCounter = 0;
        this.botCounter    = 0;
        this._portalSpawned = false;
        this.hostSessionId  = null;
        this.countdownTimer = null;
        this._botTimer      = null;
        this._warFilling    = false;

        // Monster respawn every 10s during play
        this.clock.setInterval(() => {
            if (this.gs.phase !== 'playing') return;
            const alive = Object.values(this.gs.monsters).filter(m => m.alive).length;
            const cap   = Math.min(20, 5 + Object.keys(this.gs.players).length * 2);
            if (alive < cap) this.monsterAI.spawnWave(Math.min(5, cap - alive));
        }, 10000);

        // Messages
        this.onMessage('input',        (c, m) => { if (this.gs.phase === 'playing') this.playerInputs[c.sessionId] = m; });
        this.onMessage('shoot',        (c, m) => this._spawnBullet(c.sessionId, m));
        this.onMessage('pickup_key',   (c, m) => this._handlePickup(c.sessionId, m.keyId));
        this.onMessage('enter_portal', (c)    => this._handlePortal(c.sessionId));

        this.onMessage('host_start', (c) => {
            if (c.sessionId !== this.hostSessionId) return;
            if (this.options.mode === 'war') this._startWarFill();
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

        this.clock.setInterval(() => this._tick(), TICK_MS);
    }

    onJoin(client, opts = {}) {
        const count = Object.keys(this.gs.players).length;
        if (!this.hostSessionId) this.hostSessionId = client.sessionId;

        let team = 'none', tint = TINTS[count % TINTS.length];
        if (this.options.teams) {
            team = opts.reqTeam || opts.team ||
                (Object.values(this.gs.players).filter(p => p.team === 'red').length <=
                 Object.values(this.gs.players).filter(p => p.team === 'blue').length ? 'red' : 'blue');
            tint = team === 'red' ? 0xff4444 : 0x4488ff;
        }

        const spawn = this.monsterAI.getSpawnPos();
        this.gs.players[client.sessionId] = {
            sessionId: client.sessionId,
            uid:  opts.uid  || client.sessionId,
            name: opts.name || 'Player',
            avatarUrl: opts.avatarUrl || '',
            team, tint,
            x: spawn.x, y: spawn.y, rotation: 0,
            health: 100, maxHealth: 100,
            alive: true, keys: 0, kills: 0,
            weapon: '', isBot: false,
        };

        client.send('host_status', { isHost: client.sessionId === this.hostSessionId });
        if (this.options.mode === 'squad') {
            client.send('squad_codes', { redCode: this.redCode, blueCode: this.blueCode });
        }

        this._broadcastLobbyState();
        const realCount = this._realCount();

        // ── DUEL ──
        if (this.options.mode === 'duel') {
            if (realCount >= 2) {
                // Two real players — cancel any bot timer and start
                if (this._botTimer) { this._botTimer.clear(); this._botTimer = null; }
                this._sendMatchPreview(() => this._triggerCountdown());
            } else if (!this.isPrivateDuel && !this._botTimer) {
                // Random matchmaking: wait 15s then spawn bot
                this._botTimer = this.clock.setTimeout(() => {
                    if (this._realCount() < 2) {
                        const botId = this._spawnBot('none');
                        const bots = this.gs.players[botId];
                        // Match preview then start
                        this._sendMatchPreview(() => this._triggerCountdown());
                    }
                }, 15000);
            }
            // Private duel: no timer at all — just wait for 2nd real player
        }

        // ── WAR ──
        if (this.options.mode === 'war' && !this._botTimer) {
            this._botTimer = this.clock.setTimeout(() => this._startWarFill(), 30000);
        }

        // Spawn initial monsters for DUEL and SQUAD
        if (this.options.mode !== 'war' && count === 0) {
            this.monsterAI.spawnWave(6);
        }
    }

    onLeave(client) {
        const wasHost = client.sessionId === this.hostSessionId;
        delete this.gs.players[client.sessionId];
        this.broadcast('player_left', client.sessionId);

        if (wasHost) {
            const next = Object.values(this.gs.players).find(p => !p.isBot);
            this.hostSessionId = next?.sessionId || null;
            if (this.hostSessionId) {
                const nc = this.clients.find(c => c.sessionId === this.hostSessionId);
                if (nc) nc.send('host_status', { isHost: true });
            }
            this.broadcast('new_host', { hostId: this.hostSessionId });
        }

        this._broadcastLobbyState();
        if (this._realCount() === 0) this.disconnect();
    }

    onDispose() {
        console.log(`[MazeRoom:${this.roomId}] disposed`);
    }

    // ─────────────── Helpers ───────────────

    _realCount() {
        return Object.values(this.gs.players).filter(p => !p.isBot).length;
    }

    _spawnBot(team = 'none') {
        const idx   = this.botCounter++;
        const botId = `bot_${idx}_${Date.now()}`;
        const name  = makeBotName(idx);
        const spawn = this.monsterAI.getSpawnPos();
        let tint = TINTS[idx % TINTS.length];
        if (team === 'red') tint = 0xff4444;
        if (team === 'blue') tint = 0x4488ff;

        this.gs.players[botId] = {
            sessionId: botId, uid: botId, name,
            avatarUrl: '', team, tint,
            x: spawn.x, y: spawn.y, rotation: 0,
            health: 100, maxHealth: 100,
            alive: true, keys: 0, kills: 0,
            weapon: '', isBot: true,
            _shootCooldown: Math.floor(Math.random() * 20),
        };

        this._broadcastLobbyState();
        return botId;
    }

    // Send match preview (both player profiles) then callback after 3s
    _sendMatchPreview(callback) {
        const pList = Object.values(this.gs.players).map(p => ({
            name: p.name, avatarUrl: p.avatarUrl || '', sessionId: p.sessionId,
        }));
        this.broadcast('match_preview', { players: pList, seconds: 3 });
        this.clock.setTimeout(callback, 3000);
    }

    _botAI() {
        for (const [sid, p] of Object.entries(this.gs.players)) {
            if (!p.isBot || !p.alive) continue;
            let nearest = null, bestDist = Infinity;
            for (const [oid, op] of Object.entries(this.gs.players)) {
                if (oid === sid || !op.alive) continue;
                if (this.options.teams && op.team === p.team && op.team !== 'none') continue;
                const dx = op.x - p.x, dy = op.y - p.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < bestDist) { bestDist = d; nearest = op; }
            }
            if (!nearest) continue;
            const dx = nearest.x - p.x, dy = nearest.y - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 80) {
                const jx = (Math.random() - 0.5) * 0.2, jy = (Math.random() - 0.5) * 0.2;
                p.x += ((dx / dist) + jx) * PLAYER_SPEED * 0.85;
                p.y += ((dy / dist) + jy) * PLAYER_SPEED * 0.85;
            }
            p.rotation = Math.atan2(dy, dx);
            p.x = Math.max(16, Math.min(p.x, this.monsterAI.worldW || 2000));
            p.y = Math.max(16, Math.min(p.y, this.monsterAI.worldH || 2000));
            p._shootCooldown = (p._shootCooldown || 0) - 1;
            if (p._shootCooldown <= 0 && dist < 380) {
                const noise = (Math.random() - 0.5) * 0.25;
                this._spawnBullet(sid, {
                    vx: (dx / dist + noise) * 400,
                    vy: (dy / dist + noise) * 400,
                    damage: 10 + Math.floor(Math.random() * 6),
                });
                p._shootCooldown = 22 + Math.floor(Math.random() * 28);
            }
        }
    }

    _startWarFill() {
        if (this._warFilling) return;
        this._warFilling = true;
        this.broadcast('war_fill_started', {});
        this.monsterAI.spawnWave(10);

        const fill = () => {
            const count = Object.keys(this.gs.players).length;
            if (count >= 20) { this._triggerCountdown(); return; }
            this._spawnBot('none');
            this.broadcast('war_roster', { players: this._rosterList(), total: Object.keys(this.gs.players).length });
            this.clock.setTimeout(fill, 2000);
        };
        fill();
    }

    _rosterList() {
        return Object.values(this.gs.players).map(p => ({ name: p.name, sessionId: p.sessionId }));
    }

    _broadcastLobbyState() {
        if (this.gs.phase !== 'waiting') return;
        const list = Object.values(this.gs.players).map(p => ({
            sessionId: p.sessionId, name: p.name, team: p.team,
        }));
        this.broadcast('lobby_players', list);
        if (this.options.mode === 'war')   this.broadcast('war_roster', { players: list, total: list.length });
        if (this.options.mode === 'squad') this.broadcast('squad_codes', { redCode: this.redCode, blueCode: this.blueCode });
    }

    _triggerCountdown() {
        if (this.gs.phase !== 'waiting' || this.countdownTimer) return;
        let sec = 3;
        this.broadcast('countdown', { seconds: sec });
        this.countdownTimer = this.clock.setInterval(() => {
            sec--;
            if (sec <= 0) {
                this.countdownTimer.clear(); this.countdownTimer = null;
                this._startGame();
            } else {
                this.broadcast('countdown', { seconds: sec });
            }
        }, 1000);
    }

    _startGame() {
        if (this.gs.phase !== 'waiting') return;
        this.gs.phase = 'playing';
        const alive = Object.values(this.gs.monsters).filter(m => m.alive).length;
        if (alive < 5) this.monsterAI.spawnWave(8);
        this.broadcast('game_started', {
            seed: this.gs.seed, mode: this.gs.mode,
            players: Object.values(this.gs.players),
        });
        console.log(`[MazeRoom:${this.roomId}] STARTED ${this.gs.mode} — ${Object.keys(this.gs.players).length} players`);
    }

    // ─────────────── Tick ───────────────

    _tick() {
        if (this.gs.phase !== 'playing') return;
        this.gs.tick++;
        this._botAI();

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

        for (let i = this.gs.bullets.length - 1; i >= 0; i--) {
            const b = this.gs.bullets[i];
            b.x += b.vx; b.y += b.vy; b.ttl--;
            if (b.ttl <= 0 || this._bulletHit(b)) this.gs.bullets.splice(i, 1);
        }

        this.monsterAI.update(TICK_MS, this.gs.players);

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

    _spawnBullet(ownerId, msg) {
        if (this.gs.phase !== 'playing') return;
        const p = this.gs.players[ownerId];
        if (!p || !p.alive) return;
        const len = Math.sqrt(msg.vx * msg.vx + msg.vy * msg.vy) || 1;
        this.gs.bullets.push({
            id: `b${this.bulletCounter++}`,
            x: p.x, y: p.y,
            vx: (msg.vx / len) * BULLET_SPEED,
            vy: (msg.vy / len) * BULLET_SPEED,
            damage: msg.damage || 10,
            ownerId, isExplosive: !!msg.isExplosive, ttl: BULLET_TTL,
        });
    }

    _bulletHit(b) {
        const R2 = 18 * 18;
        for (const [sid, p] of Object.entries(this.gs.players)) {
            if (sid === b.ownerId || !p.alive) continue;
            if (this.options.teams) {
                const own = this.gs.players[b.ownerId];
                if (own && own.team === p.team && own.team !== 'none') continue;
            }
            const dx = b.x - p.x, dy = b.y - p.y;
            if (dx * dx + dy * dy < R2) { this._dmgPlayer(p, b.damage, b.ownerId); return true; }
        }
        for (const m of Object.values(this.gs.monsters)) {
            if (!m.alive) continue;
            const dx = b.x - m.x, dy = b.y - m.y;
            if (dx * dx + dy * dy < R2) {
                m.health -= b.damage;
                if (m.health <= 0) { m.alive = false; const p = this.gs.players[b.ownerId]; if (p) p.kills++; }
                return true;
            }
        }
        return false;
    }

    _dmgPlayer(target, dmg, killerId) {
        target.health -= dmg;
        if (target.health <= 0) {
            target.health = 0; target.alive = false;
            const k = this.gs.players[killerId]; if (k) k.kills++;
            this._checkWin();
        }
    }

    _checkWin() {
        const alive = Object.values(this.gs.players).filter(p => p.alive);
        if (this.options.mode === 'duel' && alive.length <= 1) {
            const w = alive[0] || { uid: 'draw', name: 'Draw' };
            return this._end(w.uid, w.name);
        }
        if (this.options.teams) {
            const r = alive.filter(p => p.team === 'red').length;
            const bl = alive.filter(p => p.team === 'blue').length;
            if (r === 0 && bl > 0) return this._end('blue', 'الفريق الأزرق');
            if (bl === 0 && r > 0) return this._end('red', 'الفريق الأحمر');
        }
        if (this.options.mode === 'war' && alive.length <= 1) {
            const w = alive[0] || { uid: 'draw', name: 'Draw' };
            return this._end(w.uid, w.name);
        }
    }

    _handlePickup(sid, keyId) {
        const p = this.gs.players[sid];
        if (!p || !p.alive) return;
        p.keys++;
        this.broadcast('key_collected', { keyId, by: sid, team: p.team });
        const total = Object.values(this.gs.players).reduce((s, pp) => s + pp.keys, 0);
        if (total >= 10 && !this._portalSpawned) {
            this._portalSpawned = true;
            this.broadcast('portal_spawned', this.monsterAI.getSpawnPos());
        }
    }

    _handlePortal(sid) {
        if (!this._portalSpawned) return;
        const p = this.gs.players[sid];
        if (!p || !p.alive) return;
        this._end(this.options.teams ? p.team : p.uid, p.name);
    }

    _end(winner, name) {
        if (this.gs.phase === 'ended') return;
        this.gs.phase = 'ended'; this.gs.winner = winner;
        this.broadcast('game_over', { winner, killerName: name, mode: this.gs.mode });
        this.clock.setTimeout(() => this.disconnect(), 6000);
    }
}

module.exports = { MazeRoom };
