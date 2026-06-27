# System Analysis: Real-Time Chat System

## 1. Introduction

In the era of digital communication, real-time chat systems have become an integral part of our daily lives, whether for personal or professional communication. This project aims to design and develop a real-time chat system based on a client-server architecture, providing essential features such as public rooms, private messages, user management, and **file sharing**. This document focuses on analyzing the proposed system, defining its requirements, and providing an overview of its main components.

## 2. Problem Statement

Modern environments, whether academic or professional, require efficient and instant communication tools. Traditional systems based on email or forums may not provide the speed and interactivity required for real-time communication. There is a pressing need for a simple and effective chat system that facilitates direct interaction between users, while providing an organized environment for group conversations and privacy for individual conversations. The ability to **share files** directly within the chat context has also become an essential requirement to enhance collaboration and information exchange.

## 3. Objectives

This project aims to achieve the following objectives:

*   **Main Objective:** Design and develop a stable and efficient real-time chat system based on a client-server architecture.
*   **Sub-Objectives:**
    *   Provide multiple chat rooms to organize group conversations.
    *   Enable users to send and receive private messages securely.
    *   Manage the list of connected users and display their status.
    *   Provide a persistent history for all conversations using an SQLite database to ensure context continuity even after server restart.
    *   Include an effective notification system to alert users of new messages in rooms or private conversations.
    *   **Add a file sharing feature** to enable users to send and receive files within the chat.
    *   Build a clean, modern, and easy-to-use user interface.

## 4. System Requirements

### 4.1 Functional Requirements

*   The system must allow users to log in with a unique username.
*   The system must support multiple chat rooms that users can join and leave.
*   Users must be able to send public messages within the room they are in.
*   Users must be able to send private messages to other users.
*   The system must display a list of currently connected users.
*   The system must maintain a persistent history of all messages and files in each room and private conversation using an SQLite database.
*   The system must provide visual and auditory notifications for new messages and files (both in rooms and private messages).
*   The system must allow users to switch between rooms and private conversations seamlessly.
*   **The system must support attaching and sending files (e.g., images and documents) in both public rooms and private conversations.**
*   **The system must display received files appropriately (e.g., icons or download links).**

### 4.2 Non-Functional Requirements

*   **Performance:** The system must be able to process messages and files in real-time with minimal latency.
*   **Reliability:** The system must be stable and able to handle disconnections and automatic reconnections.
*   **Usability:** The user interface must be intuitive and easy to use.
*   **Security:** The system must maintain the privacy of private messages (although only basic authentication is currently implemented). The file sending process must be secure.
*   **Scalability:** The design must be scalable in the future to support a larger number of users and rooms. Although SQLite provides data persistence, its limitations in very large-scale expansion scenarios requiring high concurrency across multiple servers should be considered.

## 5. Proposed System Overview

The system is based on a client-server model, where:

*   **Server:** Built using Node.js and the Socket.io library. It manages connections, routes messages **and files**, maintains user and room states, and persistently stores chat history **and files** in an SQLite database.
*   **Client:** A web application (Single Page Application) built using HTML, CSS, and JavaScript. It interacts with the server via Socket.io, displays the user interface, and sends and receives messages **and files**.

Communication between the client and server occurs via WebSockets, providing a continuous, bidirectional communication channel, ideal for real-time chat applications **and small file sharing**.

## 6. High-Level Diagrams

(Use case diagram will be attached separately)
