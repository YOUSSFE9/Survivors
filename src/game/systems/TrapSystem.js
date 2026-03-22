/**
 * TrapSystem — Three trap types:
 *   1. Spike traps (proximity damage)
 *   2. Wall-to-wall NEON LASER (scans from one wall to the other, instant kill, every 3s)
 *   3. Exploding barrels (AoE on bullet hit)
 */
export class TrapSystem {
    constructor(scene) {
        this.scene = scene;
        this.traps = [];
        this.laserSystems = [];
        this.barrels = [];
        this._laserGraphics = scene.add.graphics().setDepth(25);
    }

    spawnTraps(trapPositions, tileSize, grid, gridW, gridH) {
        const types = ['spike', 'laser', 'barrel'];
        trapPositions.forEach((pos, i) => {
            const type = types[i % types.length];
            const x = pos.x * tileSize + tileSize / 2;
            const y = pos.y * tileSize + tileSize / 2;
            if      (type === 'spike')  this._createSpikeTrap(x, y);
            else if (type === 'laser')  this._createWallLaser(pos.x, pos.y, tileSize, grid, gridW, gridH);
            else if (type === 'barrel') this._createBarrel(x, y);
        });
    }

    // ─── SPIKE TRAP ───
    _createSpikeTrap(x, y) {
        const trap = this.scene.add.image(x, y, 'trap_spike')
            .setDisplaySize(28, 28).setDepth(1).setAlpha(0.65);
        this.scene.physics.world.enable(trap);
        trap.body.setImmovable(true);
        trap.body.setSize(24, 24);
        trap.setData('type', 'spike');
        trap.setData('damage', 12);
        trap.setData('cooldown', 0);
        trap.setData('active', true);
        this.traps.push(trap);
    }

    // ─── WALL-TO-WALL NEON LASER ───
    _createWallLaser(gx, gy, ts, grid, gridW, gridH) {
        // Decide orientation: scan horizontal first, then vertical
        // Find how far we can go left/right from this tile
        let leftX = gx, rightX = gx;
        while (leftX  > 0     && grid[gy] && grid[gy][leftX  - 1] !== 1) leftX--;
        while (rightX < gridW - 1 && grid[gy] && grid[gy][rightX + 1] !== 1) rightX++;
        const horizLen = rightX - leftX;

        let topY = gy, botY = gy;
        while (topY  > 0      && grid[topY  - 1] && grid[topY  - 1][gx] !== 1) topY--;
        while (botY  < gridH - 1 && grid[botY + 1] && grid[botY + 1][gx] !== 1) botY++;
        const vertLen = botY - topY;

        // Use the longer axis
        let x1, y1, x2, y2;
        if (horizLen >= vertLen && horizLen > 1) {
            // Horizontal laser
            x1 = (leftX  - 1) * ts + ts;
            y1 = gy * ts + ts / 2;
            x2 = (rightX + 1) * ts;
            y2 = y1;
        } else if (vertLen > 1) {
            // Vertical laser
            x1 = gx * ts + ts / 2;
            y1 = (topY  - 1) * ts + ts;
            x2 = x1;
            y2 = (botY + 1) * ts;
        } else {
            // Fallback: short horizontal
            x1 = gx * ts; y1 = gy * ts + ts / 2;
            x2 = (gx + 2) * ts; y2 = y1;
        }

        const laserData = {
            x1, y1, x2, y2,
            active: false,
            horizontal: Math.abs(x2 - x1) >= Math.abs(y2 - y1),
        };

        // Cycle: OFF for 2.5s → WARN 0.3s → KILL 0.5s → OFF
        const startDelay = Math.random() * 3000; // stagger lasers
        this.scene.time.delayedCall(startDelay, () => this._startLaserCycle(laserData));
        this.laserSystems.push(laserData);
    }

    _startLaserCycle(laser) {
        if (!this.scene.scene.isActive('GameScene') && !this.scene.scene.isActive()) return;

        // Warning phase (dim orange flutter)
        laser.warning = true;
        laser.active = false;

        this.scene.time.delayedCall(300, () => {
            // Kill phase
            laser.warning = false;
            laser.active = true;
            this.scene.time.delayedCall(500, () => {
                // Off phase
                laser.active = false;
                this.scene.time.delayedCall(2500, () => this._startLaserCycle(laser));
            });
        });
    }

    // ─── EXPLODING BARREL ───
    _createBarrel(x, y) {
        const barrel = this.scene.add.image(x, y, 'trap_barrel')
            .setDisplaySize(24, 28).setDepth(2);
        this.scene.physics.world.enable(barrel);
        barrel.body.setImmovable(true);
        barrel.body.setSize(20, 24);
        barrel.setData('type', 'barrel');
        barrel.setData('health', 30);
        barrel.setData('exploded', false);
        this.barrels.push(barrel);
    }

