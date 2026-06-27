let myUsername = '';
let currentRoom = 'General';
let privateMessageTarget = null;
let cachedUsersList = [];
let localUnreadMap = {};
// Global state tracking for public rooms unread message tallies
let roomUnreadMap = {};

// WebRTC State Variables
let localStream = null;
let peerConnection = null;
let activeCallTarget = null;
let iceCandidateQueue = [];

// Voice Recording State Variables
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let recordingStartTime = 0;

// Initialize notification sound using a clean, open-source audio asset
const notificationSound = new Audio('https://cdn.jsdelivr.net/gh/gcoro/larasound@master/public/sounds/ping.mp3');

// UI References
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const messagesDisplay = document.getElementById('messages-display');
const currentRoomName = document.getElementById('current-room-name');
const privateModeIndicator = document.getElementById('private-mode-indicator');
const privateTargetUser = document.getElementById('private-target-user');
const backToRoomBtn = document.getElementById('back-to-room-btn');

// File Sharing UI References
const fileBtn = document.getElementById('attach-btn');
const fileInput = document.getElementById('file-input');

// Voice Note UI Reference
const voiceBtn = document.getElementById('voice-btn');

// Call Controls UI References
const callBtn = document.getElementById('call-btn');
const hangupBtn = document.getElementById('hangup-btn');
const callStatus = document.getElementById('call-status');

// Free STUN Server configuration to gather network configurations
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

window.onAuthenticated = function(data) {
    window.myUsername = data.username;
    myUsername = data.username;
    currentRoom = data.currentRoom || 'General';

    localUnreadMap = data.unreadCounts || {};
    cachedUsersList = data.allUsers || [];
    roomUnreadMap = {}; // Reset local room tally

    if (data.rooms) renderRooms(data.rooms);
    renderUsers(cachedUsersList);

    messagesDisplay.innerHTML = '';
    if (data.roomHistory) {
        data.roomHistory.forEach(msg => displayMessage(msg));
    }

    setupSocketListeners();
    setupFileSharingListeners();
    setupVoiceNoteListeners();
    updateAppBranding();
};

function updateAppBranding() {
    const logoEl = document.querySelector('header .logo');
    if (logoEl) logoEl.textContent = 'VeloChat';
}

