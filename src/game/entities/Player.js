/**
 * Player — Starts with NO weapon/ammo.
 * Inventory-driven: pickups add weapons/ammo. Sidebar managed by HUDScene.
 */
import Phaser from 'phaser';
import { WEAPONS, WeaponSystem } from '../systems/WeaponSystem';

export class Player {
    constructor(scene, x, y, isLocal = true) {
        this.scene = scene;
        this.isLocal = isLocal;
        this.maxHealth = 100;
        this.health = this.maxHealth;
        this.speed = 180;
        this.inputDx  = 0; // exposed for server input relay
        this.inputDy  = 0;
        this.alive = true;
        this.keysCollected = 0;
        this.kills = 0;
        this.breachMode = false;
        this.shootLockUntil = 0; // prevent auto-fire after weapon switch

        // INVENTORY: starts completely empty
        this.inventory = {
            M4:      { ammo: 0, owned: false },
            BAZOOKA: { ammo: 0, owned: false },
            GRENADE: 0,
            HEALTH:  0,   // health packs stored, not auto-used
        };
        this.currentWeapon = null; // no weapon at start

        // Weapon sprite configs
        this.weaponConfigs = {
            M4:      { texture: 'weapon_m4',      offsetX: 14, offsetY: 2, muzzleLen: 30, scale: 0.65 },
            BAZOOKA: { texture: 'weapon_bazooka',  offsetX: 14, offsetY: 2, muzzleLen: 36, scale: 0.60 },
        };

        // Container
        this.container = scene.add.container(x, y);
        this.container.setDepth(10);
        this._drawSprite();

        // Physics
        scene.physics.world.enable(this.container);
        this.container.body.setCircle(17, -17, -17); // Circle hitbox for sliding and 1px gap
        this.container.body.setCollideWorldBounds(true);
        this.container.body.setDrag(900);
        this.container.body.setMaxVelocity(this.speed);

        // Health bar
        this.healthBarBg = scene.add.rectangle(0, -22, 28, 5, 0x333333, 0.85);
        this.healthBar   = scene.add.rectangle(0, -22, 28, 5, 0x00ff66);
        this.healthBarBg.setOrigin(0.5, 0.5);
        this.healthBar.setOrigin(0.5, 0.5);
        this.container.add([this.healthBarBg, this.healthBar]);

        this.weaponSystem = new WeaponSystem(scene);

        // Input
        if (isLocal) {
            this.cursors = {
                W: scene.input.keyboard.addKey('W'),
                A: scene.input.keyboard.addKey('A'),
                S: scene.input.keyboard.addKey('S'),
                D: scene.input.keyboard.addKey('D'),
                UP:    scene.input.keyboard.addKey('UP'),
                DOWN:  scene.input.keyboard.addKey('DOWN'),
                LEFT:  scene.input.keyboard.addKey('LEFT'),
                RIGHT: scene.input.keyboard.addKey('RIGHT'),
                SPACE: scene.input.keyboard.addKey('SPACE'),
                G: scene.input.keyboard.addKey('G'),
                B: scene.input.keyboard.addKey('B'),
            };
        }
    }

    _drawSprite() {
        if (this.playerSprite) this.playerSprite.destroy();
        if (this.weaponSprite) { this.weaponSprite.destroy(); this.weaponSprite = null; }

        this.playerSprite = this.scene.add.image(0, 0, 'player');
        this.playerSprite.setDisplaySize(32, 32);
        this.container.add(this.playerSprite);

        // Only draw weapon if one is equipped
        if (this.currentWeapon && this.weaponConfigs[this.currentWeapon]) {
            const wc = this.weaponConfigs[this.currentWeapon];
            this.weaponSprite = this.scene.add.image(wc.offsetX, wc.offsetY, wc.texture);
            this.weaponSprite.setScale(wc.scale);
            this.weaponSprite.setOrigin(0.1, 0.5);
            this.container.add(this.weaponSprite);
        }
    }

