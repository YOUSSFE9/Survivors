/**
 * PlayerSync — Syncs local player state to RTDB and interpolates remote players.
 * Writes at ~15 Hz, reads in real-time via onValue listener.
 */
import {
    db, firebaseEnabled,
    ref, update, onValue
} from '../../firebase/config';

export class PlayerSync {
    constructor(roomId, localUid) {
        this.roomId = roomId;
        this.localUid = localUid;
        this.syncInterval = null;
        this.remotePlayers = {};
        this.onRemoteUpdate = null;
        this.listener = null;
    }

    startSync(getLocalState) {
        if (!firebaseEnabled || !this.roomId) return;

        // Write local state at 15 Hz
        this.syncInterval = setInterval(() => {
            const state = getLocalState();
            if (!state) return;

            const playerRef = ref(db, `rooms/${this.roomId}/players/${this.localUid}`);
            update(playerRef, {
                x: Math.round(state.x),
                y: Math.round(state.y),
                rotation: Math.round(state.rotation * 100) / 100,
                health: state.health,
                weapon: state.weapon,
                alive: state.alive,
                ts: Date.now(),
            }).catch(() => { });
        }, 66); // ~15 Hz

        // Listen for remote player updates
        const playersRef = ref(db, `rooms/${this.roomId}/players`);
        this.listener = onValue(playersRef, (snap) => {
            const players = snap.val() || {};
            const remote = {};

            for (const [uid, data] of Object.entries(players)) {
                if (uid === this.localUid) continue;
                remote[uid] = this._interpolate(uid, data);
            }

            this.remotePlayers = remote;

            if (this.onRemoteUpdate) {
                this.onRemoteUpdate(remote);
            }
        });
    }

    _interpolate(uid, newData) {
        const prev = this.remotePlayers[uid];
        if (!prev) return newData;

        // Simple linear interpolation for smoother movement
        const lerpFactor = 0.3;
        return {
            ...newData,
            x: prev.x + (newData.x - prev.x) * lerpFactor,
            y: prev.y + (newData.y - prev.y) * lerpFactor,
            rotation: newData.rotation,
        };
    }

    stopSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }

    destroy() {
        this.stopSync();
    }
}
