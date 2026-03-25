import Phaser from 'phaser';

/**
 * TrapSystem
 * - Spike traps (proximity damage)
 * - Wall lasers (warning + kill cycle)
 * - Exploding barrels
 */
export class TrapSystem {
    constructor(scene) {
        this.scene = scene;
        this.traps = [];
        this.laserSystems = [];
        this.barrels = [];
    }

    spawnTraps(trapPositions, tileSize, grid, gridW, gridH) {
        if (!Array.isArray(trapPositions) || trapPositions.length === 0) return;

        const positions = [...trapPositions];
        Phaser.Utils.Array.Shuffle(positions);

        // More lasers than before, but still balanced with spikes/barrels.
        const targetLasers = Math.max(6, Math.floor(positions.length * 0.4));
        let laserCount = 0;

        for (const pos of positions) {
            const x = pos.x * tileSize + tileSize / 2;
            const y = pos.y * tileSize + tileSize / 2;

            const roll = Math.random();
            let type = 'spike';
            if (laserCount < targetLasers && roll < 0.55) type = 'laser';
            else if (roll > 0.82) type = 'barrel';

            if (type === 'laser') {
                const made = this._createWallLaser(pos.x, pos.y, tileSize, grid, gridW, gridH);
                if (made) {
                    laserCount++;
                    continue;
                }
                // Fallback if we cannot create a readable line at this area.
                if (Math.random() > 0.5) this._createBarrel(x, y);
                else this._createSpikeTrap(x, y);
                continue;
            }

            if (type === 'barrel') this._createBarrel(x, y);
            else this._createSpikeTrap(x, y);
        }
    }

    _createSpikeTrap(x, y) {
        const trap = this.scene.add.image(x, y, 'trap_spike').setDisplaySize(28, 28).setDepth(1).setAlpha(0.65);
        this.scene.physics.world.enable(trap);
        trap.body.setImmovable(true);
        trap.body.setSize(24, 24);
        trap.setData('type', 'spike').setData('damage', 12).setData('cooldown', 0).setData('active', true);
        this.traps.push(trap);
    }

    _computeLaserSegment(gx, gy, ts, grid, gridW, gridH) {
        if (gx < 0 || gy < 0 || gx >= gridW || gy >= gridH) return null;
        if (!grid[gy] || grid[gy][gx] === 1) return null;

        let lx = gx;
        let rx = gx;
        while (lx > 0 && grid[gy] && grid[gy][lx - 1] !== 1) lx--;
        while (rx < gridW - 1 && grid[gy] && grid[gy][rx + 1] !== 1) rx++;
        const hLen = rx - lx;

        let ty = gy;
        let by = gy;
        while (ty > 0 && grid[ty - 1] && grid[ty - 1][gx] !== 1) ty--;
        while (by < gridH - 1 && grid[by + 1] && grid[by + 1][gx] !== 1) by++;
        const vLen = by - ty;

        let x1;
        let y1;
        let x2;
        let y2;
        if (hLen >= vLen && hLen > 1) {
            x1 = lx * ts;
            y1 = gy * ts + ts / 2;
            x2 = (rx + 1) * ts;
            y2 = y1;
        } else if (vLen > 1) {
            x1 = gx * ts + ts / 2;
            y1 = ty * ts;
            x2 = x1;
            y2 = (by + 1) * ts;
        } else {
            x1 = gx * ts;
            y1 = gy * ts + ts / 2;
            x2 = (gx + 1) * ts;
            y2 = y1;
        }

        const dist = Phaser.Math.Distance.Between(x1, y1, x2, y2);
        const angle = Phaser.Math.Angle.Between(x1, y1, x2, y2);
        return {
            x1,
            y1,
            x2,
            y2,
            dist,
            angle,
            cx: (x1 + x2) / 2,
            cy: (y1 + y2) / 2,
        };
    }

