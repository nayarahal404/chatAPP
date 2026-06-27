const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const db = require('./database'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 10 * 1024 * 1024 // 10MB for file uploads
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ==================== AUTHENTICATION API ENDPOINTS ====================

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required' });
    }
    const result = await db.registerUser(username, password);
    res.json({ success: true, user: { id: result.id, username: result.username }, message: 'User registered successfully' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required' });
    }
    const result = await db.loginUser(username, password);
    res.json({ success: true, user: { id: result.id, username: result.username }, message: 'Login successful' });
  } catch (error) {
    res.status(401).json({ success: false, error: error.message });
  }
});

// ==================== SOCKET.IO HANDLING ====================

const users = new Map(); // socket.id -> { username, room, sessionId }
const activeUsernames = new Set(); 
const rooms = ['General', 'Technology', 'Academic', 'Lounge'];
const unreadCounters = new Map(); // username -> { roomOrUser: count }

async function initializeRooms() {
  await db.dbReady();
  for (const room of rooms) {
    try { await db.createRoom(room); } catch (err) { console.error(err.message); }
  }
}

function generateSessionId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

const roomsInitialized = initializeRooms();

// Helper to look up an active socket ID by their username
const findSocketByUsername = (targetUsername) => {
  for (let [id, user] of users.entries()) {
    if (user.username === targetUsername) return id;
  }
  return null;
};

