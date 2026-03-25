/**
 * Pickup — Collectible items with beautiful generated textures.
 * Supports: health kits, ammo, weapons, grenades.
 */
export const PICKUP_TYPES = {
    HEALTH:          { name: 'Health Kit',   texture: 'pickup_health',          value: 25 },
    AMMO_M4:         { name: 'M4 Ammo',     texture: 'pickup_ammo_m4',         value: 30 },
    AMMO_BAZOOKA:    { name: 'Bazooka Ammo', texture: 'pickup_ammo_bazooka',   value: 3  },
    WEAPON_M4:       { name: 'M4 Rifle',    texture: 'pickup_weapon_m4',       value: 60 },
    WEAPON_BAZOOKA:  { name: 'Bazooka',     texture: 'pickup_weapon_bazooka',  value: 5  },
    GRENADE:         { name: 'Grenade',     texture: 'pickup_grenade',         value: 2  },
};

export class Pickup {
    constructor(scene, x, y, type = 'HEALTH') {
        this.scene = scene;
        this.type = type;
        this.config = PICKUP_TYPES[type];

        this.container = scene.add.container(x, y);
        this.container.setDepth(3);

        // Sprite
        this.sprite = scene.add.image(0, 0, this.config.texture);
        this.sprite.setDisplaySize(24, 24);
        this.container.add(this.sprite);

        // Physics
        scene.physics.world.enable(this.container);
        this.container.body.setSize(20, 20);
        this.container.body.setOffset(-10, -10);
        this.container.body.setImmovable(true);

        // Float animation
        scene.tweens.add({
            targets: this.container,
            y: y - 4, duration: 1200 + Math.random() * 400,
            yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
    }

    collect() {
        // Collect flash — logic is handled in GameScene via Player.receivePickup
        this.scene.tweens.add({
            targets: this.container,
            scaleX: 0, scaleY: 0, alpha: 0, duration: 200,
            onComplete: () => this.destroy(),
        });
    }

    destroy() { this.container.destroy(); }
}
