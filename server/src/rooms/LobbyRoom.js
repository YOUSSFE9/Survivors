const colyseus = require('colyseus');

class LobbyRoom extends colyseus.Room {
    onCreate() {
        this.onMessage('ping', (client) => client.send('pong'));
    }
    onJoin(client) { client.send('lobby_ready', { modes: ['duel', 'squad', 'war'] }); }
    onLeave() {}
    onDispose() {}
}
module.exports = { LobbyRoom };
