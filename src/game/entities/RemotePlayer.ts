/**
 * RemotePlayer — Renders an online opponent/teammate.
 * No physics body — position comes from server state (Colyseus).
 * Uses linear interpolation for smooth movement between server ticks.
 */
import Phaser from 'phaser';

const LERP = 0.25; // per frame interpolation factor

export class RemotePlayer {
    public container: Phaser.GameObjects.Container;
    private sprite: Phaser.GameObjects.Image;
    private weaponSprite: Phaser.GameObjects.Image;
    private hpBg: Phaser.GameObjects.Rectangle;
    private hpBar: Phaser.GameObjects.Rectangle;
    private nameText: Phaser.GameObjects.Text;

    public targetX = 0;
    public targetY = 0;
    public targetRot = 0;

    public sessionId: string;
    public team: string;
    public tint: number;
    public alive = true;
    public health = 100;
    public maxHealth = 100;

    constructor(
        scene: Phaser.Scene,
        sessionId: string,
        x: number, y: number,
        name: string,
        team: string,
        tint: number
    ) {
        this.sessionId = sessionId;
        this.team = team;
        this.tint = tint;

        this.targetX = x;
        this.targetY = y;

        this.sprite = scene.add.image(0, 0, 'player')
            .setDisplaySize(32, 32)
            .setTint(tint);

        this.weaponSprite = scene.add.image(14, 2, 'weapon_m4')
            .setScale(0.65)
            .setOrigin(0.1, 0.5)
            .setTint(tint);

        this.hpBg  = scene.add.rectangle(0, -22, 28, 5, 0x333333, 0.85).setOrigin(0.5, 0.5);
        this.hpBar = scene.add.rectangle(0, -22, 28, 5, tint).setOrigin(0.5, 0.5);

        this.nameText = scene.add.text(0, -32, name, {
            fontFamily: 'Outfit, sans-serif',
            fontSize: '9px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 2,
        }).setOrigin(0.5, 1);

        this.container = scene.add.container(x, y, [
            this.hpBg, this.hpBar, this.sprite, this.weaponSprite, this.nameText
        ]).setDepth(9);
    }

    /** Called with data from server state patch. */
    applyState(data: any) {
        if (typeof data.x === 'number')        this.targetX   = data.x;
        if (typeof data.y === 'number')        this.targetY   = data.y;
        if (typeof data.rotation === 'number') this.targetRot = data.rotation;
        if (typeof data.health === 'number')   this.health    = data.health;

        // Only change alive if explicitly set (undefined means "no change")
        if (typeof data.alive === 'boolean') {
            this.alive = data.alive;
            this.container.setAlpha(data.alive ? 1 : 0);
        }

        // Weapon sprite
        if (data.weapon === 'BAZOOKA') {
            this.weaponSprite.setTexture('weapon_bazooka');
        } else if (data.weapon === 'M4') {
            this.weaponSprite.setTexture('weapon_m4');
        }
    }

    /** Call every Phaser frame for smooth interpolation. */
    update() {
        if (!this.alive) return;

        // Lerp position
        this.container.x += (this.targetX - this.container.x) * LERP;
        this.container.y += (this.targetY - this.container.y) * LERP;
        this.container.rotation += (this.targetRot - this.container.rotation) * LERP;

        // HP bar
        this.hpBar.scaleX = Math.max(0, this.health / this.maxHealth);
    }

    destroy() {
        this.container.destroy();
    }
}
