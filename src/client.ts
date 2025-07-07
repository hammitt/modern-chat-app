import { io } from 'socket.io-client';
import { Events } from './events';
import type { User, FileUploadResponse, UserSearchResponse, RoomListResponse } from './types/index.js';

const socket = io();

// DOM Elements
const form = document.getElementById('form');
const input = document.getElementById('input') as HTMLInputElement | null;
const messages = document.getElementById('messages');
const typingIndicator = document.getElementById('typing-indicator');
const roomList = document.getElementById('room-list');
const currentRoomTitle = document.getElementById('current-room-title');
const mobileRoomTitle = document.getElementById('mobile-room-title');
const usersList = document.getElementById('users-list');
const createRoomBtn = document.getElementById('create-room-btn');
const newRoomInput = document.getElementById('new-room-input') as HTMLInputElement;

// File upload elements
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const fileBtn = document.getElementById('file-btn');

// Mention dropdown elements
const mentionDropdown = document.getElementById('mention-dropdown');

// Mobile-specific elements
const menuToggle = document.getElementById('menu-toggle');
const tabletMenuToggle = document.getElementById('tablet-menu-toggle');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const sidebarClose = document.getElementById('sidebar-close');
const _mobileUsersToggle = document.getElementById('mobile-users-toggle');

let typingTimer: number;
const TYPING_TIMER_LENGTH = 1500; // ms
let currentRoom = "General"; // Default room, matches server
const typingUsers = new Set<string>(); // Track who's typing
let currentUserName = ""; // Track current user's name for message alignment
let isTyping = false; // Track if current user is in typing state

// Mention autocomplete variables
let mentionUsers: User[] = []; // Cache of users for mention autocomplete
let isMentioning = false; // Track if user is currently typing a mention
let mentionQuery = ""; // Current mention search query
let selectedMentionIndex = -1; // Currently selected mention item
let mentionStartPosition = -1; // Position where mention started

// Authentication and user management
let currentUser: User | null = null;
let isAuthenticated = false;

