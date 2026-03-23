/**
 * OnlineSync — Manages the Colyseus room connection inside GameScene.
 * Handles the JSON broadcast protocol from the plain-JS server:
 *   state_full  → sent on join with all players/monsters/bullets
 *   state_tick  → sent every 50ms with position diffs
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
        this.remoteMonsters = new Map(); // id → { sprite, hp }
        this.lastInputSent = 0;

        // Scene callbacks
        this.onGameOver = null;
        this.onPortalSpawned = null;
        this.onKeyCollected = null;
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
        this._registerHandlers();

        // Replay gameData from NetworkManager to spawn players immediately
        if (network.gameStartedData?.players) {
            for (const p of network.gameStartedData.players) {
                if (p.sessionId !== this.mySessionId) {
                    this._upsertRemote(p.sessionId, p);
                }
            }
        }
    }

    // ══════════════════════════
    //  SERVER → CLIENT handlers
    // ══════════════════════════
    _registerHandlers() {
        // Full state on first join
        this.room.onMessage('state_full', (gs) => {
            // Recreate all remote players
            for (const [sid, p] of Object.entries(gs.players)) {
                if (sid === this.mySessionId) continue;
                this._upsertRemote(sid, p);
            }
        });

        // Compact tick updates (20 Hz)
        this.room.onMessage('state_tick', (data) => {
            // Update remote players
            for (const [sid, upd] of Object.entries(data.players || {})) {
                if (sid === this.mySessionId) continue;
                const rp = this.remotePlayers.get(sid);
                if (rp) rp.applyState(upd);
            }

            // Update remote monsters
            for (const [id, m] of Object.entries(data.monsters || {})) {
                this._upsertMonster(id, m);
            }
            // Remove dead monsters
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

        // Game events
        this.room.onMessage('game_started', (data) => {
            // Create remote players from list
            if (data.players) {
                for (const p of data.players) {
                    if (p.sessionId !== this.mySessionId) this._upsertRemote(p.sessionId, p);
                }
            }
        });

        this.room.onMessage('game_over', (data) => {
            this.onGameOver?.(data);
        });

        this.room.onMessage('portal_spawned', (pos) => {
            this.onPortalSpawned?.(pos);
        });

        this.room.onMessage('key_collected', (data) => {
            this.onKeyCollected?.(data);
        });

        this.room.onError((code, msg) => {
            console.error('[OnlineSync] error', code, msg);
        });
    }

    _upsertRemote(sessionId, p) {
        if (this.remotePlayers.has(sessionId)) return;
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
        const now = Date.now();
        if (now - this.lastInputSent < INPUT_RATE) return;
        this.lastInputSent = now;
        network.sendInput(dx, dy, rotation);
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
        network.leave();
    }
}
