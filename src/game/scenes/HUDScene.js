/**
 * HUDScene — Mobile-first HUD v4 (Ultra Polished)
 *  - Professional rounded buttons with smooth hover/press tweens
 *  - Inventory Health Pack button (user requested manual heal)
 *  - Key Counter in top bar
 *  - Beautiful gradients/colors for UI
 */
import Phaser from 'phaser';
import { pwaInstallManager } from '../../utils/mobileUtils';

const LEGEND = [
    { color: 0x44ddff, label: 'اللاعب (أنت)' },
    { color: 0xff3333, label: 'الأعداء' },
    { color: 0xffd700, label: 'المفاتيح' },
    { color: 0x44cc66, label: 'نقاط الصحة' },
    { color: 0xffaa00, label: 'الذخيرة / الأسلحة' },
    { color: 0xff88ff, label: 'القنابل' },
    { color: 0x00ff88, label: 'البوابة / المخرج' },
    { color: 0x111111, label: 'الجدران' },
    { color: 0xffffff, label: 'الثقوب الناقلة' },
];

export class HUDScene extends Phaser.Scene {
    constructor() { super({ key: 'HUDScene' }); }

    init(data) { this.gameScene = data.gameScene; }

    create() {
        this.W = this.cameras.main.width;
        this.H = this.cameras.main.height;
        this.S = Math.min(this.W / 480, this.H / 320, 1.5);

        this._sidebarGroup = [];
        this._healthBtnNodes = null;
        this._breachBtnNodes = null;
        
        this._legendVisible = false;
        this._legendPanel = null;
        this._continueUsed = false; // first death allows one continue

        this._buildTopBar();
        this._buildMinimap();
        this._buildMobileControls();
        this._buildDeathOverlay();

        // Will be populated by first hudUpdate
        this._buildDynamicSidebar(null, 0); 

        this._setupEvents();
        this._scheduleInstallPrompt();
    }

    // ═══════════════════════════════════════════
    //  UI HELPERS (Rounded, Smooth, Professional)
    // ═══════════════════════════════════════════
    _createUIPanel(x, y, w, h, fillColor, strokeColor, alpha = 0.85) {
        const g = this.add.graphics().setScrollFactor(0);
        g.fillStyle(fillColor, alpha);
        g.fillRoundedRect(x, y, w, h, 8 * this.S);
        if (strokeColor) {
            g.lineStyle(1.5, strokeColor, 0.6);
            g.strokeRoundedRect(x, y, w, h, 8 * this.S);
        }
        return g;
    }