function setupSocketListeners() {
    if (!window.socket) return;

    window.socket.on('update-room-unread-count', (data) => {
        updateRoomUnreadBadge(data.room, data.count);
    });

    window.socket.on('update-user-list', (users) => {
        cachedUsersList = users;
        renderUsers(cachedUsersList);
    });

    window.socket.on('receive-message', (data) => {
        if (data.from !== myUsername) {
            notificationSound.play().catch(err => console.log("Audio waiting for user interaction."));
        }

        const isPublicMsg = data.type === 'public' || data.type === 'public-file';
        const isPrivateMsg = data.type === 'private' || data.type === 'private-file';

        if (privateMessageTarget) {
            if (isPrivateMsg && (data.from === privateMessageTarget || data.from === myUsername)) {
                displayMessage(data);
                if (data.from === privateMessageTarget) {
                    window.socket.emit('load-private-history', privateMessageTarget);
                }
            } else if (isPublicMsg) {
                updateRoomUnreadBadge(data.room);
            }
        } else {
            if (isPublicMsg) {
                if (data.room === currentRoom) {
                    displayMessage(data);
                } else {
                    updateRoomUnreadBadge(data.room);
                }
            }
        }
    });

    window.socket.on('messages-read', (data) => {
        if (privateMessageTarget && data.byUser === privateMessageTarget) {
            document.querySelectorAll('.read-receipt').forEach(span => {
                span.textContent = '✓✓';
                span.style.color = '#3498db';
                span.title = 'Read';
            });
        }
    });

    window.socket.on('update-unread-count', (data) => {
        localUnreadMap[data.from] = data.count;
        renderUsers(cachedUsersList);
    });

    window.socket.on('room-switched', (data) => {
        messagesDisplay.innerHTML = '';
        if (data.history) {
            data.history.forEach(msg => displayMessage(msg));
        }
    });

    window.socket.on('private-history-loaded', (data) => {
        if (privateMessageTarget === data.targetUsername) {
            messagesDisplay.innerHTML = '';
            if (data.history) {
                data.history.forEach(msg => displayMessage(msg));
            }
        }
    });

    // ==================== WEBRTC INCOMING SIGNALS ====================
    window.socket.on('incoming-call', async (data) => {
        if (peerConnection) return;

        activeCallTarget = data.from;
        iceCandidateQueue = [];

        const modal = document.getElementById('incoming-call-modal');
        const callerLabel = document.getElementById('caller-name-label');
        const acceptBtn = document.getElementById('accept-call-btn');
        const declineBtn = document.getElementById('decline-call-btn');

        callerLabel.textContent = `${data.from} is calling...`;
        modal.classList.remove('hidden');

        acceptBtn.onclick = null;
        declineBtn.onclick = null;

        acceptBtn.onclick = async () => {
            modal.classList.add('hidden');
            showCallUI(true);
            callStatus.textContent = `• Connecting...`;

            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                setupPeerConnection(data.from);

                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));

                while (iceCandidateQueue.length > 0) {
                    const candidate = iceCandidateQueue.shift();
                    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                }

                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);

                window.socket.emit('answer-call', { to: data.from, answer: answer });
            } catch (err) {
                console.error("Error answering call:", err);
                endCall();
            }
        };

        declineBtn.onclick = () => {
            modal.classList.add('hidden');
            window.socket.emit('end-call', { to: data.from });
            cleanCallTracks();
        };
    });

    window.socket.on('call-answered', async (data) => {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            callStatus.textContent = `• Connected`;

            while (iceCandidateQueue.length > 0) {
                const candidate = iceCandidateQueue.shift();
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
        } catch (err) {
            console.error("Error setting up remote answer:", err);
            endCall();
        }
    });

    window.socket.on('ice-candidate', async (data) => {
        try {
            if (peerConnection && peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } else {
                iceCandidateQueue.push(data.candidate);
            }
        } catch (err) {
            console.error("Error adding ICE Candidate:", err);
        }
    });

    window.socket.on('call-ended', () => {
        cleanCallTracks();
    });
}

// ==================== VOICE CHAT NOTES DRIVERS (TOGGLE MODE) ====================
function setupVoiceNoteListeners() {
    if (!voiceBtn) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        voiceBtn.style.display = 'none';
        console.warn('Voice engine is unavailable on this device configuration.');
        return;
    }

    voiceBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!isRecording) {
            startVoiceRecording();
        } else {
            stopVoiceRecording();
        }
    });
}

async function startVoiceRecording() {
    if (isRecording || mediaRecorder) return;

    audioChunks = [];
    isRecording = true;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        if (!isRecording) {
            stream.getTracks().forEach(track => track.stop());
            return;
        }

        let options = { mimeType: 'audio/webm;codecs=opus' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options = { mimeType: 'audio/webm' };
        }

        mediaRecorder = new MediaRecorder(stream, options);

        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            stream.getTracks().forEach(track => track.stop());

            if (audioChunks.length === 0) {
                console.warn("Audio data stream buffer was empty.");
                resetVoiceButtonUI();
                return;
            }

            const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = () => {
                const base64Audio = reader.result;
                const payload = `__VOICE_NOTE__:${base64Audio}`;

                if (privateMessageTarget) {
                    window.socket.emit('private-message', { to: privateMessageTarget, text: payload });
                } else {
                    window.socket.emit('send-message', { text: payload });
                }

                resetVoiceButtonUI();
            };
        };

        mediaRecorder.start(250);
        recordingStartTime = Date.now();

        voiceBtn.textContent = '🛑';
        voiceBtn.style.background = '#e74c3c';
    } catch (err) {
        console.error('Microphone capability context access denied:', err);
        resetVoiceButtonUI();
    }
}