// Check authentication status on page load
async function checkAuthStatus() {
    try {
        const response = await fetch('/api/session');
        const result = await response.json();

        if (result.authenticated) {
            currentUser = result.user;
            isAuthenticated = true;
            if (currentUser) {
                currentUserName = currentUser.username;

                // Send login event to socket
                socket.emit('user_login', { username: currentUser.username });
                console.log('User authenticated:', currentUser.username);
            }
        } else {
            // Redirect to login if not authenticated
            window.location.href = '/login.html';
            return;
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        window.location.href = '/login.html';
        return;
    }
}

// Handle successful authentication from socket
socket.on('authentication_success', (data: { username: string }) => {
    console.log('Socket authentication successful:', data.username);
    currentUserName = data.username;
});

// Handle failed authentication from socket
socket.on('authentication_failed', (error: string) => {
    console.error('Socket authentication failed:', error);
    window.location.href = '/login.html';
});

// Mobile interaction handlers
function toggleSidebar() {
    if (!sidebar || !sidebarOverlay || !menuToggle) return;

    const isActive = sidebar.classList.contains('active');

    if (isActive) {
        sidebar.classList.remove('active');
        sidebarOverlay.classList.remove('active');
        menuToggle.classList.remove('active');
    } else {
        sidebar.classList.add('active');
        sidebarOverlay.classList.add('active');
        menuToggle.classList.add('active');
    }
}

function closeSidebar() {
    if (!sidebar || !sidebarOverlay || !menuToggle) return;

    sidebar.classList.remove('active');
    sidebarOverlay.classList.remove('active');
    menuToggle.classList.remove('active');
}

function scrollToBottom() {
    if (messages) {
        messages.scrollTop = messages.scrollHeight;
    }
}

function setActiveRoomButton(room: string) {
    roomList?.querySelectorAll(".room-button").forEach((btn) => {
        if (btn.getAttribute("data-room") === room) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });

    // Update room titles (both desktop and mobile)
    if (currentRoomTitle) {
        currentRoomTitle.textContent = room;
    }
    if (mobileRoomTitle) {
        mobileRoomTitle.textContent = room;
    }
}

function updateTypingIndicator() {
    if (!typingIndicator) return;

    console.log('Updating typing indicator. Users typing:', Array.from(typingUsers));

    if (typingUsers.size === 0) {
        typingIndicator.textContent = "";
        typingIndicator.style.display = "none";
        console.log('Hiding typing indicator');
    } else if (typingUsers.size === 1) {
        const message = `💬 ${Array.from(typingUsers)[0]} is typing...`;
        typingIndicator.textContent = message;
        typingIndicator.style.display = "flex";
        console.log('Showing typing indicator:', message);
    } else {
        const message = `💬 ${typingUsers.size} people are typing...`;
        typingIndicator.textContent = message;
        typingIndicator.style.display = "flex";
        console.log('Showing typing indicator:', message);
    }
}

function switchRoom(newRoom: string) {
    if (newRoom === currentRoom) return;

    // Stop typing when switching rooms
    clearTimeout(typingTimer);
    if (isTyping) {
        socket.emit(Events.StopTyping);
        isTyping = false;
    }

    socket.emit(Events.JoinRoom, newRoom);
    currentRoom = newRoom;

    // Clear messages and typing indicators
    if (messages) messages.innerHTML = "";
    typingUsers.clear();
    updateTypingIndicator();
    setActiveRoomButton(newRoom);

    // Close sidebar on mobile after room selection
    closeSidebar();

    // Request users in the new room
    socket.emit(Events.GetUsers);
}

function createRoom() {
    if (!newRoomInput || !newRoomInput.value.trim()) return;

    const roomName = newRoomInput.value.trim();

    // Use the new API-based room creation
    createNewRoom(roomName);
    newRoomInput.value = '';
}

function addRoomToList(roomName: string) {
    if (!roomList) return;

    // Check if room already exists
    const existingButton = roomList.querySelector(`[data-room="${roomName}"]`);
    if (existingButton) return;

    const button = document.createElement('button');
    button.className = 'room-button';
    button.setAttribute('data-room', roomName);
    button.textContent = roomName;
    roomList.appendChild(button);
}

function updateUsersList(users: string[]) {
    if (!usersList) return;

    usersList.innerHTML = '';
    users.forEach(user => {
        const userElement = document.createElement('div');
        userElement.className = 'user-item';
        userElement.textContent = user;
        usersList.appendChild(userElement);
    });
}

function showMention(data: { from: string, message: string, room: string }) {
    // You could show a notification or highlight the mention
    console.log(`Mentioned by ${data.from} in ${data.room}: ${data.message}`);

    // Simple visual feedback
    document.title = `💬 Mentioned by ${data.from} - Chat App`;
    setTimeout(() => {
        document.title = 'Chat App';
    }, 3000);
}

// File upload functionality
function initFileUpload() {
    if (!fileBtn || !fileInput) return;

    // File button click handler
    fileBtn.addEventListener('click', () => {
        fileInput.click();
    });

    // File input change handler
    fileInput.addEventListener('change', handleFileSelect);
}

function handleFileSelect(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];

    if (!file) return;

    // Validate file size (10MB limit)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
        alert('File size must be less than 10MB');
        return;
    }

    // Show upload progress
    showUploadProgress(file.name);

    // Upload file
    uploadFile(file);

    // Clear input
    target.value = '';
}

function showUploadProgress(fileName: string) {
    if (!messages) return;

    const progressElement = document.createElement('li');
    progressElement.className = 'upload-progress';
    progressElement.innerHTML = `
        <div class="upload-spinner"></div>
        <div class="upload-text">Uploading ${fileName}...</div>
    `;

    messages.appendChild(progressElement);
    messages.scrollTop = messages.scrollHeight;

    // Store reference for removal
    progressElement.id = 'upload-progress-temp';
}

function removeUploadProgress() {
    const progressElement = document.getElementById('upload-progress-temp');
    if (progressElement) {
        progressElement.remove();
    }
}

async function uploadFile(file: File) {
    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('room', currentRoom);

        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            // Remove upload progress
            removeUploadProgress();

            // Send file message through socket
            const fileMessage = createFileMessage(file.name, result.file);
            socket.emit(Events.ChatMessage, fileMessage);
        } else {
            removeUploadProgress();
            alert('File upload failed: ' + result.error);
        }
    } catch (error) {
        removeUploadProgress();
        console.error('Upload error:', error);
        alert('File upload failed');
    }
}

function createFileMessage(originalName: string, fileInfo: any): string {
    // Create a special file message format that the server can recognize
    return `[FILE:${fileInfo.filename}:${originalName}:${fileInfo.size}:${fileInfo.mimetype}]`;
}