    _createButton(x, y, w, h, icon, text, subtext, mainColor, onClick, isActive = false) {
        const S = this.S;
        const container = this.add.container(x, y).setScrollFactor(0).setDepth(200);
        
        // Background
        const bg = this.add.graphics();
        const drawBg = (color, alpha, border) => {
            bg.clear();
            bg.fillStyle(color, alpha);
            bg.fillRoundedRect(-w/2, -h/2, w, h, 8*S);
            bg.lineStyle(2, border, 0.8);
            bg.strokeRoundedRect(-w/2, -h/2, w, h, 8*S);
        };
        drawBg(isActive ? mainColor : 0x0a0e22, 0.9, isActive ? 0xffffff : mainColor);

        // Icon
        const iTxt = this.add.text(0, -h/4, icon, { fontSize: `${12*S}px` }).setOrigin(0.5);
        // Label
        const txt = this.add.text(0, 2*S, text, {
            fontFamily: 'Outfit,sans-serif', fontSize: `${7*S}px`,
            color: isActive ? '#ffffff' : '#aabbcc', fontStyle: 'bold'
        }).setOrigin(0.5);
        // Subtext (Ammo/Count)
        const sTxt = this.add.text(0, h/2 - 7*S, subtext, {
            fontFamily: 'Outfit,sans-serif', fontSize: `${9*S}px`,
            color: '#ffffff', fontStyle: 'bold'
        }).setOrigin(0.5);

        container.add([bg, iTxt, txt, sTxt]);

        // Interactive hit area
        const hit = this.add.rectangle(0, 0, w, h, 0, 0).setInteractive({ cursor: 'pointer' });
        container.add(hit);

        // Tweens for smooth interaction
        hit.on('pointerover', () => {
            if (!isActive) drawBg(mainColor, 0.4, mainColor);
        });
        hit.on('pointerout', () => {
            if (!isActive) drawBg(0x0a0e22, 0.9, mainColor);
            this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 100 });
        });
        hit.on('pointerdown', () => {
            this.tweens.add({ targets: container, scaleX: 0.9, scaleY: 0.9, duration: 50 });
            onClick();
        });
        hit.on('pointerup', () => {
            this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 100 });
        });

        container.updateState = (newSub, newActive) => {
            sTxt.setText(newSub);
            if (isActive !== newActive) {
                isActive = newActive;
                drawBg(isActive ? mainColor : 0x0a0e22, 0.9, isActive ? 0xffffff : mainColor);
                txt.setColor(isActive ? '#ffffff' : '#aabbcc');
            }
        };

        return container;
    }

    // ═══════════════════════════════════════════
    //  TOP BAR
    // ═══════════════════════════════════════════
    _buildTopBar() {
        const S = this.S;
        
        // --- 1. HEALTH PANEL ---
        // Shift x to 95*S to avoid the HTML "Menu" button on the top-left
        const startX = 95*S; 
        const hy = 16*S;
        
        // Panel for health
        const hpW = 120*S;
        this._createUIPanel(startX, 6*S, hpW, 26*S, 0x0a0c16, 0x334466, 0.85).setDepth(199);

        // Heart Icon
        const hx = startX + 16*S;
        const hGfx = this.add.graphics().setScrollFactor(0).setDepth(200);
        hGfx.fillStyle(0xff3344); hGfx.fillCircle(hx-4*S, hy-2*S, 4.5*S); hGfx.fillCircle(hx+4*S, hy-2*S, 4.5*S);
        hGfx.fillTriangle(hx-8*S, hy, hx+8*S, hy, hx, hy+9*S);

        // Health Bar
        const barX = hx + 14*S, barY = hy;
        const barW = 80*S;
        this.add.graphics().setScrollFactor(0).setDepth(200)
            .fillStyle(0x111133, 1).fillRoundedRect(barX, barY-5*S, barW, 10*S, 4*S)
            .lineStyle(1, 0x334466).strokeRoundedRect(barX, barY-5*S, barW, 10*S, 4*S);
        
        this.healthBarFill = this.add.graphics().setScrollFactor(0).setDepth(201);
        this._hpBarX = barX + 1*S; this._hpBarY = barY - 4*S;
        this._hpBarW = barW - 2*S; this._hpBarH = 8*S;

        // --- 2. STATS PANEL ---
        const statsX = startX + hpW + 12*S;
        const statsW = 160*S;
        this._createUIPanel(statsX, 6*S, statsW, 26*S, 0x0a0c16, 0x334466, 0.85).setDepth(199);

        // Keys
        const kx = statsX + 22*S;
        this.add.circle(kx, hy, 6.5*S, 0xffd700).setScrollFactor(0).setDepth(200);
        this.add.circle(kx, hy, 3.5*S, 0xcc9900).setScrollFactor(0).setDepth(201);
        this.keyText = this.add.text(kx + 10*S, hy, '0/10', {
            fontFamily: 'Outfit,sans-serif', fontSize: `${11*S}px`, color: '#ffd700', fontStyle: 'bold',
        }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(200);

        // Coins
        const cx = kx + 45*S;
        this.add.text(cx, hy, '💰', { fontSize: `${11*S}px` }).setOrigin(0.5).setScrollFactor(0).setDepth(200);
        this.coinText = this.add.text(cx + 10*S, hy, '0', {
            fontFamily: 'Outfit,sans-serif', fontSize: `${11*S}px`, color: '#fff', fontStyle: 'bold',
        }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(200);

        // Kills
        const kllx = cx + 45*S;
        this.add.text(kllx, hy, '💀', { fontSize: `${11*S}px` }).setOrigin(0.5).setScrollFactor(0).setDepth(200);
        this.killText = this.add.text(kllx + 10*S, hy, '0', {
            fontFamily: 'Outfit,sans-serif', fontSize: `${11*S}px`, color: '#ff6666', fontStyle: 'bold',
        }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(200);


        // Wave (top-right, sleek badge)
        const wvW = 60*S, wvH = 20*S;
        const wvX = this.W - wvW - 8*S, wvY = 8*S;
        this._createUIPanel(wvX, wvY, wvW, wvH, 0xcc4400, 0xff8800, 0.8).setDepth(199);
        this.waveText = this.add.text(wvX + wvW/2, wvY + wvH/2, 'WAVE 1', {
            fontFamily: 'Outfit,sans-serif', fontSize: `${10*S}px`, color: '#ffffff', fontStyle: 'bold'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(200);
    }

    // ═══════════════════════════════════════════
    //  DYNAMIC UI SIDEBAR (Weapons, Health, Breach)
    // ═══════════════════════════════════════════
    _buildDynamicSidebar(inventory, keysCount) {
        this._sidebarGroup.forEach(c => c.destroy());
        this._sidebarGroup = [];
        if (!inventory) return;

        const S = this.S;
        const btnW = 50*S, btnH = 46*S;
        const x = this.W - btnW/2 - 8*S;
        let y = 38*S;

        // Weapons
        inventory.weapons.forEach(wp => {
            const btn = this._createButton(x, y + btnH/2, btnW, btnH, '🔫', wp.label, `${wp.ammo}`, 0x44aaff, () => {
                this.gameScene?.player?.equipWeapon(wp.key);
            }, wp.active);
            this._sidebarGroup.push(btn);
            y += btnH + 6*S;
        });

        // Health Packs (Manual Use)
        if (inventory.healthPacks > 0) {
            const btn = this._createButton(x, y + btnH/2, btnW, btnH, '💊', 'علاج', `×${inventory.healthPacks}`, 0x44cc66, () => {
                this.gameScene?.player?.useHealthPack();
            });
            this._sidebarGroup.push(btn);
            y += btnH + 6*S;
        }

        // Breach Button
        if (keysCount > 0) {
            const pl = this.gameScene?.player;
            const isBreach = pl && pl.breachMode;
            const btn = this._createButton(x, y + btnH/2, btnW, btnH, '🧱', 'جدار مفخخ', 'BREACH', 0xcc33cc, () => {
                if (pl) {
                    pl.breachMode = !pl.breachMode;
                    this.gameScene.events.emit('breachModeChanged', pl.breachMode);
                    btn.updateState('BREACH', pl.breachMode);
                }
            }, isBreach);
            this._sidebarGroup.push(btn);
        }
    }

    // ═══════════════════════════════════════════
    //  MOBILE CONTROLS & JOYSTICK
    // ═══════════════════════════════════════════
    _buildMobileControls() {
        const W = this.W, H = this.H, S = this.S;

        // ─ Smooth Joystick Base ─
        const joyR = 48*S;
        const joyX = joyR + 16*S, joyY = H - joyR - 16*S;
        this._joyCenter = { x: joyX, y: joyY };
        this._joyMax = joyR * 0.85;
        this._joy = { active: false, ptId: -1, x: 0, y: 0 };

        const joyGfx = this.add.graphics().setScrollFactor(0).setDepth(198);
        // Outer glow
        joyGfx.fillStyle(0x44aaff, 0.08); joyGfx.fillCircle(joyX, joyY, joyR * 1.2);
        // Base
        joyGfx.fillStyle(0x111122, 0.7); joyGfx.fillCircle(joyX, joyY, joyR);
        joyGfx.lineStyle(2, 0x4488ff, 0.4); joyGfx.strokeCircle(joyX, joyY, joyR);
        // Inner ring
        joyGfx.lineStyle(1, 0x4488ff, 0.2); joyGfx.strokeCircle(joyX, joyY, joyR * 0.4);

        // Knob with gradient-like look
        this._joyKnob = this.add.graphics().setScrollFactor(0).setDepth(199);
        this._joyKnob.setPosition(joyX, joyY);
        
        const drawKnob = (active) => {
            this._joyKnob.clear();
            this._joyKnob.fillStyle(active ? 0x66bbff : 0x4488ff, 0.9);
            this._joyKnob.fillCircle(0, 0, joyR * 0.35);
            this._joyKnob.lineStyle(2, 0xffffff, active ? 0.8 : 0.3);
            this._joyKnob.strokeCircle(0, 0, joyR * 0.35);
        };
        drawKnob(false);

        this.input.on('pointerdown', (ptr) => {
            const d2 = (ptr.x - joyX)**2 + (ptr.y - joyY)**2;
            if (!this._joy.active && d2 < (joyR * 2.5)**2) {
                this._joy.active = true; this._joy.ptId = ptr.id;
                this._updateJoyFromPtr(ptr);
                drawKnob(true);
            }
        });
        this.input.on('pointermove', (ptr) => {
            if (this._joy.active && ptr.id === this._joy.ptId) {
                this._updateJoyFromPtr(ptr);
                // No need to call drawKnob over and over, we just update position in _updateJoyFromPtr
            }
        });
        this.input.on('pointerup', (ptr) => {
            if (ptr.id === this._joy.ptId) {
                this._joy.active = false; this._joy.ptId = -1;
                this._joy.x = 0; this._joy.y = 0;
                this._joyKnob.setPosition(joyX, joyY);
                drawKnob(false);
            }
        });

        // ─ Fire Button (Twin-Stick) ─
        const fireR = 40*S;
        const fireX = W - fireR - 20*S, fireY = H - fireR - 20*S;
        this._fire = { active: false, ptId: -1, x: 0, y: 0 };
        this._fireMax = 35 * S; // Drag max distance
        
        const fBg = this.add.graphics().setScrollFactor(0).setDepth(198);
        this._fireKnob = this.add.graphics().setScrollFactor(0).setDepth(199);
        this._fireKnob.setPosition(fireX, fireY);

        const drawFireBtn = (active) => {
            fBg.clear();
            // Outer glow when active
            if (active) {
                fBg.fillStyle(0xff4422, 0.15); fBg.fillCircle(fireX, fireY, fireR * 1.5);
            }
            // Base
            fBg.fillStyle(active ? 0xff4422 : 0xaa2211, 0.6);
            fBg.fillCircle(fireX, fireY, fireR);
            fBg.lineStyle(4, active ? 0xffddcc : 0xffaa88, 0.8);
            fBg.strokeCircle(fireX, fireY, fireR);
            
            // Knob
            this._fireKnob.clear();
            this._fireKnob.fillStyle(0xffddcc, 0.9);
            this._fireKnob.fillCircle(0, 0, fireR * 0.4);
            this._fireKnob.lineStyle(2, 0xffffff, 0.8);
            this._fireKnob.strokeCircle(0, 0, fireR * 0.4);
            
            // Icon moves with the knob physically so it looks cool
            fIcon.setPosition(this._fireKnob.x, this._fireKnob.y - 6*S);
            fTxt.setPosition(this._fireKnob.x, this._fireKnob.y + 16*S);
        };

        const fIcon = this.add.text(fireX, fireY - 6*S, '🔥', { fontSize: `${20*S}px` }).setOrigin(0.5).setScrollFactor(0).setDepth(200);
        const fTxt = this.add.text(fireX, fireY + 16*S, 'FIRE', { fontFamily: 'Outfit,sans-serif', fontSize: `${9*S}px`, color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setScrollFactor(0).setDepth(200);
        drawFireBtn(false);

        const updateFireJoy = (ptr) => {
            let dx = ptr.x - fireX, dy = ptr.y - fireY;
            let d = Math.sqrt(dx*dx + dy*dy);
            if (d < 8*S) {
                // Deadzone: just a tap, don't change aim angle
                this._fireKnob.setPosition(fireX, fireY);
                this._fire.x = 0; this._fire.y = 0;
            } else {
                if (d > this._fireMax) { dx = (dx/d)*this._fireMax; dy = (dy/d)*this._fireMax; }
                this._fireKnob.setPosition(fireX + dx, fireY + dy);
                this._fire.x = dx / this._fireMax; this._fire.y = dy / this._fireMax;
            }
            drawFireBtn(true);
        };

        this.input.on('pointerdown', (ptr) => {
            if (!this._fire.active && (ptr.x - fireX)**2 + (ptr.y - fireY)**2 < (fireR*2)**2) {
                this._fire.active = true; this._fire.ptId = ptr.id;
                this.tweens.add({ targets: [fIcon, fTxt], scaleX: 1.2, scaleY: 1.2, duration: 80 });
                updateFireJoy(ptr);
            }
        });

        // ─ Grenade Button (Drag to aim Trajectory) ─
        const grnR = 28*S;
        const grnX = fireX - fireR - grnR - 15*S, grnY = fireY + fireR - grnR;
        this._grenade = { active: false, ptId: -1, dx: 0, dy: 0, power: 0 };
        const grnMax = 40 * S;
        
        const grnBg = this.add.graphics().setScrollFactor(0).setDepth(198);
        this._grnKnob = this.add.graphics().setScrollFactor(0).setDepth(199);
        this._grnKnob.setPosition(grnX, grnY);

        const drawGrn = (active) => {
            grnBg.clear();
            grnBg.fillStyle(active ? 0x44cc44 : 0x113311, 0.7);
            grnBg.fillCircle(grnX, grnY, grnR);
            grnBg.lineStyle(2, 0x88ff88, 0.8);
            grnBg.strokeCircle(grnX, grnY, grnR);

            this._grnKnob.clear();
            if (active) {
                this._grnKnob.fillStyle(0xccffcc, 0.9);
                this._grnKnob.fillCircle(0, 0, grnR * 0.4);
            }
            gIcon.setPosition(this._grnKnob.x, this._grnKnob.y - 4*S);
            gTxt.setPosition(this._grnKnob.x, this._grnKnob.y + 12*S);
        };
        const gIcon = this.add.text(grnX, grnY - 4*S, '💣', { fontSize: `${14*S}px` }).setOrigin(0.5).setScrollFactor(0).setDepth(200);
        const gTxt = this.add.text(grnX, grnY + 12*S, 'THROW', { fontFamily: 'Outfit,sans-serif', fontSize: `${7*S}px`, color: '#ccffcc', fontStyle: 'bold' }).setOrigin(0.5).setScrollFactor(0).setDepth(200);
        drawGrn(false);

        const updateGrnJoy = (ptr) => {
            let dx = ptr.x - grnX, dy = ptr.y - grnY;
            let d = Math.sqrt(dx*dx + dy*dy);
            if (d < 8*S) {
                this._grnKnob.setPosition(grnX, grnY);
                this._grenade.dx = 0; this._grenade.dy = 0; this._grenade.power = 0;
            } else {
                if (d > grnMax) { dx = (dx/d)*grnMax; dy = (dy/d)*grnMax; d = grnMax; }
                this._grnKnob.setPosition(grnX + dx, grnY + dy);
                this._grenade.dx = dx / grnMax;
                this._grenade.dy = dy / grnMax;
                this._grenade.power = d / grnMax;
            }
            drawGrn(true);
        };

        this.input.on('pointerdown', (ptr) => {
            if (!this._grenade.active && !this._fire.active && (ptr.x - grnX)**2 + (ptr.y - grnY)**2 < (grnR*2)**2) {
                this._grenade.active = true; this._grenade.ptId = ptr.id;
                this.tweens.add({ targets: [gIcon, gTxt], scaleX: 1.15, scaleY: 1.15, duration: 80 });
                updateGrnJoy(ptr);
            }
        });

        // Shared Pointer Move / Up for Fire and Grenade
        this.input.on('pointermove', (ptr) => {
            if (this._fire.active && ptr.id === this._fire.ptId) {
                updateFireJoy(ptr);
            }
            else if (this._grenade.active && ptr.id === this._grenade.ptId) {
                updateGrnJoy(ptr);
            }
        });

        this.input.on('pointerup', (ptr) => {
            if (this._fire.active && ptr.id === this._fire.ptId) {
                this._fire.active = false; this._fire.ptId = -1;
                this._fire.x = 0; this._fire.y = 0;
                this._fireKnob.setPosition(fireX, fireY);
                drawFireBtn(false);
                this.tweens.add({ targets: [fIcon, fTxt], scaleX: 1, scaleY: 1, duration: 150 });
            }
            if (this._grenade.active && ptr.id === this._grenade.ptId) {
                this._grenade.active = false; this._grenade.ptId = -1;
                this._grenade.dx = 0; this._grenade.dy = 0; this._grenade.power = 0;
                this._grnKnob.setPosition(grnX, grnY);
                drawGrn(false);
                this.tweens.add({ targets: [gIcon, gTxt], scaleX: 1, scaleY: 1, duration: 150 });
            }
        });
    }

    _updateJoyFromPtr(ptr) {
        let dx = ptr.x - this._joyCenter.x, dy = ptr.y - this._joyCenter.y;
        const d = Math.sqrt(dx*dx + dy*dy);
        if (d > this._joyMax) { dx = (dx/d)*this._joyMax; dy = (dy/d)*this._joyMax; }
        
        this._joyKnob.setPosition(this._joyCenter.x + dx, this._joyCenter.y + dy); 
        this._joy.x = dx / this._joyMax; this._joy.y = dy / this._joyMax;
    }

    getJoystickVector()  { return { x: this._joy?.x || 0, y: this._joy?.y || 0 }; }
    
    // Returns {x, y, active} for the Fire Joystick
    getFireAim() { return { x: this._fire?.x || 0, y: this._fire?.y || 0, active: this._fire?.active || false }; }
    
    // Returns {dx, dy, power, active} for Grenade Trajectory
    getGrenadeAim() { return this._grenade; }

    // ═══════════════════════════════════════════
    //  DEATH OVERLAY (Ultra Smooth)
    // ═══════════════════════════════════════════
    _buildDeathOverlay() {
        const W = this.W, H = this.H, S = this.S;
        this._deathOverlay = this.add.container(0, 0).setScrollFactor(0).setDepth(300).setVisible(false);

        // Glassmorphism background
        const bg = this.add.rectangle(W/2, H/2, W, H, 0x000000, 0.85).setInteractive();

        const pW = Math.min(320*S, W - 40), pH = 220*S;
        const panel = this._createUIPanel(W/2 - pW/2, H/2 - pH/2, pW, pH, 0x0a0c1a, 0xff4444, 0.95);

        const title = this.add.text(W/2, H/2 - 70*S, '⚠️ لقد فشلت في الهروب', {
            fontFamily: 'Outfit,sans-serif', fontSize: `${16*S}px`, color: '#ff5555', fontStyle: 'bold'
        }).setOrigin(0.5);

        // Continue button (shown only once)
        this._cBtn = this._createButton(W/2, H/2, 180*S, 40*S, '⚔️', 'أكمل القتال', 'يتابع في مكان آمن', 0x2266ff, () => this._onContinue());
        // Retry button — position changes depending on whether continue is visible
        this._rBtn = this._createButton(W/2, H/2 + 55*S, 180*S, 40*S, '🔄', 'أعد المحاولة', 'معركة جديدة', 0xbb2233, () => this._onRetry());
        this._deathTitle = title;

        this._deathOverlay.add([bg, panel, title, this._cBtn, this._rBtn]);
    }

    _showDeathOverlay() {
        // If continue was already used, hide the continue button and center the retry
        if (this._continueUsed) {
            this._cBtn.setVisible(false);
            this._rBtn.setPosition(this.W/2, this.H/2 + 20*this.S);
        } else {
            this._cBtn.setVisible(true);
            this._rBtn.setPosition(this.W/2, this.H/2 + 55*this.S);
        }
        this._deathOverlay.setVisible(true).setAlpha(0);
        this.tweens.add({ targets: this._deathOverlay, alpha: 1, duration: 400, ease: 'Power2' });

        // Show install banner on first death (delay so death overlay finishes appearing first)
        if (this._installOnDeath && !this._installShown) {
            this.time.delayedCall(800, () => this._showInstallBanner());
        }
    }

    _hideDeathOverlay() {
        this.tweens.add({ targets: this._deathOverlay, alpha: 0, duration: 250, onComplete: () => this._deathOverlay.setVisible(false) });
    }

    _onContinue() {
        this._continueUsed = true; // next death will only show Retry
        this._hideDeathOverlay();
        const gs = this.gameScene;
        if (!gs) return;
        const { grid, width, height } = gs.mazeData;
        const ts = gs.tileSize;
        const candidates = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (grid[y][x] === 1) continue;
                const wx = x*ts + ts/2, wy = y*ts + ts/2;
                let safe = true;
                for (const e of gs.enemies) {
                    if (!e.alive) continue;
                    if ((wx-e.container.x)**2 + (wy-e.container.y)**2 < (ts*8)**2) { safe = false; break; }
                }
                if (safe) candidates.push({ wx, wy });
            }
        }
        const sp = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)]
            : { wx: gs.mazeData.playerSpawn.x*ts+ts/2, wy: gs.mazeData.playerSpawn.y*ts+ts/2 };

        const pl = gs.player;
        pl.container.setPosition(sp.wx, sp.wy);
        pl.health = pl.maxHealth * 0.5;
        pl.alive = true; pl.container.setAlpha(1); pl.container.body.enable = true;
        gs.events.emit('healthChanged', pl.health);
        gs._emitHUDUpdate();
        
        this.cameras.main.flash(400, 100, 200, 255);
    }

    _onRetry() {
        this._hideDeathOverlay();
        this.cameras.main.fadeOut(300, 0, 0, 0);
        this.time.delayedCall(300, () => {
            this.scene.stop('HUDScene');
            this.scene.stop('GameScene');
            this.scene.start('BootScene');
        });
    }

    // ═══════════════════════════════════════════
    //  EVENTS & MINIMAP (unchanged logic, clean UI)
    // ═══════════════════════════════════════════
    _setupEvents() {
        if (!this.gameScene) return;
        this.gameScene.events.on('hudUpdate', d => this._onHUDUpdate(d));
        this.gameScene.events.on('waveStart', d => {
            this.waveText.setText(`WAVE ${d.wave}`);
            this.tweens.add({ targets: this.waveText, scaleX: 1.4, scaleY: 1.4, duration: 300, yoyo: true });
        });
        this.gameScene.events.on('inventoryChanged', inv => this._buildDynamicSidebar(inv, this.gameScene.player?.keysCollected || 0));
        this.gameScene.events.on('keysChanged', keys => {
            this.keyText.setText(`${keys}/10`);
            this.tweens.add({ targets: this.keyText, scaleX: 1.5, scaleY: 1.5, yoyo: true, duration: 200 });
            this._buildDynamicSidebar(this.gameScene.player?._getInventoryState(), keys);
        });
        this.gameScene.events.on('playerDied', () => this._showDeathOverlay());
        this.gameScene.events.on('playerWon',  () => this._showWinOverlay());
        this.gameScene.events.on('botWon',      d  => this._showBotWinOverlay(d?.name || 'منافس مجهول'));
    }

    _showWinOverlay() {
        if (this._gameEndShown) return;
        this._gameEndShown = true;
        const W = this.W, H = this.H, S = this.S;

        const bg = this.add.rectangle(W/2, H/2, W, H, 0x000000, 0.85).setScrollFactor(0).setDepth(350).setInteractive();
        const pW = Math.min(320*S, W-40), pH = 220*S;
        this._createUIPanel(W/2 - pW/2, H/2 - pH/2, pW, pH, 0x061a0e, 0x44ff88, 0.96).setDepth(351);

        this.add.text(W/2, H/2 - 70*S, '🏆 أنت حر!', {
            fontFamily: 'Outfit, sans-serif', fontSize: `${20*S}px`, color: '#44ff88', fontStyle: 'bold'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(352);

        this.add.text(W/2, H/2 - 30*S, 'لقد فتحت البوابة وهربت من المتاهة!', {
            fontFamily: 'Outfit, sans-serif', fontSize: `${10*S}px`, color: '#ccffee'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(352);

        const btn = this._createButton(W/2, H/2 + 45*S, 180*S, 40*S, '🔄', 'العب مجدداً', '', 0x226633, () => {
            this._gameEndShown = false;
            this.scene.stop('HUDScene');
            this.scene.stop('GameScene');
            this.scene.start('BootScene');
        });
        btn.setDepth(352);

        this.cameras.main.flash(600, 68, 255, 136);
    }

    _showBotWinOverlay(botName) {
        if (this._gameEndShown) return;
        this._gameEndShown = true;
        const W = this.W, H = this.H, S = this.S;

        const bg = this.add.rectangle(W/2, H/2, W, H, 0x000000, 0.87).setScrollFactor(0).setDepth(350).setInteractive();
        const pW = Math.min(340*S, W-40), pH = 240*S;
        this._createUIPanel(W/2 - pW/2, H/2 - pH/2, pW, pH, 0x1a0608, 0xff4444, 0.96).setDepth(351);

        this.add.text(W/2, H/2 - 80*S, '❌ خسرت!', {
            fontFamily: 'Outfit, sans-serif', fontSize: `${20*S}px`, color: '#ff5555', fontStyle: 'bold'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(352);

        this.add.text(W/2, H/2 - 40*S, `لقد نجح ${botName} بالفرار`, {
            fontFamily: 'Outfit, sans-serif', fontSize: `${11*S}px`, color: '#ffaaaa'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(352);

        this.add.text(W/2, H/2 - 10*S, 'تعفّن في المتاهة أيها السجين.', {
            fontFamily: 'Outfit, sans-serif', fontSize: `${9*S}px`, color: '#ff8888',
            wordWrap: { width: pW - 30 }
        }).setOrigin(0.5).setScrollFactor(0).setDepth(352);

        const btn = this._createButton(W/2, H/2 + 60*S, 180*S, 40*S, '🔄', 'أعد المحاولة', '', 0xbb2233, () => {
            this._gameEndShown = false;
            this.scene.stop('HUDScene');
            this.scene.stop('GameScene');
            this.scene.start('BootScene');
        });
        btn.setDepth(352);

        this.cameras.main.shake(400, 0.012);
        this.cameras.main.flash(400, 200, 30, 30);
    }

    _onHUDUpdate(data) {
        const ratio = Math.max(0, data.health / data.maxHealth);
        this.healthBarFill.clear();
        this.healthBarFill.fillStyle(ratio > 0.6 ? 0x44cc66 : ratio > 0.3 ? 0xffaa00 : 0xff3333, 1);
        this.healthBarFill.fillRoundedRect(this._hpBarX, this._hpBarY, this._hpBarW * ratio, this._hpBarH, 3*this.S);
        
        this.coinText.setText((data.coins||0).toString());
        this.killText.setText((data.kills||0).toString());
        if (data.keys) this.keyText.setText(`${data.keys.collected || 0}/10`);
        if (data.wave > 0) this.waveText.setText(`WAVE ${data.wave}`);
        if (data.inventory) Object.assign(this, { _cachedInv: data.inventory });
        this._buildDynamicSidebar(data.inventory, data.keys ? data.keys.collected : 0);
    }

    _buildMinimap() {
        const S = this.S;
        const size = Math.min(110*S, 150);
        const mx = 6*S, my = 38*S;

        this._createUIPanel(mx-2, my-2, size+4, size+4, 0x050711, 0x4488ff, 0.9).setDepth(199);
        this.minimapRT = this.add.renderTexture(mx, my, size, size).setScrollFactor(0).setDepth(200).setOrigin(0,0);
        this._mapSize = size; this._mapX = mx;

        // Legend button
        const lBtn = this._createButton(mx + size/2, my + size + 16*S, size, 22*S, '🔍', 'دليل خريطة', '', 0x334466, () => this._toggleLegend());
        lBtn.setDepth(200);

        this.time.addEvent({ delay: 150, loop: true, callback: () => this._drawMinimap() });
    }

    _drawMinimap() {
        const data = this.gameScene?.getMinimapData();
        if (!data?.maze) return;
        const rt = this.minimapRT; rt.clear();
        const sc = this._mapSize / (data.maze.width * data.tileSize);
        const gfx = this.make.graphics({ add: false });
        // White background (paths)
        gfx.fillStyle(0xfbfbfb, 1); gfx.fillRect(0, 0, this._mapSize, this._mapSize);

        for (let y = 0; y < data.maze.height; y++) {
            for (let x = 0; x < data.maze.width; x++) {
                const px = x*data.tileSize*sc, py = y*data.tileSize*sc, sz = Math.max(1.5, data.tileSize*sc);
                // Black walls
                if (data.maze.grid[y]?.[x] === 1) { gfx.fillStyle(0x111111, 1); gfx.fillRect(px, py, sz, sz); }
            }
        }
        if (data.portal) { gfx.fillStyle(0x00ff88, 1); gfx.fillCircle(data.portal.x*sc, data.portal.y*sc, 4); }
        gfx.fillStyle(0xffd700, 1); for(const k of (data.keys||[])) gfx.fillCircle(k.x*sc, k.y*sc, 3);
        gfx.fillStyle(0x44cc66, 1); for(const p of (data.healthPickups||[])) gfx.fillRect(p.x*sc-1.5, p.y*sc-1.5, 4, 4);
        gfx.fillStyle(0xffaa00, 1); for(const p of (data.ammoPickups||[])) gfx.fillRect(p.x*sc-1.5, p.y*sc-1.5, 4, 4);
        gfx.fillStyle(0xff88ff, 1); for(const p of (data.grenadePickups||[])) gfx.fillCircle(p.x*sc, p.y*sc, 2);
        gfx.fillStyle(0xff3333, 1); for(const e of (data.enemies||[])) gfx.fillRect(e.x*sc-2, e.y*sc-2, 4, 4);
        
        if (data.wormholes) {
            for (const wh of data.wormholes) {
                gfx.fillStyle(wh.color, 1);
                gfx.fillCircle(wh.x*sc, wh.y*sc, 3.5);
                gfx.lineStyle(1, 0x000000, 0.8);
                gfx.strokeCircle(wh.x*sc, wh.y*sc, 3.5);
            }
        }
        
        if (data.playerPos) { gfx.fillStyle(0x44ddff, 1); gfx.fillCircle(data.playerPos.x*sc, data.playerPos.y*sc, 3.5); }
        rt.draw(gfx); gfx.destroy();
    }

    _toggleLegend() {
        if (this._legendVisible) {
            if (this._legendPanel) { this._legendPanel.destroy(); this._legendPanel = null; }
            this._legendVisible = false; return;
        }
        this._legendVisible = true;
        const S = this.S;
        const w = 140*S;
        const rowH = 18*S;
        const pad = 10*S;
        const titleH = 20*S;
        const totalH = pad + titleH + LEGEND.length * rowH + pad;
        const lx = this._mapX + this._mapSize + 10*S;
        const ly = 38*S;

        const container = this.add.container(0, 0).setScrollFactor(0).setDepth(300);

        // Click-away backdrop (transparent, full-screen)
        const backdrop = this.add.rectangle(this.W/2, this.H/2, this.W, this.H, 0x000000, 0)
            .setInteractive().setScrollFactor(0);
        backdrop.on('pointerdown', () => this._toggleLegend());
        container.add(backdrop);

        container.add(this._createUIPanel(lx, ly, w, totalH, 0x080c1a, 0x44aaff, 0.97));

        // Title
        container.add(this.add.text(lx + w/2, ly + pad, 'دليل الألوان', {
            fontFamily: '"Outfit", "Tajawal", sans-serif',
            fontSize: `${11*S}px`,
            color: '#44aaff',
            fontStyle: 'bold',
        }).setOrigin(0.5, 0).setScrollFactor(0));

        // Divider
        const divG = this.add.graphics().setScrollFactor(0);
        divG.lineStyle(1, 0x44aaff, 0.25);
        divG.lineBetween(lx + 8*S, ly + pad + titleH + 2*S, lx + w - 8*S, ly + pad + titleH + 2*S);
        container.add(divG);

        LEGEND.forEach((it, i) => {
            const iy = ly + pad + titleH + 8*S + i * rowH;
            // Dot
            const dot = this.add.circle(lx + 14*S, iy + rowH/2, 5*S, it.color).setScrollFactor(0);
            // Label — bigger, bolder, Arabic-friendly
            const lbl = this.add.text(lx + 26*S, iy + rowH/2, it.label, {
                fontFamily: '"Outfit", "Tajawal", sans-serif',
                fontSize: `${10*S}px`,
                color: '#e0eaff',
                fontStyle: 'normal',
                resolution: 2,
            }).setOrigin(0, 0.5).setScrollFactor(0);
            container.add([dot, lbl]);
        });

        this._legendPanel = container;
    }

    // ═══════════════════════════════════════════
    //  PWA INSTALL PROMPT
    // ═══════════════════════════════════════════
    _scheduleInstallPrompt() {
        this._installShown = false;

        // Trigger after 60 seconds of play
        this._installTimer = this.time.delayedCall(60000, () => {
            if (!this._installShown) this._showInstallBanner();
        });

        // Also trigger on first death (fires via _showDeathOverlay)
        this._installOnDeath = true;
    }

    _showInstallBanner() {
        if (this._installShown) return;
        this._installShown = true;

        const W = this.W, S = this.S;
        const bannerH = 52*S, bannerW = Math.min(350*S, W - 20*S);
        const bx = W/2; const by = this.H - bannerH/2 - 30*S;

        const cont = this.add.container(bx, this.H + bannerH).setScrollFactor(0).setDepth(350);

        // Background
        const bg = this.add.graphics();
        bg.fillStyle(0x051a3a, 0.97);
        bg.fillRoundedRect(-bannerW/2, -bannerH/2, bannerW, bannerH, 14*S);
        bg.lineStyle(2, 0x44aaff, 0.7);
        bg.strokeRoundedRect(-bannerW/2, -bannerH/2, bannerW, bannerH, 14*S);

        // Icon + text
        const icon = this.add.text(-bannerW/2 + 18*S, 0, '📲', { fontSize: `${18*S}px` }).setOrigin(0, 0.5);
        const label = this.add.text(-bannerW/2 + 44*S, -6*S, 'ثبّت اللعبة على هاتفك', {
            fontFamily: 'Outfit,sans-serif', fontSize: `${10*S}px`, color: '#44aaff', fontStyle: 'bold',
        }).setOrigin(0, 0.5);
        const sub = this.add.text(-bannerW/2 + 44*S, 7*S, 'العب بدون متصفح كتطبيق مستقل', {
            fontFamily: 'Outfit,sans-serif', fontSize: `${7.5*S}px`, color: '#7899bb',
        }).setOrigin(0, 0.5);

        // Install button
        const btnW = 70*S, btnH = 32*S;
        const btnBg = this.add.graphics();
        btnBg.fillStyle(0x2266ff, 1);
        btnBg.fillRoundedRect(bannerW/2 - btnW - 30*S, -btnH/2, btnW, btnH, 8*S);
        const btnLbl = this.add.text(bannerW/2 - 30*S - btnW/2, 0, 'تثبيت', {
            fontFamily: 'Outfit,sans-serif', fontSize: `${10*S}px`, color: '#fff', fontStyle: 'bold',
        }).setOrigin(0.5);

        // Dismiss ×
        const dismiss = this.add.text(bannerW/2 - 10*S, -bannerH/2 + 6*S, '×', {
            fontFamily: 'Outfit,sans-serif', fontSize: `${13*S}px`, color: '#7899bb',
        }).setOrigin(1, 0).setInteractive({ cursor: 'pointer' });
        dismiss.on('pointerdown', () => this._hideInstallBanner(cont));

        // Click install area
        const hitBtn = this.add.rectangle(bannerW/2 - 30*S - btnW/2, 0, btnW, btnH, 0, 0).setInteractive({ cursor: 'pointer' });
        hitBtn.on('pointerdown', async () => {
            if (pwaInstallManager.canInstall) {
                await pwaInstallManager.showPrompt();
                this._hideInstallBanner(cont);
            } else {
                // Fallback for when PWA native prompt isn't available (e.g. testing locally over wifi without HTTPS)
                label.setText('افتح قائمة المتصفح (⋮)');
                sub.setText('ثم اختر "الإضافة إلى الشاشة الرئيسية"');
                label.setColor('#ffd700');
                btnLbl.setText('👌 فهمت');
                hitBtn.removeAllListeners('pointerdown');
                hitBtn.on('pointerdown', () => this._hideInstallBanner(cont));
            }
        });

        cont.add([bg, icon, label, sub, btnBg, btnLbl, dismiss, hitBtn]);

        // Slide in
        this.tweens.add({ targets: cont, y: by, duration: 400, ease: 'Back.Out' });

        // Pulse glow on the button
        this.tweens.add({ targets: btnBg, alpha: 0.7, duration: 600, yoyo: true, repeat: -1 });

        // Auto dismiss after 15s
        this.time.delayedCall(15000, () => this._hideInstallBanner(cont));
    }

    _hideInstallBanner(cont) {
        if (!cont || !cont.scene) return;
        this.tweens.add({
            targets: cont, y: this.H + 100, duration: 300, ease: 'Power2',
            onComplete: () => { if (cont.scene) cont.destroy(); },
        });
    }
}
