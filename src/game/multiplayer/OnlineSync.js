/**
 * OnlineSync — Manages the Socket.IO room connection inside GameScene.
 * Handles the broadcast protocol from the server:
 *   state_tick  → sent every 50ms with player/monster positions
 *   game_started / game_over / portal_spawned / key_collected
 * Sends: input, shoot, pickup_key, enter_portal, ready
 */
import { network } from './NetworkManager';
import { RemotePlayer } from '../entities/RemotePlayer';

const INPUT_RATE = 50; // 20 Hz

export class OnlineSync {
    constructor(scene) {
        this.scene = scene;
        this.room = null;
        this.remotePlayers = new Map();  // sessionId → RemotePlayer
        this.remoteMonsters = new Map(); // id → { sprite, hpBar, maxHealth }
        this.lastInputSent = 0;
        this.mySessionId = null;

        // Scene callbacks
        this.onGameOver = null;
        this.onPortalSpawned = null;
        this.onKeyCollected = null;
        this.onPickupCollected = null;
    }

    async joinRoom(mode, options) {
        this.mySessionId = null;
        this.room = await network.joinOrCreate(mode, options);
        this.mySessionId = this.room.sessionId;
        this._registerHandlers();
        return this.room;
    }

    /** Attach an already-joined room (from OnlineLobby) instead of joining a new one */
    attachRoom(room) {
        this.room = room;
        this.mySessionId = room.sessionId;
        console.log('[OnlineSync] attachRoom — mySessionId:', this.mySessionId);
        this._registerHandlers();

        // Replay gameData from NetworkManager to spawn players immediately
        if (network.gameStartedData?.players) {
            console.log('[OnlineSync] Replaying gameStartedData:', network.gameStartedData.players.length, 'players');
            for (const p of network.gameStartedData.players) {
                if (p.sessionId !== this.mySessionId) {
                    console.log('[OnlineSync] Creating remote from replay:', p.sessionId, p.name);
                    this._upsertRemote(p.sessionId, p);
                }
            }
        } else {
            console.log('[OnlineSync] No gameStartedData available for replay');
        }
    }

    // ══════════════════════════
    //  SERVER → CLIENT handlers
    // ══════════════════════════
    _registerHandlers() {
        // Full state on first join
        this.room.onMessage('state_full', (gs) => {
            for (const [sid, p] of Object.entries(gs.players)) {
                if (sid === this.mySessionId) continue;
                this._upsertRemote(sid, p);
            }
        });

        // Compact tick updates (20 Hz)
        let tickCount = 0;
        this.room.onMessage('state_tick', (data) => {
            tickCount++;
            if (tickCount <= 3 || tickCount % 60 === 0) {
                console.log(`[OnlineSync] state_tick #${tickCount}:`, Object.keys(data.players || {}), 'monsters:', Object.keys(data.monsters || {}).length);
            }
            // ── Sync LOCAL player position and state from server (server-authoritative) ──
            const myState = data.players?.[this.mySessionId];
            const player = this.scene.player;
            if (myState && player) {
                // Always check alive state, even when player is currently dead
                if (typeof myState.alive === 'boolean' && myState.alive !== player.alive) {
                    if (!myState.alive) {
                        player.die();
                    } else {
                        // Respawn: snap to server-given position first, then revive
                        player.container.setPosition(myState.x, myState.y);
                        if (player.container.body) player.container.body.reset(myState.x, myState.y);
                        player.respawn();
                    }
                }

                // Only update position and health when alive
                if (player.alive) {
                    const cx = player.container.x;
                    const cy = player.container.y;
                    const ddx = myState.x - cx;
                    const ddy = myState.y - cy;
                    const drift2 = ddx * ddx + ddy * ddy;
                    if (drift2 > 10000) { // > 100px: hard snap
                        player.container.setPosition(myState.x, myState.y);
                        if (player.container.body) player.container.body.reset(myState.x, myState.y);
                    } else if (drift2 > 25) { // > 5px: soft correction
                        const lx = cx + ddx * 0.12;
                        const ly = cy + ddy * 0.12;
                        player.container.setPosition(lx, ly);
                        if (player.container.body) player.container.body.reset(lx, ly);
                    }
                    if (typeof myState.health === 'number') player.health = myState.health;
                }
            }

            // ── Update remote players ──
            for (const [sid, upd] of Object.entries(data.players || {})) {
                if (sid === this.mySessionId) continue;
                const rp = this.remotePlayers.get(sid);
                if (rp) {
                    rp.applyState(upd);
                } else {
                    this._upsertRemote(sid, upd);
                }
            }

            // ── Update remote monsters ──
            for (const [id, m] of Object.entries(data.monsters || {})) {
                this._upsertMonster(id, m);
            }
            // Remove monsters no longer in tick
            for (const [id, rm] of this.remoteMonsters.entries()) {
                if (!data.monsters?.[id]) {
                    rm.sprite.destroy();
                    rm.hpBar.destroy();
                    this.remoteMonsters.delete(id);
                }
            }
        });

        // New player joined mid-game
        this.room.onMessage('player_joined', (p) => {
            if (p.sessionId !== this.mySessionId) this._upsertRemote(p.sessionId, p);
        });

        // Player left
        this.room.onMessage('player_left', (sid) => {
            const rp = this.remotePlayers.get(sid);
            if (rp) {
                rp.destroy();
                this.remotePlayers.delete(sid);
            }
        });

        // Authoritative teleport (Wormholes)
        this.room.onMessage('teleport', (data) => {
            const isMe = data.sessionId === this.mySessionId;
            const target = isMe ? this.scene.player : this.remotePlayers.get(data.sessionId);
            if (!target || !target.container) return;

            // Visual effect
            const color = data.color || 0xffffff;
            const container = target.container;

            // Fade out → snap → fade in
            this.scene.tweens.killTweensOf(container);
            this.scene.tweens.add({
                targets: container, alpha: 0, duration: 150,
                onComplete: () => {
                    container.setPosition(data.x, data.y);
                    if (container.body) container.body.reset(data.x, data.y);
                    
                    if (isMe) {
                        this.scene.cameras.main.flash(200, color >> 16, (color >> 8) & 0xff, color & 0xff, false);
                        this.scene.cameras.main.shake(150, 0.005);
                    }

                    // Burst effect
                    const ring = this.scene.add.circle(data.x, data.y, 8, color, 0.9).setDepth(25);
                    this.scene.tweens.add({ targets: ring, scale: 5, alpha: 0, duration: 400, onComplete: () => ring.destroy() });
                    
                    container.setAlpha(1);
                }
            });
        });

        // Game events
        this.room.onMessage('game_started', (data) => {
            if (data.players) {
                for (const p of data.players) {
                    if (p.sessionId !== this.mySessionId) this._upsertRemote(p.sessionId, p);
                }
            }
        });

        this.room.onMessage('game_over', (data) => {
            this.onGameOver?.(data);
        });

        // War: sent only to the eliminated player — the game continues for others
        this.room.onMessage('player_eliminated', (data) => {
            this.onGameOver?.({ ...data, isEliminated: true });
        });

        this.room.onMessage('portal_spawned', (pos) => {
            this.onPortalSpawned?.(pos);
        });

        this.room.onMessage('key_collected', (data) => {
            this.onKeyCollected?.(data);
        });

        this.room.onMessage('pickup_collected', (data) => {
            this.onPickupCollected?.(data);
        });

        this.room.onError((code, msg) => {
            console.error('[OnlineSync] error', code, msg);
        });
    }