function stopVoiceRecording() {
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
        resetVoiceButtonUI();
        return;
    }

    const recordingDuration = Date.now() - recordingStartTime;

    if (recordingDuration < 500) {
        setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state !== "inactive") {
                mediaRecorder.stop();
            }
        }, 500 - recordingDuration);
    } else {
        mediaRecorder.stop();
    }
}

function resetVoiceButtonUI() {
    isRecording = false;
    mediaRecorder = null;
    voiceBtn.textContent = '🎤';
    voiceBtn.classList.remove('recording-active');
    voiceBtn.style.background = '#786bc0';
}

// ==================== FILE SHARING MANAGEMENT LOGIC ====================
function setupFileSharingListeners() {
    if (!fileBtn || !fileInput) return;

    fileBtn.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (!file) return;

        if (file.size > 10 * 1024 * 1024) {
            alert("File is too large! Maximum limit allowed is 10MB.");
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            const filePayload = {
                fileName: file.name,
                fileType: file.type,
                fileData: e.target.result
            };

            if (privateMessageTarget) {
                filePayload.to = privateMessageTarget;
                window.socket.emit('private-file', filePayload);
            } else {
                window.socket.emit('send-file', filePayload);
            }

            fileInput.value = '';
        };

        reader.readAsDataURL(file);
    });
}

// ==================== WEBRTC RTCCORE LOGIC ====================
async function startVoiceCall() {
    if (!privateMessageTarget) return;
    activeCallTarget = privateMessageTarget;
    iceCandidateQueue = [];
    showCallUI(true);
    callStatus.textContent = `• Calling...`;

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        setupPeerConnection(activeCallTarget);

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        window.socket.emit('call-user', { to: activeCallTarget, offer: offer });
    } catch (err) {
        alert("Could not access microphone. Ensure HTTPS/Localhost connections.");
        endCall();
    }
}

function setupPeerConnection(targetUser) {
    peerConnection = new RTCPeerConnection(rtcConfig);

    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && window.socket) {
            window.socket.emit('ice-candidate', { to: targetUser, candidate: event.candidate });
        }
    };

    peerConnection.ontrack = (event) => {
        let audioEl = document.getElementById('remote-audio-node');
        if (!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.id = 'remote-audio-node';
            audioEl.autoplay = true;
            document.body.appendChild(audioEl);
        }
        audioEl.srcObject = event.streams[0];
    };

    peerConnection.onconnectionstatechange = () => {
        console.log(`WebRTC State: ${peerConnection.connectionState}`);
        if (peerConnection.connectionState === "failed" || peerConnection.connectionState === "disconnected") {
            cleanCallTracks();
        }
    };
}

function endCall() {
    if (activeCallTarget && window.socket) {
        window.socket.emit('end-call', { to: activeCallTarget });
    }
    cleanCallTracks();
}

function cleanCallTracks() {
    showCallUI(false);
    activeCallTarget = null;
    iceCandidateQueue = [];

    const modal = document.getElementById('incoming-call-modal');
    if (modal) modal.classList.add('hidden');

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    const audioEl = document.getElementById('remote-audio-node');
    if (audioEl) audioEl.remove();
}

function showCallUI(onCall) {
    if (onCall) {
        callBtn.classList.add('hidden');
        hangupBtn.classList.remove('hidden');
        callStatus.classList.remove('hidden');
    } else {
        callBtn.classList.remove('hidden');
        hangupBtn.classList.add('hidden');
        callStatus.classList.add('hidden');
        callStatus.textContent = '';
    }
}

