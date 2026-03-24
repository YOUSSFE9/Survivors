/**
 * KeySystem — Manages collecting 10 keys and spawning a portal.
 */
export class KeySystem {
    constructor(scene) {
        this.scene = scene;
        this.keys = [];
        this.collectedCount = 0;
        this.totalKeys = 10;
        this.portalSpawned = false;
        this.portal = null;
    }

    spawnKeys(positions, tileSize) {
        this.keys = [];
        this.collectedCount = 0;
        this.portalSpawned = false;

        positions.forEach((pos, i) => {
            const x = pos.x * tileSize + tileSize / 2;
            const y = pos.y * tileSize + tileSize / 2;

            const key = this.scene.add.container(x, y);

            // Key body
            const glow = this.scene.add.circle(0, 0, 12, 0xffd700, 0.3);
            const keyBody = this.scene.add.circle(0, 0, 7, 0xffd700);
            const keyHole = this.scene.add.circle(-2, -2, 2, 0x0a0e27);

            key.add([glow, keyBody, keyHole]);
            key.setSize(20, 20);
            key.setData('index', i);

            this.scene.physics.world.enable(key);
            key.body.setImmovable(true);

            // Floating animation
            this.scene.tweens.add({
                targets: key,
                y: y - 5,
                duration: 1000 + Math.random() * 500,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut',
            });

            // Glow pulse
            this.scene.tweens.add({
                targets: glow,
                scaleX: 1.5,
                scaleY: 1.5,
                alpha: 0.1,
                duration: 800,
                yoyo: true,
                repeat: -1,
            });

            this.keys.push(key);
        });
    }

    spawnSingleKey(x, y) {
        const key = this.scene.add.container(x, y);

        // Key body
        const glow = this.scene.add.circle(0, 0, 12, 0xffd700, 0.3);
        const keyBody = this.scene.add.circle(0, 0, 7, 0xffd700);
        const keyHole = this.scene.add.circle(-2, -2, 2, 0x0a0e27);

        key.add([glow, keyBody, keyHole]);
        key.setSize(20, 20);
        
        // Random unique index so it doesn't collide
        key.setData('index', Math.random().toString(36).substr(2, 9)); 

        this.scene.physics.world.enable(key);
        key.body.setImmovable(true);

        // Floating animation
        this.scene.tweens.add({
            targets: key, y: y - 5, duration: 1000 + Math.random() * 500,
            yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });

        // Glow pulse
        this.scene.tweens.add({
            targets: glow, scaleX: 1.5, scaleY: 1.5, alpha: 0.1,
            duration: 800, yoyo: true, repeat: -1,
        });

        this.keys.push(key);
        return key;
    }

    collectKey(player, keyContainer) {
        const idx = keyContainer.getData('index');
        if (idx === undefined) return;

        this.collectedCount++;
        keyContainer.destroy();
        this.keys = this.keys.filter(k => k !== keyContainer);

        // Only flash camera for the real player (bots have an `index` property)
        const isRealPlayer = (player.index === undefined);
        if (isRealPlayer) {
            this.scene.cameras.main.flash(200, 255, 215, 0, false);
        }

        if (this.collectedCount >= this.totalKeys && !this.portalSpawned) {
            // In online mode, the server triggers portal spawning
            if (!this.scene.onlineMode) {
                this.spawnPortal();
            }
        }

        return this.collectedCount;
    }

    removeKeyByIndex(index) {
        const key = this.keys.find(k => k.getData('index') === index);
        if (key) {
            this.collectedCount++;
            key.destroy();
            this.keys = this.keys.filter(k => k !== key);
        }
    }

    spawnPortal() {
        const mazeData = this.scene.mazeData;
        if (!mazeData) return;

        const floor = mazeData.rooms && mazeData.rooms.length > 0 
            ? mazeData.rooms[Math.floor(Math.random() * mazeData.rooms.length)]
            : { x: mazeData.width/2, y: mazeData.height/2, w: 2, h: 2 };

        const tileSize = this.scene.tileSize;
        const px = (floor.x + floor.w / 2) * tileSize;
        const py = (floor.y + floor.h / 2) * tileSize;

        this.forceSpawnPortal(px, py);
    }

    forceSpawnPortal(px, py) {
        if (this.portalSpawned) return;

        this.portal = this.scene.add.container(px, py);

        // Portal visuals
        const outerRing = this.scene.add.circle(0, 0, 30, 0x00ff88, 0.3);
        const innerRing = this.scene.add.circle(0, 0, 20, 0x00ffaa, 0.5);
        const core = this.scene.add.circle(0, 0, 12, 0x66ffcc, 0.9);

        this.portal.add([outerRing, innerRing, core]);
        this.portal.setSize(50, 50);
        this.portal.setDepth(5);

        this.scene.physics.world.enable(this.portal);
        this.portal.body.setImmovable(true);

        // Rotation animation
        this.scene.tweens.add({ targets: outerRing, angle: 360, duration: 3000, repeat: -1 });
        this.scene.tweens.add({ targets: innerRing, angle: -360, duration: 2000, repeat: -1 });
        this.scene.tweens.add({ targets: core, scaleX: 1.3, scaleY: 1.3, alpha: 0.5, duration: 800, yoyo: true, repeat: -1 });

        this.portalSpawned = true;
        this.scene.events.emit('portalSpawned', { x: px, y: py });
    }

    enterPortal(player) {
        if (!this.portal || this.collectedCount < this.totalKeys) return false;

        if (this.scene.onlineMode && this.scene.onlineSync) {
            this.scene.onlineSync.sendEnterPortal();
            // HUD feedback
            this.scene.cameras.main.flash(500, 200, 255, 200);
        } else {
            this.scene.cameras.main.fade(1000, 255, 255, 255);
            this.scene.events.emit('playerWon');
        }
        return true;
    }

    getState() {
        return {
            collected: this.collectedCount,
            total: this.totalKeys,
            portalSpawned: this.portalSpawned,
            portalPos: this.portal ? { x: this.portal.x, y: this.portal.y } : null,
            keyPositions: this.keys.map(k => ({ x: k.x, y: k.y })),
        };
    }
}