    _createWallLaser(gx, gy, ts, grid, gridW, gridH) {
        const candidates = [{ x: gx, y: gy }];
        for (let r = 1; r <= 5; r++) {
            for (let oy = -r; oy <= r; oy++) {
                for (let ox = -r; ox <= r; ox++) {
                    if (Math.abs(ox) + Math.abs(oy) > r) continue;
                    candidates.push({ x: gx + ox, y: gy + oy });
                }
            }
        }
        Phaser.Utils.Array.Shuffle(candidates);

        const viable = [];
        for (const c of candidates) {
            const seg = this._computeLaserSegment(c.x, c.y, ts, grid, gridW, gridH);
            if (!seg) continue;
            if (seg.dist < ts * 2) continue;

            // Keep lasers spatially spread so they appear in clearly different areas.
            const tooClose = this.laserSystems.some((lz) => {
                const dx = lz.cx - seg.cx;
                const dy = lz.cy - seg.cy;
                return (dx * dx + dy * dy) < (ts * 4.5) * (ts * 4.5);
            });
            if (tooClose) continue;

            const score = seg.dist + Phaser.Math.Between(0, ts * 2);
            viable.push({ ...seg, score });
        }

        if (viable.length === 0) return false;

        viable.sort((a, b) => b.score - a.score);
        const pickPool = viable.slice(0, Math.min(3, viable.length));
        const best = Phaser.Utils.Array.GetRandom(pickPool);

        const { x1, y1, x2, y2, dist, angle, cx, cy } = best;

        // ── NANO-LASER visual layers (all hidden until first loop starts) ──
        // Layer 1: wide dim outer glow  (~20px wide on normal screens)
        const glowOuter = this.scene.add.rectangle(cx, cy, dist, 14, 0x00ff44, 1)
            .setDepth(48).setRotation(angle).setAlpha(0);
        // Layer 2: mid glow
        const glowInner = this.scene.add.rectangle(cx, cy, dist, 6, 0x44ffaa, 1)
            .setDepth(49).setRotation(angle).setAlpha(0);
        // Layer 3: bright core — 2px, pure white
        const core = this.scene.add.rectangle(cx, cy, dist, 3, 0xffffff, 1)
            .setDepth(50).setRotation(angle).setAlpha(0);

        // Terminal nodes (laser emitter dots at each end)
        const emitterA = {
            outer: this.scene.add.circle(x1, y1, 5, 0x00ff88, 1).setDepth(51).setAlpha(0),
            inner: this.scene.add.circle(x1, y1, 2, 0xffffff, 1).setDepth(52).setAlpha(0),
        };
        const emitterB = {
            outer: this.scene.add.circle(x2, y2, 5, 0x00ff88, 1).setDepth(51).setAlpha(0),
            inner: this.scene.add.circle(x2, y2, 2, 0xffffff, 1).setDepth(52).setAlpha(0),
        };

        const laser = {
            x1,
            y1,
            x2,
            y2,
            cx,
            cy,
            active: false,
            warning: false,
            glowOuter,
            glowInner,
            core,
            emitterA,
            emitterB,
            seed: Math.random() * 1000,
            warningMs: Phaser.Math.Between(650, 1000),
            activeMs: Phaser.Math.Between(1200, 1900),
            cooldownMs: Phaser.Math.Between(1300, 2300),
        };

        this.scene.time.delayedCall(Phaser.Math.Between(0, 1200), () => this._startLaserLoop(laser));
        this.laserSystems.push(laser);
        return true;
    }

    _startLaserLoop(laser) {
        if (!this.scene || !this.scene.sys) return;

        // 1) Warning: beam is weak/flickering, emitters are visible.
        laser.warning = true;
        laser.active = false;

        this.scene.time.delayedCall(laser.warningMs, () => {
            if (!this.scene || !this.scene.sys) return;

            // 2) Active: full damage and bright beam.
            laser.warning = false;
            laser.active = true;

            this.scene.time.delayedCall(laser.activeMs, () => {
                if (!this.scene || !this.scene.sys) return;

                // 3) Cooldown: fully hidden.
                laser.active = false;
                this.scene.time.delayedCall(laser.cooldownMs, () => this._startLaserLoop(laser));
            });
        });
    }

    _createBarrel(x, y) {
        const barrel = this.scene.add.image(x, y, 'trap_barrel').setDisplaySize(24, 28).setDepth(2);
        this.scene.physics.world.enable(barrel);
        barrel.body.setImmovable(true);
        barrel.body.setSize(20, 24);
        barrel.setData('type', 'barrel').setData('health', 30).setData('exploded', false);
        this.barrels.push(barrel);
    }

