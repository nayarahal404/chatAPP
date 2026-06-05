const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Store users and rooms data
const users = new Map(); // socket.id -> { username, room, sessionId }
const activeUsernames = new Set(); // Track active usernames to ensure uniqueness
const rooms = ['General', 'Technology', 'Academic', 'Lounge'];

// Store chat history: roomName -> [messages] and privateChats -> "user1-user2" -> [messages]
const roomHistory = new Map();
const privateHistory = new Map();
const MAX_HISTORY = 50; // Keep last 50 messages per room/chat

// Initialize room history
rooms.forEach(room => {
    roomHistory.set(room, []);
});

function addToRoomHistory(room, message) {
    if (!roomHistory.has(room)) {
        roomHistory.set(room, []);
    }
    const history = roomHistory.get(room);
    history.push(message);
    if (history.length > MAX_HISTORY) {
        history.shift(); // Remove oldest message
    }
}

function addToPrivateHistory(user1, user2, message) {
    const key = [user1, user2].sort().join('-');
    if (!privateHistory.has(key)) {
        privateHistory.set(key, []);
    }
    const history = privateHistory.get(key);
    history.push(message);
    if (history.length > MAX_HISTORY) {
        history.shift();
    }
}

function getPrivateHistory(user1, user2) {
    const key = [user1, user2].sort().join('-');
    return privateHistory.get(key) || [];
}

// Generate a unique session ID for each user
function generateSessionId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // 1. User Management: Set Username with Uniqueness Check
    socket.on('set-username', (username) => {
        if (!username || username.trim() === '') {
            socket.emit('error-msg', 'Username is required.');
            return;
        }

        // Normalize username (trim whitespace)
        const normalizedUsername = username.trim();

        // Check if username is already taken by another active session
        if (activeUsernames.has(normalizedUsername)) {
            socket.emit('error-msg', `Username "${normalizedUsername}" is already taken. Please choose a different username.`);
            return;
        }

        // Generate a unique session ID for this user
        const sessionId = generateSessionId();

        // Add username to active usernames set
        activeUsernames.add(normalizedUsername);

        // Store user data with session ID
        users.set(socket.id, { username: normalizedUsername, room: 'General', sessionId });
        socket.join('General');
        
        const generalHistory = roomHistory.get('General') || [];
        
        socket.emit('init-data', {
            username: normalizedUsername,
            currentRoom: 'General',
            rooms: rooms,
            allUsers: Array.from(users.values()).map(u => ({ username: u.username, sessionId: u.sessionId })),
            roomHistory: generalHistory
        });

        socket.to('General').emit('user-joined', { username: normalizedUsername, sessionId, id: socket.id });
        io.emit('update-user-list', Array.from(users.values()).map(u => ({ username: u.username, sessionId: u.sessionId })));
        
        console.log(`User "${normalizedUsername}" (Session: ${sessionId}) joined the chat.`);
    });

    // 2. Chat Rooms: Switch Room
    socket.on('join-room', (newRoom) => {
        const userData = users.get(socket.id);
        if (!userData) return;

        const oldRoom = userData.room;
        socket.leave(oldRoom);
        socket.join(newRoom);
        
        userData.room = newRoom;
        users.set(socket.id, userData);

        const roomHist = roomHistory.get(newRoom) || [];
        socket.to(oldRoom).emit('user-left', { username: userData.username, sessionId: userData.sessionId, id: socket.id });
        socket.to(newRoom).emit('user-joined', { username: userData.username, sessionId: userData.sessionId, id: socket.id });
        
        socket.emit('room-switched', { room: newRoom, history: roomHist });
    });

    // 3. Messaging: Room Broadcast
    socket.on('send-message', (data) => {
        const userData = users.get(socket.id);
        if (!userData) return;

        const messageData = {
            from: userData.username,
            sessionId: userData.sessionId,
            text: data.text,
            time: new Date().toLocaleTimeString(),
            type: 'public',
            room: userData.room
        };

        addToRoomHistory(userData.room, messageData);

        // IMPORTANT: Broadcast to ALL users so they can receive notifications in other rooms
        io.emit('receive-message', messageData);
    });

    // 4. File Attachment: Send file to room or private chat
    socket.on('send-file', (data) => {
        const userData = users.get(socket.id);
        if (!userData) return;

        const fileData = {
            from: userData.username,
            sessionId: userData.sessionId,
            fileName: data.fileName,
            fileType: data.fileType,
            fileContent: data.fileContent, // Base64 encoded
            time: new Date().toLocaleTimeString(),
            type: data.isPrivate ? 'private-file' : 'public-file',
            room: userData.room
        };

        if (data.isPrivate) {
            // Private file
            let targetSocketId = null;
            for (let [id, user] of users.entries()) {
                if (user.username === data.to) {
                    targetSocketId = id;
                    break;
                }
            }

            if (targetSocketId) {
                const targetUserData = users.get(targetSocketId);
                fileData.to = data.to;
                fileData.toSessionId = targetUserData.sessionId;
                addToPrivateHistory(userData.username, data.to, fileData);
                io.to(targetSocketId).emit('receive-message', fileData);
                socket.emit('receive-message', fileData);
            } else {
                socket.emit('error-msg', `User ${data.to} not found.`);
            }
        } else {
            // Public file
            addToRoomHistory(userData.room, fileData);
            io.emit('receive-message', fileData);
        }
    });

    // 5. Private Messaging
    socket.on('private-message', (data) => {
        const userData = users.get(socket.id);
        if (!userData) return;

        let targetSocketId = null;
        for (let [id, user] of users.entries()) {
            if (user.username === data.to) {
                targetSocketId = id;
                break;
            }
        }

        if (targetSocketId) {
            const targetUserData = users.get(targetSocketId);
            const privateMsg = {
                from: userData.username,
                sessionId: userData.sessionId,
                to: data.to,
                toSessionId: targetUserData.sessionId,
                text: data.text,
                time: new Date().toLocaleTimeString(),
                type: 'private'
            };
            addToPrivateHistory(userData.username, data.to, privateMsg);
            io.to(targetSocketId).emit('receive-message', privateMsg);
            socket.emit('receive-message', privateMsg);
        } else {
            socket.emit('error-msg', `User ${data.to} not found.`);
        }
    });

    socket.on('load-private-history', (targetUsername) => {
        const userData = users.get(socket.id);
        if (!userData) return;
        const history = getPrivateHistory(userData.username, targetUsername);
        socket.emit('private-history-loaded', { history, targetUsername });
    });

    socket.on('disconnect', () => {
        const userData = users.get(socket.id);
        if (userData) {
            // Remove username from active usernames set
            activeUsernames.delete(userData.username);
            
            socket.to(userData.room).emit('user-left', { username: userData.username, sessionId: userData.sessionId, id: socket.id });
            users.delete(socket.id);
            io.emit('update-user-list', Array.from(users.values()).map(u => ({ username: u.username, sessionId: u.sessionId })));
            
            console.log(`User "${userData.username}" (Session: ${userData.sessionId}) disconnected.`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
