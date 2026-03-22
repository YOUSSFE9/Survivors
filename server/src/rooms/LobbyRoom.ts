/**
 * LobbyRoom — Matchmaking hub.
 * Clients connect here first to get routed to the right MazeRoom.
 */
import { Room, Client } from 'colyseus';

export class LobbyRoom extends Room {
    onCreate() {
        this.onMessage('find_match', (client, data: { mode: 'duel' | 'squad' | 'war'; roomCode?: string }) => {
            const roomType = data.mode === '1v1' ? 'duel' : data.mode;
            // Let Colyseus matchmaking find or create a room
            client.send('match_found', { roomType, roomCode: data.roomCode || null });
        });
    }

    onJoin(client: Client) {
        client.send('lobby_ready', { modes: ['duel', 'squad', 'war'] });
    }
    onLeave(_client: Client) {}
    onDispose() {}
}
