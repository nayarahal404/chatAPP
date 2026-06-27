# Final Technical Documentation: VeloChat Real-Time Chat System

## 1. System Architecture (Detailed)

The system is built using a **Client-Server Architecture** based on **Node.js** and **Socket.io**, enhanced with **WebRTC** for peer-to-peer voice calling. The architecture is designed to handle asynchronous and event-driven communications via a persistent WebSocket connection, alongside RESTful APIs for authentication.

### 1.1 Server-Side Architecture
The server is the heart of the application. It performs the following roles:
*   **Static File Serving:** Uses `express.static` to serve front-end assets (HTML, CSS, JS).
*   **REST API Endpoints:** Provides `/api/register` and `/api/login` endpoints for secure user authentication.
*   **Socket Management:** Manages the lifecycle of WebSocket connections, including session tracking and authentication via the `authenticate` event.
*   **Database Management:** Interacts with the SQLite database to store and retrieve user credentials, session IDs, message history, and file payloads.
*   **State Management:** Maintains an in-memory Map of currently connected users (`users`), tracking their `socket.id`, `username`, `room`, and `sessionId`.
*   **Event Routing:** Intercepts messages and files, routes them to specific rooms or individual users, and stores them in the database.
*   **WebRTC Signaling:** Acts as a signaling server to route SDP offers, answers, and ICE candidates between peers for voice calls.

### 1.2 Client-Side Architecture
The client is a Single Page Application (SPA) that interacts with the server via REST APIs and the Socket.io client library.
*   **UI Layer:** Managed via HTML5 and CSS3, featuring a responsive design with distinct login/register views and a main chat interface.
*   **Socket Layer:** Listens for server events and dynamically updates the user interface without page reloads.
*   **WebRTC Layer:** Manages local media streams (microphone) and peer connections (`RTCPeerConnection`) for voice calling.

## 2. Components

### 2.1 Server Components (`server.js`)
*   **Express Application:** Handles the HTTP server, static routing, and JSON body parsing for authentication APIs.
*   **Socket.io Server:** Attached to the HTTP server to upgrade connections to WebSockets, configured with a 10MB buffer size for file uploads.
*   **Database Module (`database.js`):** Manages the connection to the SQLite database, utilizing `bcrypt` for password hashing and providing Promise-based functions for database operations.
*   **Active User Store:** A `Map` object named `users` that holds temporary information for currently connected users. A `Set` named `activeUsernames` prevents concurrent logins.

### 2.2 Client Components (`index.html`, `script.js`)
*   **Authentication Modals:** Captures user registration and login details, communicating with REST APIs.
*   **Sidebar:** Displays available rooms with unread badges and a list of currently connected users with online status and private message unread counts.
*   **Chat Display:** A scrollable area that shows text messages and renders file attachments (images inline, others as download links).
*   **Input Handler:** Captures user text messages and file selections, sending them to the server.
*   **Call Controls:** UI elements (Call, Accept, Decline, Hangup) to manage WebRTC voice calls.

## 3. Feature Implementation

### 3.1 Authentication and Security
*   **Registration & Login:** Users register and log in using a username and password. Passwords are securely hashed using `bcrypt` before storage.
*   **Session Management:** Upon successful socket authentication, a unique `sessionId` is generated and stored in the database and active user map, ensuring secure tracking of user sessions.
*   **Concurrent Login Prevention:** The server tracks active usernames to prevent the same user from logging in from multiple tabs or devices simultaneously.

### 3.2 Rooms with Notifications and History
Rooms are implemented using Socket.io's `socket.join(roomName)` and `socket.leave(roomName)` functions.
*   **Joining:** When a user clicks on a room name, the client sends a `join-room` event. The server removes the user from their current room and adds them to the new room.
*   **History:** Upon joining, the user receives the last 50 messages from that room's history, retrieved from the database.
*   **Notifications:** If a user is not in a room and a new message arrives, an unread message counter appears next to the room name in the sidebar.

### 3.3 Private Messaging and Notifications
Private messages are fully integrated into the web interface with visual notifications.
*   **User Selection:** Clicking on a user in the "Online Users" sidebar enters "Private Chat" mode.
*   **Notifications:** Real-time badges appear next to usernames when unread private messages are received.
*   **Sound Alerts:** A notification sound plays for new incoming messages from other users.
*   **UI Feedback:** The chat header displays a "Private" badge, the target username, and call control buttons.
*   **Delivery:** The server routes messages via `io.to(targetSocketId).emit(...)` and saves them to the `private_messages` table.

