/**
 * DAHT Multiplayer Server — Socket.IO + Express
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { GameRoom } = require('./GameRoom');

const PORT = parseInt(process.env.PORT || '2567');
const app  = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: '*', methods: ['GET','POST'] },
    pingInterval: 10000,
    pingTimeout: 5000,
});

app.get('/', (_req, res) => res.send('DAHT Server OK'));

/* ─── Room registry ─── */
const rooms = new Map();

function findOrCreateRoom(roomType, isPrivate, roomCode) {
    // If joining by code, find that exact room
    if (roomCode) {
        const r = rooms.get(roomCode);
        if (r && r.roomType === roomType) return r;
        // also check if roomCode is a roomId
        for (const [id, room] of rooms) {
            if (id === roomCode && room.roomType === roomType) return room;
        }
        return null; // room not found
    }

    // Find a non-full, non-private room of same type
    if (!isPrivate) {
        for (const [, room] of rooms) {
            if (room.roomType === roomType && !room.isPrivate && !room.isFull() && room.phase === 'lobby') {
                return room;
            }
        }
    }

    // Create new room
    const room = new GameRoom(roomType, isPrivate);
    rooms.set(room.id, room);
    console.log(`[Server] Created room ${room.id} (${roomType}, private=${isPrivate})`);
    return room;
}

function cleanupRoom(roomId) {
    const room = rooms.get(roomId);
    if (room && room.playerCount() === 0) {
        room.dispose();
        rooms.delete(roomId);
        console.log(`[Server] Room ${roomId} disposed (empty)`);
    }
}

io.on('connection', (socket) => {
    console.log(`[Server] Client connected: ${socket.id}`);
    let currentRoom = null;

    /* ── JOIN OR CREATE ── */
    socket.on('join_room', (data, ack) => {
        try {
            const { roomType, uid, name, avatarUrl, roomCode, reqTeam, isPrivate } = data;

            let room;
            if (roomCode) {
                room = findOrCreateRoom(roomType, false, roomCode);
                if (!room) {
                    ack?.({ error: 'Room not found' });
                    return;
                }
            } else {
                room = findOrCreateRoom(roomType, !!isPrivate, null);
            }

            if (room.isFull()) {
                ack?.({ error: 'Room is full' });
                return;
            }

            // Leave previous room if any
            if (currentRoom) {
                currentRoom.removePlayer(socket);
                cleanupRoom(currentRoom.id);
            }

            currentRoom = room;
            socket.join(room.id);

            // Add player WITHOUT broadcasting (silent=true)
            room.addPlayer(socket, { uid, name, avatarUrl, reqTeam }, true);

            // Send ack FIRST so client creates SocketRoom and registers handlers
            ack?.({
                ok: true,
                roomId: room.id,
                sessionId: socket.id,
            });

            // AFTER ack: give client 150ms to register handlers, then send initial state
            setTimeout(() => {
                room.sendInitialState(socket.id);
            }, 150);

        } catch (e) {
            console.error('[Server] join_room error:', e);
            ack?.({ error: e.message });
        }
    });

    /* ── FORWARD ALL GAME MESSAGES TO ROOM ── */
    const gameMessages = ['input', 'shoot', 'ready', 'pickup_key', 'enter_portal',
                          'host_start', 'move_team', 'kick_player', 'request_respawn', 'pickup_item'];
    for (const msg of gameMessages) {
        socket.on(msg, (data) => {
            if (currentRoom) currentRoom.onMessage(socket, msg, data);
        });
    }

    /* ── LEAVE ── */
    socket.on('leave_room', () => {
        if (currentRoom) {
            currentRoom.removePlayer(socket);
            socket.leave(currentRoom.id);
            cleanupRoom(currentRoom.id);
            currentRoom = null;
        }
    });

    socket.on('disconnect', () => {
        console.log(`[Server] Client disconnected: ${socket.id}`);
        if (currentRoom) {
            currentRoom.removePlayer(socket);
            cleanupRoom(currentRoom.id);
            currentRoom = null;
        }
    });
});

server.listen(PORT, () => {
    console.log(`🚀 DAHT Server → http://localhost:${PORT} (Socket.IO)`);
});
