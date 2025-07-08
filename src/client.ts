import { io, type Socket } from "socket.io-client";
import { Events } from "./events";
import type { User, Room, Message } from "./types";

// Enhanced state management with better type safety
interface ClientState {
    socket: Socket;
    currentUser: User | null;
    isAuthenticated: boolean;
    currentRoom: string;
    typingUsers: Set<string>;
    isTyping: boolean;
    mentionUsers: User[];
    isMentioning: boolean;
    mentionQuery: string;
    selectedMentionIndex: number;
    mentionStartPosition: number;
    connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
    messageCache: Map<string, Message[]>;
    userCache: Map<string, User>;
}

class StateManager {
    private state: ClientState;
    private listeners: Map<keyof ClientState, Set<(value: unknown) => void>> = new Map();

    constructor() {
        this.state = {
            socket: io({ autoConnect: false }), // Don't auto-connect
            currentUser: null,
            isAuthenticated: false,
            currentRoom: "General",
            typingUsers: new Set<string>(),
            isTyping: false,
            mentionUsers: [],
            isMentioning: false,
            mentionQuery: "",
            selectedMentionIndex: -1,
            mentionStartPosition: -1,
            connectionStatus: 'connecting',
            messageCache: new Map(),
            userCache: new Map()
        };
    }

    get<K extends keyof ClientState>(key: K): ClientState[K] {
        return this.state[key];
    }

    set<K extends keyof ClientState>(key: K, value: ClientState[K]): void {
        this.state[key] = value;
        this.notifyListeners(key, value);
    }

    subscribe<K extends keyof ClientState>(
        key: K,
        callback: (value: ClientState[K]) => void
    ): () => void {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, new Set());
        }

        // Type assertion needed due to type system limitations
        const typedCallback = callback as (value: unknown) => void;
        this.listeners.get(key)!.add(typedCallback);

        // Return unsubscribe function
        return () => {
            this.listeners.get(key)?.delete(typedCallback);
        };
    }

    private notifyListeners<K extends keyof ClientState>(key: K, value: ClientState[K]): void {
        this.listeners.get(key)?.forEach(callback => callback(value));
    }

    // Helper methods for common operations
    addTypingUser(username: string): void {
        const typingUsers = new Set(this.state.typingUsers);
        typingUsers.add(username);
        this.set('typingUsers', typingUsers);
    }

    removeTypingUser(username: string): void {
        const typingUsers = new Set(this.state.typingUsers);
        typingUsers.delete(username);
        this.set('typingUsers', typingUsers);
    }

    cacheMessage(roomName: string, message: Message): void {
        const cache = new Map(this.state.messageCache);
        const roomMessages = cache.get(roomName) || [];
        roomMessages.push(message);

        // Keep only last 100 messages per room
        if (roomMessages.length > 100) {
            roomMessages.splice(0, roomMessages.length - 100);
        }

        cache.set(roomName, roomMessages);
        this.set('messageCache', cache);
    }

    getCachedMessages(roomName: string): Message[] {
        return this.state.messageCache.get(roomName) || [];
    }
}

const stateManager = new StateManager();

// Legacy state object for compatibility (will gradually migrate away from this)
const state = {
    get socket() { return stateManager.get('socket'); },
    get currentUser() { return stateManager.get('currentUser'); },
    set currentUser(value: User | null) { stateManager.set('currentUser', value); },
    get isAuthenticated() { return stateManager.get('isAuthenticated'); },
    set isAuthenticated(value: boolean) { stateManager.set('isAuthenticated', value); },
    get currentRoom() { return stateManager.get('currentRoom'); },
    set currentRoom(value: string) { stateManager.set('currentRoom', value); },
    get typingUsers() { return stateManager.get('typingUsers'); },
    get isTyping() { return stateManager.get('isTyping'); },
    set isTyping(value: boolean) { stateManager.set('isTyping', value); },
    get mentionUsers() { return stateManager.get('mentionUsers'); },
    set mentionUsers(value: User[]) { stateManager.set('mentionUsers', value); },
    get isMentioning() { return stateManager.get('isMentioning'); },
    set isMentioning(value: boolean) { stateManager.set('isMentioning', value); },
    get mentionQuery() { return stateManager.get('mentionQuery'); },
    set mentionQuery(value: string) { stateManager.set('mentionQuery', value); },
    get selectedMentionIndex() { return stateManager.get('selectedMentionIndex'); },
    set selectedMentionIndex(value: number) { stateManager.set('selectedMentionIndex', value); },
    get mentionStartPosition() { return stateManager.get('mentionStartPosition'); },
    set mentionStartPosition(value: number) { stateManager.set('mentionStartPosition', value); }
};

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

