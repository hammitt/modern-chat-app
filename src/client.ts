import { io, type Socket } from "socket.io-client";
import { Events } from "./events";
import type { User, Room, Message } from "./types";

// Enhanced state management with better type safety
interface ClientState {
    socket: Socket;
    currentUser: User | null;
    isAuthenticated: boolean;
    currentRoom: string;
    typingUsers: Set<string>; // This will store user UUIDs
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
            typingUsers: new Set<string>(), // This will store user UUIDs
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
    addTypingUser(uuid: string): void {
        const typingUsers = new Set(this.state.typingUsers);
        typingUsers.add(uuid);
        this.set('typingUsers', typingUsers);
    }

    removeTypingUser(uuid: string): void {
        const typingUsers = new Set(this.state.typingUsers);
        typingUsers.delete(uuid);
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

        if (result.authenticated && result.user) {
            stateManager.set('currentUser', result.user);
            stateManager.set('isAuthenticated', true);
            console.log('User authenticated and set in state:', result.user);

            // Now connect the socket after authentication
            const socket = stateManager.get('socket');
            if (!socket.connected) {
                socket.connect();
                console.log('Socket connecting after authentication...');

                // Send login event once when connected
                socket.once('connect', () => {
                    console.log('Socket connected, sending user_login event for:', result.user?.uuid);
                    socket.emit(Events.UserLogin, { userUuid: result.user!.uuid });
                });
            } else {
                // Already connected, send login event immediately
                console.log('Socket already connected, sending user_login event for:', result.user.uuid);
                socket.emit(Events.UserLogin, { userUuid: result.user.uuid });
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
stateManager.get('socket').on(Events.AuthenticationSuccess, (data: { userUuid: string }) => {
    console.log('Socket authentication successful for user UUID:', data.userUuid);
    // Update the state to reflect successful authentication
    const currentUser = stateManager.get('currentUser');
    if (currentUser && currentUser.uuid === data.userUuid) {
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

    const typingUuids = stateManager.get('typingUsers');
    const userCache = stateManager.get('userCache');
    const currentUser = stateManager.get('currentUser');

    // Filter out the current user from the typing list
    const otherTypingUuids = Array.from(typingUuids).filter(uuid => uuid !== currentUser?.uuid);

    if (otherTypingUuids.length === 0) {
        typingIndicator.textContent = "";
        typingIndicator.style.display = "none";
    } else {
        const names = otherTypingUuids.map(uuid => userCache.get(uuid)?.username || 'Someone');
        if (names.length === 1) {
            typingIndicator.textContent = `💬 ${names[0]} is typing...`;
        } else if (names.length === 2) {
            typingIndicator.textContent = `💬 ${names[0]} and ${names[1]} are typing...`;
        } else {
            typingIndicator.textContent = `💬 Several people are typing...`;
        }
        typingIndicator.style.display = "flex";
    }
}

function switchRoom(newRoom: string) {
    const state = stateManager; // Use stateManager directly
    if (newRoom === state.get('currentRoom')) return;

    // Stop typing when switching rooms
    clearTimeout(typingTimer);
    if (state.get('isTyping')) {
        state.get('socket').emit(Events.StopTyping, { room: state.get('currentRoom') });
        state.set('isTyping', false);
    }

    state.get('socket').emit(Events.JoinRoom, { room: newRoom });
    state.set('currentRoom', newRoom);

    // Clear messages and typing indicators
    if (messages) messages.innerHTML = "";
    state.set('typingUsers', new Set());
    updateTypingIndicator();
    setActiveRoomButton(newRoom);

    // Close sidebar on mobile after room selection
    closeSidebar();

    // Request users in the new room
    state.get('socket').emit(Events.GetUsers);
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
        formData.append('room', stateManager.get('currentRoom'));

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
            const fileMessage = {
                room: stateManager.get('currentRoom'),
                messageType: 'file',
                fileName: result.file.originalName,
                fileUrl: result.file.url,
                fileSize: result.file.size,
            };
            stateManager.get('socket').emit(Events.ChatMessage, fileMessage);
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

function createFileMessage(originalName: string, fileInfo: { filename: string; size: number; mimetype: string; url: string; }): Partial<Message> {
    // Create a special file message format that the server can recognize
    return {
        messageType: 'file',
        fileName: originalName,
        fileUrl: fileInfo.url,
        fileSize: fileInfo.size,
        content: `File: ${originalName}`
    };
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

function addMessage(msg: Message) {
    if (!messages) return;

    const item = document.createElement('li');
    item.classList.add('message-item');

    const user = msg.user || stateManager.get('userCache').get(msg.user_uuid);
    const isCurrentUser = msg.user_uuid === stateManager.get('currentUser')?.uuid;

    if (msg.messageType === 'system') {
        item.classList.add('system-message');
        item.textContent = msg.content;
    } else if (user) {
        item.classList.toggle('current-user', isCurrentUser);
        item.setAttribute('data-user-uuid', msg.user_uuid);

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.textContent = user.username.charAt(0).toUpperCase();
        if (user.avatar) {
            avatar.style.backgroundImage = `url(${user.avatar})`;
        }

        const messageBody = document.createElement('div');
        messageBody.className = 'message-body';

        const messageHeader = document.createElement('div');
        messageHeader.className = 'message-header';
        messageHeader.textContent = `${user.firstName} ${user.lastName}`;

        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';

        if (msg.messageType === 'file' && msg.fileName && msg.fileUrl) {
            messageContent.appendChild(createFileMessageElement(msg, user.username));
        } else {
            messageContent.textContent = msg.content;
        }
        
        const messageTimestamp = document.createElement('div');
        messageTimestamp.className = 'message-timestamp';
        messageTimestamp.textContent = new Date(msg.timestamp).toLocaleTimeString();

        messageBody.appendChild(messageHeader);
        messageBody.appendChild(messageContent);
        messageBody.appendChild(messageTimestamp);
        
        item.appendChild(avatar);
        item.appendChild(messageBody);

    } else {
        // Fallback for messages from unknown users
        item.textContent = `${msg.content}`;
    }

    messages.appendChild(item);
    scrollToBottom();
}

function createFileMessageElement(msg: Message, username: string): HTMLElement {
    const fileElement = document.createElement('div');
    fileElement.className = 'file-message';

    const fileLink = document.createElement('a');
    fileLink.href = msg.fileUrl!;
    fileLink.target = '_blank';
    fileLink.rel = 'noopener noreferrer';
    fileLink.textContent = msg.fileName || 'Download File';

    const fileSize = msg.fileSize ? `(${(msg.fileSize / 1024).toFixed(2)} KB)` : '';

    fileElement.innerHTML = `
        <div class="file-icon">📄</div>
        <div class="file-info">
            <div class="file-name">${fileLink.outerHTML}</div>
            <div class="file-size">${fileSize}</div>
        </div>
    `;
    return fileElement;
}

function showMentionDropdown(users: User[], query: string) {
    if (!mentionDropdown || !input) return;

    mentionDropdown.innerHTML = '';
    if (users.length === 0) {
        hideMentionDropdown();
        return;
    }

    users.forEach((user, index) => {
        const item = document.createElement('div');
        item.className = 'mention-item';
        if (index === stateManager.get('selectedMentionIndex')) {
            item.classList.add('selected');
        }
        item.textContent = `${user.firstName} ${user.lastName} (@${user.username})`;
        item.onclick = () => selectMention(user);
        mentionDropdown.appendChild(item);
    });

    const rect = input.getBoundingClientRect();
    mentionDropdown.style.display = 'block';
    mentionDropdown.style.left = `${rect.left}px`;
    mentionDropdown.style.top = `${rect.bottom}px`;
}

function hideMentionDropdown() {
    if (mentionDropdown) {
        mentionDropdown.style.display = 'none';
    }
    stateManager.set('isMentioning', false);
}

function selectMention(user: User) {
    if (!input) return;
    const start = stateManager.get('mentionStartPosition');
    const currentText = input.value;
    const newText = `${currentText.substring(0, start)}@${user.username} `;
    input.value = newText;
    input.focus();
    hideMentionDropdown();
}

function handleMentionNavigation(e: KeyboardEvent): boolean {
    if (!stateManager.get('isMentioning')) return false;

    const items = mentionDropdown?.querySelectorAll('.mention-item');
    if (!items || items.length === 0) return false;

    let index = stateManager.get('selectedMentionIndex');

    if (e.key === 'ArrowDown') {
        index++;
        if (index >= items.length) index = 0;
        e.preventDefault();
    } else if (e.key === 'ArrowUp') {
        index--;
        if (index < 0) index = items.length - 1;
        e.preventDefault();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (index > -1) {
            const selectedUser = stateManager.get('mentionUsers')[index];
            if (selectedUser) {
                selectMention(selectedUser);
            }
        }
        e.preventDefault();
        return true;
    } else {
        return false;
    }
    
    stateManager.set('selectedMentionIndex', index);
    showMentionDropdown(stateManager.get('mentionUsers'), stateManager.get('mentionQuery'));
    return true;
}

async function fetchUsers(query: string): Promise<User[]> {
    try {
        const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
        if (!response.ok) {
            throw new Error('Failed to fetch users');
        }
        return await response.json() as User[];
    } catch (error) {
        console.error('Error fetching users for mention:', error);
        return [];
    }
}

async function getAllUsers(): Promise<void> {
    try {
        const response = await fetch('/api/users');
        if (!response.ok) {
            throw new Error('Failed to fetch all users');
        }
        const users = await response.json() as User[];
        updateUsersList(users);
    } catch (error) {
        console.error('Error fetching all users:', error);
    }
}

// #endregion

// #region Socket Event Handlers
function setupSocketListeners() {
    const socket = stateManager.get('socket');

    socket.on('connect', () => {
        console.log('Socket connected with id:', socket.id);
        stateManager.set('connectionStatus', 'connected');
        const currentUser = stateManager.get('currentUser');
        if (currentUser) {
            socket.emit(Events.UserLogin, { userUuid: currentUser.uuid });
        }
    });

    socket.on('disconnect', () => {
        console.log('Socket disconnected');
        stateManager.set('connectionStatus', 'disconnected');
    });

    socket.on(Events.ChatMessage, (msg: Message) => {
        console.log('Received message:', msg);
        addMessage(msg);
        stateManager.cacheMessage(msg.room, msg);
    });

    socket.on(Events.Typing, (data: { user: User }) => {
        if (data.user.uuid !== stateManager.get('currentUser')?.uuid) {
            stateManager.addTypingUser(data.user.uuid);
            stateManager.get('userCache').set(data.user.uuid, data.user);
            updateTypingIndicator();
        }
    });

    socket.on(Events.StopTyping, (data: { userUuid: string }) => {
        stateManager.removeTypingUser(data.userUuid);
        updateTypingIndicator();
    });

    socket.on(Events.UsersList, (users: User[]) => {
        console.log('Users in room:', users);
        updateUsersList(users);
        // Cache users
        users.forEach(user => stateManager.get('userCache').set(user.uuid, user));
    });

    socket.on(Events.UserJoined, (data: { user: User, room: string }) => {
        addMessage({
            user_uuid: 'system',
            room: data.room,
            content: `${data.user.username} joined the room.`,
            timestamp: new Date().toISOString(),
            messageType: 'system'
        });
        // Add user to cache
        stateManager.get('userCache').set(data.user.uuid, data.user);
    });

    socket.on(Events.UserLeft, (data: { user: User, room: string }) => {
        addMessage({
            user_uuid: 'system',
            room: data.room,
            content: `${data.user.username} left the room.`,
            timestamp: new Date().toISOString(),
            messageType: 'system'
        });
        // Optionally remove user from cache if they are not in any other shared rooms
    });

    socket.on(Events.RoomsList, (rooms: Room[]) => {
        console.log('Received room list:', rooms);
        if (roomList) {
            roomList.innerHTML = ''; // Clear existing rooms
            rooms.forEach(room => addRoomToList(room.name));
        }
    });

    socket.on(Events.RoomCreated, (room: Room) => {
        console.log('New room created:', room);
        addRoomToList(room.name);
    });

    socket.on(Events.UserMention, (data: { from: string; message: string; room: string }) => {
        showMention(data);
    });
}
// #endregion

// #region Initialization
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

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    checkAuthStatus().then(() => {
        init();
        setupSocketListeners();
    }).catch(error => {
        console.error("Initialization failed:", error);
        window.location.href = '/login.html';
    });
});

function init() {
    // Form and input initialization
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

        // Mention handling
        input.addEventListener('input', handleInputForMention);
        input.addEventListener('keydown', (e) => {
            if (stateManager.get('isMentioning')) {
                handleMentionNavigation(e);
            }
        });
        document.addEventListener('click', (e) => {
            if (mentionDropdown && !mentionDropdown.contains(e.target as Node)) {
                hideMentionDropdown();
            }
        });

        // Initial data fetch
        fetchInitialData().catch(error => console.error('Failed to fetch initial data:', error));
    }

    async function fetchInitialData() {
        // Fetch initial room list
        try {
            const response = await fetch('/api/rooms/public');
            const rooms = await response.json() as Room[];
            if (roomList) {
                roomList.innerHTML = '';
                rooms.forEach(room => addRoomToList(room.name));
            }
            // Set the first room as active, or a default
            const initialRoom = rooms.length > 0 ? rooms[0].name : 'General';
            switchRoom(initialRoom);
        } catch (error) {
            console.error('Failed to fetch initial rooms:', error);
        }

        // Fetch all users to populate cache and user list
        await getAllUsers();
    }

    function handleInputForMention() {
        if (!input) return;

        const text = input.value;
        const cursorPos = input.selectionStart;

        if (cursorPos === null) return;

        const atMatch = text.substring(0, cursorPos).match(/@(\w*)$/);

        if (atMatch) {
            const query = atMatch[1];
            stateManager.set('isMentioning', true);
            stateManager.set('mentionQuery', query);
            stateManager.set('mentionStartPosition', atMatch.index || 0);
            stateManager.set('selectedMentionIndex', -1);

            fetchUsers(query).then(users => {
                stateManager.set('mentionUsers', users);
                showMentionDropdown(users, query);
            }).catch(error => console.error('Failed to fetch users for mention:', error));
        } else {
            hideMentionDropdown();
        }
    }
}
