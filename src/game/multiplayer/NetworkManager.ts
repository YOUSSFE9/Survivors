/**
 * NetworkManager — Socket.IO client layer.
 * Drop-in replacement for the old Colyseus version.
 * Provides the same API: connect(), joinOrCreate(), createPrivateRoom(), leave().
 * Returns a SocketRoom object with onMessage(), send(), sessionId, id — like Colyseus Room.
 */
import { io, Socket } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'https://daht-server.onrender.com';

/**
 * SocketRoom wraps a socket connection and mimics the Colyseus Room interface
 * so OnlineLobby.tsx and OnlineSync.ts work without changes.
 */
class SocketRoom {
    public sessionId: string = '';
    public id: string = '';
    private _socket: Socket;
    private _handlers: Map<string, Function[]> = new Map();

    constructor(socket: Socket, sessionId: string, roomId: string) {
        this._socket = socket;
        this.sessionId = sessionId;
        this.id = roomId;
    }

    /** Register a handler for a server message — same API as Colyseus room.onMessage() */
    onMessage(type: string, handler: (data: any) => void) {
        // Store for cleanup
        if (!this._handlers.has(type)) this._handlers.set(type, []);
        this._handlers.get(type)!.push(handler);
        // Register on socket
        this._socket.on(type, handler);
    }

    /** Send a message to the server — same API as Colyseus room.send() */
    send(type: string, data?: any) {
        this._socket.emit(type, data);
    }

    /** Register error handler */
    onError(handler: (code: number, msg: string) => void) {
        this._socket.on('connect_error', (err: any) => handler(0, err.message));
    }

    /** Leave the room */
    async leave() {
        this._socket.emit('leave_room');
        // Remove all handlers
        for (const [type, handlers] of this._handlers) {
            for (const h of handlers) this._socket.off(type, h as any);
        }
        this._handlers.clear();
    }
}

class NetworkManager {
    private socket: Socket | null = null;
    public room: SocketRoom | null = null;
    public sessionId: string = '';
    public connected = false;
    public gameStartedData: any = null;

    connect() {
        if (!this.socket) {
            this.socket = io(SERVER_URL, {
                transports: ['websocket', 'polling'],
                autoConnect: true,
            });
            this.connected = true;
            this.socket.on('connect', () => {
                console.log(`[NetworkManager] Connected: ${this.socket?.id}`);
            });
            this.socket.on('disconnect', () => {
                console.log('[NetworkManager] Disconnected');
            });
        }
        return this;
    }

    isAvailable(): boolean { return !!this.socket?.connected; }

    /**
     * Join or create a room.
     */
    async joinOrCreate(
        roomType: 'duel' | 'squad' | 'war',
        options: { uid: string; name: string; avatarUrl?: string; roomCode?: string; reqTeam?: string }
    ): Promise<SocketRoom> {
        if (!this.socket) this.connect();

        if (!this.socket!.connected) {
            await new Promise<void>((resolve) => {
                this.socket!.once('connect', () => resolve());
            });
        }

        return new Promise((resolve, reject) => {
            this.socket!.emit('join_room', { roomType, ...options }, (response: any) => {
                if (response?.error) {
                    reject(new Error(response.error));
                    return;
                }
                const room = new SocketRoom(this.socket!, response.sessionId, response.roomId);
                this.room = room;
                this.sessionId = response.sessionId;
                console.log(`[NetworkManager] Joined "${roomType}" — session: ${this.sessionId}`);
                resolve(room);
            });
        });
    }

    /**
     * Create a private room.
     */
    async createPrivateRoom(
        roomType: 'duel' | 'squad',
        options: { uid: string; name: string; avatarUrl?: string; reqTeam?: string }
    ): Promise<{ room: SocketRoom; roomId: string }> {
        if (!this.socket) this.connect();

        if (!this.socket!.connected) {
            await new Promise<void>((resolve) => {
                this.socket!.once('connect', () => resolve());
            });
        }

        return new Promise((resolve, reject) => {
            this.socket!.emit('join_room', { roomType, ...options, isPrivate: true }, (response: any) => {
                if (response?.error) {
                    reject(new Error(response.error));
                    return;
                }
                const room = new SocketRoom(this.socket!, response.sessionId, response.roomId);
                this.room = room;
                this.sessionId = response.sessionId;
                const roomId = response.roomId;
                console.log(`[NetworkManager] Created private ${roomType} — roomId: ${roomId}`);
                resolve({ room, roomId });
            });
        });
    }

    sendInput(dx: number, dy: number, rotation: number) {
        this.socket?.emit('input', { dx, dy, rotation });
    }

    sendShoot(vx: number, vy: number, damage: number, isExplosive = false) {
        this.socket?.emit('shoot', { vx, vy, damage, isExplosive });
    }

    sendPickupKey(keyId: string) {
        this.socket?.emit('pickup_key', { keyId });
    }

    sendEnterPortal() {
        this.socket?.emit('enter_portal');
    }

    sendReady() {
        this.socket?.emit('ready');
    }

    async leave() {
        await this.room?.leave();
        this.room = null;
        this.sessionId = '';
    }

    destroy() {
        this.leave();
        this.socket?.disconnect();
        this.socket = null;
        this.connected = false;
    }
}

export const network = new NetworkManager();
