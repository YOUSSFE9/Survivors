/**
 * BootScene — Generates ALL game textures procedurally at high quality.
 * 64×64 for entities, 32×32 for environment. No external files needed.
 * Characters are SCARY, WEIRD, and MEMORABLE for viral marketing.
 */
import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
    constructor() { super({ key: 'BootScene' }); }

    preload() {
        const w = this.cameras.main.width, h = this.cameras.main.height;
        this.add.rectangle(w/2, h/2, 300, 20, 0x222244);
        const bar = this.add.rectangle(w/2 - 148, h/2, 4, 16, 0x00ccff).setOrigin(0, 0.5);
        this.add.text(w/2, h/2 - 40, 'LOADING SPACE STATION...', {
            fontFamily: 'Outfit, sans-serif', fontSize: '18px', color: '#88bbff',
        }).setOrigin(0.5);
        this.load.on('progress', v => { bar.width = 296 * v; });
    }

    create() {
        this._generateTextures();
        const mode = this.registry.get('gameMode') || 'offline';
        this.scene.start('GameScene', { mode });
    }

    // ─── helpers ───
    _g() { return this.make.graphics({ x: 0, y: 0, add: false }); }

    _circle(g, cx, cy, r, fill, ow = 3, oc = 0x111122) {
        g.lineStyle(ow, oc, 1); g.fillStyle(fill, 1);
        g.strokeCircle(cx, cy, r); g.fillCircle(cx, cy, r);
    }
    _rr(g, x, y, w, h, r, fill, ow = 3, oc = 0x111122) {
        g.lineStyle(ow, oc, 1); g.fillStyle(fill, 1);
        g.strokeRoundedRect(x, y, w, h, r); g.fillRoundedRect(x, y, w, h, r);
    }

    // ─── MAIN ───
    _generateTextures() {
        const S = 64;
        this._genPlayer(S);
        this._genZombie(S);
        this._genMonster(S);
        this._genGhost(S);
        this._genPickups();
        this._genTraps();
        this._genGrenade();
        this._genEnvironment();
        this._genProjectiles();
    }

    // ━━━ PLAYER (Astronaut with arm for weapon) ━━━
    _genPlayer(S) {
        const g = this._g(), cx = S/2, cy = S/2;
        // Shadow
        g.fillStyle(0x000000, 0.15); g.fillEllipse(cx, cy+14, 26, 7);
        // Backpack
        this._rr(g, cx-22, cy-6, 10, 20, 4, 0xccd0e4);
        g.fillStyle(0x8899bb, 1); g.fillRect(cx-20, cy, 6, 3);
        g.fillStyle(0x66aaff, 0.6); g.fillCircle(cx-17, cy-2, 2); // light
        // Body
        this._rr(g, cx-10, cy-6, 20, 22, 6, 0xe4e8f6);
        g.fillStyle(0x99aabb, 1); g.fillRect(cx-8, cy+8, 16, 3); // belt
        // Left arm (holding weapon side)
        this._rr(g, cx+10, cy-2, 8, 12, 3, 0xdce0f0, 2.5);
        // Right arm
        this._rr(g, cx-18, cy, 6, 10, 3, 0xdce0f0, 2.5);
        // Helmet
        this._circle(g, cx, cy-8, 13, 0xeef0ff);
        // Visor (bright orange)
        this._rr(g, cx-8, cy-16, 16, 12, 5, 0xff9900);
        // Visor glare
        g.fillStyle(0xffffff, 0.5); g.fillCircle(cx+3, cy-13, 3);
        g.fillStyle(0xffffff, 0.25); g.fillCircle(cx-2, cy-10, 1.5);
        // Legs
        this._rr(g, cx-7, cy+14, 6, 8, 3, 0xdce0f0, 2);
        this._rr(g, cx+1, cy+14, 6, 8, 3, 0xdce0f0, 2);
        // Boots
        g.fillStyle(0x556677, 1);
        g.fillRoundedRect(cx-8, cy+19, 7, 4, 2);
        g.fillRoundedRect(cx+1, cy+19, 7, 4, 2);
        g.generateTexture('player', S, S); g.destroy();

        // ─ M4 weapon ─
        const gm = this._g();
        gm.lineStyle(2.5, 0x111122, 1);
        gm.fillStyle(0x2a2a3a, 1);
        gm.fillRect(4, 5, 28, 5); gm.strokeRect(4, 5, 28, 5); // barrel
        gm.fillStyle(0x3a3a4a, 1);
        gm.fillRect(0, 3, 12, 9); gm.strokeRect(0, 3, 12, 9); // receiver
        gm.fillStyle(0x443322, 1);
        gm.fillRect(-2, 4, 4, 8); gm.strokeRect(-2, 4, 4, 8); // stock
        gm.fillStyle(0x2a2a3a, 1);
        gm.fillRect(8, 12, 4, 7); gm.strokeRect(8, 12, 4, 7); // mag
        gm.fillStyle(0x1a1a2a, 1);
        gm.fillRect(20, 2, 5, 3); gm.strokeRect(20, 2, 5, 3); // sight
        gm.fillStyle(0xff8800, 0.9);
        gm.fillCircle(33, 7, 2); // muzzle flash point
        gm.generateTexture('weapon_m4', 36, 20); gm.destroy();

        // ─ Bazooka ─
        const gb = this._g();
        gb.lineStyle(2.5, 0x111122, 1);
        gb.fillStyle(0x4a5a4a, 1);
        gb.fillRoundedRect(0, 3, 38, 10, 4); gb.strokeRoundedRect(0, 3, 38, 10, 4);
        gb.fillStyle(0x333333, 1);
        gb.fillRect(36, 2, 6, 12); gb.strokeRect(36, 2, 6, 12); // front
        gb.fillStyle(0x443322, 1);
        gb.fillRect(12, 13, 5, 7); gb.strokeRect(12, 13, 5, 7); // grip
        gb.fillStyle(0xff4400, 1);
        gb.fillRect(24, 0, 4, 4); gb.strokeRect(24, 0, 4, 4); // sight
        gb.generateTexture('weapon_bazooka', 44, 22); gb.destroy();
    }

    // ━━━ ZOMBIE (Decayed, brain exposed, glowing red eyes) ━━━
    _genZombie(S) {
        const g = this._g(), cx = S/2, cy = S/2;
        g.fillStyle(0x000000, 0.15); g.fillEllipse(cx, cy+16, 24, 7);
        // Body (torn, decayed)
        this._rr(g, cx-10, cy-2, 20, 20, 4, 0x3d7a2e);
        // Torn shirt patches
        g.fillStyle(0x6b5b4f, 0.7); g.fillRect(cx-8, cy, 7, 8);
        g.fillStyle(0x5a4a3e, 0.5); g.fillRect(cx+2, cy+4, 6, 6);
        // Exposed ribs
        g.lineStyle(1.5, 0x2a5a1e, 1);
        g.strokeRect(cx-3, cy+2, 6, 2);
        g.strokeRect(cx-3, cy+5, 6, 2);
        // Arms (different lengths - one decayed)
        this._rr(g, cx-16, cy+2, 7, 14, 3, 0x3d7a2e, 2);
        this._rr(g, cx+10, cy, 6, 10, 3, 0x2d6a1e, 2); // shorter, darker
        // Claw fingers
        g.lineStyle(1.5, 0x111122, 1);
        g.fillStyle(0x4a8a3e, 1);
        g.fillTriangle(cx-16, cy+14, cx-18, cy+20, cx-14, cy+18);
        g.fillTriangle(cx+12, cy+8, cx+16, cy+14, cx+10, cy+12);
        // Head
        this._circle(g, cx, cy-8, 13, 0x4a8a3a);
        // Exposed brain (top of head, pinkish)
        g.lineStyle(2, 0x111122, 1);
        g.fillStyle(0xcc6688, 1);
        g.beginPath(); g.arc(cx, cy-14, 8, Math.PI, 0, false); g.closePath();
        g.fillPath(); g.strokePath();
        // Brain wrinkles
        g.lineStyle(1, 0xaa4466, 1);
        g.beginPath(); g.moveTo(cx-5, cy-16); g.lineTo(cx-2, cy-13); g.lineTo(cx+1, cy-17); g.lineTo(cx+4, cy-14); g.strokePath();
        // Glowing red eyes
        g.fillStyle(0xff0000, 0.3); g.fillCircle(cx-5, cy-8, 6); // glow
        g.fillStyle(0xff0000, 0.3); g.fillCircle(cx+5, cy-8, 6);
        this._circle(g, cx-5, cy-8, 4, 0xff2200, 2);
        this._circle(g, cx+5, cy-8, 4, 0xff2200, 2);
        g.fillStyle(0xffff00, 1); g.fillCircle(cx-5, cy-8, 1.5); // pupil glow
        g.fillStyle(0xffff00, 1); g.fillCircle(cx+5, cy-8, 1.5);
        // Torn jaw with teeth
        g.lineStyle(2, 0x111122, 1);
        g.fillStyle(0x2a5a1a, 1);
        g.fillRect(cx-7, cy-2, 14, 6); g.strokeRect(cx-7, cy-2, 14, 6);
        // Jagged teeth
        g.fillStyle(0xeeeecc, 1);
        for (let i = 0; i < 5; i++) {
            const tx = cx - 6 + i * 3;
            g.fillTriangle(tx, cy-2, tx+1.5, cy+2, tx+3, cy-2);
        }
        // Drool
        g.lineStyle(1, 0x88cc88, 0.6);
        g.beginPath(); g.moveTo(cx+3, cy+4); g.lineTo(cx+4, cy+8); g.strokePath();
        // Legs
        this._rr(g, cx-7, cy+16, 6, 8, 3, 0x3d7a2e, 2);
        this._rr(g, cx+1, cy+16, 6, 8, 3, 0x3d7a2e, 2);
        g.generateTexture('zombie', S, S); g.destroy();
    }

    // ━━━ MONSTER (Demonic purple beast, horns, claws, spikes) ━━━
    _genMonster(S) {
        const g = this._g(), cx = S/2, cy = S/2;
        g.fillStyle(0x000000, 0.15); g.fillEllipse(cx, cy+17, 30, 8);
        // Spiked tail
        g.lineStyle(2.5, 0x111122, 1);
        g.fillStyle(0x6622aa, 1);
        g.beginPath(); g.moveTo(cx-12, cy+12); g.lineTo(cx-24, cy+8);
        g.lineTo(cx-28, cy+2); g.lineTo(cx-24, cy+6); g.lineTo(cx-12, cy+8); g.closePath();
        g.fillPath(); g.strokePath();
        // Spike on tail
        g.fillStyle(0xddcc88, 1);
        g.fillTriangle(cx-28, cy+2, cx-30, cy-4, cx-26, cy); 
        // Body (big, muscular purple)
        this._rr(g, cx-14, cy-4, 28, 24, 6, 0x7722bb);
        // Chest muscles
        g.fillStyle(0x8833cc, 0.5);
        g.fillCircle(cx-5, cy+4, 6); g.fillCircle(cx+5, cy+4, 6);
        // Arms (massive with claws)
        this._rr(g, cx-22, cy-4, 10, 18, 4, 0x6622aa, 2.5);
        this._rr(g, cx+13, cy-4, 10, 18, 4, 0x6622aa, 2.5);
        // Claws (3 per hand)
        g.fillStyle(0xddcc88, 1); g.lineStyle(1.5, 0x111122, 1);
        for (let i = 0; i < 3; i++) {
            g.fillTriangle(cx-22+i*4, cy+12, cx-24+i*4, cy+20, cx-20+i*4, cy+16);
            g.fillTriangle(cx+14+i*4, cy+12, cx+12+i*4, cy+20, cx+16+i*4, cy+16);
        }
        // Head
        this._circle(g, cx, cy-10, 14, 0x7722bb);
        // Curved horns
        g.lineStyle(3, 0x111122, 1); g.fillStyle(0x991166, 1);
        // Left horn (curved)
        g.beginPath(); g.moveTo(cx-10, cy-18); g.lineTo(cx-16, cy-32);
        g.lineTo(cx-6, cy-28); g.lineTo(cx-6, cy-18); g.closePath();
        g.fillPath(); g.strokePath();
        // Right horn
        g.beginPath(); g.moveTo(cx+10, cy-18); g.lineTo(cx+16, cy-32);
        g.lineTo(cx+6, cy-28); g.lineTo(cx+6, cy-18); g.closePath();
        g.fillPath(); g.strokePath();
        // Fiery eyes
        g.fillStyle(0xffaa00, 0.3); g.fillCircle(cx-6, cy-12, 6);
        g.fillStyle(0xffaa00, 0.3); g.fillCircle(cx+6, cy-12, 6);
        this._circle(g, cx-6, cy-12, 4, 0xffcc00, 2);
        this._circle(g, cx+6, cy-12, 4, 0xffcc00, 2);
        g.fillStyle(0xff0000, 1); g.fillCircle(cx-6, cy-12, 2);
        g.fillStyle(0xff0000, 1); g.fillCircle(cx+6, cy-12, 2);
        // Angry brow ridges
        g.lineStyle(3, 0x5511aa, 1);
        g.beginPath(); g.moveTo(cx-12, cy-18); g.lineTo(cx-2, cy-15); g.strokePath();
        g.beginPath(); g.moveTo(cx+12, cy-18); g.lineTo(cx+2, cy-15); g.strokePath();
        // Wide mouth with fangs
        g.lineStyle(2, 0x111122, 1);
        g.fillStyle(0x220011, 1);
        g.fillRoundedRect(cx-9, cy-4, 18, 8, 3); g.strokeRoundedRect(cx-9, cy-4, 18, 8, 3);
        // Fangs
        g.fillStyle(0xffffff, 1);
        g.fillTriangle(cx-7, cy-4, cx-5, cy+4, cx-9, cy+2);
        g.fillTriangle(cx+7, cy-4, cx+5, cy+4, cx+9, cy+2);
        g.fillTriangle(cx-3, cy-4, cx-2, cy+1, cx-4, cy);
        g.fillTriangle(cx+3, cy-4, cx+2, cy+1, cx+4, cy);
        // Legs
        this._rr(g, cx-10, cy+18, 8, 8, 3, 0x6622aa, 2);
        this._rr(g, cx+2, cy+18, 8, 8, 3, 0x6622aa, 2);
        g.generateTexture('monster', S, S); g.destroy();
    }

    // ━━━ GHOST (Eerie specter, hollow eye sockets, trailing wisps) ━━━
    _genGhost(S) {
        const g = this._g(), cx = S/2, cy = S/2;
        // Outer glow
        g.fillStyle(0x6688cc, 0.06); g.fillCircle(cx, cy, 30);
        g.fillStyle(0x88aadd, 0.08); g.fillCircle(cx, cy-2, 24);
        // Trailing wisps (behind body)
        g.fillStyle(0xb0c8e8, 0.15);
        g.fillEllipse(cx-8, cy+18, 6, 12);
        g.fillEllipse(cx+8, cy+20, 5, 14);
        g.fillEllipse(cx, cy+22, 4, 10);
        // Main body (ghostly translucent)
        g.lineStyle(2.5, 0x5577aa, 1); g.fillStyle(0xc8d8ee, 0.85);
        g.beginPath();
        g.arc(cx, cy-4, 18, Math.PI, 0, false);
        g.lineTo(cx+18, cy+12);
        g.arc(cx+12, cy+12, 6, 0, Math.PI, false);
        g.arc(cx, cy+12, 6, 0, Math.PI, false);
        g.arc(cx-12, cy+12, 6, 0, Math.PI, false);
        g.lineTo(cx-18, cy-4);
        g.closePath(); g.fillPath(); g.strokePath();
        // Inner ethereal glow
        g.fillStyle(0xddeeff, 0.3);
        g.fillCircle(cx, cy-2, 10);
        // Hollow eye sockets (deep black)
        g.lineStyle(2, 0x334466, 1);
        g.fillStyle(0x0a0a22, 1);
        g.strokeCircle(cx-7, cy-6, 5); g.fillCircle(cx-7, cy-6, 5);
        g.strokeCircle(cx+7, cy-6, 5); g.fillCircle(cx+7, cy-6, 5);
        // Ghostly pupil glow (tiny eerie blue dots)
        g.fillStyle(0x44aaff, 0.9); g.fillCircle(cx-6, cy-6, 1.5);
        g.fillStyle(0x44aaff, 0.9); g.fillCircle(cx+8, cy-6, 1.5);
        // Mouth (open wail)
        g.fillStyle(0x1a1a33, 1);
        g.fillEllipse(cx, cy+4, 5, 4);
        g.lineStyle(1.5, 0x334466, 1);
        g.strokeEllipse(cx, cy+4, 5, 4);
        g.generateTexture('ghost', S, S); g.destroy();
    }

    // ━━━ PICKUPS (Beautiful, clear, eye-friendly) ━━━
    _genPickups() {
        const S = 32;
        // Health Kit (clean white box with green cross, rounded, glowing)
        const gh = this._g();
        gh.fillStyle(0x22cc55, 0.2); gh.fillCircle(S/2, S/2, 15); // glow
        this._rr(gh, 3, 3, 26, 26, 6, 0xffffff, 2.5, 0x22aa44);
        gh.lineStyle(0); gh.fillStyle(0x22cc55, 1);
        gh.fillRect(13, 6, 6, 20); gh.fillRect(6, 13, 20, 6); // cross
        gh.generateTexture('pickup_health', S, S); gh.destroy();

        // M4 Ammo (golden bullets in dark box)
        const ga = this._g();
        ga.fillStyle(0xffaa00, 0.15); ga.fillCircle(S/2, S/2, 14);
        this._rr(ga, 3, 3, 26, 26, 6, 0x2a2a3a, 2.5, 0xffaa00);
        ga.lineStyle(0); ga.fillStyle(0xffcc33, 1);
        for (let i = 0; i < 3; i++) {
            ga.fillRoundedRect(8+i*7, 7, 5, 16, 2);
            ga.fillStyle(0xcc8800, 1); ga.fillRect(8+i*7, 7, 5, 4); // tip
            ga.fillStyle(0xffcc33, 1);
        }
        ga.generateTexture('pickup_ammo_m4', S, S); ga.destroy();

        // Bazooka Ammo (red rocket in box)
        const gb = this._g();
        gb.fillStyle(0xff4400, 0.15); gb.fillCircle(S/2, S/2, 14);
        this._rr(gb, 3, 3, 26, 26, 6, 0x3a2222, 2.5, 0xff4400);
        gb.lineStyle(2, 0x111122, 1); gb.fillStyle(0xff5533, 1);
        gb.fillRoundedRect(7, 11, 18, 8, 3); gb.strokeRoundedRect(7, 11, 18, 8, 3);
        gb.fillStyle(0xffaa33, 1); gb.fillTriangle(25, 11, 29, 15, 25, 19); // nose
        gb.fillStyle(0xcc2200, 1);
        gb.fillTriangle(7, 11, 4, 8, 7, 15);
        gb.fillTriangle(7, 15, 4, 22, 7, 19); // fins
        gb.generateTexture('pickup_ammo_bazooka', S, S); gb.destroy();

        // Weapon M4 pickup
        const gwm = this._g();
        gwm.fillStyle(0xffaa00, 0.12); gwm.fillCircle(S/2, S/2, 14);
        this._rr(gwm, 3, 3, 26, 26, 6, 0x445566, 2.5, 0xffaa00);
        gwm.lineStyle(2, 0x111122, 1); gwm.fillStyle(0x333344, 1);
        gwm.fillRect(6, 13, 20, 4); gwm.strokeRect(6, 13, 20, 4);
        gwm.fillRect(8, 17, 4, 5); gwm.strokeRect(8, 17, 4, 5);
        gwm.fillStyle(0xffaa00, 1);
        gwm.fillCircle(16, 9, 3); gwm.strokeCircle(16, 9, 3);
        gwm.generateTexture('pickup_weapon_m4', S, S); gwm.destroy();

        // Weapon Bazooka pickup
        const gwb = this._g();
        gwb.fillStyle(0xff3300, 0.12); gwb.fillCircle(S/2, S/2, 14);
        this._rr(gwb, 3, 3, 26, 26, 6, 0x445544, 2.5, 0xff3300);
        gwb.lineStyle(2, 0x111122, 1); gwb.fillStyle(0x445544, 1);
        gwb.fillRoundedRect(5, 13, 22, 6, 3); gwb.strokeRoundedRect(5, 13, 22, 6, 3);
        gwb.fillStyle(0xff3300, 1);
        gwb.fillCircle(16, 9, 3); gwb.strokeCircle(16, 9, 3);
        gwb.generateTexture('pickup_weapon_bazooka', S, S); gwb.destroy();

        // Key (glowing golden key)
        const gk = this._g();
        gk.fillStyle(0xffd700, 0.15); gk.fillCircle(S/2, S/2, 14);
        gk.lineStyle(2.5, 0x997700, 1); gk.fillStyle(0xffd700, 1);
        gk.fillCircle(16, 9, 6); gk.strokeCircle(16, 9, 6);
        gk.fillStyle(0xcc9900, 1); gk.fillCircle(16, 9, 3); gk.strokeCircle(16, 9, 3);
        gk.fillStyle(0xffd700, 1);
        gk.fillRect(13, 14, 6, 12); gk.strokeRect(13, 14, 6, 12);
        gk.fillRect(18, 20, 4, 3); gk.strokeRect(18, 20, 4, 3);
        gk.fillRect(18, 24, 3, 3); gk.strokeRect(18, 24, 3, 3);
        gk.generateTexture('pickup_key', S, S); gk.destroy();

        // Grenade pickup
        const gg = this._g();
        gg.fillStyle(0x44cc44, 0.15); gg.fillCircle(S/2, S/2, 14);
        this._rr(gg, 3, 3, 26, 26, 6, 0x334433, 2.5, 0x44cc44);
        gg.lineStyle(2, 0x111122, 1); gg.fillStyle(0x445544, 1);
        gg.fillCircle(16, 17, 7); gg.strokeCircle(16, 17, 7);
        gg.fillStyle(0x667766, 1); gg.fillRect(13, 7, 6, 6); gg.strokeRect(13, 7, 6, 6);
        gg.fillStyle(0xffaa00, 1); gg.fillCircle(16, 7, 2);
        gg.generateTexture('pickup_grenade', S, S); gg.destroy();
    }

    // ━━━ TRAPS ━━━
    _genTraps() {
        const S = 32;
        // Spike trap
        const gs = this._g();
        gs.fillStyle(0x332222, 1); gs.fillRect(0, 0, S, S);
        gs.lineStyle(1.5, 0x111122, 1); gs.fillStyle(0xaaaaaa, 1);
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                const sx = 4 + i*7, sy = 4 + j*7;
                gs.fillTriangle(sx, sy+5, sx+3, sy, sx+6, sy+5);
                gs.strokeTriangle(sx, sy+5, sx+3, sy, sx+6, sy+5);
            }
        }
        gs.generateTexture('trap_spike', S, S); gs.destroy();

        // Laser emitter
        const gl = this._g();
        gl.fillStyle(0x222233, 1); gl.fillRect(0, 0, S, S);
        gl.lineStyle(2, 0xff0000, 0.8);
        gl.fillStyle(0xff0000, 0.3); gl.fillRect(0, 12, S, 8);
        gl.strokeRect(0, 12, S, 8);
        gl.fillStyle(0xff4444, 0.8); gl.fillRect(0, 14, S, 4);
        gl.fillStyle(0xffffff, 0.5); gl.fillRect(0, 15, S, 2);
        gl.generateTexture('trap_laser', S, S); gl.destroy();

        // Exploding barrel
        const gb = this._g();
        gb.fillStyle(0x000000, 0.12); gb.fillEllipse(S/2, S/2+3, 20, 6);
        this._rr(gb, 6, 4, 20, 24, 4, 0x884422, 2.5, 0x111122);
        gb.fillStyle(0xaa5533, 1); gb.fillRect(8, 8, 16, 3);
        gb.fillRect(8, 20, 16, 3);
        // Warning symbol
        gb.fillStyle(0xffcc00, 1);
        gb.fillTriangle(S/2, 12, S/2-4, 20, S/2+4, 20);
        gb.fillStyle(0x111111, 1); gb.fillRect(S/2-1, 14, 2, 4);
        gb.fillCircle(S/2, 19, 1);
        gb.generateTexture('trap_barrel', S, S); gb.destroy();
    }

    // ━━━ GRENADE (throwable) ━━━
    _genGrenade() {
        const g = this._g();
        g.lineStyle(2, 0x111122, 1);
        g.fillStyle(0x445544, 1);
        g.fillCircle(8, 10, 6); g.strokeCircle(8, 10, 6);
        g.fillStyle(0x556655, 1);
        g.fillRect(5, 2, 6, 5); g.strokeRect(5, 2, 5, 5);
        g.fillStyle(0xffaa00, 1); g.fillCircle(8, 2, 2);
        g.generateTexture('grenade', 16, 16); g.destroy();

        // Explosion
        const ge = this._g();
        ge.fillStyle(0xff6600, 0.6); ge.fillCircle(16, 16, 16);
        ge.fillStyle(0xff8800, 0.4); ge.fillCircle(16, 16, 12);
        ge.fillStyle(0xffcc00, 0.5); ge.fillCircle(16, 16, 8);
        ge.fillStyle(0xffffff, 0.4); ge.fillCircle(16, 16, 4);
        ge.generateTexture('explosion', 32, 32); ge.destroy();
    }

    // ━━━ ENVIRONMENT ━━━
    _genEnvironment() {
        const wg = this._g();
        wg.fillStyle(0x151a30, 1); wg.fillRect(0, 0, 32, 32);
        wg.fillStyle(0x0a0d1a, 1); wg.fillRect(4, 4, 24, 24);
        wg.fillStyle(0x2a355a, 1); wg.fillRect(4, 4, 24, 2); wg.fillRect(4, 4, 2, 24);
        wg.fillStyle(0xe67e22, 0.8); wg.fillRect(14, 0, 4, 4); wg.fillRect(14, 28, 4, 4);
        wg.generateTexture('wall', 32, 32); wg.destroy();

        const fg = this._g();
        fg.fillStyle(0x222a44, 1); fg.fillRect(0, 0, 32, 32);
        fg.fillStyle(0x1a2035, 1); fg.fillRect(0, 31, 32, 1); fg.fillRect(31, 0, 1, 32);
        fg.fillStyle(0x334066, 0.5); fg.fillRect(15, 15, 2, 2);
        fg.generateTexture('floor', 32, 32); fg.destroy();
    }

    // ━━━ PROJECTILES ━━━
    _genProjectiles() {
        const bg = this._g();
        bg.fillStyle(0xffee44, 0.3); bg.fillCircle(5, 5, 5);
        bg.fillStyle(0xffcc00, 1); bg.fillCircle(5, 5, 3);
        bg.fillStyle(0xffffff, 0.8); bg.fillCircle(5, 5, 1.5);
        bg.generateTexture('bullet', 10, 10); bg.destroy();

        const rg = this._g();
        rg.lineStyle(1.5, 0x111122, 1);
        rg.fillStyle(0x888888, 1); rg.fillRoundedRect(0, 2, 14, 6, 2); rg.strokeRoundedRect(0, 2, 14, 6, 2);
        rg.fillStyle(0xff4400, 1); rg.fillTriangle(14, 2, 18, 5, 14, 8);
        rg.generateTexture('rocket', 20, 10); rg.destroy();

        const pg = this._g();
        pg.fillStyle(0xffffff, 1); pg.fillCircle(2, 2, 2);
        pg.generateTexture('particle', 4, 4); pg.destroy();
    }
}
