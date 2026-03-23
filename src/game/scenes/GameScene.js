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
    }

    create() {
        this.tileSize = 32;
        this.enemies = [];
        this.pickups = [];
        this.killCount = 0;

        // Generate maze — use server algorithm+seed for online, original for offline
        const mazeSeed = this.onlineSeed || null;
        if (mazeSeed) {
            // Online: use same algorithm as server for identical maze
            this.mazeData = MazeGenerator.generateOnline(20, 20, 3, mazeSeed);
        } else {
            // Offline: use full recursive backtracker with rooms
            const mazeGen = new MazeGenerator(20, 20, 3);
            this.mazeData = mazeGen.generate();
        }

        const worldW = this.mazeData.width  * this.tileSize;
        const worldH = this.mazeData.height * this.tileSize;
        this.physics.world.setBounds(0, 0, worldW, worldH);

        this._drawMaze();

        // Bullet group (capped for perf)
        this.bulletGroup = this.physics.add.group({ maxSize: 40 });

        // Player (starts with no ammo/weapon)
        const spawnX = this.mazeData.playerSpawn.x * this.tileSize + this.tileSize / 2;
        const spawnY = this.mazeData.playerSpawn.y * this.tileSize + this.tileSize / 2;
        this.player = new Player(this, spawnX, spawnY, true);

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
        for (let i = 0; i < 200; i++) {
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

        // Launch Wormholes
        this._spawnWormholes();
        this.time.addEvent({ delay: 60000, loop: true, callback: () => this._spawnWormholes() });

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

        // Launch HUD
        this.scene.launch('HUDScene', { gameScene: this });
        this.time.delayedCall(200, () => this._emitHUDUpdate());

        // Periodic trap check
        this.time.addEvent({
            delay: 80, loop: true,
            callback: () => { if (this.trapSystem && this.player) this.trapSystem.checkPlayerCollision(this.player); },
        });
    }

    update(time, delta) {
        if (this.player) this.player.update(time, delta);

        // Update bots
        for (const bot of (this.bots || [])) {
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
            if (ex > camX - VIEW_MARGIN && ex < camX + camW + VIEW_MARGIN &&
                ey > camY - VIEW_MARGIN && ey < camY + camH + VIEW_MARGIN) {
                e.update(time, delta);
            } else {
                e.container.body.setVelocity(0, 0); // freeze off-screen
            }
        }
        
        if (this.player && this.player.alive) {
            this._checkWormholeCollisions(this.player.container, this.player);
        }

        // Trap laser draw (every frame for smooth neon animation)
        if (this.trapSystem) this.trapSystem.update();

        // Bullet cleanup
        this.bulletGroup.getChildren().forEach(b => {
            if (b.active) {
                if (b.x < 0 || b.y < 0 ||
                    b.x > this.physics.world.bounds.width ||
                    b.y > this.physics.world.bounds.height) {
                    this._recycleBullet(b);
                }
            }
        });

        // Breach via space when breach mode active
        if (this._breachActive && this.player?.alive &&
            Phaser.Input.Keyboard.JustDown(this.player.cursors.SPACE)) {
            this._tryBreach();
        }

        // Online: send local input to server + interpolate remote players
        if (this.onlineMode && this.onlineSync && this.player?.alive) {
            const vx = this.player.container.body?.velocity?.x || 0;
            const vy = this.player.container.body?.velocity?.y || 0;
            const len = Math.sqrt(vx*vx + vy*vy);
            const dx = len > 0 ? vx/len : 0;
            const dy = len > 0 ? vy/len : 0;
            this.onlineSync.sendInput(dx, dy, this.player.container.rotation);
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
            const { network: netMgr } = await import('../multiplayer/NetworkManager');
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
            this.onlineSync.onGameOver = ({ winner, killerName, mode: m }) => {
                const isWinner = winner === this.onlineUid ||
                    (this.onlineTeam && winner === this.onlineTeam);
                this.events.emit('onlineGameOver', { isWinner, killerName, mode: m });
                this.scene.get('HUDScene')?.events?.emit(
                    isWinner ? 'showWin' : 'showLoss',
                    { name: killerName || winner }
                );
            };

            // Server spawns portal — create local visual + overlap
            this.onlineSync.onPortalSpawned = (pos) => {
                if (this.keySystem) this.keySystem.forceSpawnPortal(pos.x, pos.y);
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
    _spawnWormholes() {
        if (this.wormholes) {
            this.wormholes.forEach(w => w.container.destroy());
        }

        const colors = [0xff2222, 0x22ff22, 0x2222ff, 0xffff22, 0xff22ff, 0x22ffff, 0xff8822, 0xff2288, 0x88ff22, 0xffffff];
        this.wormholes = [];
        this.availableWormholeExits = [];

        const candidates = [];
        const { grid, width, height } = this.mazeData;
        const ts = this.tileSize;
        
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                if (grid[y][x] === 0) {
                    const isEdge = x < 4 || x > width - 4 || y < 4 || y > height - 4;
                    candidates.push({ x, y });
                    if (isEdge) candidates.push({ x, y }); // Double probability
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
        });
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
    createBullet(x, y, vx, vy, damage, isExplosive, explosionRadius, weaponKey) {
        let bullet = this.bulletGroup.getFirstDead(false);
        if (!bullet) {
            bullet = this.physics.add.image(x, y, 'bullet');
            this.bulletGroup.add(bullet);
        }
        bullet.enableBody(true, x, y, true, true);
        bullet.setPosition(x, y);
        bullet.body.setVelocity(vx, vy);
        bullet.body.setAllowGravity(false);
        bullet.setDepth(15);
        bullet.setData('damage', damage);
        bullet.setData('isExplosive', isExplosive || false);
        bullet.setData('explosionRadius', explosionRadius || 0);
        bullet.setData('owner', 'player');

        if (isExplosive) { bullet.setTint(0xff3300); bullet.setDisplaySize(10, 10); }
        else             { bullet.setTint(0xffcc00); bullet.setDisplaySize(5, 5); }

        this.time.delayedCall(2000, () => { if (bullet.active) this._recycleBullet(bullet); });
        return bullet;
    }

    _recycleBullet(bullet) { bullet.disableBody(true, true); }

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
            }
        });
    }

    _addKeyCollider(key) {
        this.physics.add.overlap(this.player.container, key, () => {
            this.keySystem.collectKey(this.player, key);
            this._emitHUDUpdate();
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
        if (this.player?.alive) {
            const dx = this.player.container.x - x, dy = this.player.container.y - y;
            if (Math.sqrt(dx*dx+dy*dy) < r) this.player.takeDamage(35);
        }
        for (const e of this.enemies) {
            if (!e.alive) continue;
            const dx = e.container.x - x, dy = e.container.y - y;
            if (Math.sqrt(dx*dx+dy*dy) < r) e.takeDamage(50);
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

        this.physics.add.collider(this.bulletGroup, this.wallGroup, (bullet) => {
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
            delay: 80, loop: true,
            callback: () => this._checkBulletCollisions(),
        });
    }

    _createExplosion(x, y, radius) {
        const c = this.add.circle(x, y, 6, 0xff6600, 0.85).setDepth(100);
        this.cameras.main.shake(150, 0.01);
        this.tweens.add({ targets: c, scaleX: radius/6, scaleY: radius/6, alpha: 0, duration: 280, ease: 'Power2', onComplete: () => c.destroy() });
        for (const e of this.enemies) {
            if (!e.alive) continue;
            const dx = e.container.x - x, dy = e.container.y - y;
            if (Math.sqrt(dx*dx+dy*dy) < radius) e.takeDamage(25);
        }
    }

    _checkBulletCollisions() {
        const bullets = this.bulletGroup.getChildren();
        for (const b of bullets) {
            if (!b.active) continue;
            // Barrels
            for (const barrel of this.trapSystem.getBarrels()) {
                if (barrel.getData('exploded')) continue;
                const dx = b.x - barrel.x, dy = b.y - barrel.y;
                if (Math.sqrt(dx*dx+dy*dy) < 14) {
                    this.trapSystem.damageBarrel(barrel, b.getData('damage') || 10);
                    this._recycleBullet(b); break;
                }
            }
            if (!b.active) continue;
            // Enemies
            for (const e of this.enemies) {
                if (!e.alive) continue;
                const dx = b.x - e.container.x, dy = b.y - e.container.y;
                if (Math.sqrt(dx*dx+dy*dy) < 18) {
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
                const dx = b.x - bot.container.x, dy = b.y - bot.container.y;
                if (Math.sqrt(dx*dx+dy*dy) < 16) {
                    bot.takeDamage(b.getData('damage') || 10);
                    this._recycleBullet(b);
                    break;
                }
            }
            if (!b.active) continue;
            // Bot bullets hit the real player
            if (owner.startsWith('bot_') && this.player?.alive) {
                const dx = b.x - this.player.container.x, dy = b.y - this.player.container.y;
                if (Math.sqrt(dx*dx+dy*dy) < 18) {
                    this.player.takeDamage(b.getData('damage') || 10);
                    this._recycleBullet(b);
                }
            }
        }
        // Portal
        if (this.keySystem.portal && this.player?.alive) {
            const dx = this.player.container.x - this.keySystem.portal.x;
            const dy = this.player.container.y - this.keySystem.portal.y;
            if (Math.sqrt(dx*dx+dy*dy) < 30) this.keySystem.enterPortal(this.player);
        }
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