function parseFileMessage(content: string): { isFile: boolean; fileData?: any } {
    const fileRegex = /\[FILE:([^:]+):([^:]+):(\d+):([^\]]+)\]/;
    const match = content.match(fileRegex);

    if (match) {
        return {
            isFile: true,
            fileData: {
                filename: match[1],
                originalName: match[2],
                size: parseInt(match[3]),
                mimetype: match[4],
                url: `/uploads/${match[1]}`
            }
        };
    }

    return { isFile: false };
}

function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileExtension(filename: string): string {
    return filename.split('.').pop()?.toUpperCase() || 'FILE';
}

function isImageFile(mimetype: string): boolean {
    return mimetype.startsWith('image/');
}

function createFileMessageElement(fileData: any, username: string): HTMLElement {
    const fileElement = document.createElement('div');
    fileElement.className = 'file-message';

    const fileIcon = getFileExtension(fileData.originalName);
    const fileSize = formatFileSize(fileData.size);

    let fileContent = `
        <div class="file-info">
            <div class="file-icon">${fileIcon}</div>
            <div class="file-details">
                <div class="file-name">${fileData.originalName}</div>
                <div class="file-size">${fileSize}</div>
            </div>
        </div>
        <a href="${fileData.url}" class="file-download" download="${fileData.originalName}">
            Download
        </a>
    `;

    // Add image preview for image files
    if (isImageFile(fileData.mimetype)) {
        fileContent += `
            <img src="${fileData.url}" alt="${fileData.originalName}" class="image-preview" 
                 onclick="window.open('${fileData.url}', '_blank')">
        `;
    }

    fileElement.innerHTML = fileContent;

    return fileElement;
}

// Mention autocomplete functionality
async function fetchUsers(): Promise<void> {
    try {
        const response = await fetch('/api/users');
        if (response.ok) {
            mentionUsers = await response.json();
        }
    } catch (error) {
        console.error('Error fetching users:', error);
    }
}

async function searchUsers(query: string) {
    try {
        const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
        const result = await response.json();

        if (result.success) {
            return result.users;
        } else {
            console.error('Error searching users:', result.error);
            return [];
        }
    } catch (error) {
        console.error('Error searching users:', error);
        return [];
    }
}

async function getAllUsers() {
    try {
        const response = await fetch('/api/users');
        const result = await response.json();

        if (result.success) {
            mentionUsers = result.users;
            return result.users;
        } else {
            console.error('Error getting users:', result.error);
            return [];
        }
    } catch (error) {
        console.error('Error getting users:', error);
        return [];
    }
}

function showMentionDropdown(users: any[], query: string) {
    if (!mentionDropdown || !input) return;

    // Filter users based on query
    const filteredUsers = users.filter(user =>
        user.username.toLowerCase().includes(query.toLowerCase()) ||
        `${user.firstName} ${user.lastName}`.toLowerCase().includes(query.toLowerCase())
    );

    if (filteredUsers.length === 0) {
        hideMentionDropdown();
        return;
    }

    // Create dropdown content
    mentionDropdown.innerHTML = '';
    selectedMentionIndex = -1;

    filteredUsers.forEach((user, index) => {
        const item = document.createElement('div');
        item.className = 'mention-item';
        item.innerHTML = `
            <span class="mention-username">@${user.username}</span>
            <span class="mention-name">${user.firstName} ${user.lastName}</span>
        `;

        item.addEventListener('click', () => {
            insertMention(user.username);
        });

        mentionDropdown.appendChild(item);
    });

    // Position dropdown above input
    const inputRect = input.getBoundingClientRect();
    mentionDropdown.style.display = 'block';
    mentionDropdown.style.left = inputRect.left + 'px';
    mentionDropdown.style.bottom = (window.innerHeight - inputRect.top + 10) + 'px';
    mentionDropdown.style.width = inputRect.width + 'px';
}

function hideMentionDropdown() {
    if (mentionDropdown) {
        mentionDropdown.style.display = 'none';
        mentionDropdown.innerHTML = '';
    }
    isMentioning = false;
    selectedMentionIndex = -1;
}

