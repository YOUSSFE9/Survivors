/**
 * GameScene — Supports offline (AI bot) AND online (Colyseus) modes.
 */
import Phaser from 'phaser';
import { MazeGenerator, TILE } from '../systems/MazeGenerator';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { Pickup } from '../entities/Pickup';
import { KeySystem } from '../systems/KeySystem';
import { WaveSpawner } from '../systems/WaveSpawner';
import { EconomySystem } from '../systems/EconomySystem';
import { TrapSystem } from '../systems/TrapSystem';
import { Pathfinder } from '../systems/Pathfinder';
import { BotPlayer } from '../entities/BotPlayer';
import { network as netMgr } from '../multiplayer/NetworkManager';
import { 
    getDailyStats, incrementDailyStat, getDailyKey, addGoldCoins,
    firestore, doc as fbDoc, getDoc as fbGetDoc, setDoc as fbSetDoc, serverTimestamp 
} from '../../firebase/config';

// OnlineSync is loaded dynamically to avoid bundling Colyseus in offline builds
let OnlineSync = null;

export class GameScene extends Phaser.Scene {
    constructor() { super({ key: 'GameScene' }); }

    init() {
        // Read options from the Phaser registry (set by React wrapper)
        this.gameMode     = this.game.registry.get('gameMode') || 'offline';
        this.onlineMode   = this.game.registry.get('onlineMode') || null; // 'duel'|'squad'|'war'
        this.onlineRoomId = this.game.registry.get('roomId')   || null;
        this.onlineUid    = this.game.registry.get('uid')        || null;
        this.onlineName   = this.game.registry.get('name')       || 'Player';
        this.onlineSeed   = this.game.registry.get('mazeSeed')   || null; // shared seed from server
        this.onlineGrid   = this.game.registry.get('mazeGrid')   || null; // generated grid from server
        this.onlineTrapPositions = this.game.registry.get('trapPositions') || null;
        // Prize system: Google UID for Firestore daily stat tracking (offline mode only)
        this._prizeUid  = this.game.registry.get('prizeUid')  || null;
        this._prizeName = this.game.registry.get('prizeName') || 'Player';
        this._prizePhoto= this.game.registry.get('prizePhoto')|| '';
    }

    create() {
        this.tileSize = 32;
        this.enemies = [];
        this.pickups = [];
        this.killCount = 0;
        this.performanceProfile = this._buildPerformanceProfile();
        this._frameCounter = 0;

        // Pre-allocate explosion circle pool to avoid GC spikes during combat
        this.explosionPool = [];
        const POOL_SIZE = this.performanceProfile.lowEnd ? 10 : 20;
        for (let i = 0; i < POOL_SIZE; i++) {
            const c = this.add.circle(0, 0, 6, 0xff6600, 0.85).setDepth(100).setActive(false).setVisible(false);
            this.explosionPool.push(c);
        }

        // Generate maze — use server algorithm+seed for online, original for offline
        const hasOnlineSeed = this.onlineSeed !== null && this.onlineSeed !== undefined;
        const mazeSeed = hasOnlineSeed ? this.onlineSeed : null;
        if (hasOnlineSeed) {
            // Online: use same algorithm as server for identical maze
            this.mazeData = MazeGenerator.generateOnline
                ? MazeGenerator.generateOnline(20, 20, 3, mazeSeed, this.onlineGrid)
                : (() => {
                    const mg = new MazeGenerator(20, 20, 3, mazeSeed);
                    const d = mg.generate();
                    // Override grid with server-authoritative grid
                    if (this.onlineGrid) d.grid = this.onlineGrid;
                    return d;
                })();
            // Inject server-authoritative trap positions so TrapSystem works in online mode
            if (this.onlineTrapPositions?.length) {
                this.mazeData.trapPositions = this.onlineTrapPositions;
            }
        } else {
            // Offline: use full recursive backtracker with rooms
            const mazeGen = new MazeGenerator(20, 20, 3);
            this.mazeData = mazeGen.generate();
        }

        const worldW = this.mazeData.width  * this.tileSize;
        const worldH = this.mazeData.height * this.tileSize;
        this.physics.world.setBounds(0, 0, worldW, worldH);

        this._drawMaze();

        // Bullet pool scales down on low-end devices to keep frame time stable.
        this.bulletGroup = this.physics.add.group({ maxSize: this.performanceProfile.maxBullets });

        // Player (starts with no ammo/weapon)
        const spawnX = this.mazeData.playerSpawn.x * this.tileSize + this.tileSize / 2;
        const spawnY = this.mazeData.playerSpawn.y * this.tileSize + this.tileSize / 2;
        this.player = new Player(this, spawnX, spawnY, true);
        this._setupKeyboardInput();

        // BFS Pathfinder (shared by all enemies)
        this.pathfinder = new Pathfinder(this.mazeData.grid, this.tileSize);

        // Camera (Infinite space bounds)
        this.cameras.main.startFollow(this.player.container, true, 0.1, 0.1);
        this.cameras.main.setDeadzone(80, 60);
        // Wider view on mobile so players can see traps/lasers
        const isMobile = !this.sys.game.device.os.desktop;
        this.cameras.main.setZoom(isMobile ? 0.95 : 1.4);

        // Space Background (fewer stars for perf)
        this.cameras.main.setBackgroundColor('#000000');
        const starGfx = this.add.graphics().setDepth(-10);
        for (let i = 0; i < this.performanceProfile.starCount; i++) {
            const sx = Phaser.Math.Between(-1000, worldW + 1000);
            const sy = Phaser.Math.Between(-1000, worldH + 1000);
            const r = Math.random() * 1.5 + 0.5;
            starGfx.fillStyle(Math.random() > 0.8 ? 0xaaccff : 0xffffff, Math.random() * 0.7 + 0.2);
            starGfx.fillCircle(sx, sy, r);
        }

        // Key system
        this.keySystem = new KeySystem(this);
        this.keySystem.spawnKeys(this.mazeData.keyPositions, this.tileSize);

        // Economy
        this.economy = new EconomySystem();
        if (this._prizeUid) {
            this.economy.setUser(this._prizeUid);
            this.economy.loadCoins().then(() => this._emitHUDUpdate());
        }

        // Pickups
        this._spawnPickups();

        // Trap system (pass grid for laser wall-scan)
        this.trapSystem = new TrapSystem(this);
        this.trapSystem.spawnTraps(
            this.mazeData.trapPositions, this.tileSize,
            this.mazeData.grid, this.mazeData.width, this.mazeData.height
        );

        // Collisions
        this._setupCollisions();

        // Launch Wormholes (offline only; online uses server-provided data)
        if (!this.onlineMode) {
            this._spawnWormholes();
            this.time.addEvent({ delay: 60000, loop: true, callback: () => this._spawnWormholes() });
        }

        // Spawn bots only in offline mode
        this.bots = [];
        if (!this.onlineMode) {
            this.time.delayedCall(2000, () => this._spawnBots());
        }

        // Online mode: skip bots/waves, connect to Colyseus instead
        if (this.onlineMode) {
            this._startOnlineMode();
        }

        // Wave spawner (offline only)
        if (this.gameMode === 'offline' && !this.onlineMode) {
            this.waveSpawner = new WaveSpawner(this);
            this.events.on('spawnEnemy', (type) => this._spawnEnemy(type));
            this.events.on('enemyDied',  (enemy) => this._onEnemyDied(enemy));
            this.waveSpawner.start();
        }

        // Periodic dead enemy cleanup (every 5s, removes destroyed containers from array)
        this.time.addEvent({
            delay: 5000, loop: true,
            callback: () => {
                this.enemies = this.enemies.filter(e => e.alive || (e.container && e.container.active));
            }
        });

        // Grenade handling
        this.events.on('grenadeThrown', (data) => this._handleGrenade(data));

        // Breach mode
        this._breachActive = false;
        this.events.on('breachModeChanged', (active) => { this._breachActive = active; });

        // Player events
        this.events.on('playerDied',  () => {
            this.economy.onDeath();
            this._emitHUDUpdate();
            if (this.onlineMode) {
                this.time.delayedCall(800, () => {
                    this.scene.get('HUDScene')?.events?.emit('showLoss', { name: '' });
                });
            }
        });
        this.events.on('inventoryChanged', () => this._emitHUDUpdate());
        this.events.on('healthChanged',    () => this._emitHUDUpdate());

        // Offline-only: initialize daily stats record and listen for portal entry
        if (!this.onlineMode && this._prizeUid) {
            // Ensure today's record exists
            getDailyStats(this._prizeUid, this._prizeName, this._prizePhoto).catch(() => {});

            // Listen for portal entry (playerWon event from KeySystem)
            this.events.on('playerWon', () => {
                // 1. Track portal for daily bonus
                incrementDailyStat(this._prizeUid, 'portalsOpened', 1).then(() => {
                    // Check if player reached 10 portals today → award 10 coins
                    getDailyStats(this._prizeUid, this._prizeName, this._prizePhoto).then(stats => {
                        if (stats && stats.portalsOpened >= 10) {
                            // Award 10 coins only if not already awarded today
                            const awardId = `${this._prizeUid}_10portals_${getDailyKey()}`;
                            const ref = fbDoc(firestore, 'daily_awards', awardId);
                            fbGetDoc(ref).then(snap => {
                                if (!snap.exists()) {
                                    addGoldCoins(this._prizeUid, 10).then(() => {
                                        fbSetDoc(ref, { 
                                            uid: this._prizeUid, 
                                            day: getDailyKey(), 
                                            reason: '10_portals', 
                                            coins: 10, 
                                            awardedAt: serverTimestamp() 
                                        }).catch(() => {});
                                    });
                                }
                            }).catch(() => {});
                        }
                    }).catch(() => {});
                }).catch(() => {});
            });
        }

        // Launch HUD
        this.scene.launch('HUDScene', { gameScene: this });
        this.time.delayedCall(200, () => this._emitHUDUpdate());
    }

