const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

// Initialize SQLite database
const dbPath = path.join(__dirname, 'chat_database.db');
let dbReadyPromise;

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database at:', dbPath);
  }
});

// Initialize database schema
function initializeDatabase() {
  if (dbReadyPromise) return dbReadyPromise;

  dbReadyPromise = new Promise((resolve, reject) => {
    db.serialize(() => {
      // Create users table
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          session_id TEXT UNIQUE,
          is_online BOOLEAN DEFAULT 0,
          joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_active DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) console.error('Error creating users table:', err.message);
        else console.log('Users table ready');
      });

      // Create rooms table
      db.run(`
        CREATE TABLE IF NOT EXISTS rooms (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_name TEXT UNIQUE NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) console.error('Error creating rooms table:', err.message);
        else console.log('Rooms table ready');
      });

      // Create messages table
      db.run(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_id INTEGER NOT NULL,
          username TEXT NOT NULL,
          session_id TEXT NOT NULL,
          message_text TEXT NOT NULL,
          file_data TEXT,
          file_name TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (room_id) REFERENCES rooms(id)
        )
      `, (err) => {
        if (err) console.error('Error creating messages table:', err.message);
        else console.log('Messages table ready');
      });

      // Create private_messages table
      db.run(`
        CREATE TABLE IF NOT EXISTS private_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sender_username TEXT NOT NULL,
          sender_session_id TEXT NOT NULL,
          receiver_username TEXT NOT NULL,
          message_text TEXT NOT NULL,
          file_data TEXT,
          file_name TEXT,
          is_read BOOLEAN DEFAULT 0,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) console.error('Error creating private_messages table:', err.message);
        else console.log('Private messages table ready');
      });

      // Create room_history table
      db.run(`
        CREATE TABLE IF NOT EXISTS room_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_id INTEGER NOT NULL,
          username TEXT NOT NULL,
          session_id TEXT NOT NULL,
          joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (room_id) REFERENCES rooms(id)
        )
      `, (err) => {
        if (err) console.error('Error creating room_history table:', err.message);
        else console.log('Room history table ready');
      });

      // Create unread_counters table
      db.run(`
        CREATE TABLE IF NOT EXISTS unread_counters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          receiver_username TEXT NOT NULL,
          sender_username TEXT NOT NULL,
          unread_count INTEGER DEFAULT 0,
          UNIQUE(receiver_username, sender_username)
        )
      `, (err) => {
        if (err) {
          console.error('Error creating unread_counters table:', err.message);
          reject(err);
        } else {
          console.log('Unread counters table ready');
          resolve();
        }
      });
    });
  });
  return dbReadyPromise;
}

// Immediately start initialization
initializeDatabase();

// ==================== NEW USER MANAGEMENT FUNCTIONS ====================

function registerUser(username, password) {
  return new Promise((resolve, reject) => {
    if (!username || !password) {
      return reject(new Error('Username and password are required'));
    }
    bcrypt.hash(password, 10, (err, hashedPassword) => {
      if (err) return reject(err);
      db.run(
        `INSERT INTO users (username, password) VALUES (?, ?)`,
        [username, hashedPassword],
        function(err) {
          if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
              reject(new Error('Username already exists'));
            } else {
              reject(err);
            }
          } else {
            resolve({ id: this.lastID, username: username });
          }
        }
      );
    });
  });
}

function loginUser(username, password) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, username, password, is_online FROM users WHERE username = ?`,
      [username],
      (err, user) => {
        if (err) return reject(err);
        if (!user) return reject(new Error('User not found'));
        bcrypt.compare(password, user.password, (err, result) => {
          if (err) return reject(err);
          if (!result) return reject(new Error('Invalid password'));
          db.run(
            `UPDATE users SET is_online = 1, last_active = CURRENT_TIMESTAMP WHERE username = ?`,
            [username],
            (err) => {
              if (err) return reject(err);
              resolve({ id: user.id, username: user.username });
            }
          );
        });
      }
    );
  });
}

function updateUserSession(username, sessionId) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users SET session_id = ?, is_online = 1, last_active = CURRENT_TIMESTAMP WHERE username = ?`,
      [sessionId, username],
      function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      }
    );
  });
}

function setUserOffline(username) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users SET is_online = 0, session_id = NULL WHERE username = ?`,
      [username],
      function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      }
    );
  });
}

