/**
 * BotPlayer — Elite single AI opponent (skill 9/10).
 * HP 500 → needs 50 M4 shots (10dmg) or 10 Bazooka shots (50dmg) to kill.
 * Damage 2 → needs 50 bot-bullets to kill the 100HP player.
 * Uses BFS pathfinding to navigate AROUND walls to reach the player.
 * 50% time → hunt keys/portal (escape), 50% → hunt the player (combat).
 */
import Phaser from 'phaser';
import { Pathfinder } from '../systems/Pathfinder';

const NAMES = [
    'Shadow_Ghost','Dark_Viper','NeonKiller','IronWolf','StealthX',
    'BloodMoon','QuantumZ','DeathShot','CyberFox','PhantomX',
    'Zer0_Cool','SkullCrush','FrostByte','NightHawk','RazorEdge'
];
const TINTS = [
    0xff3333, 0x33ff88, 0x3388ff, 0xffdd33, 0xff33ff,
    0x33ffdd, 0xff8833, 0x88ff33, 0xdd33ff, 0x33ccff,
    0xff5533, 0x55ff88, 0xddbb33, 0x5588ff, 0xff55aa
];

export class BotPlayer {
    constructor(scene, x, y, index) {
        this.scene   = scene;
        this.alive   = true;
        this.index   = index;
        this._teleportCooldown = 0;
        this._won    = false;
        this._dying  = false;
        this._life   = 0;

        // Stats (tanky — 50 M4 shots / 10 bazooka)
        this.speed     = 180;
        this.health    = 500;
        this.maxHealth = 500;
        this.damage    = 2;    // 50 shots to kill 100HP player
        this.fireRate  = 280;
        this.thinkMs   = 300;
        this.keysCollected = 0;

        // Identity
        this.name = NAMES[0];
        this.tint = TINTS[0];

        // Container
        this.container = scene.add.container(x, y).setDepth(10);
        this._buildVisuals();

        // Physics — same as Player
        scene.physics.world.enable(this.container);
        this.container.body.setSize(22, 22);
        this.container.body.setOffset(-11, -11);
        this.container.body.setCollideWorldBounds(true);
        this.container.body.setDrag(900);
        this.container.body.setMaxVelocity(this.speed);

        // BFS Pathfinding (same system enemies use)
        this.pathfinder = null;
        this.path = [];
        this._pathTimer = 0;
        this._pathInterval = 800; // recompute path every 800ms

        if (scene.mazeData) {
            this.pathfinder = new Pathfinder(scene.mazeData.grid, scene.tileSize);
        }

        // State
        this._tx = x; this._ty = y;
        this._lastThink = 0;
        this._lastFire  = 0;
        this._stuckFrames = 0;
        this._lastX = x; this._lastY = y;
        this._mode = 'keys'; // 'keys' or 'hunt'
    }

    _buildVisuals() {
        this.container.removeAll(true);
        this.sprite = this.scene.add.image(0, 0, 'player').setDisplaySize(36, 36);
        this.sprite.setTint(this.tint);
        this.weaponSprite = this.scene.add.image(14, 2, 'weapon_m4');
        this.weaponSprite.setScale(0.65).setOrigin(0.1, 0.5).setTint(this.tint);
        this.hpBg  = this.scene.add.rectangle(0, -22, 28, 5, 0x333333, 0.85).setOrigin(0.5, 0.5);
        this.hpBar = this.scene.add.rectangle(0, -22, 28, 5, this.tint).setOrigin(0.5, 0.5);
        this.container.add([this.hpBg, this.hpBar, this.sprite, this.weaponSprite]);
    }

    // ══════════════════════════
    //  UPDATE
    // ══════════════════════════
    update(time, delta) {
        if (!this.alive) return;

        // Safety: always visible when alive
        if (this.container.alpha < 0.9) this.container.setAlpha(1);
        if (this.container.scaleX < 0.9) this.container.setScale(1);

        this.hpBar.scaleX = Math.max(0, this.health / this.maxHealth);

        // Think
        if (time - this._lastThink >= this.thinkMs) {
            this._lastThink = time;
            this._think();
        }

        // Pathfind to target
        this._pathTimer += delta;
        if (this._pathTimer >= this._pathInterval) {
            this._pathTimer = 0;
            this._recomputePath();
        }

        this._followPath();
        this._detectStuck();
        this._tryPickupKeys();
        this._tryEnterPortal();
        this._tryShoot(time);
    }