    _upsertRemote(sessionId, p) {
        if (this.remotePlayers.has(sessionId)) {
            this.remotePlayers.get(sessionId).applyState(p);
            return;
        }
        const rp = new RemotePlayer(
            this.scene, sessionId,
            p.x || 0, p.y || 0,
            p.name || 'Player',
            p.team || 'none',
            p.tint || 0xffffff
        );
        rp.applyState(p);
        this.remotePlayers.set(sessionId, rp);
    }

    _upsertMonster(id, m) {
        let obj = this.remoteMonsters.get(id);
        if (!obj) {
            const type = m.type || 'zombie';
            const sprite = this.scene.add.image(m.x, m.y, type)
                .setDisplaySize(36, 36).setDepth(8);
            const hpBar = this.scene.add.rectangle(m.x, m.y - 22, 28, 4, 0xff3333).setDepth(9);
            obj = { sprite, hpBar, maxHealth: m.health };
            this.remoteMonsters.set(id, obj);
        }
        obj.sprite.setPosition(m.x, m.y).setVisible(m.alive);
        obj.hpBar.setPosition(m.x, m.y - 22).setVisible(m.alive);
        obj.hpBar.scaleX = Math.max(0, m.health / obj.maxHealth);
    }

    // ══════════════════════════
    //  CLIENT → SERVER (20 Hz)
    // ══════════════════════════
    sendInput(dx, dy, rotation) {
        if (this.room) this.room.send('input', { dx, dy, rotation });
    }

    sendShoot(vx, vy, damage, isExplosive = false) {
        network.sendShoot(vx, vy, damage, isExplosive);
    }

    sendPickupKey(keyId) { network.sendPickupKey(keyId); }
    sendEnterPortal()   { network.sendEnterPortal(); }
    sendReady()         { network.sendReady(); }

    // ══════════════════════════
    //  UPDATE (every Phaser frame)
    // ══════════════════════════
    update() {
        for (const rp of this.remotePlayers.values()) rp.update();
    }

    destroy() {
        for (const rp of this.remotePlayers.values()) rp.destroy();
        this.remotePlayers.clear();
        for (const rm of this.remoteMonsters.values()) {
            rm.sprite.destroy();
            rm.hpBar.destroy();
        }
        this.remoteMonsters.clear();
        network.leave();
    }
}
