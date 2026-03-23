/**
 * NetworkManager — Colyseus client layer.
 * Single class managing the connection, room joining, and message routing.
 *
 * Usage:
 *   const net = new NetworkManager();
 *   await net.connect();
 *   const room = await net.joinOrCreate('war', { uid, name });
 *   room.onStateChange(state => { ... });
 */
import { Client, Room } from 'colyseus.js';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:2567';

class NetworkManager {
    private client: Client | null = null;
    public room: Room | null = null;
    public sessionId: string = '';
    public connected = false;

    connect() {
        if (!this.client) {
            this.client = new Client(SERVER_URL);
            this.connected = true;
        }
        return this;
    }

    isAvailable(): boolean {
        return !!this.client;
    }

    /**
     * Join or create a room.
     * @param roomType 'duel' | 'squad' | 'war'
     * @param options  { uid, name, roomCode? }
     */
    async joinOrCreate(
        roomType: 'duel' | 'squad' | 'war',
        options: { uid: string; name: string; roomCode?: string; reqTeam?: string }
    ): Promise<Room> {
        if (!this.client) this.connect();

        this.room = roomType === 'squad' && options.roomCode
            ? await this.client!.joinById(options.roomCode, options)
            : await this.client!.joinOrCreate(roomType, options);

        this.sessionId = this.room.sessionId;
        console.log(`[NetworkManager] Joined "${roomType}" — session: ${this.sessionId}`);
        return this.room;
    }

    /** Create a private squad room and return its ID for sharing. */
    async createPrivateRoom(options: { uid: string; name: string }): Promise<{ room: Room; roomId: string }> {
        if (!this.client) this.connect();
        const room = await this.client!.create('squad', options);
        this.room = room;
        this.sessionId = room.sessionId;
        // The room ID can be used as an invite code
        const roomId = (room as any).id as string;
        console.log(`[NetworkManager] Created private squad — roomId: ${roomId}`);
        return { room, roomId };
    }

    /** Send player input (called every animation frame, throttled internally). */
    sendInput(dx: number, dy: number, rotation: number) {
        this.room?.send('input', { dx, dy, rotation });
    }

    /** Send shoot event. */
    sendShoot(vx: number, vy: number, damage: number, isExplosive = false) {
        this.room?.send('shoot', { vx, vy, damage, isExplosive });
    }

    /** Send key pickup event. */
    sendPickupKey(keyId: string) {
        this.room?.send('pickup_key', { keyId });
    }

    /** Send portal enter event. */
    sendEnterPortal() {
        this.room?.send('enter_portal');
    }

    /** Mark player as ready (1v1 / squad lobby). */
    sendReady() {
        this.room?.send('ready');
    }

    async leave() {
        await this.room?.leave();
        this.room = null;
        this.sessionId = '';
    }

    destroy() {
        this.leave();
        this.client = null;
        this.connected = false;
    }
}

// Singleton — one connection per tab
export const network = new NetworkManager();