// Check authentication status on page load
async function checkAuthStatus() {
    try {
        const response = await fetch('/api/session');
        const result = await response.json() as { authenticated: boolean; user?: User };

        if (result.authenticated) {
            stateManager.set('currentUser', result.user || null);
            stateManager.set('isAuthenticated', true);
            console.log('User authenticated and set in state:', result.user);

            // Now connect the socket after authentication
            const socket = stateManager.get('socket');
            if (!socket.connected) {
                socket.connect();
                console.log('Socket connecting after authentication...');

                // Send login event once when connected
                if (result.user) {
                    socket.once('connect', () => {
                        console.log('Socket connected, sending user_login event for:', result.user?.username);
                        socket.emit(Events.UserLogin, { username: result.user!.username });
                    });
                }
            } else if (result.user) {
                // Already connected, send login event immediately
                console.log('Socket already connected, sending user_login event for:', result.user.username);
                socket.emit(Events.UserLogin, { username: result.user.username });
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
stateManager.get('socket').on(Events.AuthenticationSuccess, (data: { username: string }) => {
    console.log('Socket authentication successful:', data.username);
    // Update the state to reflect successful authentication
    const currentUser = stateManager.get('currentUser');
    if (currentUser) {
        console.log('Authentication confirmed for user:', currentUser.username);
    }
});

// Handle failed authentication from socket
stateManager.get('socket').on(Events.AuthenticationFailed, (error: string) => {
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

    console.log('Updating typing indicator. Users typing:', Array.from(state.typingUsers));

    if (state.typingUsers.size === 0) {
        typingIndicator.textContent = "";
        typingIndicator.style.display = "none";
        console.log('Hiding typing indicator');
    } else if (state.typingUsers.size === 1) {
        const message = `💬 ${Array.from(state.typingUsers)[0]} is typing...`;
        typingIndicator.textContent = message;
        typingIndicator.style.display = "flex";
        console.log('Showing typing indicator:', message);
    } else {
        const message = `💬 ${state.typingUsers.size} people are typing...`;
        typingIndicator.textContent = message;
        typingIndicator.style.display = "flex";
        console.log('Showing typing indicator:', message);
    }
}

function switchRoom(newRoom: string) {
    if (newRoom === state.currentRoom) return;

    // Stop typing when switching rooms
    clearTimeout(typingTimer);
    if (state.isTyping) {
        state.socket.emit(Events.StopTyping);
        state.isTyping = false;
    }

    state.socket.emit(Events.JoinRoom, newRoom);
    state.currentRoom = newRoom;

    // Clear messages and typing indicators
    if (messages) messages.innerHTML = "";
    state.typingUsers.clear();
    updateTypingIndicator();
    setActiveRoomButton(newRoom);

    // Close sidebar on mobile after room selection
    closeSidebar();

    // Request users in the new room
    state.socket.emit(Events.GetUsers);
}

function createRoom() {
    if (!newRoomInput || !newRoomInput.value.trim()) return;

    const roomName = newRoomInput.value.trim();

    // Use the new API-based room creation
    createNewRoom(roomName).catch(error => {
        console.error('Failed to create room:', error);
    });
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

function updateUsersList(users: User[]) {
    if (!usersList) return;

    usersList.innerHTML = '';
    users.forEach(user => {
        const userElement = document.createElement('div');
        userElement.className = 'user-item';
        userElement.innerHTML = `
            <div class="user-avatar">${user.username.charAt(0).toUpperCase()}</div>
            <div class="user-info">
                <div class="user-name">${user.firstName} ${user.lastName} (@${user.username})</div>
            </div>
        `;
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
    uploadFile(file).catch(error => {
        console.error('File upload failed:', error);
        removeUploadProgress();
    });

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
        formData.append('room', state.currentRoom);

        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        const result = await response.json() as {
            success: boolean;
            file?: { filename: string; size: number; mimetype: string; url: string; originalName: string };
            error?: string;
        };

        if (result.success && result.file) {
            // Remove upload progress
            removeUploadProgress();

            // Send file message through socket
            const fileMessage = createFileMessage(file.name, result.file);
            state.socket.emit(Events.ChatMessage, fileMessage);
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

function createFileMessage(originalName: string, fileInfo: { filename: string; size: number; mimetype: string }): string {
    // Create a special file message format that the server can recognize
    return `[FILE:${fileInfo.filename}:${originalName}:${fileInfo.size}:${fileInfo.mimetype}]`;
}

function parseFileMessage(content: string): {
    isFile: boolean;
    fileData?: {
        filename: string;
        originalName: string;
        size: number;
        mimetype: string;
        url: string;
    }
} {
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

function createFileMessageElement(fileData: {
    filename: string;
    originalName: string;
    size: number;
    mimetype: string;
    url: string;
}, _username: string): HTMLElement {
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
            state.mentionUsers = await response.json() as User[];
        }
    } catch (error) {
        console.error('Error fetching users:', error);
    }
}

async function _searchUsers(query: string): Promise<User[]> {
    try {
        const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
        const result = await response.json() as { success: boolean; users?: User[]; error?: string };

        if (result.success) {
            return result.users || [];
        } else {
            console.error('Error searching users:', result.error);
            return [];
        }
    } catch (error) {
        console.error('Error searching users:', error);
        return [];
    }
}

async function getAllUsers(): Promise<User[]> {
    try {
        const response = await fetch('/api/users');
        const result = await response.json() as { success: boolean; users?: User[]; error?: string };

        if (result.success) {
            state.mentionUsers = result.users || [];
            return result.users || [];
        } else {
            console.error('Error getting users:', result.error);
            return [];
        }
    } catch (error) {
        console.error('Error getting users:', error);
        return [];
    }
}

function showMentionDropdown(users: User[], query: string) {
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
    state.selectedMentionIndex = -1;

    filteredUsers.forEach((user, _index) => {
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
    state.isMentioning = false;
    state.selectedMentionIndex = -1;
}

function insertMention(username: string) {
    if (!input) return;

    const currentValue = input.value;
    const beforeMention = currentValue.substring(0, state.mentionStartPosition);
    const afterMention = currentValue.substring(input.selectionStart || state.mentionStartPosition);

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
            state.selectedMentionIndex = Math.min(state.selectedMentionIndex + 1, items.length - 1);
            updateMentionSelection(items);
            return true;
        case 'ArrowUp':
            e.preventDefault();
            state.selectedMentionIndex = Math.max(state.selectedMentionIndex - 1, 0);
            updateMentionSelection(items);
            return true;
        case 'Enter':
            e.preventDefault();
            if (state.selectedMentionIndex >= 0 && state.selectedMentionIndex < items.length) {
                const selectedItem = items[state.selectedMentionIndex];
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
        if (index === state.selectedMentionIndex) {
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
            if (state.isTyping) {
                state.socket.emit(Events.StopTyping);
                state.isTyping = false;
            }

            // Send the message to the server
            state.socket.emit(Events.ChatMessage, input.value);
            input.value = "";

            // Ensure mobile keyboard stays visible
            input.focus();
        }
    });

    // Emit a 'typing' event when the user is typing (with throttling)
    input.addEventListener("input", () => {
        // Handle mention autocomplete
        handleMentionInput().catch(error => console.error('Error handling mention input:', error));

        // Clear existing timer
        clearTimeout(typingTimer);

        // Only emit if user is actually typing (not just cleared input)
        if (input.value.trim().length > 0) {
            // Always emit typing event to refresh server-side timeout
            console.log("Emitting typing event");
            state.socket.emit(Events.Typing);
            state.isTyping = true;
        } else {
            // Input is empty, stop typing immediately
            if (state.isTyping) {
                console.log("Emitting stop typing event (empty input)");
                state.socket.emit(Events.StopTyping);
                state.isTyping = false;
            }
        }

        // Reset timer - stop typing after user stops typing
        typingTimer = window.setTimeout(() => {
            if (state.isTyping) {
                console.log("Typing timeout - emitting stop typing");
                state.socket.emit(Events.StopTyping);
                state.isTyping = false;
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
        if (state.isTyping) {
            console.log("Input lost focus - stopping typing");
            state.socket.emit(Events.StopTyping);
            state.isTyping = false;
        }
        // Hide mention dropdown when input loses focus
        setTimeout(() => {
            hideMentionDropdown();
            state.isMentioning = false;
        }, 200); // Small delay to allow click events on dropdown items
    });

    // Listen for connection
    state.socket.on('connect', () => {
        console.log('Connected to server');
        // Request user info immediately upon connection
        state.socket.emit(Events.GetUserInfo);
        // Fetch users for mention autocomplete
        fetchUsers().catch(error => console.error('Failed to fetch users:', error));
    });

    // Listen for messages from the server
    state.socket.on(Events.ChatMessage, (msg: { user: User, message: string }) => {
        // A message arrived, hide the typing indicator
        state.typingUsers.clear();
        updateTypingIndicator();
        clearTimeout(typingTimer);

        const item = document.createElement("li");

        // Check if this is a file message
        const { isFile, fileData } = parseFileMessage(msg.message);        // Get current user from state manager
        const currentUser = stateManager.get('currentUser');

        // Determine if this is the current user's message
        // Check both user comparison and if the message user matches the authenticated user
        const isOwnMessage = currentUser && (
            currentUser.id === msg.user.id ||
            currentUser.username === msg.user.username ||
            (currentUser.username && msg.user.username && currentUser.username === msg.user.username)
        );

        console.log('Message received:', {
            currentUser: currentUser?.username,
            currentUserId: currentUser?.id,
            msgUser: msg.user.username,
            msgUserId: msg.user.id,
            isOwnMessage
        });

        // Create message header with sender info (for other users only)
        if (!isOwnMessage) {
            const messageHeader = document.createElement('div');
            messageHeader.className = 'message-header';
            messageHeader.innerHTML = `<span class="sender-name">${msg.user.firstName} ${msg.user.lastName}</span> <span class="sender-username">@${msg.user.username}</span>`;
            item.appendChild(messageHeader);
        }

        if (isFile && fileData) {
            // Handle file message
            const fileElement = createFileMessageElement(fileData, msg.user.username);

            if (isOwnMessage) {
                item.classList.add('my-message');
            } else {
                item.classList.add('other-message');
            }

            item.appendChild(fileElement);
        } else {
            // Handle regular text message
            const messageContent = document.createElement('div');
            messageContent.className = 'message-content';

            if (isOwnMessage) {
                item.classList.add('my-message');
                console.log('Added my-message class for text message:', item, 'currentUser:', currentUser?.username);
            } else {
                item.classList.add('other-message');
                console.log('Added other-message class for text message:', item);
            }

            // Highlight mentions
            if (msg.message.includes('@')) {
                messageContent.innerHTML = msg.message.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
            } else {
                messageContent.textContent = msg.message;
            }

            item.appendChild(messageContent);
        }

        if (messages) {
            messages.appendChild(item);
            scrollToBottom();
        }
    });

    // Listen for typing events from other users
    state.socket.on(Events.Typing, (userName: string) => {
        console.log(`${userName} is typing`);
        state.typingUsers.add(userName);
        updateTypingIndicator();
    });

    // Listen for stop typing events from other users
    state.socket.on(Events.StopTyping, (userName: string) => {
        console.log(`${userName} stopped typing`);
        state.typingUsers.delete(userName);
        updateTypingIndicator();
    });

    // Listen for room updates
    state.socket.on(Events.RoomsList, (rooms: string[]) => {
        rooms.forEach(room => addRoomToList(room));
    });

    // Listen for user updates
    state.socket.on(Events.UsersList, (users: User[]) => {
        updateUsersList(users);
    });

    // Listen for mentions
    state.socket.on(Events.UserMention, (data: { from: string, message: string, room: string }) => {
        showMention(data);
    });

    // Listen for user join/leave events
    state.socket.on(Events.UserJoined, (userName: string) => {
        const item = document.createElement("li");
        item.className = "system-message";
        item.textContent = `${userName} joined the room`;
        messages.appendChild(item);
        scrollToBottom();

        // Refresh users list
        state.socket.emit(Events.GetUsers);
    });

    state.socket.on(Events.UserLeft, (userName: string) => {
        const item = document.createElement("li");
        item.className = "system-message";
        item.textContent = `${userName} left the room`;
        messages.appendChild(item);
        scrollToBottom();

        // Remove from typing users
        state.typingUsers.delete(userName);
        updateTypingIndicator();

        // Refresh users list
        state.socket.emit(Events.GetUsers);
    });

    // Listen for room creation confirmation
    state.socket.on(Events.RoomCreated, (roomName: string) => {
        addRoomToList(roomName);
        switchRoom(roomName); // Auto-join the created room
    });

    // Listen for user info
    state.socket.on(Events.UserInfo, (userInfo: { name: string, id: string, currentRoom: string }) => {
        // This is handled by the checkAuthStatus function now
        console.log('User info received, but will rely on session auth:', userInfo);
    });

    // Optional: Listen for confirmation of room join
    state.socket.on(Events.JoinedRoom, (room) => {
        console.log(`Successfully joined room: ${room}`);
    });

    // Check authentication status first, then initialize
    checkAuthStatus().then(() => {
        // Load room data and initial data after authentication
        loadPublicRooms().catch(error => console.error('Failed to load public rooms:', error));
        loadJoinedRooms().catch(error => console.error('Failed to load joined rooms:', error));

        // Request initial data only after authentication
        state.socket.emit(Events.GetRooms);
        state.socket.emit(Events.GetUsers);
        state.socket.emit(Events.GetUserInfo);
    }).catch(error => {
        console.error('Authentication check failed:', error);
        window.location.href = '/login.html';
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
        const result = await response.json() as { success: boolean; rooms?: Room[]; error?: string };

        if (result.success && result.rooms) {
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
                publicRooms.forEach((room: Room) => {
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
        const result = await response.json() as { success: boolean; rooms?: Room[]; error?: string };

        if (result.success && result.rooms) {
            const joinedRooms = result.rooms;
            console.log('Joined rooms:', joinedRooms);
            // You can highlight joined rooms or show special indicators
        }
    } catch (error) {
        console.error('Error loading joined rooms:', error);
    }
}

async function _joinRoom(roomName: string) {
    try {
        const response = await fetch('/api/rooms/join', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ roomName })
        });

        const result = await response.json() as { success: boolean; error?: string };
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

async function _leaveRoom(roomName: string) {
    try {
        const response = await fetch('/api/rooms/leave', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ roomName })
        });

        const result = await response.json() as { success: boolean; error?: string };
        if (result.success) {
            console.log(`Successfully left room: ${roomName}`);
            // Switch to General room after leaving
            if (state.currentRoom === roomName) {
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

        const result = await response.json() as { success: boolean; error?: string };
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
            state.isMentioning = true;
            state.mentionStartPosition = atIndex;
            state.mentionQuery = query;

            // Load users if not cached
            if (state.mentionUsers.length === 0) {
                await getAllUsers();
            }

            // Show dropdown with filtered users
            showMentionDropdown(state.mentionUsers, query);
        } else {
            hideMentionDropdown();
        }
    } else {
        hideMentionDropdown();
    }
}