    // ══════════════════════════
    //  AI BRAIN — 50/50 PRIORITY
    // ══════════════════════════
    _think() {
        const gs = this.scene;
        const bx = this.container.x, by = this.container.y;

        // FLEE if critically low
        if (this.health < this.maxHealth * 0.10) {
            this._mode = 'keys';
            const s = this._safeSpot();
            this._tx = s.x; this._ty = s.y;
            return;
        }

        // PORTAL → absolute top priority
        const ks = gs.keySystem?.getState();
        if (ks?.portalSpawned && ks?.portalPos) {
            this._mode = 'keys';
            this._tx = ks.portalPos.x; this._ty = ks.portalPos.y;
            return;
        }

        // Check distance to player
        const player = gs.player;
        const playerAlive = player?.alive;
        let playerDist = Infinity;
        if (playerAlive) {
            playerDist = Phaser.Math.Distance.Between(bx, by, player.container.x, player.container.y);
        }

        // 50% HUNT player if within ~160px (50cm on screen), else 50% seek keys
        if (playerAlive && playerDist < 160) {
            // COMBAT MODE — chase and fight the player
            this._mode = 'hunt';
            this._tx = player.container.x;
            this._ty = player.container.y;
            return;
        }

        // KEY SEEKING MODE — look for keys to escape
        this._mode = 'keys';
        const keys = gs.keySystem?.keys || [];
        let bestK = null, bestD = Infinity;
        for (const k of keys) {
            if (!k || !k.active) continue;
            const d = Phaser.Math.Distance.Between(bx, by, k.x, k.y);
            if (d < bestD) { bestD = d; bestK = k; }
        }
        if (bestK) {
            this._tx = bestK.x; this._ty = bestK.y;
            return;
        }

        // Nothing to do — roam
        const r = this._rndFloor();
        this._tx = r.x; this._ty = r.y;
    }

    // ══════════════════════════
    //  BFS PATHFINDING (no wall phasing)
    // ══════════════════════════
    _recomputePath() {
        if (!this.pathfinder) return;
        const bx = this.container.x, by = this.container.y;
        this.path = this.pathfinder.findPath(bx, by, this._tx, this._ty);
    }

    _followPath() {
        const bx = this.container.x, by = this.container.y;

        // If we have waypoints, follow them
        if (this.path.length > 0) {
            const wp = this.path[0];
            const dx = wp.x - bx, dy = wp.y - by;
            const d = Math.sqrt(dx*dx + dy*dy);

            if (d < 8) {
                this.path.shift(); // reached waypoint, next
                return;
            }

            this.container.body.setVelocity((dx/d)*this.speed, (dy/d)*this.speed);
            this.container.rotation = Math.atan2(dy, dx);
            return;
        }

        // No path — direct movement to target (fallback)
        const dx = this._tx - bx;
        const dy = this._ty - by;
        const d = Math.sqrt(dx*dx + dy*dy);

        if (d < 10) {
            this.container.body.setVelocity(0, 0);
            return;
        }

        this.container.body.setVelocity((dx/d)*this.speed, (dy/d)*this.speed);
        this.container.rotation = Math.atan2(dy, dx);
    }

    _detectStuck() {
        const cx = this.container.x, cy = this.container.y;
        const moved = Math.abs(cx - this._lastX) + Math.abs(cy - this._lastY);
        this._lastX = cx; this._lastY = cy;

        if (moved < 0.5) this._stuckFrames++;
        else this._stuckFrames = 0;

        if (this._stuckFrames > 40) {
            this._stuckFrames = 0;
            this.path = []; // clear bad path
            const r = this._rndFloor();
            this._tx = r.x; this._ty = r.y;
        }
    }

    // ══════════════════════════
    //  KEYS & PORTAL
    // ══════════════════════════
    _tryPickupKeys() {
        const ks = this.scene.keySystem;
        if (!ks) return;
        const bx = this.container.x, by = this.container.y;
        for (let i = ks.keys.length - 1; i >= 0; i--) {
            const k = ks.keys[i];
            if (!k || !k.active) continue;
            if (Phaser.Math.Distance.Between(bx, by, k.x, k.y) < 22) {
                ks.collectKey(this, k);
                this.keysCollected++;
                break;
            }
        }
    }

    _tryEnterPortal() {
        const ks = this.scene.keySystem;
        if (!ks?.portal || !ks.portalSpawned) return;
        const dx = this.container.x - ks.portal.x;
        const dy = this.container.y - ks.portal.y;
        if (dx*dx + dy*dy < 900) {
            if (!this._won) {
                this._won = true;
                this.scene.events.emit('botWon', { name: this.name });
            }
        }
    }

