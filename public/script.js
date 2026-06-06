const socket = io();

// DOM Elements
const loginContainer = document.getElementById('login-container');
const appContainer = document.getElementById('app-container');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');
const displayUsername = document.getElementById('display-username');
const roomsList = document.getElementById('rooms-list');
const usersList = document.getElementById('users-list');
const messagesDisplay = document.getElementById('messages-display');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const attachBtn = document.getElementById('attach-btn');
const fileInput = document.getElementById('file-input');
const currentRoomName = document.getElementById('current-room-name');
const privateModeIndicator = document.getElementById('private-mode-indicator');
const privateTargetUser = document.getElementById('private-target-user');
const backToRoomBtn = document.getElementById('back-to-room-btn');

let myUsername = '';
let mySessionId = '';
let currentRoom = 'General';
let privateMessageTarget = null; // null = room mode, username = private mode
let privateMessageTargetSessionId = null; // Session ID of the private message target
let unreadMessages = new Map(); // username-sessionId -> count of unread messages
let unreadRooms = new Map(); // roomName -> count of unread messages

// --- Login Logic ---
joinBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (username) {
        socket.emit('set-username', username);
    }
});

usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinBtn.click();
});

// --- Socket Events ---

socket.on('init-data', (data) => {
    myUsername = data.username;
    mySessionId = data.allUsers.find(u => u.username === data.username)?.sessionId || '';
    currentRoom = data.currentRoom;
    
    displayUsername.textContent = `${myUsername} (${mySessionId.substring(0, 8)}...)`;
    loginContainer.classList.add('hidden');
    appContainer.classList.remove('hidden');
    
    renderRooms(data.rooms);
    renderUsers(data.allUsers);
    
    // Load and display room history
    if (data.roomHistory && data.roomHistory.length > 0) {
        data.roomHistory.forEach(msg => {
            appendMessage(msg);
        });
    }
    
    addSystemMessage(`Welcome ${myUsername}! You joined ${currentRoom}.`);
});

socket.on('update-user-list', (users) => {
    renderUsers(users);
});

socket.on('room-switched', (data) => {
    currentRoom = data.room;
    currentRoomName.textContent = currentRoom;
    messagesDisplay.innerHTML = ''; // Clear chat for new room
    
    // Clear unread count for this room
    unreadRooms.delete(currentRoom);
    updateRoomNotifications();
    
    // Load and display room history
    if (data.history && data.history.length > 0) {
        data.history.forEach(msg => {
            appendMessage(msg);
        });
    }
    
    addSystemMessage(`You joined room: ${currentRoom}`);
    renderRoomsActiveState();
    
    // Exit private mode when switching rooms
    if (privateMessageTarget) {
        exitPrivateMode(false); 
    }
});

socket.on('receive-message', (msg) => {
    if (msg.type === 'private' || msg.type === 'private-file') {
        // --- Private Message Handling ---
        if ((privateMessageTarget === msg.from && privateMessageTargetSessionId === msg.sessionId) || 
            (msg.from === myUsername && msg.sessionId === mySessionId)) {
            appendMessage(msg);
            if (msg.from !== myUsername) {
                const key = `${msg.from}-${msg.sessionId}`;
                unreadMessages.delete(key);
                updateUserNotifications();
            }
        } else {
            // Unread private message
            const key = `${msg.from}-${msg.sessionId}`;
            const currentCount = unreadMessages.get(key) || 0;
            unreadMessages.set(key, currentCount + 1);
            updateUserNotifications();
            playNotificationSound();
        }
    } else {
        // --- Room Message Handling ---
        // 1. If we are in the same room AND NOT in private mode
        if (!privateMessageTarget && currentRoom === msg.room) {
            appendMessage(msg);
        } 
        // 2. If we are in a different room OR in private mode
        else {
            if (msg.from !== myUsername) {
                const currentCount = unreadRooms.get(msg.room) || 0;
                unreadRooms.set(msg.room, currentCount + 1);
                updateRoomNotifications();
                playNotificationSound();
            }
        }
    }
});

socket.on('private-history-loaded', (data) => {
    messagesDisplay.innerHTML = '';
    if (data.history && data.history.length > 0) {
        data.history.forEach(msg => {
            appendMessage(msg);
        });
    }
    const key = `${data.targetUsername}-${privateMessageTargetSessionId}`;
    unreadMessages.delete(key);
    updateUserNotifications();
});

socket.on('user-joined', (data) => {
    addSystemMessage(`${data.username} (${data.sessionId.substring(0, 8)}...) joined the room.`);
});

socket.on('user-left', (data) => {
    addSystemMessage(`${data.username} (${data.sessionId.substring(0, 8)}...) left the room.`);
});

socket.on('error-msg', (msg) => {
    alert(msg);
});

// --- UI Rendering Functions ---

