# VeloChat Real-Time Chat System

VeloChat is a comprehensive real-time communication platform built with Node.js, Socket.io, and WebRTC. It supports secure user authentication, public rooms, private messaging, file sharing, and peer-to-peer voice calling.

## 🚀 How to Run the Project

1.  **Ensure Node.js is installed** on your operating system. You can download it from the [official Node.js website](https://nodejs.org/).
2.  **Extract** the project files you downloaded.
3.  **Open a terminal or command prompt** inside the extracted project folder.
4.  **Install necessary libraries:**
    ```bash
    npm install
    ```
    *Note: Ensure you have an internet connection while executing this command to download dependencies like `express`, `socket.io`, `sqlite3`, and `bcrypt`.*
5.  **Start the server:**
    ```bash
    npm start
    ```
    Alternatively, for development with automatic restarts on file changes, you can use:
    ```bash
    npm run dev
    ```
6.  **Open the application in your browser:** After the server starts successfully, navigate to: `http://localhost:3000`.

## 📁 Project Structure

*   `server.js`: The main server file managing REST APIs, Socket.io connections, and WebRTC signaling.
*   `database.js`: Module for managing the SQLite database, including authentication and message storage.
*   `public/`: Contains the front-end files (HTML, CSS, JavaScript).
    *   `public/index.html`: Main UI with authentication modals and chat interface.
    *   `public/script.js`: Client-side logic for Socket.io, WebRTC, and UI interactions.
*   `chat_database.db`: The SQLite database file (created automatically on first run).
*   `FINAL_TECHNICAL_DOCUMENTATION_EN.md`: Detailed technical documentation.
*   `SETUP_GUIDE_EN.md`: Step-by-step setup and run instructions.
*   `SYSTEM_ANALYSIS_EN.md`: Analysis of the system architecture and data flow.

## 🛠 Technologies Used

*   **Backend:** Node.js, Express, Socket.io, SQLite, bcrypt
*   **Frontend:** HTML5, CSS3, JavaScript
*   **Communication:** WebSockets (Socket.io) for messaging, WebRTC for P2P Voice Calls
*   **Security:** REST API Authentication with bcrypt password hashing
*   **Storage:** Persistent data storage using SQLite for users, messages, and file payloads.
*   **Features:** Public Rooms, Private Messaging, File Sharing (up to 10MB), Voice Calling, Real-time Notifications, and Persistent Chat History.