// ==================== RENDERING UI CODE ====================
function renderUsers(users) {
    const usersList = document.getElementById('users-list');
    if (!usersList) return;

    usersList.innerHTML = '';
    const loggedInMe = (window.myUsername || myUsername || '').trim().toLowerCase();

    users.forEach(user => {
        if (!user || !user.username) return;
        const isMe = user.username.trim().toLowerCase() === loggedInMe;

        const li = document.createElement('li');
        if (privateMessageTarget && user.username === privateMessageTarget) {
            li.classList.add('private-selected');
        }

        const labelSpan = document.createElement('span');
        if (isMe) {
            labelSpan.innerHTML = `${user.username} <span style="opacity: 0.6; font-size: 11px; margin-left: 4px;">(You)</span>`;
            li.style.pointerEvents = 'none';
        } else {
            labelSpan.textContent = user.username;
            li.onclick = function() {
                enterPrivateMode(user.username);
            };
        }
        li.appendChild(labelSpan);

        const unreadCount = localUnreadMap[user.username] || 0;
        if (!isMe && unreadCount > 0) {
            const badge = document.createElement('span');
            badge.className = 'notification-badge';
            badge.textContent = unreadCount;
            li.appendChild(badge);
        }

        usersList.appendChild(li);
    });
}

function renderRooms(rooms) {
    const roomsList = document.getElementById('rooms-list');
    if (!roomsList) return;

    roomsList.innerHTML = '';
    rooms.forEach(roomName => {
        const name = typeof roomName === 'string' ? roomName : roomName.room_name;
        const li = document.createElement('li');

        li.setAttribute('data-room-name', name);

        const nameSpan = document.createElement('span');
        nameSpan.textContent = name;
        li.appendChild(nameSpan);

        if (name === currentRoom && !privateMessageTarget) {
            li.classList.add('active');
        }

        li.onclick = function() {
            exitPrivateMode();
            switchRoom(name);
        };

        const roomUnreadCount = roomUnreadMap[name] || 0;
        if (roomUnreadCount > 0 && (privateMessageTarget || name !== currentRoom)) {
            const roomBadge = document.createElement('span');
            roomBadge.className = 'notification-badge room-badge';
            roomBadge.textContent = roomUnreadCount;
            li.appendChild(roomBadge);
        }

        roomsList.appendChild(li);
    });
}

function updateRoomUnreadBadge(roomName, serverCount) {
    const finalCount = serverCount !== undefined ? serverCount : (roomUnreadMap[roomName] || 0) + 1;
    roomUnreadMap[roomName] = finalCount;

    const roomLi = document.querySelector(`[data-room-name="${roomName}"]`);
    if (roomLi) {
        let badge = roomLi.querySelector('.room-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'notification-badge room-badge';
            roomLi.appendChild(badge);
        }
        badge.textContent = finalCount;
    }
}

function enterPrivateMode(targetUsername) {
    privateMessageTarget = targetUsername;
    currentRoomName.classList.add('hidden');
    privateModeIndicator.classList.remove('hidden');
    privateTargetUser.textContent = targetUsername;

    callBtn.classList.remove('hidden');

    const allRoomItems = document.querySelectorAll('#rooms-list li');
    allRoomItems.forEach(item => {
        item.classList.remove('active');
    });

    localUnreadMap[targetUsername] = 0;
    renderUsers(cachedUsersList);
    window.socket.emit('load-private-history', targetUsername);
}

function exitPrivateMode() {
    privateMessageTarget = null;
    privateModeIndicator.classList.add('hidden');
    currentRoomName.classList.remove('hidden');

    cleanCallTracks();
    callBtn.classList.add('hidden');

    switchRoom(currentRoom);
}

function switchRoom(roomName) {
    currentRoom = roomName;
    currentRoomName.textContent = roomName;

    roomUnreadMap[roomName] = 0;

    const roomLi = document.querySelector(`[data-room-name="${roomName}"]`);
    if (roomLi) {
        const badge = roomLi.querySelector('.room-badge');
        if (badge) badge.remove();
    }

    const allRoomItems = document.querySelectorAll('#rooms-list li');
    allRoomItems.forEach(item => {
        if (item.getAttribute('data-room-name') === roomName) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    window.socket.emit('join-room', roomName);
}

function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !window.socket) return;

    if (privateMessageTarget) {
        window.socket.emit('private-message', {
            to: privateMessageTarget,
            text: text
        });
    } else {
        window.socket.emit('send-message', {
            text: text
        });
    }

    messageInput.value = '';
    messageInput.focus();
}