    update() {
        if (!this.scene || !this.scene.player || !this.scene.player.alive) return;

        const t = Date.now();
        for (const laser of this.laserSystems) {
            if (laser.active) {
                // High-freq shimmer: the core brightness oscillates fast to mimic photon energy
                const shimmer = 0.86 + Math.sin(t * 0.035 + laser.seed) * 0.14;
                laser.glowOuter.setAlpha(shimmer * 0.55);
                laser.glowInner.setAlpha(shimmer * 0.92);
                laser.core.setAlpha(1); // always full white

                // User requested endpoint dots to disappear outside pre-fire warning.
                laser.emitterA.outer.setAlpha(0).setScale(1);
                laser.emitterA.inner.setAlpha(0);
                laser.emitterB.outer.setAlpha(0).setScale(1);
                laser.emitterB.inner.setAlpha(0);
                continue;
            }

            if (laser.warning) {
                // Pre-fire warning: endpoint dots blink strongly, beam remains faint.
                const flicker = 0.45 + Math.sin(t * 0.03 + laser.seed) * 0.35;
                const blink = (Math.floor((t + laser.seed * 10) / 110) % 2) === 0 ? 1 : 0.15;
                const alpha = Phaser.Math.Clamp(flicker * blink, 0.08, 0.9);
                laser.glowOuter.setFillStyle(0xff4400, 1).setAlpha(0.12 * alpha);
                laser.glowInner.setFillStyle(0xff8800, 1).setAlpha(0.22 * alpha);
                laser.core.setFillStyle(0xffbb66, 1).setAlpha(0.30 * alpha);

                laser.emitterA.outer.setAlpha(0.95 * alpha).setScale(1.05).setFillStyle(0xff6600, 1);
                laser.emitterA.inner.setAlpha(1.0 * alpha);
                laser.emitterB.outer.setAlpha(0.95 * alpha).setScale(1.05).setFillStyle(0xff6600, 1);
                laser.emitterB.inner.setAlpha(1.0 * alpha);
                continue;
            }

            // Idle / cooldown: reset fill colours and hide everything
            laser.glowOuter.setFillStyle(0x00ff44, 1).setAlpha(0);
            laser.glowInner.setFillStyle(0x44ffaa, 1).setAlpha(0);
            laser.core.setFillStyle(0xffffff, 1).setAlpha(0);
            laser.emitterA.outer.setAlpha(0).setScale(1).setFillStyle(0x00ff88, 1);
            laser.emitterA.inner.setAlpha(0);
            laser.emitterB.outer.setAlpha(0).setScale(1).setFillStyle(0x00ff88, 1);
            laser.emitterB.inner.setAlpha(0);
        }
    }

    checkPlayerCollision(player) {
        if (!player || !player.alive || !player.container || !player.container.body) return;

        const px = player.container.x;
        const py = player.container.y;

        // Spikes
        for (const trap of this.traps) {
            if (!trap.getData('active')) continue;
            const dx = px - trap.x;
            const dy = py - trap.y;
            if (Math.abs(dx) < 16 && Math.abs(dy) < 16) {
                const now = Date.now();
                if (now - (trap.getData('cooldown') || 0) > 1200) {
                    trap.setData('cooldown', now);
                    player.takeDamage(trap.getData('damage') || 12);
                    trap.setAlpha(1);
                    this.scene.time.delayedCall(250, () => {
                        if (trap.scene) trap.setAlpha(0.65);
                    });
                }
            }
        }

        // Active lasers only
        for (const laser of this.laserSystems) {
            if (!laser.active) continue;

            const line = new Phaser.Geom.Line(laser.x1, laser.y1, laser.x2, laser.y2);
            const bounds = player.container.body;
            const rect = new Phaser.Geom.Rectangle(
                player.container.x + bounds.offset.x,
                player.container.y + bounds.offset.y,
                bounds.width,
                bounds.height
            );

            if (Phaser.Geom.Intersects.LineToRectangle(line, rect)) {
                player.takeDamage(999);
            }
        }
    }

    damageBarrel(barrel, damage) {
        if (barrel.getData('exploded')) return;
        const hp = (barrel.getData('health') || 30) - damage;
        barrel.setData('health', hp);
        barrel.setTint(0xff6666);
        this.scene.time.delayedCall(80, () => {
            if (barrel.scene) barrel.clearTint();
        });
        if (hp <= 0) this.explodeBarrel(barrel);
    }

    explodeBarrel(barrel) {
        barrel.setData('exploded', true);
        barrel.setVisible(false);
        const boom = this.scene.add.image(barrel.x, barrel.y, 'explosion').setDisplaySize(16, 16).setDepth(50).setAlpha(0.9);
        this.scene.tweens.add({
            targets: boom,
            scaleX: 5,
            scaleY: 5,
            alpha: 0,
            duration: 400,
            ease: 'Power2',
            onComplete: () => boom.destroy(),
        });
        this.scene.cameras.main.shake(200, 0.015);

        const r = 80;
        if (this.scene.player && this.scene.player.alive) {
            const dx = this.scene.player.container.x - barrel.x;
            const dy = this.scene.player.container.y - barrel.y;
            if (Math.sqrt(dx * dx + dy * dy) < r) this.scene.player.takeDamage(40);
        }
        for (const e of (this.scene.enemies || [])) {
            if (!e.alive) continue;
            const dx = e.container.x - barrel.x;
            const dy = e.container.y - barrel.y;
            if (Math.sqrt(dx * dx + dy * dy) < r) e.takeDamage(30);
        }
        barrel.destroy();
        this.barrels = this.barrels.filter((b) => b !== barrel);
    }

    getBarrels() {
        return this.barrels;
    }
}
