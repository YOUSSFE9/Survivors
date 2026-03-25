/**
 * RoomManager — Manages online multiplayer rooms via Firebase RTDB.
 * Matchmaking: fills existing rooms before creating new ones.
 * Max 20 players per room.
 */
import { v4 as uuidv4 } from 'uuid';
import {
    db, firebaseEnabled,
    ref, set, onValue, onDisconnect, remove, get, update, serverTimestamp
} from '../../firebase/config';

const MAX_PLAYERS = 20;

export class RoomManager {
    constructor() {
        this.currentRoom = null;
        this.playerId = null;
        this.roomRef = null;
        this.listeners = [];
    }

    async findOrCreateRoom(uid) {
        if (!firebaseEnabled || !db) {
            console.warn('Firebase not available. Cannot create online room.');
            return null;
        }

        this.playerId = uid;

        try {
            // Search for available rooms
            const roomsRef = ref(db, 'rooms');
            const snapshot = await get(roomsRef);

            if (snapshot.exists()) {
                const rooms = snapshot.val();
                for (const [roomId, roomData] of Object.entries(rooms)) {
                    const playerCount = roomData.players ? Object.keys(roomData.players).length : 0;
                    if (playerCount < MAX_PLAYERS && roomData.state === 'waiting') {
                        // Join this room
                        return await this._joinRoom(roomId);
                    }
                }
            }

            // No available room, create new
            return await this._createRoom();
        } catch (e) {
            console.error('Room matchmaking error:', e);
            return null;
        }
    }

    async _createRoom() {
        const roomId = uuidv4().slice(0, 8);
        const roomRef = ref(db, `rooms/${roomId}`);

        await set(roomRef, {
            state: 'waiting',
            createdAt: serverTimestamp(),
            hostId: this.playerId,
            mazeSeed: Math.floor(Math.random() * 999999),
        });

        return this._joinRoom(roomId);
    }

    async _joinRoom(roomId) {
        this.currentRoom = roomId;
        this.roomRef = ref(db, `rooms/${roomId}`);

        const playerRef = ref(db, `rooms/${roomId}/players/${this.playerId}`);

        await set(playerRef, {
            x: 0,
            y: 0,
            rotation: 0,
            health: 100,
            weapon: 'M4',
            alive: true,
            joinedAt: serverTimestamp(),
        });

        // Cleanup on disconnect
        onDisconnect(playerRef).remove();

        // Count players; if enough, start game
        const playersRef = ref(db, `rooms/${roomId}/players`);
        onValue(playersRef, (snap) => {
            const players = snap.val();
            const count = players ? Object.keys(players).length : 0;

            // If 2+ players and room is waiting, could auto start
            if (count >= 2) {
                const stateRef = ref(db, `rooms/${roomId}/state`);
                set(stateRef, 'playing');
            }
        });

        return roomId;
    }

    onPlayerUpdate(callback) {
        if (!this.currentRoom || !firebaseEnabled) return;

        const playersRef = ref(db, `rooms/${this.currentRoom}/players`);
        const unsub = onValue(playersRef, (snap) => {
            const players = snap.val() || {};
            callback(players, this.playerId);
        });

        this.listeners.push(unsub);
    }

    async updatePlayerState(state) {
        if (!this.currentRoom || !this.playerId || !firebaseEnabled) return;

        const playerRef = ref(db, `rooms/${this.currentRoom}/players/${this.playerId}`);
        await update(playerRef, state);
    }

    async leaveRoom() {
        if (!this.currentRoom || !this.playerId || !firebaseEnabled) return;

        const playerRef = ref(db, `rooms/${this.currentRoom}/players/${this.playerId}`);
        await remove(playerRef);

        // Check if room is empty
        const playersRef = ref(db, `rooms/${this.currentRoom}/players`);
        const snap = await get(playersRef);
        if (!snap.exists() || Object.keys(snap.val()).length === 0) {
            // Delete room
            await remove(ref(db, `rooms/${this.currentRoom}`));
        }

        this.currentRoom = null;
        this.roomRef = null;
    }

    getRoomId() {
        return this.currentRoom;
    }

    destroy() {
        this.leaveRoom();
    }
}
