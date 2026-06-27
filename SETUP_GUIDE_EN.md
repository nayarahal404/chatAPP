# VeloChat Real-Time Chat System Setup Guide

This guide provides detailed instructions on how to set up and run the VeloChat real-time chat system, focusing on the new components related to user authentication, file sharing, and WebRTC voice calling.

## 1. Prerequisites

Before you begin, ensure that the following software is installed on your system:

*   **Node.js:** A JavaScript runtime environment. You can download it from the [official Node.js website](https://nodejs.org/). It is recommended to use the latest stable version.
*   **npm package manager:** Comes automatically installed with Node.js.

## 2. Setup and Run Steps

Follow these steps to set up and run the project:

### 2.1. Download the Project

If you haven't already, download the project files and extract them to a folder of your choice.

### 2.2. Install Dependencies

1.  Open a command prompt (Terminal or Command Prompt) and navigate to the project's root folder (where `package.json` is located).
2.  Install all necessary project dependencies, including `express`, `socket.io`, `sqlite3`, and `bcrypt`, using the following command:

    ```bash
    npm install
    ```

    *Note: Ensure your device is connected to the internet while executing this command to download the required packages.*

### 2.3. Run the Server

1.  After the dependencies are installed, remain in the same command prompt window (or open a new one in the same folder).
2.  Start the server using the npm `start` script defined in `package.json`:

    ```bash
    npm start
    ```

    Alternatively, for development with automatic restarts on file changes, you can use:

    ```bash
    npm run dev
    ```

    When the server runs for the first time, the `database.js` file will create a new SQLite database named `chat_database.db` in the project's root folder if it doesn't exist, and it will create the necessary tables: `users`, `rooms`, `messages`, `private_messages`, `room_history`, and `unread_counters`.

    You should see a message in the command prompt indicating that the server is running and listening on port 3000 (or any other specified port).

### 2.4. Access the Application

1.  Open your preferred web browser.
2.  Navigate to the following address:

    ```
    http://localhost:3000
    ```

3.  You will be presented with a login/registration page. You can either register a new account or log in with existing credentials.
4.  You can open multiple browser windows or tabs (or use different browsers) and log in with different usernames to test public and private chat functionalities, including file sharing and voice calls.

## 3. Important Notes

*   **Database:** The SQLite database is stored in the `chat_database.db` file within the project folder. You can use tools like [DB Browser for SQLite](https://sqlitebrowser.org/) to browse the database contents and verify stored messages, user data, and private chat history.
*   **Persistence:** Thanks to the SQLite database, all messages, user data, and unread message logs will remain saved even after restarting the server or closing the application.
*   **Server Restarts:** If you make changes to the server files (`server.js`, `database.js`), you will need to restart the server (via `Ctrl+C` then `npm start` or `npm run dev` again) to apply the changes.
*   **WebRTC (Voice Calling):** For voice calling to function correctly, ensure you are accessing the application over `https://` (if deployed) or `http://localhost` (for local development), as WebRTC requires a secure context or localhost. Your browser will also request microphone access.
