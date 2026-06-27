const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const forge = require('node-forge'); // Replaced child_process with node-forge
const { Server } = require('socket.io');
const db = require('./database');

const app = express();

// ==================== AUTO-GENERATE SSL CERTIFICATES ====================

const keysDir = path.join(__dirname, 'keys');
const keyPath = path.join(keysDir, 'key.pem');
const certPath = path.join(keysDir, 'cert.pem');

// Ensure the /keys directory exists
if (!fs.existsSync(keysDir)) {
  fs.mkdirSync(keysDir, { recursive: true });
}

// Check if certificates are missing, then auto-generate them using node-forge
if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.log('SSL certificates not found in /keys. Generating self-signed certificates via node-forge...');
  try {
    const pki = forge.pki;
    const keys = pki.rsa.generateKeyPair(2048);
    const cert = pki.createCertificate();

    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

    const attrs = [
      { name: 'commonName', value: 'localhost' },
      { name: 'countryName', value: 'US' },
      { shortName: 'ST', value: 'State' },
      { name: 'localityName', value: 'City' },
      { name: 'organizationName', value: 'Dev' },
      { shortName: 'OU', value: 'Local' }
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(keys.privateKey, forge.md.sha256.create());

    const pemKey = pki.privateKeyToPem(keys.privateKey);
    const pemCert = pki.certificateToPem(cert);

    fs.writeFileSync(keyPath, pemKey);
    fs.writeFileSync(certPath, pemCert);
    console.log('Certificates generated successfully via node-forge.');
  } catch (error) {
    console.error('Failed to generate SSL certificates automatically:', error.message);
    process.exit(1);
  }
}

// Load SSL options
const serverOptions = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath)
};

// Create Native HTTPS Server
const server = https.createServer(serverOptions, app);

// INCREASE THRESHOLD BASE FOR BASE64 RECORDINGS (100MB)
const io = new Server(server, {
  maxHttpBufferSize: 100 * 1024 * 1024
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

      unreadCounters.set(normalizedUsername, unreadCounts || {});

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

  socket.on('answer-call', (data) => {
    const targetSocketId = findSocketByUsername(data.to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-answered', {
        answer: data.answer
      });
    }
  });

  socket.on('ice-candidate', (data) => {
    const targetSocketId = findSocketByUsername(data.to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('ice-candidate', {
        candidate: data.candidate
      });
    }
  });

  socket.on('end-call', (data) => {
    const targetSocketId = findSocketByUsername(data.to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-ended');
    }
  });

  // ==================== 3. TEXT MESSAGING & CHAT FEATURES ====================

  socket.on('join-room', async (newRoom) => {
    const userData = users.get(socket.id);
    if (!userData) return;

    socket.leave(userData.room);
    socket.join(newRoom);
    userData.room = newRoom;

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
      io.to(userData.room).emit('receive-message', messageData);
    }
  });

  socket.on('private-message', async (data) => {
    const userData = users.get(socket.id);
    if (!userData || userData.username === data.to) return;

    const targetSocketId = findSocketByUsername(data.to);
    const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Check if the recipient already has this sender's chat layout active
    const recipientSocket = targetSocketId ? users.get(targetSocketId) : null;
    const isRecipientViewingChat = recipientSocket && recipientSocket.room === userData.username;

    const privateMsg = {
      from: userData.username,
      to: data.to,
      text: data.text,
      time: currentTime,
      type: 'private',
      isRead: isRecipientViewingChat // Immediately flag true if receiver is watching your DM channel
    };

    try {
      await db.savePrivateMessage(userData.username, userData.sessionId, data.to, data.text);

      if (!unreadCounters.has(data.to)) unreadCounters.set(data.to, {});
      const receiverCounters = unreadCounters.get(data.to);

      if (!isRecipientViewingChat) {
         receiverCounters[userData.username] = (receiverCounters[userData.username] || 0) + 1;
      }

      socket.emit('receive-message', privateMsg);

      if (targetSocketId) {
        io.to(targetSocketId).emit('receive-message', privateMsg);
        if (!isRecipientViewingChat) {
          io.to(targetSocketId).emit('update-unread-count', {
            from: userData.username,
            count: receiverCounters[userData.username]
          });
        } else {
          // If the recipient is viewing, broadcast right back to the sender to display double ticks
          socket.emit('messages-read', { byUser: data.to });
        }
      }
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('load-private-history', async (targetUsername) => {
    const userData = users.get(socket.id);
    if (!userData) return;

    try {
      await db.markPrivateMessageAsRead(targetUsername, userData.username);
      const history = await db.getPrivateHistory(userData.username, targetUsername);

      if (unreadCounters.has(userData.username)) {
        const counters = unreadCounters.get(userData.username);
        counters[targetUsername] = 0;
      }

      // Explicitly inject isRead properties on individual matching logs inside historical arrays
      const normalizedHistory = history.map(msg => {
         if (msg.from === targetUsername) {
            msg.isRead = true;
         }
         return msg;
      });

      socket.emit('private-history-loaded', { history: normalizedHistory, targetUsername });
      socket.emit('update-unread-count', { from: targetUsername, count: 0 });

      // Signal the sender that their message was opened so their checkmarks swap from ✓ to ✓✓
      const targetSocketId = findSocketByUsername(targetUsername);
      if (targetSocketId) {
         io.to(targetSocketId).emit('messages-read', { byUser: userData.username });
      }
    } catch (err) {
      socket.emit('private-history-loaded', { history: [], targetUsername });
    }
  });

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

  socket.on('send-file', async (data) => {
    const userData = users.get(socket.id);
    if (!userData) return;

    const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const fileMessage = {
      from: userData.username,
      fileName: data.fileName,
      fileData: data.fileData,
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

  socket.on('private-file', async (data) => {
    const userData = users.get(socket.id);
    if (!userData || userData.username === data.to) return;

    const targetSocketId = findSocketByUsername(data.to);
    const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const recipientSocket = targetSocketId ? users.get(targetSocketId) : null;
    const isRecipientViewingChat = recipientSocket && recipientSocket.room === userData.username;

    const privateFileMessage = {
      from: userData.username,
      to: data.to,
      fileName: data.fileName,
      fileData: data.fileData,
      fileType: data.fileType,
      time: currentTime,
      type: 'private-file',
      isRead: isRecipientViewingChat
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

      if (!isRecipientViewingChat) {
         receiverCounters[userData.username] = (receiverCounters[userData.username] || 0) + 1;
      }

      socket.emit('receive-message', privateFileMessage);

      if (targetSocketId) {
        io.to(targetSocketId).emit('receive-message', privateFileMessage);
        if (!isRecipientViewingChat) {
          io.to(targetSocketId).emit('update-unread-count', {
            from: userData.username,
            count: receiverCounters[userData.username]
          });
        } else {
          socket.emit('messages-read', { byUser: data.to });
        }
      }
    } catch (err) {
      console.error("Failed to save private file attachment history:", err);
      socket.emit('receive-message', privateFileMessage);
    }
  });

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
    console.log(`Secure LAN server running on all network interfaces via port ${PORT} (HTTPS)`);
});