    update(time, delta) {
        if (!this.alive || !this.isLocal) return;

        const body = this.container.body;
        const hud = this.scene.scene.get('HUDScene');
        let joyVector = { x: 0, y: 0 };
        let fireAim = { x: 0, y: 0, active: false };
        let grenadeAim = { dx: 0, dy: 0, power: 0, active: false };
        
        if (hud) {
            joyVector = hud.getJoystickVector() || { x: 0, y: 0 };
            fireAim = hud.getFireAim ? hud.getFireAim() : { x: 0, y: 0, active: false };
            grenadeAim = hud.getGrenadeAim ? hud.getGrenadeAim() : { active: false };
        }

        const isDesktop = !this.scene.sys.game.device.input.touch;

        // 1. INPUT MOVEMENT
        let vx = joyVector.x, vy = joyVector.y;
        if (this.cursors.A.isDown || this.cursors.LEFT.isDown)  vx = -1;
        if (this.cursors.D.isDown || this.cursors.RIGHT.isDown) vx = 1;
        if (this.cursors.W.isDown || this.cursors.UP.isDown)    vy = -1;
        if (this.cursors.S.isDown || this.cursors.DOWN.isDown)  vy = 1;

        // 2. AIMING (Decoupled from movement!)
        if (this.lastAimAngle === undefined) this.lastAimAngle = this.container.rotation;

        if (isDesktop) {
            const ptr = this.scene.input.activePointer;
            this.lastAimAngle = Math.atan2(ptr.worldY - this.container.y, ptr.worldX - this.container.x);
        } else if (fireAim.active && (fireAim.x !== 0 || fireAim.y !== 0)) {
            this.lastAimAngle = Math.atan2(fireAim.y, fireAim.x);
        } else if (grenadeAim.active && (grenadeAim.dx !== 0 || grenadeAim.dy !== 0)) {
            this.lastAimAngle = Math.atan2(grenadeAim.dy, grenadeAim.dx);
        } else if (vx !== 0 || vy !== 0) {
            // Only fall back to movement direction if we are NOT in the middle of aiming
            if (!this.bazookaAimActive && !this.grenadeAimActive && !fireAim.active && !grenadeAim.active) {
                this.lastAimAngle = Math.atan2(vy, vx);
            }
        }
        this.container.rotation = this.lastAimAngle;
        const aimAngle = this.lastAimAngle;

        // 3. APPLY MOVEMENT
        if (vx !== 0 || vy !== 0) {
            const len = Math.sqrt(vx * vx + vy * vy);
            this.inputDx = vx / len;
            this.inputDy = vy / len;
            body.setVelocity(this.inputDx * this.speed, this.inputDy * this.speed);
            this.playerSprite.y = Math.sin(time * 0.012) * 1.5;
        } else {
            this.inputDx = 0;
            this.inputDy = 0;
            body.setVelocity(0, 0);
            this.playerSprite.y = 0;
        }

        // Send input to server
        if (this.scene.onlineSync) {
            this.scene.onlineSync.sendInput(this.inputDx, this.inputDy, this.container.rotation);
        }

        // 4. WEAPON FIRING
        const isSpaceDown = this.cursors.SPACE.isDown;
        const isMouseFiring = isDesktop && this.scene.input.activePointer.isDown;
        const isFireActive = isMouseFiring || isSpaceDown || fireAim.active;

        if (this.currentWeapon === 'BAZOOKA') {
            if (isFireActive && !this.bazookaAimActive) {
                this.bazookaAimActive = true;
                this.startBazookaAim();
            } else if (!isFireActive && this.bazookaAimActive) {
                this.bazookaAimActive = false;
                this.shoot(); 
                if (this.bazookaLine) this.bazookaLine.clear();
            }

            if (this.bazookaAimActive) {
                this.updateBazookaAim(aimAngle);
            }
        } else if (this.currentWeapon && isFireActive) {
            this.shoot();
        }

        // 5. GRENADE TRAJECTORY & THROW
        const gKeyActive = isDesktop && this.cursors.G.isDown;
        if (this.inventory.GRENADE > 0) {
            const isAimingGrenade = grenadeAim.active || gKeyActive;
            
            if (isAimingGrenade && !this.grenadeAimActive) {
                this.grenadeAimActive = true;
                this.startGrenadeAim();
            } else if (!isAimingGrenade && this.grenadeAimActive) {
                this.grenadeAimActive = false;
                let power = grenadeAim.power || 0;
                if (isDesktop) {
                    const ptr = this.scene.input.activePointer;
                    const dist = Phaser.Math.Distance.Between(this.container.x, this.container.y, ptr.worldX, ptr.worldY);
                    power = Math.min(dist / 300, 1.0);
                }
                this.throwGrenade(aimAngle, Math.max(0.1, power));
            }
            
            if (this.grenadeAimActive) {
                let power = grenadeAim.power || 0;
                if (isDesktop) {
                    const ptr = this.scene.input.activePointer;
                    const dist = Phaser.Math.Distance.Between(this.container.x, this.container.y, ptr.worldX, ptr.worldY);
                    power = Math.min(dist / 300, 1.0);
                }
                this.updateGrenadeAim(aimAngle, Math.max(0.1, power));
            }
        } else if (this.grenadeAimActive) {
            // Out of grenades while aiming
            this.grenadeAimActive = false;
            if (this.grenadeArc) { this.grenadeArc.clear(); }
        }

        // Breach toggle
        if (Phaser.Input.Keyboard.JustDown(this.cursors.B) && this.keysCollected > 0) {
            this.breachMode = !this.breachMode;
            this.scene.events.emit('breachModeChanged', this.breachMode);
        }

        // Health bar color
        const ratio = this.health / this.maxHealth;
        this.healthBar.scaleX = Math.max(0, ratio);
        if (ratio > 0.6) this.healthBar.fillColor = 0x00ff66;
        else if (ratio > 0.3) this.healthBar.fillColor = 0xffaa00;
        else this.healthBar.fillColor = 0xff3333;
    }