function renderRooms(rooms) {
    roomsList.innerHTML = '';
    rooms.forEach(room => {
        const li = document.createElement('li');
        li.dataset.room = room;
        
        const roomSpan = document.createElement('span');
        roomSpan.textContent = room;
        li.appendChild(roomSpan);
        
        if (room === currentRoom && !privateMessageTarget) li.classList.add('active');
        
        li.addEventListener('click', () => {
            if (room !== currentRoom || privateMessageTarget) {
                socket.emit('join-room', room);
            }
        });
        roomsList.appendChild(li);
    });
    updateRoomNotifications();
}

function renderRoomsActiveState() {
    document.querySelectorAll('#rooms-list li').forEach(li => {
        li.classList.toggle('active', li.dataset.room === currentRoom && !privateMessageTarget);
    });
}

function updateRoomNotifications() {
    const roomElements = document.querySelectorAll('#rooms-list li');
    roomElements.forEach(li => {
        const roomName = li.dataset.room;
        
        const oldBadge = li.querySelector('.notification-badge');
        if (oldBadge) oldBadge.remove();
        
        if (unreadRooms.has(roomName)) {
            const badge = document.createElement('span');
            badge.classList.add('notification-badge');
            badge.textContent = unreadRooms.get(roomName);
            li.appendChild(badge);
        }
    });
}

function renderUsers(users) {
    usersList.innerHTML = '';
    users.forEach(user => {
        const li = document.createElement('li');
        const userSpan = document.createElement('span');
        const displayText = user.username === myUsername ? 
            `${user.username} (You)` : 
            `${user.username} (${user.sessionId.substring(0, 8)}...)`;
        userSpan.textContent = displayText;
        li.appendChild(userSpan);
        
        if (user.username !== myUsername || user.sessionId !== mySessionId) {
            li.title = 'Click to send private message';
            li.addEventListener('click', () => {
                enterPrivateMode(user.username, user.sessionId);
            });
            if (user.username === privateMessageTarget && user.sessionId === privateMessageTargetSessionId) {
                li.classList.add('private-selected');
            }
        }
        usersList.appendChild(li);
    });
    updateUserNotifications();
}

function updateUserNotifications() {
    const userElements = document.querySelectorAll('#users-list li');
    userElements.forEach(li => {
        const userSpan = li.querySelector('span');
        if (!userSpan) return;
        
        const oldBadge = li.querySelector('.notification-badge');
        if (oldBadge) oldBadge.remove();
        
        // Check all unread messages for this user
        for (let [key, count] of unreadMessages.entries()) {
            const [username, sessionId] = key.split('-');
            const displayText = `${username} (${sessionId.substring(0, 8)}...)`;
            if (userSpan.textContent.includes(displayText) || userSpan.textContent.includes(username)) {
                const badge = document.createElement('span');
                badge.classList.add('notification-badge');
                badge.textContent = count;
                li.appendChild(badge);
                break;
            }
        }
    });
}

function enterPrivateMode(targetUsername, targetSessionId) {
    privateMessageTarget = targetUsername;
    privateMessageTargetSessionId = targetSessionId;
    privateModeIndicator.classList.remove('hidden');
    privateTargetUser.textContent = `with ${targetUsername} (${targetSessionId.substring(0, 8)}...)`;
    messageInput.placeholder = `Private message to ${targetUsername}...`;
    
    document.querySelectorAll('#users-list li').forEach(li => {
        const span = li.querySelector('span');
        if (span && span.textContent.includes(targetUsername) && span.textContent.includes(targetSessionId.substring(0, 8))) {
            li.classList.add('private-selected');
        } else {
            li.classList.remove('private-selected');
        }
    });
    
    document.querySelectorAll('#rooms-list li').forEach(li => {
        li.classList.remove('active');
    });
    
    socket.emit('load-private-history', targetUsername);
    addSystemMessage(`Now chatting privately with ${targetUsername} (${targetSessionId.substring(0, 8)}...)`);
}

function exitPrivateMode(clearDisplay = true) {
    privateMessageTarget = null;
    privateMessageTargetSessionId = null;
    if (clearDisplay) {
        messagesDisplay.innerHTML = '';
        socket.emit('join-room', currentRoom);
    }
    
    privateModeIndicator.classList.add('hidden');
    messageInput.placeholder = 'Type a message...';
    
    unreadRooms.delete(currentRoom);
    updateRoomNotifications();
    
    document.querySelectorAll('#users-list li').forEach(li => {
        li.classList.remove('private-selected');
    });
    
    renderRoomsActiveState();
}

backToRoomBtn.addEventListener('click', () => {
    exitPrivateMode();
});

// --- Language Detection Function ---
function detectLanguage(text) {
    const arabicRegex = /[\u0600-\u06FF]/g;
    const arabicChars = (text.match(arabicRegex) || []).length;
    const totalChars = text.length;
    return arabicChars > totalChars / 2 ? 'rtl' : 'ltr';
}