function displayMessage(data) {
    let sender = data.from || data.username || data.sender_username;
    let rawText = data.text || data.message_text;
    const timeStampStr = data.time || data.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (!sender) return;

    let fileData = data.fileData;
    let fileType = data.fileType;
    let fileName = data.fileName;
    let isFileType = data.type === 'public-file' || data.type === 'private-file' || fileData;

    if (rawText && rawText.startsWith('__FILE_PAYLOAD__:')) {
        try {
            const parsedFile = JSON.parse(rawText.replace('__FILE_PAYLOAD__:', ''));
            fileData = parsedFile.fileData;
            fileType = parsedFile.fileType;
            fileName = parsedFile.fileName;
            isFileType = true;
        } catch(e) {
            console.error("Failed parsing inline asset attachment", e);
        }
    }

    const msgContainer = document.createElement('div');
    msgContainer.className = 'message';

    const loginUserMatch = (window.myUsername || '').trim();
    if (sender === loginUserMatch) {
        msgContainer.classList.add('sent');
    } else {
        msgContainer.classList.add('received');
    }

    const bubbleCard = document.createElement('div');

    const metaDiv = document.createElement('div');
    metaDiv.className = 'msg-meta';
    metaDiv.textContent = sender === loginUserMatch ? `You • ${timeStampStr}` : `${sender} • ${timeStampStr}`;
    bubbleCard.appendChild(metaDiv);

    const textDiv = document.createElement('div');
    textDiv.className = 'msg-text';

    let readReceiptHtml = '';
    if (sender === loginUserMatch && (data.type === 'private' || data.type === 'private-file' || privateMessageTarget)) {
        if (data.isRead === true || data.is_read === true || data.read === true) {
            readReceiptHtml = `<span class="read-receipt" style="margin-left: 6px; font-size: 11px; color: #2d7ecb; font-weight: bold;" title="Read">✓✓</span>`;
        } else {
            readReceiptHtml = `<span class="read-receipt" style="margin-left: 6px; font-size: 11px; color: #2d7ecb;" title="Sent">✓</span>`;
        }
    }

    if (rawText && rawText.startsWith('__VOICE_NOTE__:')) {
        const audioSrc = rawText.split('__VOICE_NOTE__:')[1];
        textDiv.innerHTML = `
            <audio controls src="${audioSrc}" style="margin-top: 5px; max-width: 100%; height: 36px; display: block;"></audio>
            ${readReceiptHtml}
        `;
    } else if (isFileType) {
        if (fileType && fileType.startsWith('image/')) {
            textDiv.innerHTML = `
                <img src="${fileData}" style="max-width: 200px; display: block; border-radius: 4px; margin-top: 4px;" alt="${fileName || 'Image'}"/>
                ${readReceiptHtml}
            `;
        } else {
            textDiv.innerHTML = `
                <a href="${fileData}" download="${fileName || 'file'}" style="color: #667eea; text-decoration: underline; font-weight: bold;">📥 Download ${fileName || 'Attachment'}</a>
                ${readReceiptHtml}
            `;
        }
    } else {
        if (!rawText) return;
        textDiv.innerHTML = `
            <span style="display:inline-block; word-break:break-word;">${rawText}</span>
            ${readReceiptHtml}
        `;
    }

    bubbleCard.appendChild(textDiv);
    msgContainer.appendChild(bubbleCard);
    messagesDisplay.appendChild(msgContainer);

    messagesDisplay.scrollTop = messagesDisplay.scrollHeight;
}

if (sendBtn) sendBtn.addEventListener('click', sendMessage);
if (messageInput) messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
if (backToRoomBtn) backToRoomBtn.addEventListener('click', exitPrivateMode);

if (callBtn) callBtn.addEventListener('click', startVoiceCall);
if (hangupBtn) hangupBtn.addEventListener('click', endCall);
