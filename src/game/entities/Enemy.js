/**
 * Enemy — Smart AI with BFS pathfinding. Recomputes path every 1s to navigate walls.
 * Supports: zombie, monster, ghost.
 */
import Phaser from 'phaser';
import { Pathfinder } from '../systems/Pathfinder';

export const ENEMY_TYPES = {
    zombie: { name: 'Zombie', health: 60, speed: 58, damage: 8, attackRate: 1000, size: 11, canPhase: false, points: 1 },
    monster: { name: 'Monster', health: 40, speed: 100, damage: 15, attackRate: 600, size: 11, canPhase: false, points: 2 },
    ghost: { name: 'Ghost', health: 25, speed: 88, damage: 5, attackRate: 800, size: 11, canPhase: true, points: 1 },
};

export class Enemy {
    constructor(scene, x, y, type = 'zombie') {
        this.scene = scene;
        this.type = type;
        this.config = ENEMY_TYPES[type];
        this.health = this.config.health;
        this.maxHealth = this.config.health;
        this.alive = true;
        this.lastAttackTime = 0;
        this.isFlashing = false;

        // BFS pathfinding
        this.pathfinder = null;
        this.path = [];
        this.pathTimer = 0;
        this.pathUpdateInterval = 1500 + Math.random() * 1000; // stagger between enemies (perf)

        // Container
        this.container = scene.add.container(x, y);
        this.container.setDepth(8);

        // Sprite
        this.sprite = scene.add.image(0, 0, this.type);
        this.sprite.setDisplaySize(38, 38);
        this.container.add(this.sprite);

        // Health bar
        this.healthBarBg = scene.add.rectangle(0, -22, 28, 4, 0x000000, 0.8);
        this.healthBar = scene.add.rectangle(0, -22, 28, 4, 0xff3333);
        this.healthBarBg.setOrigin(0.5, 0.5);
        this.healthBar.setOrigin(0.5, 0.5);
        this.container.add([this.healthBarBg, this.healthBar]);

        // Physics
        scene.physics.world.enable(this.container);
        const sz = this.config.size;
        this.container.body.setSize(sz * 2, sz * 2);
        this.container.body.setOffset(-sz, -sz);
        this.container.body.setCollideWorldBounds(true);

        // Ghost flicker
        if (type === 'ghost') {
            this.container.setAlpha(0.7);
            scene.tweens.add({
                targets: this.container, alpha: 0.25,
                duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
            });
        }
    }

    /**
     * Call this once after the scene has a pathfinder ready.
     */
    setPathfinder(pathfinder) {
        this.pathfinder = pathfinder;
    }

    update(time, delta) {
        if (!this.alive) return;

        // Pick nearest target: real player or alive bot
        let target = null, targetDist = Infinity;
        const ex = this.container.x, ey = this.container.y;

        const player = this.scene.player;
        if (player?.alive) {
            const d = Phaser.Math.Distance.Between(ex, ey, player.container.x, player.container.y);
            if (d < targetDist) { targetDist = d; target = player; }
        }

        for (const bot of (this.scene.bots || [])) {
            if (!bot.alive) continue;
            const d = Phaser.Math.Distance.Between(ex, ey, bot.container.x, bot.container.y);
            if (d < targetDist) { targetDist = d; target = bot; }
        }

        if (!target) return;

        const px = target.container.x, py = target.container.y;
        const dx = px - ex, dy = py - ey;
        const dist = targetDist;

        // Attack range
        if (dist < 22) {
            this.container.body.setVelocity(0, 0);
            this.sprite.y = 0;
            if (Date.now() - this.lastAttackTime >= this.config.attackRate) {
                this.lastAttackTime = Date.now();
                target.takeDamage(this.config.damage);
            }
            this.healthBar.scaleX = Math.max(0, this.health / this.maxHealth);
            return;
        }

        // Ghost: phase through walls — direct movement
        if (this.config.canPhase) {
            const len = Math.sqrt(dx * dx + dy * dy);
            this.container.body.setVelocity((dx / len) * this.config.speed, (dy / len) * this.config.speed);
            this.sprite.flipX = dx < 0;
            this.sprite.y = Math.sin(time * 0.012) * 2;
            this.healthBar.scaleX = Math.max(0, this.health / this.maxHealth);
            return;
        }

        // BFS pathfinding
        this.pathTimer += delta;
        if (this.pathTimer >= this.pathUpdateInterval || this.path.length === 0) {
            this.pathTimer = 0;
            if (this.pathfinder) {
                this.path = this.pathfinder.findPath(ex, ey, px, py);
            }
        }

        // Follow next waypoint in path
        if (this.path.length > 0) {
            const wp = this.path[0];
            const wpDx = wp.x - ex, wpDy = wp.y - ey;
            const wpDist = Math.sqrt(wpDx * wpDx + wpDy * wpDy);

            if (wpDist < 6) {
                // Reached waypoint, move to next
                this.path.shift();
            } else {
                const spd = this.config.speed;
                this.container.body.setVelocity((wpDx / wpDist) * spd, (wpDy / wpDist) * spd);
                this.sprite.flipX = wpDx < 0;
                this.sprite.y = Math.sin(time * 0.012) * 2;
            }
        } else {
            // Fallback: direct movement if BFS fails
            const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            this.container.body.setVelocity((dx / len) * this.config.speed, (dy / len) * this.config.speed);
            this.sprite.flipX = dx < 0;
        }

        this.healthBar.scaleX = Math.max(0, this.health / this.maxHealth);
    }

    takeDamage(amount) {
        if (!this.alive) return;
        this.health -= amount;

        if (!this.isFlashing && this.sprite) {
            this.isFlashing = true;
            this.sprite.setTint(0xff0000);
            this.scene.time.delayedCall(120, () => {
                if (this.sprite && this.sprite.scene) this.sprite.clearTint();
                this.isFlashing = false;
            });
        }

        // Floating damage number
        const dmgText = this.scene.add.text(
            this.container.x, this.container.y - 24,
            `-${amount}`,
            { fontFamily: 'Outfit, sans-serif', fontSize: '14px', color: '#ff4444', fontStyle: 'bold', stroke: '#000', strokeThickness: 2 }
        ).setOrigin(0.5).setDepth(200);
        this.scene.tweens.add({
            targets: dmgText, y: dmgText.y - 32, alpha: 0, duration: 600,
            onComplete: () => dmgText.destroy(),
        });

        if (this.health <= 0) this.die();
    }

    die() {
        this.alive = false;
        this.path = [];
        if (this.container.body) {
            this.container.body.setVelocity(0, 0);
            this.container.body.setEnable(false);
        }

        // Death particles
        for (let i = 0; i < 7; i++) {
            const p = this.scene.add.circle(
                this.container.x + (Math.random() - 0.5) * 24,
                this.container.y + (Math.random() - 0.5) * 24,
                3 + Math.random() * 3, 0xff3333, 0.9
            ).setDepth(15);
            this.scene.tweens.add({
                targets: p,
                x: p.x + (Math.random() - 0.5) * 50,
                y: p.y + (Math.random() - 0.5) * 50,
                alpha: 0, scaleX: 0.1, scaleY: 0.1,
                duration: 400 + Math.random() * 200,
                onComplete: () => p.destroy(),
            });
        }

        this.scene.tweens.add({
            targets: this.container,
            alpha: 0, scaleX: 0.1, scaleY: 0.1,
            duration: 280, ease: 'Power2',
            onComplete: () => this.scene.events.emit('enemyDied', this),
        });
    }

    destroy() {
        if (this.container && this.container.scene) this.container.destroy();
    }
}
