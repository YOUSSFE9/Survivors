const { io } = require('socket.io-client');
console.log('Connecting to server...');
const socket = io('http://localhost:2567', { transports: ['websocket', 'polling'] });

socket.on('connect', () => {
    console.log('Connected! Socket ID:', socket.id);
    console.log('Emitting join_room...');
    socket.emit('join_room', { roomType: 'duel', uid: 'test1', name: 'TestUser' }, (res) => {
        console.log('Join room response:', res);
        process.exit(0);
    });
});

socket.on('connect_error', (err) => {
    console.error('Connection error:', err.message);
    process.exit(1);
});

setTimeout(() => {
    console.error('Timeout waiting for connection!');
    process.exit(1);
}, 3000);