    // ─── UPDATE (draw lasers — optimized) ───
    update() {
        const gfx = this._laserGraphics;
        gfx.clear();

        for (const laser of this.laserSystems) {
            if (laser.active) {
                this._drawNeonLaser(gfx, laser, 1.0);
            } else if (laser.warning) {
                this._drawNeonLaser(gfx, laser, 0.25, 0xff6600);
            }
        }
    }

    _drawNeonLaser(gfx, laser, alpha, color = 0xff0000) {
        const { x1, y1, x2, y2 } = laser;

        // Glow (single wide stroke)
        gfx.lineStyle(8, color, alpha * 0.20);
        gfx.beginPath(); gfx.moveTo(x1, y1); gfx.lineTo(x2, y2); gfx.strokePath();

        // Core (bright thin line)
        gfx.lineStyle(2, 0xffffff, alpha * 0.90);
        gfx.beginPath(); gfx.moveTo(x1, y1); gfx.lineTo(x2, y2); gfx.strokePath();

        // Emitter dots at ends
        gfx.fillStyle(color, alpha * 0.9);
        gfx.fillCircle(x1, y1, 3);
        gfx.fillCircle(x2, y2, 3);
    }

    // ─── PLAYER COLLISION CHECK ───
    checkPlayerCollision(player) {
        if (!player.alive) return;
        const px = player.container.x, py = player.container.y;

        // Spikes
        for (const trap of this.traps) {
            if (!trap.active) continue;
            const dx = px - trap.x, dy = py - trap.y;
            if (Math.sqrt(dx * dx + dy * dy) < 16) {
                const now = Date.now();
                if (now - (trap.getData('cooldown') || 0) > 1200) {
                    trap.setData('cooldown', now);
                    player.takeDamage(trap.getData('damage') || 12);
                    trap.setAlpha(1);
                    this.scene.time.delayedCall(250, () => { if (trap.scene) trap.setAlpha(0.65); });
                }
            }
        }

        // Lasers — INSTANT KILL when active beam intersects player
        for (const laser of this.laserSystems) {
            if (!laser.active) continue;
            if (this._pointNearSegment(px, py, laser.x1, laser.y1, laser.x2, laser.y2, 10)) {
                player.takeDamage(9999); // instant kill
                this.scene.cameras.main.shake(350, 0.025);
                return;
            }
        }
    }

    // Helper: check if point (px,py) is within `tol` pixels of segment (x1,y1)-(x2,y2)
    _pointNearSegment(px, py, x1, y1, x2, y2, tol) {
        const A = px - x1, B = py - y1;
        const C = x2 - x1, D = y2 - y1;
        const lenSq = C * C + D * D;
        let t = lenSq > 0 ? (A * C + B * D) / lenSq : 0;
        t = Math.max(0, Math.min(1, t));
        const nearX = x1 + t * C, nearY = y1 + t * D;
        const dist = Math.sqrt((px - nearX) ** 2 + (py - nearY) ** 2);
        return dist < tol;
    }

    // ─── BARREL DAMAGE ───
    damageBarrel(barrel, damage) {
        if (barrel.getData('exploded')) return;
        const hp = (barrel.getData('health') || 30) - damage;
        barrel.setData('health', hp);
        barrel.setTint(0xff6666);
        this.scene.time.delayedCall(80, () => { if (barrel.scene) barrel.clearTint(); });
        if (hp <= 0) this.explodeBarrel(barrel);
    }

    explodeBarrel(barrel) {
        barrel.setData('exploded', true);
        const x = barrel.x, y = barrel.y;
        const boom = this.scene.add.image(x, y, 'explosion').setDisplaySize(16, 16).setDepth(50).setAlpha(0.9);
        this.scene.tweens.add({ targets: boom, scaleX: 5, scaleY: 5, alpha: 0, duration: 400, ease: 'Power2', onComplete: () => boom.destroy() });
        this.scene.cameras.main.shake(200, 0.015);
        // AoE
        const r = 80;
        const pl = this.scene.player;
        if (pl && pl.alive) {
            const dx = pl.container.x - x, dy = pl.container.y - y;
            if (Math.sqrt(dx*dx+dy*dy) < r) pl.takeDamage(40);
        }
        for (const e of (this.scene.enemies || [])) {
            if (!e.alive) continue;
            const dx = e.container.x - x, dy = e.container.y - y;
            if (Math.sqrt(dx*dx+dy*dy) < r) e.takeDamage(30);
        }
        barrel.destroy();
        this.barrels = this.barrels.filter(b => b !== barrel);
    }

    getBarrels() { return this.barrels; }
    destroy() { this._laserGraphics.destroy(); }
}
