/**
 * DAHT Multiplayer Server — Socket.IO + Express
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { GameRoom } = require('./GameRoom');

const PORT = parseInt(process.env.PORT || '2567');
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '*')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
const CORS_ORIGIN = ALLOWED_ORIGINS.includes('*') ? '*' : ALLOWED_ORIGINS;

/* ─── FIREBASE ADMIN SDK (Prizes Automation) 🔥 ─── */
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const keyPath = path.join(__dirname, '..', 'serviceAccountKey.json');
if (fs.existsSync(keyPath)) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert(require(keyPath))
        });
        console.log('✅ [Server] Firebase Admin Initialized (Key loaded)');
    } catch (e) {
        console.error('❌ [Server] Firebase Admin Init Error:', e.message);
    }
} else {
    console.warn('⚠️ [Server] serviceAccountKey.json NOT FOUND. Automated prizes disabled.');
}

const db = admin.apps.length ? admin.firestore() : null;

/** 🏆 Distribute prizes to Daily Leaderboard winners (#1) */
async function distributeDailyPrizes(targetDate) {
    if (!db) return;
    try {
        console.log(`[Prizes] Checking winners for: ${targetDate}...`);
        
        // 1. Check if already distributed
        const awardRef = db.collection('daily_prize_logs').doc(targetDate);
        const log = await awardRef.get();
        if (log.exists) {
            console.log(`[Prizes] Already distributed for ${targetDate}. Skipping.`);
            return;
        }

        // 2. Fetch Top Killer
        const killersSnap = await db.collection('daily_stats')
            .where('day', '==', targetDate)
            .orderBy('monsterKills', 'desc')
            .limit(1)
            .get();

        // 3. Fetch Top Survivor
        const survivorsSnap = await db.collection('daily_stats')
            .where('day', '==', targetDate)
            .orderBy('portalsOpened', 'desc')
            .limit(1)
            .get();

        const batch = db.batch();
        const results = { killers: null, survivors: null };

        if (!killersSnap.empty) {
            const winner = killersSnap.docs[0].data();
            console.log(`[Prizes] Killer Winner: ${winner.displayName} (${winner.uid})`);
            batch.update(db.collection('players').doc(winner.uid), {
                goldCoins: admin.firestore.FieldValue.increment(1)
            });
            batch.set(db.collection('daily_awards').doc(`${winner.uid}_killer_win_${targetDate}`), {
                uid: winner.uid, day: targetDate, reason: 'killer_win', coins: 1, awardedAt: admin.firestore.Timestamp.now()
            });
            results.killers = winner.displayName;
        }

        if (!survivorsSnap.empty) {
            const winner = survivorsSnap.docs[0].data();
            console.log(`[Prizes] Survivor Winner: ${winner.displayName} (${winner.uid})`);
            batch.update(db.collection('players').doc(winner.uid), {
                goldCoins: admin.firestore.FieldValue.increment(1)
            });
            batch.set(db.collection('daily_awards').doc(`${winner.uid}_survivor_win_${targetDate}`), {
                uid: winner.uid, day: targetDate, reason: 'survivor_win', coins: 1, awardedAt: admin.firestore.Timestamp.now()
            });
            results.survivors = winner.displayName;
        }

        // Mark as distributed
        batch.set(awardRef, { distributedAt: admin.firestore.Timestamp.now(), ...results });
        await batch.commit();
        console.log(`✅ [Prizes] Prizes distributed for ${targetDate}`);
    } catch (e) {
        console.error(`❌ [Prizes] Error for ${targetDate}:`, e);
    }
}

// Check every hour if we need to distribute for "Yesterday"
setInterval(() => {
    if (!db) return;
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    distributeDailyPrizes(yesterday);
}, 3600000); // 1 hour

// Trigger manual check on startup
setTimeout(() => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    distributeDailyPrizes(yesterday);
}, 5000);
const app  = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'], credentials: true },
    pingInterval: 10000,
    pingTimeout: 5000,
});

app.get('/', (_req, res) => res.send('DAHT Server OK'));
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', ts: Date.now(), rooms: rooms.size });
});

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
    console.log(`[Server] CORS origin: ${Array.isArray(CORS_ORIGIN) ? CORS_ORIGIN.join(', ') : CORS_ORIGIN}`);
});

process.on('uncaughtException', (err) => {
    console.error('[Server] Uncaught exception:', err);
});
process.on('unhandledRejection', (err) => {
    console.error('[Server] Unhandled rejection:', err);
});
