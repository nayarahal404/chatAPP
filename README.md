# VeloChat Real-Time Chat System

VeloChat is a comprehensive real-time communication platform built with Node.js, Socket.io, and WebRTC. It supports secure user authentication, public rooms, private messaging, file sharing, and peer-to-peer voice calling.

---

## 🚀 How to Run the Project

1. **Ensure Node.js is installed** on your operating system. You can download it from the [official Node.js website](https://nodejs.org/).
2. **Extract** the project files you downloaded.
3. **Open a terminal or command prompt** inside the extracted project folder.
4. **Install necessary libraries:**

```bash
npm install

```

> 📝 *Note: Ensure you have an internet connection while executing this command to download dependencies like `express`, `socket.io`, `sqlite3`, `bcrypt`, and `node-forge`.*

5. **Start the server:**

```bash
npm start

```

On the first run, the system will automatically create a `/keys` directory and securely generate self-signed SSL certificates (`key.pem` and `cert.pem`) using `node-forge`.
6. **Open the application in your browser:**

* **Local Access:** Navigate to `https://localhost:3000`
* **LAN Access (Other Devices):** Navigate to `https://<YOUR_LOCAL_IP>:3000`

> ⚠️ *Important: Because the generated certificate is self-signed, your browser will show a privacy warning (e.g., "Your connection is not private"). This is normal for local development. Click **Advanced** and select **Proceed to localhost (unsafe)** to open the application.*

---

## 📁 Project Structure

* `server.js`: The main secure server file managing HTTPS configurations, REST APIs, Socket.io connections, and WebRTC signaling.
* `database.js`: Module for managing the SQLite database, including authentication and message storage.
* `public/`: Contains the front-end files (HTML, CSS, JavaScript).
* `public/index.html`: Main UI with authentication modals and chat interface.
* `public/script.js`: Client-side logic for Socket.io, WebRTC, Toggle Voice Notes, and UI interactions.
* `keys/`: Directory holding the auto-generated SSL certificate and private key files (`cert.pem`, `key.pem`).
* `chat_database.db`: The SQLite database file (created automatically on first run).
* `FINAL_TECHNICAL_DOCUMENTATION_EN.md`: Detailed technical documentation.
* `SETUP_GUIDE_EN.md`: Step-by-step setup and run instructions.
* `SYSTEM_ANALYSIS_EN.md`: Analysis of the system architecture and data flow.

---

## 🛠 Technologies Used

* **Backend:** Node.js, Express, Native HTTPS, Socket.io, SQLite, bcrypt, node-forge
* **Frontend:** HTML5, CSS3, JavaScript
* **Communication:** WebSockets (Socket.io) for messaging and status synchronization, WebRTC for P2P Voice Calls
* **Security & Network:** * HTTPS protocol configuration for LAN WebRTC and Media Devices compatibility.
* In-memory RSA certificate generation (2048-bit) using `node-forge`.
* REST API Authentication with bcrypt password hashing.


* **Storage:** Persistent data storage using SQLite for users, rooms, message delivery states, and file payloads.
* **Features:** Public Rooms, Private Messaging, **Real-Time Read Receipts ($\checkmark\checkmark$ indicators)**, File Sharing (up to 10MB payload limit), **Toggle-To-Record Inline Voice Notes**, P2P Voice Calling, Real-time Notifications, and Persistent Chat History.