function insertMention(username: string) {
    if (!input) return;

    const currentValue = input.value;
    const beforeMention = currentValue.substring(0, mentionStartPosition);
    const afterMention = currentValue.substring(input.selectionStart || mentionStartPosition);

    const newValue = beforeMention + `@${username} ` + afterMention;
    input.value = newValue;

    // Set cursor position after the mention
    const newCursorPos = beforeMention.length + username.length + 2; // +2 for "@" and space
    input.setSelectionRange(newCursorPos, newCursorPos);

    hideMentionDropdown();
    input.focus();
}

function handleMentionNavigation(e: KeyboardEvent): boolean {
    if (!mentionDropdown || mentionDropdown.style.display === 'none') return false;

    const items = mentionDropdown.querySelectorAll('.mention-item');
    if (items.length === 0) return false;

    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            selectedMentionIndex = Math.min(selectedMentionIndex + 1, items.length - 1);
            updateMentionSelection(items);
            return true;
        case 'ArrowUp':
            e.preventDefault();
            selectedMentionIndex = Math.max(selectedMentionIndex - 1, 0);
            updateMentionSelection(items);
            return true;
        case 'Enter':
            e.preventDefault();
            if (selectedMentionIndex >= 0 && selectedMentionIndex < items.length) {
                const selectedItem = items[selectedMentionIndex];
                const username = selectedItem.querySelector('.mention-username')?.textContent?.substring(1); // Remove @
                if (username) {
                    insertMention(username);
                }
            }
            return true;
        case 'Escape':
            e.preventDefault();
            hideMentionDropdown();
            return true;
    }

    return false;
}

function updateMentionSelection(items: NodeListOf<Element>) {
    items.forEach((item, index) => {
        if (index === selectedMentionIndex) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });
}

