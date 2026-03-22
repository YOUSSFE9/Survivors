/**
 * MazeRoom — Core game room supporting 3 modes:
 *   'duel'  → 1v1, no teams, 2 players
 *   'squad' → team red vs blue, up to 4v4
 *   'war'   → FFA, up to 20 players
 *
 * The SERVER is authoritative for:
 *   - Monster movement & AI
 *   - Bullet hit detection
 *   - Damage & death
 *   - Key collection
 * Clients send only: inputs (move_dir, shoot, pickup, etc.)
 */
import { Room, Client, Delayed } from 'colyseus';
import { GameState, PlayerState, MonsterState, BulletState } from '../schemas/GameState';
import { MonsterAI } from '../logic/MonsterAI';
import { MazeGenerator } from '../logic/MazeGenerator';

const TICK_RATE = 20; // 20 Hz = 50ms per tick
const PLAYER_SPEED = 180;
const BULLET_SPEED = 400;
const BULLET_TTL = 2000; // ms

interface RoomOptions {
    mode: '1v1' | 'squad' | 'war';
    maxPlayers: number;
    teams: boolean;
}

interface PlayerInput {
    dx: number;
    dy: number;
    rotation: number;
}

export class MazeRoom extends Room<GameState> {
    private options!: RoomOptions;
    private monsterAI!: MonsterAI;
    private tickInterval!: Delayed;
    private tickMs = 1000 / TICK_RATE;
    private playerInputs = new Map<string, PlayerInput>();
    private bulletIdCounter = 0;
    private bulletTimers = new Map<string, Delayed>();

    onCreate(options: RoomOptions) {
        this.options = options;
        this.maxClients = options.maxPlayers;

        const state = new GameState();
        state.mode = options.mode === '1v1' ? 'duel' : options.mode;
        state.phase = 'waiting';
        state.mazeSeed = Math.floor(Math.random() * 999999);
        this.setState(state);

        // Generate maze
        const mazeData = MazeGenerator.generate(20, 20, 3, state.mazeSeed);

        // Spawn monster AI
        this.monsterAI = new MonsterAI(mazeData, state);
        this.monsterAI.spawnInitialMonsters(5);

        // Register message handlers
        this.onMessage('input', (client, input: PlayerInput) => {
            this.playerInputs.set(client.sessionId, input);
        });

        this.onMessage('shoot', (client, data: { vx: number; vy: number; damage: number; isExplosive?: boolean }) => {
            this._handleShoot(client, data);
        });

        this.onMessage('pickup_key', (client, data: { keyId: string }) => {
            this._handlePickupKey(client, data.keyId);
        });

        this.onMessage('enter_portal', (client) => {
            this._handlePortal(client);
        });

        this.onMessage('ready', (client) => {
            const p = this.state.players.get(client.sessionId);
            if (p) {
                p.ready = true;
                this._checkStart();
            }
        });

        // Server tick loop
        this.tickInterval = this.clock.setInterval(() => {
            this._tick();
        }, this.tickMs);

        // Monster wave spawner (every 10s)
        this.clock.setInterval(() => {
            if (this.state.phase === 'playing') {
                const aliveMonsters = [...this.state.monsters.values()].filter(m => m.alive).length;
                const maxMonsters = Math.min(20, 5 + this._playerCount() * 2);
                if (aliveMonsters < maxMonsters) {
                    this.monsterAI.spawnWave(Math.min(5, maxMonsters - aliveMonsters));
                }
            }
        }, 10000);

        console.log(`[MazeRoom] created — mode: ${options.mode}, maxPlayers: ${options.maxPlayers}`);
    }

    onJoin(client: Client, options: { uid?: string; name?: string }) {
        const p = new PlayerState();
        p.sessionId = client.sessionId;
        p.uid = options.uid || client.sessionId;
        p.name = options.name || `Player_${client.sessionId.slice(0, 4)}`;
        p.health = 100;
        p.maxHealth = 100;
        p.alive = true;
        p.ready = false;
        p.kills = 0;
        p.keys = 0;

        // Assign team if squad mode
        if (this.options.teams) {
            const redCount  = [...this.state.players.values()].filter(x => x.team === 'red').length;
            const blueCount = [...this.state.players.values()].filter(x => x.team === 'blue').length;
            p.team = redCount <= blueCount ? 'red' : 'blue';
            p.tint = p.team === 'red' ? 0xff4444 : 0x4488ff;
        } else {
            const TINTS = [0xff3333, 0x33ff88, 0x3388ff, 0xffdd33, 0xff33ff,
                           0x33ffdd, 0xff8833, 0x88ff33, 0xdd33ff, 0x33ccff];
            p.tint = TINTS[this.state.players.size % TINTS.length];
        }

        // Spawn position
        const spawn = this.monsterAI.getSpawnPos();
        p.x = spawn.x; p.y = spawn.y;

        if (!this.state.hostId) this.state.hostId = client.sessionId;

        this.state.players.set(client.sessionId, p);
        console.log(`[MazeRoom] ${p.name} joined (${p.team || 'ffa'}) — ${this.state.players.size}/${this.maxClients}`);

        // Auto-start War mode when full
        if (this.options.mode === 'war' && this.state.players.size >= 2) {
            this._startGame();
        }
    }