### 3.4 File Sharing
Users can share files up to 10MB in both public rooms and private chats.
*   **Processing:** The client reads the file, converts it to a Base64 string, and sends it along with metadata (name, type) to the server.
*   **Storage:** The server bundles the file metadata and Base64 payload into a JSON string prefixed with `__FILE_PAYLOAD__:` and stores it in the standard message text columns.
*   **Rendering:** The client parses incoming messages; if a `__FILE_PAYLOAD__:` prefix is detected, it renders images inline or provides a download link for other file types.

### 3.5 WebRTC Voice Calling
Users can initiate peer-to-peer voice calls in private chat mode.
*   **Signaling:** The Socket.io server routes `call-user`, `incoming-call`, `answer-call`, `call-answered`, and `ice-candidate` events between the caller and callee.
*   **Media:** The client uses `navigator.mediaDevices.getUserMedia` to access the microphone.
*   **Connection:** An `RTCPeerConnection` is established using Google's public STUN servers to negotiate the connection across NATs.

## 4. Data Flow

1.  **Authentication:** The client sends credentials to `/api/login` or `/api/register`. On success, the client connects via WebSocket and emits an `authenticate` event with the username.
2.  **Initialization:** The server validates the user, generates a session ID, joins them to the 'General' room, and sends back room lists, user lists, history, and unread counts.
3.  **Communication:**
    *   **Public:** Client sends `send-message` or `send-file` -> Server saves to DB -> Server broadcasts `receive-message` to the room.
    *   **Private:** Client sends `private-message` or `private-file` -> Server saves to DB -> Server sends `receive-message` to target and sender.
4.  **Voice Call:** Caller initiates call -> Server routes SDP offer -> Callee accepts -> Server routes SDP answer -> Peers exchange ICE candidates -> P2P audio stream established.
5.  **Termination:** Client closes tab -> Server detects `disconnect` -> Server sets user offline in DB, removes from active maps, and notifies others.

## 5. Technical Design

*   **Concurrency:** Handled by Node.js non-blocking I/O and the event loop.
*   **Low Latency:** Achieved through WebSockets for messaging and WebRTC for direct peer-to-peer audio streaming.
*   **Reliability:** Socket.io provides automatic reconnection if the network is interrupted.
*   **Security:** Passwords are hashed with bcrypt. File uploads are size-limited (10MB) to prevent memory exhaustion.

## 6. Limitations

*   **Scalability:** Although SQLite provides data persistence, it may not be the optimal choice for very large-scale applications requiring high concurrency across multiple servers. For such scenarios, other relational databases (e.g., PostgreSQL, MySQL) or NoSQL solutions might be needed.
*   **File Storage:** Files are currently stored as Base64 strings within the SQLite database. This can rapidly increase database size and impact performance. A dedicated file storage solution (e.g., AWS S3, local file system) is recommended for production.
*   **WebRTC TURN Servers:** The application currently relies only on public STUN servers. In restrictive network environments (strict NATs/firewalls), a TURN server would be required to relay audio traffic.

## 7. Database Component (`database.js`)

The `database.js` module is responsible for managing the SQLite database. Its main functions include:
*   **Database Initialization:** Creating the database file and necessary tables (`users`, `rooms`, `messages`, `private_messages`, `room_history`, `unread_counters`) if they do not exist.
*   **User Management:** Registering users with hashed passwords, authenticating logins, updating session IDs, and tracking online status.
*   **Message Management:** Storing public and private messages (including embedded file payloads), and retrieving chat history.
*   **Unread Message Tracking:** Updating and retrieving the count of unread private messages for each user.

## 8. Future Work

*   **Database Migration:** Implement PostgreSQL or MySQL for improved scalability and concurrent access.
*   **External File Storage:** Migrate file storage from Base64 in SQLite to a dedicated object storage service like AWS S3.
*   **Video Calling:** Extend the WebRTC implementation to support video streams alongside audio.
*   **End-to-End Encryption:** Implement client-side encryption for private messages and file payloads.
*   **Enhanced UI:** Add typing indicators, read receipts, and emojis.