function getOnlineUsers() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, username, joined_at, last_active FROM users WHERE is_online = 1 ORDER BY username`,
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
}

function getUserByUsername(username) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, username, is_online, joined_at, last_active FROM users WHERE username = ?`,
      [username],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
}

function getAllUsers() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, username, is_online, joined_at, last_active FROM users ORDER BY username`,
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
}

// ==================== EXISTING FUNCTIONS ====================

function saveRoomMessage(roomId, username, sessionId, messageText, fileData = null, fileName = null) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO messages (room_id, username, session_id, message_text, file_data, file_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [roomId, username, sessionId, messageText, fileData, fileName],
      function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}

function savePrivateMessage(senderUsername, senderSessionId, receiverUsername, messageText, fileData = null, fileName = null) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO private_messages (sender_username, sender_session_id, receiver_username, message_text, file_data, file_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [senderUsername, senderSessionId, receiverUsername, messageText, fileData, fileName],
      function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}

function getRoomHistory(roomId, limit = 50) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT username as "from", session_id as sessionId, message_text as text, 
              file_data as fileContent, file_name as fileName, timestamp as time
       FROM messages WHERE room_id = ? ORDER BY timestamp DESC LIMIT ?`,
      [roomId, limit],
      (err, rows) => {
        if (err) reject(err);
        else {
          const history = rows ? rows.reverse().map(row => ({
            ...row,
            type: row.fileContent ? 'public-file' : 'public',
            time: new Date(row.time).toLocaleTimeString()
          })) : [];
          resolve(history);
        }
      }
    );
  });
}

function getPrivateHistory(user1, user2, limit = 50) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT sender_username as "from", message_text as text, 
              file_data as fileContent, file_name as fileName, is_read, timestamp as time
       FROM private_messages 
       WHERE (sender_username = ? AND receiver_username = ?) 
          OR (sender_username = ? AND receiver_username = ?)
       ORDER BY timestamp DESC LIMIT ?`,
      [user1, user2, user2, user1, limit],
      (err, rows) => {
        if (err) reject(err);
        else {
          const history = rows ? rows.reverse().map(row => ({
            ...row,
            type: row.fileContent ? 'private-file' : 'private',
            time: new Date(row.time).toLocaleTimeString()
          })) : [];
          resolve(history);
        }
      }
    );
  });
}

function getRoomId(roomName) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id FROM rooms WHERE room_name = ?`,
      [roomName],
      (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.id : null);
      }
    );
  });
}

function createRoom(roomName) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO rooms (room_name) VALUES (?)`,
      [roomName],
      function(err) {
        if (err) reject(err);
        else {
          getRoomId(roomName).then(resolve).catch(reject);
        }
      }
    );
  });
}

function addUserToRoom(roomId, username, sessionId) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO room_history (room_id, username, session_id) VALUES (?, ?, ?)`,
      [roomId, username, sessionId],
      function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}

function markPrivateMessageAsRead(senderUsername, receiverUsername) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE private_messages SET is_read = 1 
       WHERE sender_username = ? AND receiver_username = ?`,
      [senderUsername, receiverUsername],
      function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      }
    );
  });
}

function getUnreadCount(receiverUsername, senderUsername) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT COUNT(*) as count FROM private_messages 
       WHERE sender_username = ? AND receiver_username = ? AND is_read = 0`,
      [senderUsername, receiverUsername],
      (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.count : 0);
      }
    );
  });
}

function getAllUnreadCounts(username) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT sender_username, COUNT(*) as count FROM private_messages 
       WHERE receiver_username = ? AND is_read = 0 
       GROUP BY sender_username`,
      [username],
      (err, rows) => {
        if (err) reject(err);
        else {
          const counts = {};
          if (rows) {
            rows.forEach(row => {
              counts[row.sender_username] = row.count;
            });
          }
          resolve(counts);
        }
      }
    );
  });
}

module.exports = {
  db,
  dbReady: initializeDatabase,
  registerUser,
  loginUser,
  updateUserSession,
  setUserOffline,
  getOnlineUsers,
  getUserByUsername,
  getAllUsers,
  saveRoomMessage,
  savePrivateMessage,
  getRoomHistory,
  getPrivateHistory,
  getRoomId,
  createRoom,
  addUserToRoom,
  markPrivateMessageAsRead,
  getUnreadCount,
  getAllUnreadCounts
};