    onLeave(client: Client) {
        const p = this.state.players.get(client.sessionId);
        if (p) {
            this.state.players.delete(client.sessionId);
            console.log(`[MazeRoom] ${p.name} left`);
        }
        if (this.state.players.size === 0) {
            this.disconnect();
        }
    }

    onDispose() {
        this.tickInterval?.clear();
        console.log(`[MazeRoom] disposed`);
    }

    // ══════════════════════════
    //  GAME TICK (20 Hz)
    // ══════════════════════════
    private _tick() {
        if (this.state.phase !== 'playing') return;

        this.state.serverTick++;

        // Apply player inputs
        for (const [sid, input] of this.playerInputs) {
            const p = this.state.players.get(sid);
            if (!p || !p.alive) continue;

            const len = Math.sqrt(input.dx * input.dx + input.dy * input.dy);
            if (len > 0.01) {
                const speed = PLAYER_SPEED / TICK_RATE;
                p.x += (input.dx / len) * speed;
                p.y += (input.dy / len) * speed;
                p.rotation = input.rotation;

                // Simple wall clamp (maze bounds)
                p.x = Math.max(0, Math.min(p.x, this.monsterAI.worldW));
                p.y = Math.max(0, Math.min(p.y, this.monsterAI.worldH));
            }
        }

        // Advance bullets
        for (let i = this.state.bullets.length - 1; i >= 0; i--) {
            const b = this.state.bullets[i];
            b.x += (b.vx / TICK_RATE);
            b.y += (b.vy / TICK_RATE);

            // Check bullet hits
            this._checkBulletHits(b, i);
        }

        // Update monster AI
        this.monsterAI.update(this.tickMs, this.state.players);
    }

    // ══════════════════════════
    //  BULLET LOGIC
    // ══════════════════════════
    private _handleShoot(client: Client, data: { vx: number; vy: number; damage: number; isExplosive?: boolean }) {
        if (this.state.phase !== 'playing') return;
        const p = this.state.players.get(client.sessionId);
        if (!p || !p.alive) return;

        const b = new BulletState();
        b.x = p.x; b.y = p.y;
        b.vx = data.vx; b.vy = data.vy;
        b.damage = data.damage;
        b.ownerId = client.sessionId;
        b.isExplosive = data.isExplosive || false;

        this.state.bullets.push(b);

        // TTL cleanup
        this.clock.setTimeout(() => {
            const idx = this.state.bullets.indexOf(b);
            if (idx !== -1) this.state.bullets.splice(idx, 1);
        }, BULLET_TTL);
    }

    private _checkBulletHits(bullet: BulletState, bulletIdx: number) {
        const RADIUS = 18;

        // Vs players
        for (const [sid, p] of this.state.players) {
            if (sid === bullet.ownerId || !p.alive) continue;

            // Friendly fire check (squad mode)
            if (this.options.teams) {
                const shooter = this.state.players.get(bullet.ownerId);
                if (shooter && shooter.team === p.team) continue;
            }

            const dx = bullet.x - p.x, dy = bullet.y - p.y;
            if (dx*dx + dy*dy < RADIUS*RADIUS) {
                this._dealDamage(p, bullet.damage, bullet.ownerId, bullet.isExplosive, bullet.x, bullet.y);
                this.state.bullets.splice(bulletIdx, 1);
                return;
            }
        }

        // Vs monsters
        for (const [mid, m] of this.state.monsters) {
            if (!m.alive) continue;
            const dx = bullet.x - m.x, dy = bullet.y - m.y;
            if (dx*dx + dy*dy < RADIUS*RADIUS) {
                m.health -= bullet.damage;
                if (m.health <= 0) {
                    m.alive = false;
                    // Credit kill to shooter
                    const shooter = this.state.players.get(bullet.ownerId);
                    if (shooter) shooter.kills++;
                }
                this.state.bullets.splice(bulletIdx, 1);
                return;
            }
        }
    }