if (form && input && messages && roomList) {
    // Mobile menu handlers
    menuToggle?.addEventListener('click', toggleSidebar);
    tabletMenuToggle?.addEventListener('click', toggleSidebar);
    sidebarClose?.addEventListener('click', closeSidebar);
    sidebarOverlay?.addEventListener('click', closeSidebar);

    // Close sidebar when clicking a room on mobile
    roomList.addEventListener("click", (e) => {
        const target = e.target as HTMLElement;
        if (target && target.matches("button.room-button")) {
            const newRoom = target.getAttribute("data-room");
            if (newRoom) switchRoom(newRoom);
        }
    });

    // Handle room creation
    createRoomBtn?.addEventListener("click", createRoom);
    newRoomInput?.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            createRoom();
        }
    });

    form.addEventListener("submit", (e) => {
        e.preventDefault();
        if (input.value.trim()) {
            // Stop typing when sending message
            clearTimeout(typingTimer);
            if (isTyping) {
                socket.emit(Events.StopTyping);
                isTyping = false;
            }

            // Send the message to the server
            socket.emit(Events.ChatMessage, input.value);
            input.value = "";

            // Ensure mobile keyboard stays visible
            input.focus();
        }
    });

    // Emit a 'typing' event when the user is typing (with throttling)
    input.addEventListener("input", async () => {
        // Handle mention autocomplete
        await handleMentionInput();

        // Clear existing timer
        clearTimeout(typingTimer);

        // Only emit if user is actually typing (not just cleared input)
        if (input.value.trim().length > 0) {
            // Always emit typing event to refresh server-side timeout
            console.log("Emitting typing event");
            socket.emit(Events.Typing);
            isTyping = true;
        } else {
            // Input is empty, stop typing immediately
            if (isTyping) {
                console.log("Emitting stop typing event (empty input)");
                socket.emit(Events.StopTyping);
                isTyping = false;
            }
        }

        // Reset timer - stop typing after user stops typing
        typingTimer = window.setTimeout(() => {
            if (isTyping) {
                console.log("Typing timeout - emitting stop typing");
                socket.emit(Events.StopTyping);
                isTyping = false;
            }
        }, TYPING_TIMER_LENGTH);
    });

    // Handle keyboard navigation for mention dropdown
    input.addEventListener("keydown", (e) => {
        // Handle mention navigation
        if (handleMentionNavigation(e)) {
            return; // Event was handled by mention system
        }
    });

    // Handle mobile-specific input behaviors
    input.addEventListener("focus", () => {
        // Scroll to bottom when input is focused on mobile
        setTimeout(scrollToBottom, 100);
    });

    // Stop typing when input loses focus
    input.addEventListener("blur", () => {
        clearTimeout(typingTimer);
        if (isTyping) {
            console.log("Input lost focus - stopping typing");
            socket.emit(Events.StopTyping);
            isTyping = false;
        }
        // Hide mention dropdown when input loses focus
        setTimeout(() => {
            hideMentionDropdown();
            isMentioning = false;
        }, 200); // Small delay to allow click events on dropdown items
    });

    // Listen for connection
    socket.on('connect', () => {
        console.log('Connected to server');
        // Request user info immediately upon connection
        socket.emit(Events.GetUserInfo);
        // Fetch users for mention autocomplete
        fetchUsers();
    });

    // Listen for messages from the server
    socket.on(Events.ChatMessage, (msg: string) => {
        // A message arrived, hide the typing indicator
        typingUsers.clear();
        updateTypingIndicator();
        clearTimeout(typingTimer);

        const item = document.createElement("li");

        // Check if this is a file message
        const { isFile, fileData } = parseFileMessage(msg);

        if (isFile && fileData) {
            // Handle file message
            const username = msg.split(':')[0]; // Extract username from message
            const fileElement = createFileMessageElement(fileData, username);

            // Determine if this is the current user's message
            const isOwnMessage = currentUserName && msg.startsWith(`${currentUserName}:`);

            if (isOwnMessage) {
                item.classList.add('own-message');
            } else {
                item.classList.add('other-message');
            }

            item.appendChild(fileElement);
        } else {
            // Handle regular text message
            // Determine if this is the current user's message
            const isOwnMessage = currentUserName && msg.startsWith(`${currentUserName}:`);

            // Add appropriate class for styling
            if (isOwnMessage) {
                item.classList.add('own-message');
                console.log('Adding own-message class for:', msg);
            } else if (msg.includes(':') && !msg.includes('Bot:') && !msg.includes(' joined the room') && !msg.includes(' left the room')) {
                // Regular user message from someone else (not system message)
                item.classList.add('other-message');
                console.log('Adding other-message class for:', msg);
            } else {
                // System or bot message - no special alignment
                console.log('System/bot message:', msg);
            }

            // Highlight mentions
            if (msg.includes('@')) {
                item.innerHTML = msg.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
            } else {
                item.textContent = msg;
            }
        }

        if (messages) {
            messages.appendChild(item);
            scrollToBottom();
        }
    });

    // Listen for typing events from other users
    socket.on(Events.Typing, (userName: string) => {
        console.log(`${userName} is typing`);
        typingUsers.add(userName);
        updateTypingIndicator();
    });

    // Listen for stop typing events from other users
    socket.on(Events.StopTyping, (userName: string) => {
        console.log(`${userName} stopped typing`);
        typingUsers.delete(userName);
        updateTypingIndicator();
    });

    // Listen for room updates
    socket.on(Events.RoomsList, (rooms: string[]) => {
        rooms.forEach(room => addRoomToList(room));
    });

    // Listen for user updates
    socket.on(Events.UsersList, (users: string[]) => {
        updateUsersList(users);
    });

    // Listen for mentions
    socket.on(Events.UserMention, (data: { from: string, message: string, room: string }) => {
        showMention(data);
    });

    // Listen for user join/leave events
    socket.on(Events.UserJoined, (userName: string) => {
        const item = document.createElement("li");
        item.className = "system-message";
        item.textContent = `${userName} joined the room`;
        messages.appendChild(item);
        scrollToBottom();

        // Refresh users list
        socket.emit(Events.GetUsers);
    });

    socket.on(Events.UserLeft, (userName: string) => {
        const item = document.createElement("li");
        item.className = "system-message";
        item.textContent = `${userName} left the room`;
        messages.appendChild(item);
        scrollToBottom();

        // Remove from typing users
        typingUsers.delete(userName);
        updateTypingIndicator();

        // Refresh users list
        socket.emit(Events.GetUsers);
    });

    // Listen for room creation confirmation
    socket.on(Events.RoomCreated, (roomName: string) => {
        addRoomToList(roomName);
        switchRoom(roomName); // Auto-join the created room
    });

    // Listen for user info
    socket.on(Events.UserInfo, (userInfo: { name: string, id: string, currentRoom: string }) => {
        currentUserName = userInfo.name;
        console.log('Current user name set to:', currentUserName);
    });

    // Optional: Listen for confirmation of room join
    socket.on(Events.JoinedRoom, (room) => {
        console.log(`Successfully joined room: ${room}`);
    });

    // Check authentication status first, then initialize
    checkAuthStatus().then(() => {
        // Load room data and initial data after authentication
        loadPublicRooms();
        loadJoinedRooms();

        // Request initial data only after authentication
        socket.emit(Events.GetRooms);
        socket.emit(Events.GetUsers);
        socket.emit(Events.GetUserInfo);
    });

    // Handle orientation changes on mobile
    window.addEventListener('orientationchange', () => {
        setTimeout(scrollToBottom, 200);
    });

    // Handle window resize for better mobile experience
    window.addEventListener('resize', () => {
        if (window.innerWidth >= 1024) {
            // Close mobile sidebar on desktop
            closeSidebar();
        }
    });

    // Initialize file upload functionality
    initFileUpload();
} else {
    console.error("Could not find one or more of the required elements");
}

