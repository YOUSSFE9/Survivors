/**
 * NetworkManager — Colyseus client layer.
 * Manages connection, room joining, and message routing.
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

    isAvailable(): boolean { return !!this.client; }

    /**
     * Join or create a room.
     * For duel/war: uses joinOrCreate.
     * For squad with roomCode: joins by ID.
     * For duel with roomCode: joins by ID.
     */
    async joinOrCreate(
        roomType: 'duel' | 'squad' | 'war',
        options: { uid: string; name: string; roomCode?: string; reqTeam?: string }
    ): Promise<Room> {
        if (!this.client) this.connect();

        if (options.roomCode) {
            // Join by room code (works for both duel friend and squad)
            this.room = await this.client!.joinById(options.roomCode, options);
        } else {
            this.room = await this.client!.joinOrCreate(roomType, options);
        }

        this.sessionId = this.room.sessionId;
        console.log(`[NetworkManager] Joined "${roomType}" — session: ${this.sessionId}`);
        return this.room;
    }

    /**
     * Create a private room for any mode (duel or squad).
     * Returns the room + roomId for sharing as invite code.
     */
    async createPrivateRoom(
        roomType: 'duel' | 'squad',
        options: { uid: string; name: string; reqTeam?: string }
    ): Promise<{ room: Room; roomId: string }> {
        if (!this.client) this.connect();
        const room = await this.client!.create(roomType, options);
        this.room = room;
        this.sessionId = room.sessionId;
        const roomId = (room as any).id as string;
        console.log(`[NetworkManager] Created private ${roomType} — roomId: ${roomId}`);
        return { room, roomId };
    }

    sendInput(dx: number, dy: number, rotation: number) {
        this.room?.send('input', { dx, dy, rotation });
    }

    sendShoot(vx: number, vy: number, damage: number, isExplosive = false) {
        this.room?.send('shoot', { vx, vy, damage, isExplosive });
    }

    sendPickupKey(keyId: string) {
        this.room?.send('pickup_key', { keyId });
    }

    sendEnterPortal() {
        this.room?.send('enter_portal');
    }

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

export const network = new NetworkManager();