function appendMessage(msg) {
    const div = document.createElement('div');
    
    const isSentByMe = msg.from === myUsername && msg.sessionId === mySessionId;
    
    // Handle file attachments
    if (msg.type === 'public-file' || msg.type === 'private-file') {
        div.classList.add('file-attachment');
        div.classList.add(isSentByMe ? 'sent' : 'received');
        
        const senderDisplay = isSentByMe ? 'You' : `${msg.from} (${msg.sessionId.substring(0, 8)}...)`;
        const fileIcon = getFileIcon(msg.fileType);
        const fileSizeKB = (msg.fileContent.length / 1024).toFixed(2);
        
        div.innerHTML = `<div class="msg-meta">${senderDisplay} • ${msg.time}</div>
                         <div class="file-info">
                             <div class="file-icon">${fileIcon}</div>
                             <div class="file-details">
                                 <div class="file-name">${msg.fileName}</div>
                                 <div class="file-size">${fileSizeKB} KB</div>
                             </div>
                         </div>`;
        
        // Add download button for received files
        if (!isSentByMe) {
            const downloadBtn = document.createElement('button');
            downloadBtn.textContent = 'Download';
            downloadBtn.style.marginTop = '8px';
            downloadBtn.style.padding = '6px 12px';
            downloadBtn.style.background = '#3498db';
            downloadBtn.style.color = 'white';
            downloadBtn.style.border = 'none';
            downloadBtn.style.borderRadius = '4px';
            downloadBtn.style.cursor = 'pointer';
            downloadBtn.addEventListener('click', () => {
                downloadFile(msg.fileContent, msg.fileName);
            });
            div.appendChild(downloadBtn);
        }
    } else {
        // Handle text messages
        div.classList.add('message');
        
        if (msg.type === 'private') {
            div.classList.add(isSentByMe ? 'private-sent' : 'private-received');
        } else {
            div.classList.add(isSentByMe ? 'sent' : 'received');
        }
        
        // Detect language and add RTL/LTR class
        const lang = detectLanguage(msg.text);
        div.classList.add(lang);
        
        const senderDisplay = isSentByMe ? 'You' : `${msg.from} (${msg.sessionId.substring(0, 8)}...)`;
        div.innerHTML = `<div class="msg-meta">${senderDisplay} • ${msg.time}</div>
                         <div class="msg-text">${msg.text}</div>`;
    }
    
    messagesDisplay.appendChild(div);
    messagesDisplay.scrollTop = messagesDisplay.scrollHeight;
}

function getFileIcon(fileType) {
    if (fileType.startsWith('image/')) return '🖼️';
    if (fileType.startsWith('video/')) return '🎥';
    if (fileType.startsWith('audio/')) return '🎵';
    if (fileType.includes('pdf')) return '📄';
    if (fileType.includes('word') || fileType.includes('document')) return '📝';
    if (fileType.includes('sheet') || fileType.includes('excel')) return '📊';
    return '📎';
}

function downloadFile(base64Content, fileName) {
    const link = document.createElement('a');
    link.href = 'data:application/octet-stream;base64,' + base64Content;
    link.download = fileName;
    link.click();
}

function addSystemMessage(text) {
    const div = document.createElement('div');
    div.classList.add('system-msg');
    div.textContent = text;
    messagesDisplay.appendChild(div);
    messagesDisplay.scrollTop = messagesDisplay.scrollHeight;
}

function playNotificationSound() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.frequency.value = 800;
        oscillator.type = 'sine';
        gain.gain.setValueAtTime(0.3, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.1);
    } catch(e) { console.log('Audio error:', e); }
}

// --- File Attachment Handling ---
attachBtn.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        // Limit file size to 5MB
        if (file.size > 5 * 1024 * 1024) {
            alert('File size must be less than 5MB');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (event) => {
            const base64Content = event.target.result.split(',')[1]; // Remove data:... prefix
            
            if (privateMessageTarget) {
                socket.emit('send-file', {
                    fileName: file.name,
                    fileType: file.type,
                    fileContent: base64Content,
                    to: privateMessageTarget,
                    isPrivate: true
                });
            } else {
                socket.emit('send-file', {
                    fileName: file.name,
                    fileType: file.type,
                    fileContent: base64Content,
                    isPrivate: false
                });
            }
        };
        reader.readAsDataURL(file);
        fileInput.value = ''; // Reset file input
    }
});

sendBtn.addEventListener('click', () => {
    const text = messageInput.value.trim();
    if (text) {
        if (privateMessageTarget) {
            socket.emit('private-message', { to: privateMessageTarget, text });
        } else {
            socket.emit('send-message', { text });
        }
        messageInput.value = '';
        messageInput.focus();
    }
});

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendBtn.click();
});