    update(time, delta) {
        if (!this.player) return;
        this._frameCounter++;

        // If player is dead, pause main gameplay logic (skip AI, traps, etc.)
        if (!this.player.alive) {
            this.player.update(time, delta); // Still allow player animation/tint
            if (this.onlineMode && this.onlineSync) {
                this.onlineSync.update();
            }
            return;
        }

        this.player.update(time, delta);

        // Update bots
        const botStride = this.performanceProfile.lowEnd ? 2 : 1;
        let botIdx = 0;
        for (const bot of (this.bots || [])) {
            botIdx++;
            if (botStride > 1 && ((botIdx + this._frameCounter) % botStride !== 0)) continue;
            if (bot.alive) {
                bot.update(time, delta);
                // Only check wormhole if bot is still fully visible (not mid-tween)
                if (bot.container.alpha > 0.5) {
                    this._checkWormholeCollisions(bot.container, bot);
                }
            }
        }

        // Update enemies (skip off-screen ones to save BFS pathfinding)
        const camX = this.cameras.main.scrollX;
        const camY = this.cameras.main.scrollY;
        const camW = this.cameras.main.width / (this.cameras.main.zoom || 1);
        const camH = this.cameras.main.height / (this.cameras.main.zoom || 1);
        const VIEW_MARGIN = 300; // px margin around camera view

        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i];
            if (!e.alive) continue;
            // Only update enemies within extended camera view
            const ex = e.container.x, ey = e.container.y;
            const inView = ex > camX - VIEW_MARGIN && ex < camX + camW + VIEW_MARGIN &&
                ey > camY - VIEW_MARGIN && ey < camY + camH + VIEW_MARGIN;
            if (inView) {
                if (this.performanceProfile.enemyUpdateStride > 1 &&
                    ((i + this._frameCounter) % this.performanceProfile.enemyUpdateStride !== 0)) {
                    continue;
                }
                e.update(time, delta);
            } else {
                e.container.body.setVelocity(0, 0); // freeze off-screen
            }
        }
        
        if (this.player && this.player.alive) {
            this._checkWormholeCollisions(this.player.container, this.player);
        }

        // Trap laser draw & collisions
        if (this.trapSystem) {
            this.trapSystem.update();
            this.trapSystem.checkPlayerCollision(this.player);
        }

        // Bullet cleanup (halve frequency on low-end devices).
        if (!this.performanceProfile.lowEnd || this._frameCounter % 2 === 0) {
            const now = Date.now();
            this.bulletGroup.getChildren().forEach(b => {
                if (b.active) {
                    // Out of bounds
                    if (b.x < 0 || b.y < 0 ||
                        b.x > this.physics.world.bounds.width ||
                        b.y > this.physics.world.bounds.height) {
                        this._recycleBullet(b);
                        return;
                    }
                    // Safety max-lifetime: 3s — prevents stuck-corner bullets
                    const age = now - (b.getData('spawnTime') || now);
                    if (age > 3000) this._recycleBullet(b);
                }
            });
        }

        // Breach via space when breach mode active
        if (this._breachActive && this.player?.alive &&
            Phaser.Input.Keyboard.JustDown(this.player.cursors.SPACE)) {
            this._tryBreach();
        }

        // Online: interpolate remote/server-synced entities
        if (this.onlineMode && this.onlineSync) {
            this.onlineSync.update();
        }
    }

    // ═══ ONLINE ═══
    async _startOnlineMode() {
        try {
            // Lazy import to avoid bundling colyseus in offline mode
            const mod = await import('../multiplayer/OnlineSync');
            const { OnlineSync: OSync } = mod;
            this.onlineSync = new OSync(this);

            // REUSE the existing room from OnlineLobby (stored on network singleton)
            if (netMgr.room) {
                this.onlineSync.attachRoom(netMgr.room);
                console.log('[GameScene] Attached to existing room:', netMgr.room.id);

                // Initialize local player position to match EXACT server spawn
                const data = netMgr.gameStartedData;
                if (data?.players) {
                    const mine = data.players.find(p => p.sessionId === netMgr.sessionId);
                    if (mine && this.player) {
                        this.player.container.setPosition(mine.x, mine.y);
                        if (this.player.container.body) {
                            this.player.container.body.reset(mine.x, mine.y);
                        }
                    }
                }
            } else {
                // Fallback: join fresh (shouldn't normally happen)
                await this.onlineSync.joinRoom(this.onlineMode, {
                    uid: this.onlineUid || 'anon',
                    name: this.onlineName || 'Player',
                    roomCode: this.onlineRoomId,
                });
            }

            // Handle game over from server
            this.onlineSync.onGameOver = (data) => {
                const { winner, killerName, isEliminated } = data;

                if (isEliminated) {
                    this.events.emit('onlineGameOver', { isWinner: false, killerName, mode: this.onlineMode, isEliminated: true });
                    this.scene.get('HUDScene')?.events?.emit('showLoss', { name: killerName || 'an enemy', allowReturn: true });
                    return;
                }

                const isWinner = winner === this.onlineUid ||
                    (this.onlineTeam && winner === this.onlineTeam) ||
                    winner === this.onlineSync.mySessionId;

                // Track portal entry for daily stats if in Survivors/War mode
                if (isWinner && this._prizeUid) {
                    if (this.onlineMode === 'survivors' || this.onlineMode === 'war') {
                         incrementDailyStat(this._prizeUid, 'portalsOpened', 1).catch(() => {});
                    }
                }

                this.events.emit('onlineGameOver', { isWinner, killerName, mode: this.onlineMode });
                this.scene.get('HUDScene')?.events?.emit(
                    isWinner ? 'showWin' : 'showLoss',
                    { name: killerName || winner }
                );
            };

            // Server spawns portal — create local visual + overlap
            this.onlineSync.onPortalSpawned = (pos) => {
                if (this.keySystem) this.keySystem.forceSpawnPortal(pos.x, pos.y);
            };

            // Server-synced wormholes
            if (netMgr.gameStartedData?.wormholes) {
                this._spawnWormholes(netMgr.gameStartedData.wormholes);
            }

            // Remote pickup collection sync
            this.onlineSync.onPickupCollected = (data) => {
                this._removePickupByIndex(data.pickupIndex);
            };

            // Remote key collection sync
            this.onlineSync.onKeyCollected = (data) => {
                const keyId = data.keyId;
                if (keyId !== undefined) {
                    this.keySystem.removeKeyByIndex(keyId);
                }
            };

            console.log('[GameScene] Online mode active:', this.onlineMode);
        } catch (e) {
            console.error('[GameScene] Failed to start online mode:', e);
        }
    }

    // ═══ MAZE ═══
    _drawMaze() {
        const { grid, width, height } = this.mazeData;
        const ts = this.tileSize;
        this.wallGroup = this.physics.add.staticGroup();

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const px = x * ts + ts/2, py = y * ts + ts/2;
                if (grid[y][x] === TILE.WALL) {
                    const wall = this.wallGroup.create(px, py, 'wall');
                    wall.setDisplaySize(ts, ts);
                    wall.setData('gridX', x);
                    wall.setData('gridY', y);
                    wall.refreshBody();
                } else {
                    this.add.image(px, py, 'floor').setDisplaySize(ts, ts).setDepth(0);
                }
            }
        }
    }

    // ═══ WORMHOLES (Randomly shifting portals) ═══
    _spawnWormholes(serverWormholes = null) {
        if (this.wormholes) {
            this.wormholes.forEach(w => w.container.destroy());
        }

        this.wormholes = [];
        this.availableWormholeExits = [];
        const ts = this.tileSize;

        if (serverWormholes) {
            // Online: Use data from server
            serverWormholes.forEach((w) => {
                const whX = w.x * ts + ts / 2;
                const whY = w.y * ts + ts / 2;
                this._createWormholeVisual(whX, whY, w.color);
            });
            return;
        }

        // Offline: Generate locally
        const colors = [0xff2222, 0x22ff22, 0x2222ff, 0xffff22, 0xff22ff, 0x22ffff, 0xff8822, 0xff2288, 0x88ff22, 0xffffff];
        const candidates = [];
        const { grid, width, height } = this.mazeData;
        
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                if (grid[y][x] === 0) {
                    const isEdge = x < 4 || x > width - 4 || y < 4 || y > height - 4;
                    candidates.push({ x, y });
                    if (isEdge) candidates.push({ x, y });
                }
            }
        }
        
        Phaser.Utils.Array.Shuffle(candidates);
        const selected = [];
        for (const c of candidates) {
            if (!selected.find(s => s.x === c.x && s.y === c.y)) {
                selected.push(c);
                if (selected.length === 10) break;
            }
        }

        selected.forEach((pos, i) => {
            const whX = pos.x * ts + ts/2;
            const whY = pos.y * ts + ts/2;
            const color = colors[i % colors.length];
            this._createWormholeVisual(whX, whY, color);
        });
    }

    _createWormholeVisual(whX, whY, color) {
        const ts = this.tileSize;
        const container = this.add.container(whX, whY).setDepth(4);
        
        const outer = this.add.graphics();
        outer.lineStyle(2, color, 0.9);
        outer.beginPath();
        for(let a=0; a<Math.PI*4; a+=0.2) {
            let r = (a / (Math.PI*4)) * (ts/2);
            let px = Math.cos(a)*r, py = Math.sin(a)*r;
            a === 0 ? outer.moveTo(px,py) : outer.lineTo(px,py);
        }
        outer.strokePath();

        this.tweens.add({ targets: outer, angle: -360, duration: 1500, repeat: -1, ease: 'Linear' });

        const inner = this.add.circle(0, 0, 6, 0x000000);
        const glow = this.add.circle(0, 0, ts/2 - 2, color, 0.3);
        this.tweens.add({ targets: glow, scaleX: 1.3, scaleY: 1.3, alpha: 0.1, duration: 800, yoyo: true, repeat: -1 });

        container.add([glow, outer, inner]);
        const wh = { x: whX, y: whY, color, container };
        this.wormholes.push(wh);
        this.availableWormholeExits.push(wh);
    }

    _checkWormholeCollisions(bodyContainer, entityObj) {
        if (!this.wormholes) return;
        if (entityObj._teleportCooldown && Date.now() < entityObj._teleportCooldown) return;

        for (const wh of this.wormholes) {
            const dx = bodyContainer.x - wh.x;
            const dy = bodyContainer.y - wh.y;
            if (dx*dx + dy*dy < 225) { // 15px radius logic overlap
                this._teleportEntity(bodyContainer, entityObj, wh);
                break;
            }
        }
    }

    _teleportEntity(bodyContainer, entityObj, entryWh) {
        let candidates = this.availableWormholeExits.filter(w => w !== entryWh);
        if (candidates.length === 0) {
            this.availableWormholeExits = [...this.wormholes];
            candidates = this.availableWormholeExits.filter(w => w !== entryWh);
        }
        const exitWh = candidates[Math.floor(Math.random() * candidates.length)];
        this.availableWormholeExits = this.availableWormholeExits.filter(w => w !== exitWh);

        // Smooth fade-out → teleport → fade-in
        entityObj._teleportCooldown = Date.now() + 3200;
        const isPlayer = entityObj === this.player;

        // Kill any existing alpha tweens on this container first
        this.tweens.killTweensOf(bodyContainer);

        this.tweens.add({
            targets: bodyContainer, alpha: 0, duration: 200,
            onComplete: () => {
                if (!entityObj.alive) {
                    bodyContainer.setAlpha(1);
                    return; // died mid-teleport, abort
                }
                bodyContainer.setPosition(exitWh.x, exitWh.y);
                if (isPlayer) {
                    this.cameras.main.flash(150, exitWh.color >> 16, (exitWh.color >> 8) & 0xff, exitWh.color & 0xff, false);
                    this.cameras.main.shake(150, 0.006);
                }
                // Ring burst VFX at exit
                const ring = this.add.circle(exitWh.x, exitWh.y, 8, exitWh.color, 0.9).setDepth(25);
                this.tweens.add({
                    targets: ring, scaleX: 5, scaleY: 5, alpha: 0, duration: 500,
                    ease: 'Power2', onComplete: () => ring.destroy()
                });
                // Guaranteed fade back in
                bodyContainer.setAlpha(1);
            }
        });
    }

    // ═══ BOT PLAYERS ═══
    _spawnBots() {
        const { grid, width, height } = this.mazeData;
        const ts = this.tileSize;
        const floors = [];
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++)
                if (grid[y][x] === 0) floors.push({ x: x*ts+ts/2, y: y*ts+ts/2 });
        
        Phaser.Utils.Array.Shuffle(floors);
        
        for (let i = 0; i < 1; i++) { // 1 elite opponent
            const pos = floors[i] || floors[0];
            const bot = new BotPlayer(this, pos.x, pos.y, i);
            // Wall collision — same as real player (1 bot is fine for perf)
            this.physics.add.collider(bot.container, this.wallGroup);
            this.bots.push(bot);
        }

        // Enemies attack nearby bots (400ms interval, not 200)
        this.time.addEvent({
            delay: 400, loop: true,
            callback: () => {
                for (const e of this.enemies) {
                    if (!e.alive) continue;
                    for (const bot of this.bots) {
                        if (!bot.alive) continue;
                        const d = Phaser.Math.Distance.Between(e.container.x, e.container.y, bot.container.x, bot.container.y);
                        if (d < 50 && Date.now() - (e._lastBotAtk||0) > e.config.attackRate) {
                            e._lastBotAtk = Date.now();
                            bot.takeDamage(e.config.damage);
                        }
                    }
                }
            }
        });
    }

    // ═══ BULLETS ═══
    _isWall(x, y) {
        const ts = this.tileSize;
        const gx = Math.floor(x / ts), gy = Math.floor(y / ts);
        if (gx < 0 || gy < 0 || gx >= this.mazeData.width || gy >= this.mazeData.height) return true;
        return this.mazeData.grid[gy][gx] === TILE.WALL;
    }

    _resolveBulletSpawn(x, y, vx, vy) {
        const mag = Math.sqrt(vx * vx + vy * vy);
        if (!Number.isFinite(mag) || mag < 0.0001) return { x, y, adjusted: false };
        const dx = vx / mag;
        const dy = vy / mag;
        if (!this._isWall(x, y)) return { x, y, adjusted: false };

        const maxBacktrack = Math.max(72, Math.floor(this.tileSize * 3));
        for (let dist = 2; dist <= maxBacktrack; dist += 2) {
            const tx = x - dx * dist;
            const ty = y - dy * dist;
            if (!this._isWall(tx, ty)) return { x: tx, y: ty, adjusted: true };
        }

        const maxForward = Math.max(24, Math.floor(this.tileSize));
        for (let dist = 2; dist <= maxForward; dist += 2) {
            const tx = x + dx * dist;
            const ty = y + dy * dist;
            if (!this._isWall(tx, ty)) return { x: tx, y: ty, adjusted: true };
        }

        if (this.player?.container && !this._isWall(this.player.container.x, this.player.container.y)) {
            const safeX = this.player.container.x + dx * 14;
            const safeY = this.player.container.y + dy * 14;
            if (!this._isWall(safeX, safeY)) return { x: safeX, y: safeY, adjusted: true };
        }

        return { x, y, adjusted: true };
    }

    createBullet(x, y, vx, vy, damage, isExplosive, explosionRadius) {
        if (!Number.isFinite(vx) || !Number.isFinite(vy) || (vx === 0 && vy === 0)) return null;

        let bullet = this.bulletGroup.getFirstDead(false);
        if (!bullet) {
            const activeBullets = this.bulletGroup.getChildren().filter((b) => b.active);
            if (activeBullets.length >= this.performanceProfile.maxBullets) {
                bullet = activeBullets.reduce((oldest, current) => {
                    const oldestTs = oldest.getData('spawnTime') || 0;
                    const currentTs = current.getData('spawnTime') || 0;
                    return currentTs < oldestTs ? current : oldest;
                });
                this._recycleBullet(bullet);
            }
        }
        if (!bullet) {
            bullet = this.physics.add.image(x, y, 'bullet');
            this.bulletGroup.add(bullet);
        }

        const spawn = this._resolveBulletSpawn(x, y, vx, vy);
        const bx = spawn.x;
        const by = spawn.y;
        const now = Date.now();
        const wallGraceMs = spawn.adjusted ? 110 : 35;

        bullet.enableBody(true, bx, by, true, true);
        bullet.setPosition(bx, by);
        bullet.body.setVelocity(vx, vy);
        bullet.body.setAllowGravity(false);
        bullet.body.setCollideWorldBounds(true);
        bullet.body.onWorldBounds = true;
        bullet.setDepth(15);
        bullet.setData('damage', damage);
        bullet.setData('isExplosive', isExplosive || false);
        bullet.setData('explosionRadius', explosionRadius || 0);
        bullet.setData('owner', 'player');
        bullet.setData('spawnTime', now);
        bullet.setData('wallGraceUntil', now + wallGraceMs);
        bullet.setData('prevX', bx);
        bullet.setData('prevY', by);

        if (isExplosive) { bullet.setTint(0xff3300); bullet.setDisplaySize(12, 12); }
        else             { bullet.setTint(0xffcc00); bullet.setDisplaySize(6, 6); }

        return bullet;
    }

    _recycleBullet(bullet) {
        bullet.disableBody(true, true);
        bullet.setData('prevX', null);
        bullet.setData('prevY', null);
    }

    // ═══ PICKUPS (routes through player.receivePickup) ═══
    _spawnPickups() {
        const ts = this.tileSize;
        const types = ['HEALTH', 'AMMO_M4', 'AMMO_BAZOOKA', 'WEAPON_M4', 'WEAPON_BAZOOKA', 'GRENADE'];
        this.mazeData.pickupPositions.forEach((pos, i) => {
            const pickup = new Pickup(
                this,
                pos.x * ts + ts/2, pos.y * ts + ts/2,
                types[i % types.length]
            );
            pickup._index = i; // store index for network sync
            this.pickups.push(pickup);
            this._addPickupCollider(pickup);
        });
    }

    _addPickupCollider(pickup) {
        this.physics.add.overlap(this.player.container, pickup.container, () => {
            if (!pickup._collected) {
                pickup._collected = true;
                const type  = pickup.type;
                const value = pickup.config.value;
                this.player.receivePickup(type, value);
                pickup.collect(this.player); // visual flash
                this.pickups = this.pickups.filter(p => p !== pickup);
                // Tell server about the collection so other clients also remove it
                if (this.onlineSync?.room) {
                    this.onlineSync.room.send('pickup_item', { pickupIndex: pickup._index, type });
                }
            }
        });
    }

    /** Remove a pickup by index (called from remote pickup_collected event) */
    _removePickupByIndex(index) {
        const idx = this.pickups.findIndex(p => p._index === index);
        if (idx !== -1) {
            const pickup = this.pickups[idx];
            pickup._collected = true;
            pickup.collect(null); // visual flash without applying to player
            this.pickups.splice(idx, 1);
        }
    }

    _addKeyCollider(key) {
        this.physics.add.overlap(this.player.container, key, () => {
            if (this.onlineSync?.room) {
                this.onlineSync.sendPickupKey(key.getData('index'));
            }
            this.keySystem.collectKey(this.player, key);
            this._emitHUDUpdate();
            // Offline-only: track key collection in Firestore leaderboard
            if (!this.onlineMode && this._prizeUid) {
                incrementDailyStat(this._prizeUid, 'keysCollected', 1).catch(() => {});
            }
        });
    }

    // ═══ ENEMIES ═══
    _spawnEnemy(type) {
        const positions = this.mazeData.enemyPositions;
        if (positions.length === 0) return;
        const pos = positions[Math.floor(Math.random() * positions.length)];
        const ts = this.tileSize;
        const enemy = new Enemy(this, pos.x * ts + ts/2, pos.y * ts + ts/2, type);
        enemy.setPathfinder(this.pathfinder);
        if (type !== 'ghost') this.physics.add.collider(enemy.container, this.wallGroup);
        this.enemies.push(enemy);
    }

    _onEnemyDied(enemy) {
        this.killCount++;
        this.economy.onAIKill().then(() => this._emitHUDUpdate());
        if (this.waveSpawner) this.waveSpawner.onEnemyKilled();
        // Offline-only: track monster kills in Firestore daily leaderboard
        if (!this.onlineMode && this._prizeUid) {
            incrementDailyStat(this._prizeUid, 'monsterKills', 1).catch(() => {});
        }

        // 40% chance to drop random loot
        if (Math.random() < 0.4) {
            const drops = ['HEALTH', 'AMMO_M4', 'GRENADE', 'KEY'];
            const type = drops[Math.floor(Math.random() * drops.length)];
            const ex = enemy.container.x, ey = enemy.container.y;
            if (type === 'KEY') {
                const key = this.keySystem.spawnSingleKey(ex, ey);
                this._addKeyCollider(key);
            } else {
                const pickup = new Pickup(this, ex, ey, type);
                this.pickups.push(pickup);
                this._addPickupCollider(pickup);
            }
        }

        this.time.delayedCall(400, () => {
            const idx = this.enemies.indexOf(enemy);
            if (idx !== -1) { this.enemies.splice(idx, 1); enemy.destroy(); }
        });

        // Respawn a new random enemy after 5 seconds at a far floor tile
        this.time.delayedCall(5000, () => {
            const types = ['zombie', 'monster', 'ghost'];
            this._spawnEnemyAtRandomFloor(types[Math.floor(Math.random() * types.length)]);
        });
    }

    _spawnEnemyAtRandomFloor(type) {
        const { grid, width, height } = this.mazeData;
        const ts = this.tileSize;
        const candidates = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (grid[y][x] === TILE.WALL) continue;
                const wx = x * ts + ts/2, wy = y * ts + ts/2;
                if (this.player) {
                    const dx = wx - this.player.container.x, dy = wy - this.player.container.y;
                    if (Math.sqrt(dx*dx+dy*dy) < ts * 7) continue;
                }
                candidates.push({ x, y });
            }
        }
        if (candidates.length === 0) return;
        const pos = candidates[Math.floor(Math.random() * candidates.length)];
        const enemy = new Enemy(this, pos.x * ts + ts/2, pos.y * ts + ts/2, type);
        enemy.setPathfinder(this.pathfinder);
        if (type !== 'ghost') this.physics.add.collider(enemy.container, this.wallGroup);
        this.enemies.push(enemy);
    }

    // ═══ GRENADES ═══
    _handleGrenade({ fromX, fromY, toX, toY }) {
        // Arc indicator
        const arcG = this.add.graphics().setDepth(20);
        arcG.lineStyle(2, 0xffaa00, 0.5);
        arcG.beginPath();
        const steps = 20;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = fromX + (toX - fromX) * t;
            const y = fromY + (toY - fromY) * t - Math.sin(t * Math.PI) * 40;
            i === 0 ? arcG.moveTo(x, y) : arcG.lineTo(x, y);
        }
        arcG.strokePath();

        // Grenade sprite
        const grenade = this.add.image(fromX, fromY, 'grenade').setDisplaySize(12, 12).setDepth(18);
        const landing = this.add.circle(toX, toY, 12, 0xff0000, 0.2).setDepth(1);
        this.tweens.add({ targets: landing, alpha: 0.55, duration: 300, yoyo: true, repeat: 4 });

        // Fly arc
        const dur = 800;
        let elapsed = 0;
        const timer = this.time.addEvent({
            delay: 16, loop: true,
            callback: () => {
                elapsed += 16;
                const t = Math.min(elapsed / dur, 1);
                grenade.x = fromX + (toX - fromX) * t;
                grenade.y = fromY + (toY - fromY) * t - Math.sin(t * Math.PI) * 40;
                grenade.rotation += 0.15;
                if (t >= 1) {
                    timer.destroy(); arcG.destroy();
                    grenade.setPosition(toX, toY);

                    // 3s fuse flicker
                    let fc = 0;
                    const fl = this.time.addEvent({
                        delay: 200, repeat: 14,
                        callback: () => { fc++; grenade.setTint(fc%2===0 ? 0xff0000 : 0xffffff); },
                    });
                    this.time.delayedCall(3000, () => {
                        fl.destroy();
                        this._grenadeExplode(toX, toY);
                        grenade.destroy(); landing.destroy();
                    });
                }
            },
        });
    }

    _grenadeExplode(x, y) {
        const boom = this.add.image(x, y, 'explosion').setDisplaySize(16, 16).setDepth(50).setAlpha(0.9);
        this.cameras.main.shake(250, 0.02);
        this.tweens.add({ targets: boom, scaleX: 5, scaleY: 5, alpha: 0, duration: 500, ease: 'Power2', onComplete: () => boom.destroy() });
        const r = 100;
        const rSq = r * r;
        if (this.player?.alive) {
            const dx = this.player.container.x - x, dy = this.player.container.y - y;
            if (dx*dx + dy*dy < rSq) this.player.takeDamage(35);
        }
        for (const e of this.enemies) {
            if (!e.alive) continue;
            const dx = e.container.x - x, dy = e.container.y - y;
            if (dx*dx + dy*dy < rSq) e.takeDamage(50);
        }
        if (this.onlineMode && this.onlineSync) {
            for (const rp of this.onlineSync.remotePlayers.values()) {
                if (!rp.alive) continue;
                const dx = rp.container.x - x, dy = rp.container.y - y;
                if (dx*dx + dy*dy < rSq) {
                    // Similar to bullets, local hit effect only. Server handles real damage via the 'shoot' event if synced.
                    // Or if grenades aren't synced server-side, we'd need to emit a hit.
                    // For now, the visual effect is what matters locally.
                }
            }
        }
    }

    // ═══ WALL BREACH ═══
    _tryBreach() {
        if (!this.player || this.player.keysCollected <= 0) return;
        const angle = this.player.container.rotation;
        const checkX = this.player.container.x + Math.cos(angle) * 24;
        const checkY = this.player.container.y + Math.sin(angle) * 24;
        const ts = this.tileSize;
        const gx = Math.floor(checkX / ts), gy = Math.floor(checkY / ts);
        if (gx >= 0 && gx < this.mazeData.width && gy >= 0 && gy < this.mazeData.height) {
            if (this.mazeData.grid[gy][gx] === TILE.WALL) {
                this.player.keysCollected--;
                this.mazeData.grid[gy][gx] = TILE.FLOOR;
                // Update pathfinder grid
                this.pathfinder.setGrid(this.mazeData.grid);
                // Remove physics wall
                for (const wall of this.wallGroup.getChildren()) {
                    if (wall.getData('gridX') === gx && wall.getData('gridY') === gy) {
                        wall.destroy(); break;
                    }
                }
                this.add.image(gx*ts+ts/2, gy*ts+ts/2, 'floor').setDisplaySize(ts, ts).setDepth(0);
                const flash = this.add.circle(checkX, checkY, 20, 0x44bbff, 0.7).setDepth(50);
                this.cameras.main.shake(100, 0.009);
                this.tweens.add({ targets: flash, alpha: 0, scaleX: 3, scaleY: 3, duration: 300, onComplete: () => flash.destroy() });
                this.player.breachMode = false;
                this._breachActive = false;
                this.events.emit('breachModeChanged', false);
                this._emitHUDUpdate();
            }
        }
    }

    // ═══ COLLISIONS ═══
    _setupCollisions() {
        this.physics.add.collider(this.player.container, this.wallGroup);

        if (!this._bulletWorldBoundsHandler) {
            const world = this.physics?.world;
            if (world) {
                const worldRef = world;
                const worldBoundsHandler = (body) => {
                    const bullet = body?.gameObject;
                    if (!bullet || !bullet.active || !this.bulletGroup.contains(bullet)) return;
                    if (bullet.getData('isExplosive')) {
                        this._createExplosion(bullet.x, bullet.y, bullet.getData('explosionRadius') || 80);
                    }
                    this._recycleBullet(bullet);
                };
                this._bulletWorldBoundsHandler = worldBoundsHandler;
                this._bulletWorldRef = worldRef;
                worldRef.on('worldbounds', worldBoundsHandler);

                const cleanupWorldBounds = () => {
                    if (worldRef && typeof worldRef.off === 'function') {
                        worldRef.off('worldbounds', worldBoundsHandler);
                    }
                    if (this._bulletWorldBoundsHandler === worldBoundsHandler) this._bulletWorldBoundsHandler = null;
                    if (this._bulletWorldRef === worldRef) this._bulletWorldRef = null;
                };

                this.sys.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanupWorldBounds);
                this.sys.events.once(Phaser.Scenes.Events.DESTROY, cleanupWorldBounds);
            }
        }

        this.physics.add.collider(this.bulletGroup, this.wallGroup, (bullet) => {
            const wallGraceUntil = bullet.getData('wallGraceUntil') || 0;
            if (Date.now() < wallGraceUntil) return;
            if (bullet.getData('isExplosive')) this._createExplosion(bullet.x, bullet.y, bullet.getData('explosionRadius') || 80);
            this._recycleBullet(bullet);
        });

        // Keys
        for (const key of this.keySystem.keys) {
            this._addKeyCollider(key);
        }

        // Pickups (Initial pickups are handled in _spawnPickups, so no loop needed here)

        // Bullet↔enemy + barrel (80ms instead of 40ms for perf)
        this.time.addEvent({
            delay: this.performanceProfile.collisionIntervalMs, loop: true,
            callback: () => this._checkBulletCollisions(),
        });
    }

    _createExplosion(x, y, radius) {
        // Use pool — find an inactive circle or fall back to creating a new one
        let c = this.explosionPool.find(o => !o.active);
        if (!c) {
            c = this.add.circle(0, 0, 6, 0xff6600, 0.85).setDepth(100);
            this.explosionPool.push(c);
        }
        c.setPosition(x, y).setActive(true).setVisible(true).setAlpha(0.85).setScale(1);
        c.setFillStyle(0xff6600, 0.85);
        this.cameras.main.shake(150, 0.01);
        this.tweens.killTweensOf(c);
        this.tweens.add({
            targets: c,
            scaleX: radius / 6,
            scaleY: radius / 6,
            alpha: 0,
            duration: 280,
            ease: 'Power2',
            onComplete: () => { c.setActive(false).setVisible(false).setScale(1); },
        });
        const radiusSq = radius * radius;
        for (const e of this.enemies) {
            if (!e.alive) continue;
            const dx = e.container.x - x, dy = e.container.y - y;
            if (dx*dx + dy*dy < radiusSq) e.takeDamage(25);
        }
    }

    _segmentPointDistanceSq(x1, y1, x2, y2, px, py) {
        const sx = x2 - x1;
        const sy = y2 - y1;
        const segLenSq = sx * sx + sy * sy;
        if (segLenSq <= 0.0001) {
            const dx = px - x1;
            const dy = py - y1;
            return dx * dx + dy * dy;
        }
        let t = ((px - x1) * sx + (py - y1) * sy) / segLenSq;
        t = Phaser.Math.Clamp(t, 0, 1);
        const cx = x1 + sx * t;
        const cy = y1 + sy * t;
        const dx = px - cx;
        const dy = py - cy;
        return dx * dx + dy * dy;
    }

    _checkBulletCollisions() {
        const bullets = this.bulletGroup.getChildren();
        const barrelHitSq = 14 * 14;
        const enemyHitSq = 18 * 18;
        const botHitSq = 16 * 16;
        const playerHitSq = 18 * 18;
        let camMinX = -Infinity;
        let camMinY = -Infinity;
        let camMaxX = Infinity;
        let camMaxY = Infinity;
        if (this.performanceProfile.lowEnd) {
            const cam = this.cameras.main;
            const vw = cam.width / (cam.zoom || 1);
            const vh = cam.height / (cam.zoom || 1);
            const margin = 220;
            camMinX = cam.scrollX - margin;
            camMinY = cam.scrollY - margin;
            camMaxX = cam.scrollX + vw + margin;
            camMaxY = cam.scrollY + vh + margin;
        }
        for (const b of bullets) {
            if (!b.active) continue;
            if (b.x < camMinX || b.x > camMaxX || b.y < camMinY || b.y > camMaxY) {
                b.setData('prevX', b.x);
                b.setData('prevY', b.y);
                continue;
            }

            const prevX = b.getData('prevX');
            const prevY = b.getData('prevY');
            const fromX = Number.isFinite(prevX) ? prevX : b.x;
            const fromY = Number.isFinite(prevY) ? prevY : b.y;
            const toX = b.x;
            const toY = b.y;

            // Barrels
            for (const barrel of this.trapSystem.getBarrels()) {
                if (barrel.getData('exploded')) continue;
                const dSq = this._segmentPointDistanceSq(fromX, fromY, toX, toY, barrel.x, barrel.y);
                if (dSq < barrelHitSq) {
                    this.trapSystem.damageBarrel(barrel, b.getData('damage') || 10);
                    this._recycleBullet(b); break;
                }
            }
            if (!b.active) continue;
            // Enemies
            for (const e of this.enemies) {
                if (!e.alive) continue;
                const dSq = this._segmentPointDistanceSq(fromX, fromY, toX, toY, e.container.x, e.container.y);
                if (dSq < enemyHitSq) {
                    e.takeDamage(b.getData('damage') || 10);
                    if (b.getData('isExplosive')) this._createExplosion(b.x, b.y, b.getData('explosionRadius') || 80);
                    this._recycleBullet(b); break;
                }
            }
            if (!b.active) continue;
            // Bots — only player bullets and enemy-fired projectiles hit bots
            // (bot's OWN bullets skip itself)
            const owner = b.getData('owner') || '';
            for (const bot of (this.bots || [])) {
                if (!bot.alive) continue;
                // Skip if this bullet was fired BY this bot
                if (owner === 'bot_' + bot.index) continue;
                const dSq = this._segmentPointDistanceSq(fromX, fromY, toX, toY, bot.container.x, bot.container.y);
                if (dSq < botHitSq) {
                    bot.takeDamage(b.getData('damage') || 10);
                    this._recycleBullet(b);
                    break;
                }
            }
            if (!b.active) continue;
            // Bot bullets hit the real player
            if (owner.startsWith('bot_') && this.player?.alive) {
                const dSq = this._segmentPointDistanceSq(fromX, fromY, toX, toY, this.player.container.x, this.player.container.y);
                if (dSq < playerHitSq) {
                    this.player.takeDamage(b.getData('damage') || 10);
                    this._recycleBullet(b);
                }
            }
            if (!b.active) continue;
            // Remote Players (Online mode)
            if (this.onlineMode && this.onlineSync) {
                for (const [sid, rp] of this.onlineSync.remotePlayers.entries()) {
                    if (!rp.alive) continue;
                    // Don't hit yourself with your own bullets
                    if (owner === 'player' && sid === this.onlineSync.mySessionId) continue;
                    
                    const dSq = this._segmentPointDistanceSq(fromX, fromY, toX, toY, rp.container.x, rp.container.y);
                    if (dSq < enemyHitSq) {
                        // In a fully authoritative server, we'd send a "hit" event.
                        // Here, because we send 'shoot' to the server, the server calculates hits automatically 
                        // and broadcasts health updates via state_tick.
                        // But we CAN show a local hit effect/explosion for responsiveness!
                        if (b.getData('isExplosive')) {
                            this._createExplosion(b.x, b.y, b.getData('explosionRadius') || 80);
                        }
                        this._recycleBullet(b);
                        break;
                    }
                }
            }
            if (b.active) {
                b.setData('prevX', b.x);
                b.setData('prevY', b.y);
            }
        }
        // Portal
        if (this.keySystem.portal && this.player?.alive) {
            const dx = this.player.container.x - this.keySystem.portal.x;
            const dy = this.player.container.y - this.keySystem.portal.y;
            if (dx*dx + dy*dy < 30 * 30) this.keySystem.enterPortal(this.player);
        }

        // Wormholes (Offline only - Online handled by server)
        if (!this.onlineMode && this.player?.alive) {
            this._checkWormholeCollisions(this.player.container, this.player);
        }
    }

    _buildPerformanceProfile() {
        const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4;
        const deviceMemory = (typeof navigator !== 'undefined' && navigator.deviceMemory) ? navigator.deviceMemory : 4;
        const isMobile = !this.sys.game.device.os.desktop;
        const lowEnd = isMobile && (cores <= 4 || deviceMemory <= 4);

        return {
            lowEnd,
            starCount: lowEnd ? 90 : 200,
            maxBullets: lowEnd ? 50 : 80,
            collisionIntervalMs: lowEnd ? 120 : 80,
            enemyUpdateStride: lowEnd ? 2 : 1,
        };
    }

    _setupKeyboardInput() {
        const kb = this.input?.keyboard;
        if (!kb) return;

        kb.enabled = true;
        kb.resetKeys();
        if (typeof kb.addCapture === 'function') {
            kb.addCapture(['W', 'A', 'S', 'D', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'SPACE', 'G', 'B']);
        }

        const focusCanvas = () => {
            const canvas = this.game?.canvas;
            if (!canvas || typeof canvas.focus !== 'function') return;
            if (!canvas.hasAttribute('tabindex')) canvas.setAttribute('tabindex', '0');
            canvas.focus();
        };

        const inputRef = this.input;
        this._focusCanvasHandler = focusCanvas;
        if (inputRef && typeof inputRef.on === 'function') {
            inputRef.on('pointerdown', this._focusCanvasHandler);
        }
        this.time.delayedCall(0, focusCanvas);

        const onWindowBlur = () => kb.resetKeys();
        const onWindowFocus = () => {
            kb.enabled = true;
            kb.resetKeys();
            focusCanvas();
        };
        const onVisibility = () => {
            if (document.hidden) kb.resetKeys();
        };

        if (typeof window !== 'undefined') {
            window.addEventListener('blur', onWindowBlur);
            window.addEventListener('focus', onWindowFocus);
        }
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', onVisibility);
        }

        this.sys.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            if (this._focusCanvasHandler && inputRef && typeof inputRef.off === 'function') {
                inputRef.off('pointerdown', this._focusCanvasHandler);
            }
            this._focusCanvasHandler = null;
            if (typeof window !== 'undefined') {
                window.removeEventListener('blur', onWindowBlur);
                window.removeEventListener('focus', onWindowFocus);
            }
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', onVisibility);
            }
            kb.resetKeys();
        });
    }

    // ═══ HUD DATA ═══
    _emitHUDUpdate() {
        const inv = this.player._getInventoryState ? this.player._getInventoryState() : null;
        this.events.emit('hudUpdate', {
            health:       this.player.health,
            maxHealth:    this.player.maxHealth,
            inventory:    inv,
            keys:         this.keySystem.getState(),
            coins:        this.economy.getCoins(),
            wave:         this.waveSpawner ? this.waveSpawner.getCurrentWave() : 0,
            kills:        this.killCount,
        });
    }

    getMinimapData() {
        const ks = this.keySystem.getState();
        return {
            maze:           this.mazeData,
            playerPos:      this.player ? { x: this.player.container.x, y: this.player.container.y } : null,
            enemies:        this.enemies.filter(e => e.alive).map(e => ({ x: e.container.x, y: e.container.y })),
            keys:           ks.keyPositions || [],
            healthPickups:  this.pickups.filter(p => p.type === 'HEALTH'  && !p._collected).map(p => ({ x: p.container.x, y: p.container.y })),
            ammoPickups:    this.pickups.filter(p => (p.type === 'AMMO_M4' || p.type === 'AMMO_BAZOOKA' || p.type === 'WEAPON_M4' || p.type === 'WEAPON_BAZOOKA') && !p._collected).map(p => ({ x: p.container.x, y: p.container.y })),
            grenadePickups: this.pickups.filter(p => p.type === 'GRENADE' && !p._collected).map(p => ({ x: p.container.x, y: p.container.y })),
            portal:         ks.portalPos,
            tileSize:       this.tileSize,
            wormholes:      this.wormholes ? this.wormholes.map(w => ({ x: w.x, y: w.y, color: w.color })) : []
        };
    }
}