    // ══════════════════════════
    //  SHOOTING (predictive aim, only when in line of sight)
    // ══════════════════════════
    _tryShoot(time) {
        if (time - this._lastFire < this.fireRate) return;
        if (!this.scene.createBullet) return;
        const bx = this.container.x, by = this.container.y;

        // Priority 1: real player (only if in hunt mode or very close)
        let target = null, targetBody = null;
        const player = this.scene.player;
        if (player?.alive) {
            const d = Phaser.Math.Distance.Between(bx, by, player.container.x, player.container.y);
            if (d < 200) { target = player.container; targetBody = player.container.body; }
        }
        // Priority 2: nearest enemy
        if (!target) {
            let minD = Infinity;
            for (const e of (this.scene.enemies || [])) {
                if (!e.alive) continue;
                const d = Phaser.Math.Distance.Between(bx, by, e.container.x, e.container.y);
                if (d < 180 && d < minD) { minD = d; target = e.container; targetBody = e.container.body; }
            }
        }
        if (!target) return;

        this._lastFire = time;
        const spd = 400;

        // Predictive aim
        let aimX = target.x, aimY = target.y;
        if (targetBody?.velocity) {
            const t = Phaser.Math.Distance.Between(bx, by, aimX, aimY) / spd;
            aimX += targetBody.velocity.x * t * 0.5;
            aimY += targetBody.velocity.y * t * 0.5;
        }

        const ang = Math.atan2(aimY - by, aimX - bx);
        const bullet = this.scene.createBullet(bx, by,
            Math.cos(ang)*spd, Math.sin(ang)*spd, this.damage, false, 0, 'BOT');
        if (bullet) bullet.setData('owner', 'bot_' + this.index);

        // Muzzle flash
        const flash = this.scene.add.circle(
            bx + Math.cos(ang)*16, by + Math.sin(ang)*16, 4, this.tint, 0.9).setDepth(22);
        this.scene.tweens.add({ targets: flash, alpha: 0, duration: 60,
            onComplete: () => flash.destroy() });
    }

    // ══════════════════════════
    //  DAMAGE & DEATH + RESPAWN
    // ══════════════════════════
    takeDamage(amount) {
        if (!this.alive || this._dying) return;
        this.health -= amount;
        if (this.sprite?.active) {
            this.sprite.setTint(0xffffff);
            this.scene.time.delayedCall(80, () => {
                if (this.sprite?.active && this.alive) this.sprite.setTint(this.tint);
            });
        }
        if (this.health <= 0) this._die();
    }

    _die() {
        if (this._dying) return;
        this._dying = true;
        this.alive  = false;
        this.container.body.enable = false;

        this.scene.tweens.killTweensOf(this.container);

        // Explosion particles
        const ex = this.container.x, ey = this.container.y;
        for (let i = 0; i < 8; i++) {
            const ang = (Math.PI * 2 / 8) * i;
            const p = this.scene.add.circle(
                ex + Math.cos(ang)*6, ey + Math.sin(ang)*6, 4, this.tint, 0.9).setDepth(20);
            this.scene.tweens.add({
                targets: p,
                x: ex + Math.cos(ang)*40, y: ey + Math.sin(ang)*40,
                alpha: 0, scaleX: 0.2, scaleY: 0.2,
                duration: 350, ease: 'Power2',
                onComplete: () => p.destroy()
            });
        }

        this.container.setAlpha(0);

        // Respawn as new identity after 8s
        this.scene.time.delayedCall(8000, () => {
            if (!this.scene?.scene?.isActive('GameScene')) return;
            this._respawn();
        });
    }

    _respawn() {
        this._life++;
        this.name = NAMES[this._life % NAMES.length];
        this.tint = TINTS[this._life % TINTS.length];

        this.health = this.maxHealth;
        this.alive  = true;
        this._dying = false;
        this._won   = false;
        this.keysCollected = 0;
        this._stuckFrames  = 0;
        this.path = [];

        const r = this._rndFloor();
        this.container.setPosition(r.x, r.y);
        this.container.body.enable = true;
        this.container.body.setVelocity(0, 0);

        this._buildVisuals();
        this.container.setAlpha(1).setScale(1);
    }

    // ══════════════════════════
    //  HELPERS
    // ══════════════════════════
    _rndFloor() {
        const { grid, width, height } = this.scene.mazeData;
        const ts = this.scene.tileSize;
        const bx = this.container.x, by = this.container.y;
        let best = null, bestScore = -Infinity;
        for (let i = 0; i < 40; i++) {
            const rx = Phaser.Math.Between(1, width-2);
            const ry = Phaser.Math.Between(1, height-2);
            if (grid[ry][rx] !== 0) continue;
            const wx = rx*ts+ts/2, wy = ry*ts+ts/2;
            const d = Phaser.Math.Distance.Between(bx, by, wx, wy);
            if (d + Math.random()*60 > bestScore) { bestScore = d + Math.random()*60; best = { x: wx, y: wy }; }
        }
        return best || { x: 200, y: 200 };
    }

    _safeSpot() {
        const bx = this.container.x, by = this.container.y;
        let fx = 0, fy = 0;
        for (const e of (this.scene.enemies || [])) {
            if (!e.alive) continue;
            const dx = bx - e.container.x, dy = by - e.container.y;
            const d = Math.max(1, Math.sqrt(dx*dx+dy*dy));
            fx += dx/d; fy += dy/d;
        }
        const d = Math.max(0.01, Math.sqrt(fx*fx+fy*fy));
        return { x: bx+(fx/d)*140, y: by+(fy/d)*140 };
    }

    destroy() {
        if (this.container?.scene) this.container.destroy();
    }
}