io.on('connection', (socket) => {

  // ==================== 1. CHAT AUTHENTICATION ====================
  socket.on('authenticate', async (username) => {
    try {
      await roomsInitialized;
      if (!username) return socket.emit('authentication-error', 'Username is required.');
      
      const normalizedUsername = username.trim();
      const user = await db.getUserByUsername(normalizedUsername);
      if (!user) return socket.emit('authentication-error', 'User not found.');
      if (activeUsernames.has(normalizedUsername)) return socket.emit('authentication-error', 'Already logged in.');

      const sessionId = generateSessionId();
      activeUsernames.add(normalizedUsername);
      await db.updateUserSession(normalizedUsername, sessionId);

      users.set(socket.id, { username: normalizedUsername, room: 'General', sessionId });
      socket.join('General');

      const getUserList = () => Array.from(users.values()).map(u => ({ username: u.username, sessionId: u.sessionId }));
      const roomId = await db.getRoomId('General');
      const generalHistory = await db.getRoomHistory(roomId);
      const unreadCounts = await db.getAllUnreadCounts(normalizedUsername);
      
      // Store baseline unread counters inside our server state
      unreadCounters.set(normalizedUsername, unreadCounts || {});

      // Successfully authenticated
      socket.emit('authentication-success', {
        username: normalizedUsername,
        currentRoom: 'General',
        rooms: rooms, 
        allUsers: getUserList(), 
        roomHistory: generalHistory,
        unreadCounts: unreadCounts
      });

      socket.to('General').emit('user-joined', { username: normalizedUsername, sessionId });
      io.emit('update-user-list', getUserList());
      
    } catch (error) {
      socket.emit('authentication-error', error.message);
    }
  });

  // ==================== 2. WEBRTC SIGNALING ====================
  
  // Route SDP Offer to target peer
  socket.on('call-user', (data) => {
    const sender = users.get(socket.id);
    if (!sender) return; 

    const targetSocketId = findSocketByUsername(data.to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('incoming-call', {
        from: sender.username,
        offer: data.offer
      });
    }
  });

  // Route SDP Answer back to caller
  socket.on('answer-call', (data) => {
    const targetSocketId = findSocketByUsername(data.to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-answered', {
        answer: data.answer
      });
    }
  });

  // Route ICE Candidates between peers
  socket.on('ice-candidate', (data) => {
    const targetSocketId = findSocketByUsername(data.to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('ice-candidate', {
        candidate: data.candidate
      });
    }
  });

  // Handle Call Disconnection / Hang up
  socket.on('end-call', (data) => {
    const targetSocketId = findSocketByUsername(data.to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-ended');
    }
  });

  // ==================== 3. TEXT MESSAGING & CHAT FEATURES ====================

  // Switch Room
  socket.on('join-room', async (newRoom) => {
    const userData = users.get(socket.id);
    if (!userData) return;

    socket.leave(userData.room);
    socket.join(newRoom);
    userData.room = newRoom;

    // Reset unread count for this room upon user arrival
    if (unreadCounters.has(userData.username)) {
      const counters = unreadCounters.get(userData.username);
      if (counters) {
        counters[newRoom] = 0;
      }
    }

    try {
      const roomId = await db.getRoomId(newRoom);
      const roomHist = await db.getRoomHistory(roomId);
      socket.emit('room-switched', { room: newRoom, history: roomHist });
    } catch (err) {
      socket.emit('room-switched', { room: newRoom, history: [] });
    }
  });

  // Public Room Messaging (Now tracking all public unread tallies)
  socket.on('send-message', async (data) => {
    const userData = users.get(socket.id);
    if (!userData) return;

    const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const messageData = {
      from: userData.username,
      text: data.text,
      time: currentTime,
      type: 'public',
      room: userData.room
    };

    try {
      const roomId = await db.getRoomId(userData.room);
      await db.saveRoomMessage(roomId, userData.username, userData.sessionId, data.text);
      io.to(userData.room).emit('receive-message', messageData); 

      // Update unread counters for active online users outside this room focus
      for (let [targetSocketId, user] of users.entries()) {
        if (user.room !== userData.room) {
          if (!unreadCounters.has(user.username)) {
            unreadCounters.set(user.username, {});
          }
          const targetCounters = unreadCounters.get(user.username);
          targetCounters[userData.room] = (targetCounters[userData.room] || 0) + 1;

          // Notify client to update public room unread indicator badge
          io.to(targetSocketId).emit('update-room-unread-count', {
            room: userData.room,
            count: targetCounters[userData.room]
          });
        }
      }
    } catch (err) {
      io.to(userData.room).emit('receive-message', messageData); 
    }
  });

  // Private Messaging
  socket.on('private-message', async (data) => {
    const userData = users.get(socket.id);
    if (!userData || userData.username === data.to) return;

    const targetSocketId = findSocketByUsername(data.to);
    const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const privateMsg = {
      from: userData.username,
      to: data.to,
      text: data.text,
      time: currentTime,
      type: 'private'
    };

    try {
      await db.savePrivateMessage(userData.username, userData.sessionId, data.to, data.text);
      
      if (!unreadCounters.has(data.to)) unreadCounters.set(data.to, {});
      const receiverCounters = unreadCounters.get(data.to);
      receiverCounters[userData.username] = (receiverCounters[userData.username] || 0) + 1;

      // Echo instantly back to sender
      socket.emit('receive-message', privateMsg);

      // Route straight to targeted online client if available
      if (targetSocketId) {
        io.to(targetSocketId).emit('receive-message', privateMsg);
        io.to(targetSocketId).emit('update-unread-count', {
          from: userData.username,
          count: receiverCounters[userData.username]
        });
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Private History Load & Reset Counters
  socket.on('load-private-history', async (targetUsername) => {
    const userData = users.get(socket.id);
    if (!userData) return;

    try {
      const history = await db.getPrivateHistory(userData.username, targetUsername);
      await db.markPrivateMessageAsRead(targetUsername, userData.username);

      if (unreadCounters.has(userData.username)) {
        const counters = unreadCounters.get(userData.username);
        counters[targetUsername] = 0;
      }

      socket.emit('private-history-loaded', { history, targetUsername });
      socket.emit('update-unread-count', { from: targetUsername, count: 0 });
    } catch (err) {
      socket.emit('private-history-loaded', { history: [], targetUsername });
    }
  });

  // Get all unread counts on fresh load request
  socket.on('get-unread-counts', async () => {
    const userData = users.get(socket.id);
    if (!userData) return;
    try {
      const unreadCounts = await db.getAllUnreadCounts(userData.username);
      unreadCounters.set(userData.username, unreadCounts);
      socket.emit('unread-counts', unreadCounts);
    } catch (err) {
      socket.emit('unread-counts', {});
    }
  });

  // ==================== 4. FILE SHARING FEATURES ====================

  // Handle file sharing in public rooms (Now tracking public room unread files)
  socket.on('send-file', async (data) => {
    const userData = users.get(socket.id);
    if (!userData) return;

    const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const fileMessage = {
      from: userData.username,
      fileName: data.fileName,
      fileData: data.fileData, // Base64 string payload
      fileType: data.fileType,
      time: currentTime,
      type: 'public-file',
      room: userData.room
    };

    try {
      const roomId = await db.getRoomId(userData.room);
      
      const embeddedFileContent = `__FILE_PAYLOAD__:${JSON.stringify({
        fileName: data.fileName,
        fileData: data.fileData,
        fileType: data.fileType
      })}`;

      await db.saveRoomMessage(roomId, userData.username, userData.sessionId, embeddedFileContent);
      io.to(userData.room).emit('receive-message', fileMessage);

      // Distribute unread room count updates for file transmissions
      for (let [targetSocketId, user] of users.entries()) {
        if (user.room !== userData.room) {
          if (!unreadCounters.has(user.username)) {
            unreadCounters.set(user.username, {});
          }
          const targetCounters = unreadCounters.get(user.username);
          targetCounters[userData.room] = (targetCounters[userData.room] || 0) + 1;

          io.to(targetSocketId).emit('update-room-unread-count', {
            room: userData.room,
            count: targetCounters[userData.room]
          });
        }
      }
    } catch (err) {
      console.error("Failed to save public room file attachment history:", err);
      io.to(userData.room).emit('receive-message', fileMessage);
    }
  });

  // Handle file sharing across Direct DMs
  socket.on('private-file', async (data) => {
    const userData = users.get(socket.id);
    if (!userData || userData.username === data.to) return;

    const targetSocketId = findSocketByUsername(data.to);
    const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const privateFileMessage = {
      from: userData.username,
      to: data.to,
      fileName: data.fileName,
      fileData: data.fileData, // Base64 string payload
      fileType: data.fileType,
      time: currentTime,
      type: 'private-file'
    };

    try {
      const embeddedFileContent = `__FILE_PAYLOAD__:${JSON.stringify({
        fileName: data.fileName,
        fileData: data.fileData,
        fileType: data.fileType
      })}`;

      await db.savePrivateMessage(userData.username, userData.sessionId, data.to, embeddedFileContent);
      
      if (!unreadCounters.has(data.to)) unreadCounters.set(data.to, {});
      const receiverCounters = unreadCounters.get(data.to);
      receiverCounters[userData.username] = (receiverCounters[userData.username] || 0) + 1;

      // Echo directly back to sender terminal
      socket.emit('receive-message', privateFileMessage);

      // Route straight to targeted online recipient
      if (targetSocketId) {
        io.to(targetSocketId).emit('receive-message', privateFileMessage);
        io.to(targetSocketId).emit('update-unread-count', {
          from: userData.username,
          count: receiverCounters[userData.username]
        });
      }
    } catch (err) {
      console.error("Failed to save private file attachment history:", err);
      socket.emit('receive-message', privateFileMessage);
    }
  });

  // Clean Disconnect
  socket.on('disconnect', async () => {
    const userData = users.get(socket.id);
    if (userData) {
      activeUsernames.delete(userData.username);
      try { await db.setUserOffline(userData.username); } catch (err) {}
      users.delete(socket.id);
      io.emit('update-user-list', Array.from(users.values()).map(u => ({ username: u.username, sessionId: u.sessionId })));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on all network interfaces via port ${PORT}`);
});