    // ══════════════════════════
    //  DAMAGE
    // ══════════════════════════
    private _dealDamage(target: PlayerState, dmg: number, killerId: string, isExplosive: boolean, bx: number, by: number) {
        target.health -= dmg;

        if (isExplosive) {
            // AoE explosion — 80px radius
            for (const [sid, p] of this.state.players) {
                if (!p.alive || sid === killerId) continue;
                const dx = bx - p.x, dy = by - p.y;
                if (dx*dx + dy*dy < 6400) p.health -= dmg * 0.6;
            }
            for (const [mid, m] of this.state.monsters) {
                if (!m.alive) continue;
                const dx = bx - m.x, dy = by - m.y;
                if (dx*dx + dy*dy < 6400) m.health -= dmg * 0.6;
            }
        }

        if (target.health <= 0) {
            target.health = 0;
            target.alive = false;
            const killer = this.state.players.get(killerId);
            if (killer) killer.kills++;
            this._checkWinCondition();
        }
    }

    // ══════════════════════════
    //  KEYS & PORTAL
    // ══════════════════════════
    private _handlePickupKey(client: Client, keyId: string) {
        const p = this.state.players.get(client.sessionId);
        if (!p || !p.alive) return;
        p.keys++;
        this.broadcast('key_collected', { keyId, by: client.sessionId, team: p.team });
        this._checkPortalSpawn();
    }

    private _checkPortalSpawn() {
        const totalKeys = [...this.state.players.values()].reduce((s, p) => s + p.keys, 0);
        const keysNeeded = 10;
        if (totalKeys >= keysNeeded && !this._portalSpawned) {
            this._portalSpawned = true;
            const pos = this.monsterAI.getRandomFloor();
            this.broadcast('portal_spawned', { x: pos.x, y: pos.y });
        }
    }

    private _portalSpawned = false;

    private _handlePortal(client: Client) {
        if (!this._portalSpawned) return;
        const p = this.state.players.get(client.sessionId);
        if (!p || !p.alive) return;

        // In squad mode, team wins together
        if (this.options.teams) {
            this.state.winner = p.team;
        } else {
            this.state.winner = p.uid;
        }
        this.state.phase = 'ended';
        this.broadcast('game_over', { winner: this.state.winner, killerName: p.name, mode: this.state.mode });
        this.clock.setTimeout(() => this.disconnect(), 5000);
    }

    // ══════════════════════════
    //  WIN CONDITION
    // ══════════════════════════
    private _checkWinCondition() {
        const alive = [...this.state.players.values()].filter(p => p.alive);

        if (this.options.mode === '1v1' && alive.length === 1) {
            this.state.winner = alive[0].uid;
            this.state.phase = 'ended';
            this.broadcast('game_over', { winner: this.state.winner, killerName: alive[0].name, mode: 'duel' });
            this.clock.setTimeout(() => this.disconnect(), 5000);
        }

        if (this.options.teams) {
            const redAlive  = alive.filter(p => p.team === 'red').length;
            const blueAlive = alive.filter(p => p.team === 'blue').length;
            if (redAlive === 0 && blueAlive > 0) this._endWithWinner('blue');
            if (blueAlive === 0 && redAlive > 0) this._endWithWinner('red');
        }

        if (this.options.mode === 'war' && alive.length === 1) {
            this.state.winner = alive[0].uid;
            this.state.phase = 'ended';
            this.broadcast('game_over', { winner: alive[0].uid, killerName: alive[0].name, mode: 'war' });
            this.clock.setTimeout(() => this.disconnect(), 5000);
        }
    }

    private _endWithWinner(team: string) {
        this.state.winner = team;
        this.state.phase = 'ended';
        const rep = [...this.state.players.values()].find(p => p.team === team);
        this.broadcast('game_over', { winner: team, killerName: rep?.name || team, mode: 'squad' });
        this.clock.setTimeout(() => this.disconnect(), 5000);
    }

    // ══════════════════════════
    //  LOBBY
    // ══════════════════════════
    private _checkStart() {
        if (this.options.mode === 'war') return; // auto-starts
        const all = [...this.state.players.values()];
        if (all.length >= 2 && all.every(p => p.ready)) {
            this._startGame();
        }
    }

    private _startGame() {
        if (this.state.phase !== 'waiting') return;
        this.state.phase = 'playing';
        this.broadcast('game_started', {
            seed: this.state.mazeSeed,
            mode: this.state.mode,
            players: [...this.state.players.values()].map(p => ({
                sessionId: p.sessionId, uid: p.uid, name: p.name,
                team: p.team, tint: p.tint, x: p.x, y: p.y
            }))
        });
        console.log(`[MazeRoom] GAME STARTED — mode: ${this.state.mode}, players: ${this.state.players.size}`);
    }

    private _playerCount() {
        return this.state.players.size;
    }
}