// Room management functions
async function loadPublicRooms() {
    try {
        const response = await fetch('/api/rooms/public');
        const result = await response.json();

        if (result.success) {
            const publicRooms = result.rooms;
            // Update room list with public rooms
            if (roomList) {
                // Clear existing rooms except default ones
                const existingButtons = roomList.querySelectorAll('.room-button');
                existingButtons.forEach(btn => {
                    const room = btn.getAttribute('data-room');
                    if (room !== 'General' && room !== 'Technology' && room !== 'Test Environment') {
                        btn.remove();
                    }
                });

                // Add public rooms
                publicRooms.forEach((room: any) => {
                    addRoomToList(room.name);
                });
            }
        }
    } catch (error) {
        console.error('Error loading public rooms:', error);
    }
}

async function loadJoinedRooms() {
    try {
        const response = await fetch('/api/rooms/joined');
        const result = await response.json();

        if (result.success) {
            const joinedRooms = result.rooms;
            console.log('Joined rooms:', joinedRooms);
            // You can highlight joined rooms or show special indicators
        }
    } catch (error) {
        console.error('Error loading joined rooms:', error);
    }
}

async function joinRoom(roomName: string) {
    try {
        const response = await fetch('/api/rooms/join', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ roomName })
        });

        const result = await response.json();
        if (result.success) {
            console.log(`Successfully joined room: ${roomName}`);
            // The socket will handle the actual room switching
            switchRoom(roomName);
        } else {
            console.error('Failed to join room:', result.error);
        }
    } catch (error) {
        console.error('Error joining room:', error);
    }
}

async function leaveRoom(roomName: string) {
    try {
        const response = await fetch('/api/rooms/leave', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ roomName })
        });

        const result = await response.json();
        if (result.success) {
            console.log(`Successfully left room: ${roomName}`);
            // Switch to General room after leaving
            if (currentRoom === roomName) {
                switchRoom('General');
            }
        } else {
            console.error('Failed to leave room:', result.error);
        }
    } catch (error) {
        console.error('Error leaving room:', error);
    }
}

async function createNewRoom(name: string, description: string = '', isPublic: boolean = true) {
    try {
        const response = await fetch('/api/rooms/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name, description, isPublic })
        });

        const result = await response.json();
        if (result.success) {
            console.log(`Successfully created room: ${name}`);
            addRoomToList(name);
            switchRoom(name);
        } else {
            console.error('Failed to create room:', result.error);
        }
    } catch (error) {
        console.error('Error creating room:', error);
    }
}

async function handleMentionInput() {
    if (!input) return;

    const currentValue = input.value;
    const cursorPos = input.selectionStart || 0;

    // Find @ symbol before cursor
    let atIndex = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
        if (currentValue[i] === '@') {
            atIndex = i;
            break;
        } else if (currentValue[i] === ' ' || i === 0) {
            break;
        }
    }

    if (atIndex >= 0) {
        // Extract mention query
        const query = currentValue.substring(atIndex + 1, cursorPos);

        // Only trigger if query is reasonable length and doesn't contain spaces
        if (query.length <= 20 && !query.includes(' ')) {
            isMentioning = true;
            mentionStartPosition = atIndex;
            mentionQuery = query;

            // Load users if not cached
            if (mentionUsers.length === 0) {
                await getAllUsers();
            }

            // Show dropdown with filtered users
            showMentionDropdown(mentionUsers, query);
        } else {
            hideMentionDropdown();
        }
    } else {
        hideMentionDropdown();
    }
}