    /**
     * Equip a weapon (called from HUD sidebar button or auto-equip on first pickup).
     * Blocks firing for 300ms to prevent accidental shoot on tap.
     */
    equipWeapon(key) {
        if (!this.inventory[key] || !this.inventory[key].owned) return;
        this.currentWeapon = key;
        this.shootLockUntil = Date.now() + 300;
        this._drawSprite();
        
        // Reset Bazooka aiming
        if (this.bazookaAimActive) {
            this.bazookaAimActive = false;
            if (this.bazookaLine) this.bazookaLine.clear();
        }
        
        this.scene.events.emit('inventoryChanged', this._getInventoryState());
    }

    shoot() {
        if (!this.alive || !this.currentWeapon) return;
        if (Date.now() < this.shootLockUntil) return; // locked after switch
        const inv = this.inventory[this.currentWeapon];
        if (!inv || inv.ammo <= 0) return;
        if (!this.weaponSystem.canFire(this.currentWeapon)) return;

        const angle = this.container.rotation;
        const wc = this.weaponConfigs[this.currentWeapon];
        if (!wc) return;

        const muzzleX = this.container.x + Math.cos(angle) * wc.muzzleLen;
        const muzzleY = this.container.y + Math.sin(angle) * wc.muzzleLen;

        const bullet = this.weaponSystem.fire(this.currentWeapon, muzzleX, muzzleY, angle);
        if (bullet) {
            bullet.setData('owner', 'player');
            inv.ammo--;

            // Auto-unequip at 0
            if (inv.ammo <= 0) {
                // Try to switch to another owned weapon
                const fallback = Object.keys(this.inventory).find(
                    k => k !== 'GRENADE' && k !== this.currentWeapon && this.inventory[k].owned && this.inventory[k].ammo > 0
                );
                this.currentWeapon = fallback || null;
                this._drawSprite();
            }

            this.scene.events.emit('inventoryChanged', this._getInventoryState());

            // Recoil
            if (this.weaponSprite) {
                this.scene.tweens.add({
                    targets: this.weaponSprite, x: wc.offsetX - 3,
                    duration: 40, yoyo: true, ease: 'Power2',
                });
            }

            // Muzzle flash
            const flash = this.scene.add.circle(muzzleX, muzzleY, 6, 0xffcc00, 0.85).setDepth(20);
            this.scene.tweens.add({
                targets: flash, alpha: 0, scaleX: 2.5, scaleY: 2.5,
                duration: 80, onComplete: () => flash.destroy(),
            });

            // Send shoot to server
            if (this.scene.onlineSync) {
                const bvx = Math.cos(angle) * (wc.muzzleLen > 30 ? 650 : 800);
                const bvy = Math.sin(angle) * (wc.muzzleLen > 30 ? 650 : 800);
                const dmg = wc.muzzleLen > 30 ? 60 : 35; // Bazooka vs M4 damage
                const isExplosive = wc.muzzleLen > 30;
                this.scene.onlineSync.sendShoot(bvx, bvy, dmg, isExplosive);
            }
        }
    }

    startGrenadeAim() {
        if (!this.grenadeArc) {
            this.grenadeArc = this.scene.add.graphics().setDepth(15);
        }
    }

    updateGrenadeAim(angle, power) {
        if (!this.grenadeArc) return;
        this.grenadeArc.clear();
        
        const maxDist = 300; // max throw distance
        const throwDist = maxDist * power;
        const fromX = this.container.x, fromY = this.container.y;
        const toX = fromX + Math.cos(angle) * throwDist;
        const toY = fromY + Math.sin(angle) * throwDist;

        // Draw an elegant parabolic dashed arc or solid line
        this.grenadeArc.lineStyle(2, 0xffbb00, 0.7);
        this.grenadeArc.beginPath();
        const steps = 15;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = fromX + (toX - fromX) * t;
            // Add a curve upward matching the throw angle visual
            const y = fromY + (toY - fromY) * t - Math.sin(t * Math.PI) * (throwDist * 0.25);
            i === 0 ? this.grenadeArc.moveTo(x, y) : this.grenadeArc.lineTo(x, y);
        }
        this.grenadeArc.strokePath();

        // Draw the landing target circle
        this.grenadeArc.fillStyle(0xff3300, 0.4);
        this.grenadeArc.fillCircle(toX, toY, 18);
        this.grenadeArc.lineStyle(1, 0xff3300, 0.8);
        this.grenadeArc.strokeCircle(toX, toY, 18);
    }

    startBazookaAim() {
        if (!this.bazookaLine) {
            this.bazookaLine = this.scene.add.graphics().setDepth(15);
        }
    }

    updateBazookaAim(angle) {
        if (!this.bazookaLine) return;
        this.bazookaLine.clear();
        
        const wc = this.weaponConfigs['BAZOOKA'];
        if (!wc) return;
        
        const startX = this.container.x + Math.cos(angle) * wc.muzzleLen;
        const startY = this.container.y + Math.sin(angle) * wc.muzzleLen;
        
        const maxDist = 800; // Screen length laser
        
        this.bazookaLine.lineStyle(2, 0xff3300, 0.6);
        this.bazookaLine.beginPath();
        
        // Dashed line
        const dashLen = 15;
        const gapLen = 15;
        let currDist = 0;
        let isDraw = true;
        
        let cx = startX, cy = startY;
        while (currDist < maxDist) {
            let step = Math.min(isDraw ? dashLen : gapLen, maxDist - currDist);
            let nx = cx + Math.cos(angle) * step;
            let ny = cy + Math.sin(angle) * step;
            
            if (isDraw) {
                this.bazookaLine.moveTo(cx, cy);
                this.bazookaLine.lineTo(nx, ny);
            }
            cx = nx; cy = ny;
            currDist += step;
            isDraw = !isDraw;
        }
        this.bazookaLine.strokePath();
    }

    throwGrenade(angle, power) {
        if (this.inventory.GRENADE <= 0) return;
        
        if (this.grenadeArc) {
            this.grenadeArc.clear();
        }
        
        this.inventory.GRENADE--;
        const throwDist = 300 * power;
        const toX = this.container.x + Math.cos(angle) * throwDist;
        const toY = this.container.y + Math.sin(angle) * throwDist;
        
        this.scene.events.emit('grenadeThrown', {
            fromX: this.container.x, fromY: this.container.y, toX, toY, power
        });
        this.scene.events.emit('inventoryChanged', this._getInventoryState());
    }

    /**
     * Called when a pickup is collected. Adds to inventory.
     * @param {string} type  e.g. 'AMMO_M4', 'WEAPON_M4', 'GRENADE', 'HEALTH'
     * @param {number} value
     */
    receivePickup(type, value) {
        if (type === 'HEALTH') {
            // Add to inventory — NOT auto-use
            this.inventory.HEALTH = (this.inventory.HEALTH || 0) + 1;
        } else if (type === 'KEY') {
            this.keysCollected = (this.keysCollected || 0) + 1;
            this.scene.events.emit('keysChanged', this.keysCollected);
        } else if (type === 'GRENADE') {
            this.inventory.GRENADE = (this.inventory.GRENADE || 0) + value;
        } else if (type === 'AMMO_M4') {
            this.inventory.M4.ammo = Math.min(WEAPONS.M4.maxAmmo, (this.inventory.M4.ammo || 0) + value);
            this.inventory.M4.owned = true;
            if (!this.currentWeapon) { this.currentWeapon = 'M4'; this._drawSprite(); }
        } else if (type === 'AMMO_BAZOOKA') {
            this.inventory.BAZOOKA.ammo = Math.min(WEAPONS.BAZOOKA.maxAmmo, (this.inventory.BAZOOKA.ammo || 0) + value);
            this.inventory.BAZOOKA.owned = true;
            if (!this.currentWeapon) { this.currentWeapon = 'BAZOOKA'; this._drawSprite(); }
        } else if (type === 'WEAPON_M4') {
            this.inventory.M4.ammo = Math.min(WEAPONS.M4.maxAmmo, (this.inventory.M4.ammo || 0) + value);
            this.inventory.M4.owned = true;
            if (!this.currentWeapon) { this.currentWeapon = 'M4'; this._drawSprite(); }
        } else if (type === 'WEAPON_BAZOOKA') {
            this.inventory.BAZOOKA.ammo = Math.min(WEAPONS.BAZOOKA.maxAmmo, (this.inventory.BAZOOKA.ammo || 0) + value);
            this.inventory.BAZOOKA.owned = true;
            if (!this.currentWeapon) { this.currentWeapon = 'BAZOOKA'; this._drawSprite(); }
        }
        this.scene.events.emit('inventoryChanged', this._getInventoryState());
    }

    _getInventoryState() {
        return {
            weapons: [
                this.inventory.M4.owned
                    ? { key: 'M4',      label: 'M4',      ammo: this.inventory.M4.ammo,      active: this.currentWeapon === 'M4' }
                    : null,
                this.inventory.BAZOOKA.owned
                    ? { key: 'BAZOOKA', label: 'BAZOOKA', ammo: this.inventory.BAZOOKA.ammo,  active: this.currentWeapon === 'BAZOOKA' }
                    : null,
            ].filter(Boolean),
            grenades: this.inventory.GRENADE,
            healthPacks: this.inventory.HEALTH,
            currentWeapon: this.currentWeapon,
        };
    }

    useHealthPack() {
        if (this.inventory.HEALTH <= 0 || this.health >= this.maxHealth) return;
        this.inventory.HEALTH--;
        this.heal(this.maxHealth * 0.5);
        this.scene.events.emit('inventoryChanged', this._getInventoryState());
        
        // Green flash effect on player
        if (this.playerSprite) {
            this.playerSprite.setTint(0x44ff44);
            this.scene.time.delayedCall(200, () => {
                if (this.playerSprite && this.playerSprite.scene) this.playerSprite.clearTint();
            });
        }
    }

    heal(amount) {
        this.health = Math.min(this.maxHealth, this.health + amount);
        this.scene.events.emit('healthChanged', this.health);
    }

    // Legacy shims (called by GameScene's old code)
    addAmmo(weapon, amount) { this.receivePickup(`AMMO_${weapon}`, amount); }

    takeDamage(amount) {
        if (!this.alive) return;
        this.health -= amount;
        this.scene.cameras.main.shake(100, 0.005);
        if (this.playerSprite) {
            this.playerSprite.setTint(0xff4444);
            this.scene.time.delayedCall(130, () => { if (this.playerSprite) this.playerSprite.clearTint(); });
        }
        if (this.health <= 0) { this.health = 0; this.die(); }
        this.scene.events.emit('healthChanged', this.health);
    }

    die() {
        this.alive = false;
        this.container.setAlpha(0.3);
        this.container.body.setVelocity(0, 0);
        this.container.body.enable = false;
        this.scene.events.emit('playerDied');
        
        // In online mode, the server tells us when to respawn.
        if (!this.scene.onlineMode) {
            this.scene.time.delayedCall(3000, () => this.respawn());
        }
    }

    respawn() {
        const spawn = this.scene.mazeData?.playerSpawn;
        const ts = this.scene.tileSize;
        if (!this.scene.onlineMode && spawn) {
            this.container.setPosition(spawn.x * ts + ts/2, spawn.y * ts + ts/2);
        }
        // If online, position is updated by Server state_tick override!
        
        this.health = this.maxHealth;
        this.alive = true;
        this.keysCollected = 0; // Reset keys on death
        this.scene.events.emit('keysChanged', this.keysCollected);
        
        this.container.setAlpha(1);
        this.container.body.enable = true;
        this.scene.events.emit('healthChanged', this.health);
        this.scene.events.emit('playerRespawned');
    }

    getState() {
        return {
            x: this.container.x, y: this.container.y,
            rotation: this.container.rotation,
            health: this.health,
            weapon: this.currentWeapon,
            alive: this.alive,
        };
    }

    setState(state) {
        if (!this.isLocal) {
            this.container.setPosition(state.x, state.y);
            this.container.rotation = state.rotation;
            this.health = state.health;
            this.alive = state.alive;
            this.container.setAlpha(state.alive ? 1 : 0.3);
        }
    }

    destroy() { this.container.destroy(); }
}
