import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { errorHandler } from './errorHandler.js';
import { performanceMonitor } from './performance.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { Events } from './events.js';
import { TEST_USERS, TEST_ROOMS, getBotResponse as getTestBotResponse, getMainBotResponse } from './testEnvironment.js';
import { chatDatabase } from './database.js';
import type { Message, SessionUser } from './types/index.js';

// Extend socket.data interface
declare module 'socket.io' {
    interface SocketData {
        userUuid?: string;
        userName?: string;  // Keep for backward compatibility
        room?: string;
    }
}

// Extend session interface to include user data
declare module 'express-session' {
    interface SessionData {
        user?: SessionUser;
    }
}

// This is the in-memory user data linked to a socket connection
interface ConnectedUser {
    uuid: string;
    username: string;
    firstName: string;
    lastName: string;
    email: string;
    socketId: string;
    currentRoom: string;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        // Allow images, documents, and common file types
        const allowedMimes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf', 'text/plain', 'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];

        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('File type not allowed'));
        }
    }
});

// Store room data and user information (keeping in-memory for real-time features)
interface RoomData {
    users: Set<string>; // Store user UUIDs instead of usernames
}

const rooms = new Map<string, RoomData>();
const connectedUsers = new Map<string, ConnectedUser>(); // key is socket.id
const typingUsers = new Map<string, Set<string>>(); // room -> set of user UUIDs who are typing
const typingTimeouts = new Map<string, Map<string, NodeJS.Timeout>>(); // room -> user UUID -> timeout

// Initialize database and default rooms
async function initializeServer() {
    try {
        await chatDatabase.init();

        // Ensure system user exists for creating default rooms
        let systemUser = await chatDatabase.getUserByEmail('system@chat.app');
        if (!systemUser) {
            systemUser = await chatDatabase.createUser({
                email: 'system@chat.app',
                username: 'system',
                firstName: 'System',
                lastName: 'Bot'
            });
        }

        // Create default rooms in database
        for (const roomName of TEST_ROOMS) {
            await chatDatabase.createRoom(roomName, `Default ${roomName} room`, systemUser.uuid);
            rooms.set(roomName, {
                users: new Set()
            });
        }

        console.log('✅ Server initialized with database');
    } catch (error) {
        console.error('❌ Failed to initialize server:', error);
        process.exit(1);
    }
}

function getOrCreateRoom(roomName: string): RoomData {
    if (!rooms.has(roomName)) {
        rooms.set(roomName, {
            users: new Set()
        });
    }
    return rooms.get(roomName)!;
}

// Enhanced message retrieval with user data
async function sendRecentMessages(socket: Socket, roomName: string, limit: number = 50): Promise<void> {
    try {
        const messages = await chatDatabase.getRecentMessages(roomName, limit);
        // Messages from getRecentMessages already contain the user object.
        for (const msg of messages) {
            socket.emit(Events.ChatMessage, msg);
        }
    } catch (error) {
        console.error('Error loading recent messages:', error);
    }
}

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/dist', express.static(path.join(__dirname, '..', 'dist')));
app.use(express.json()); // Parse JSON requests

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    if (config.isProduction) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    next();
});

// Rate limiting
const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    message: {
        error: 'Too many requests from this IP, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

app.use(limiter);

// Session middleware with enhanced security
const sessionMiddleware = session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: config.session.secure,
        maxAge: config.session.maxAge,
        httpOnly: true,
        sameSite: 'strict'
    },
    name: 'chat.sid' // Change default session name
});

app.use(sessionMiddleware);

// Authentication routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'chat.html'));
});

app.post('/api/register', (req, res) => {
    const asyncHandler = async () => {
        const { firstName, lastName, username, email } = req.body as {
            firstName: string;
            lastName: string;
            username: string;
            email: string;
        };

        try {
            // Check if user already exists by email
            const existingUser = await chatDatabase.getUserByEmail(email);
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    error: 'Email already registered'
                });
            }

            // Create new user with UUID (username no longer needs to be unique)
            const newUser = await chatDatabase.createUser({
                email: email.trim(),
                username: username.trim(),
                firstName: firstName.trim(),
                lastName: lastName.trim()
            });

            // Create session
            req.session.user = {
                uuid: newUser.uuid,
                email: newUser.email,
                username: newUser.username,
                firstName: newUser.firstName,
                lastName: newUser.lastName,
                avatar: newUser.avatar
            };

            res.json({
                success: true,
                user: {
                    uuid: newUser.uuid,
                    email: newUser.email,
                    username: newUser.username,
                    firstName: newUser.firstName,
                    lastName: newUser.lastName,
                    fullName: `${newUser.firstName} ${newUser.lastName}`,
                    avatar: newUser.avatar
                }
            });
        } catch (error) {
            console.error('Registration error:', error);
            res.status(500).json({
                success: false,
                error: 'Registration failed'
            });
        }
    };

    asyncHandler().catch(error => {
        console.error('Async handler error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    });
});

// Temporary endpoint for testing - login with existing user via email
app.post('/api/login-existing', (req, res) => {
    const asyncHandler = async () => {
        const { email } = req.body as { email: string };

        try {
            const user = await chatDatabase.getUserByEmail(email);
            if (user) {
                // Create session for existing user
                req.session.user = {
                    uuid: user.uuid,
                    email: user.email,
                    username: user.username,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    avatar: user.avatar
                };

                res.json({
                    success: true,
                    user: {
                        uuid: user.uuid,
                        email: user.email,
                        username: user.username,
                        firstName: user.firstName,
                        lastName: user.lastName,
                        avatar: user.avatar
                    }
                });
            } else {
                res.status(404).json({ success: false, error: 'User not found' });
            }
        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({ success: false, error: 'Login failed' });
        }
    };

    asyncHandler().catch(error => {
        console.error('Async handler error:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    });
});

// File upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const fileInfo = {
            filename: req.file.filename,
            originalname: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype,
            url: `/uploads/${req.file.filename}`
        };

        res.json({
            success: true,
            file: fileInfo
        });

        // Optionally emit file upload to the relevant room
        // This would require knowing which room the user is in
        // Could be passed as a form field or handled by the client

    } catch (error) {
        console.error('File upload error:', error);
        res.status(500).json({ error: 'File upload failed' });
    }
});

// Get room list endpoint
app.get('/api/rooms', (req, res) => {
    (async () => {
        try {
            const roomList = await chatDatabase.getAllRooms();
            res.json(roomList);
        } catch (error) {
            console.error('Error fetching rooms:', error);
            res.status(500).json({ error: 'Failed to fetch rooms' });
        }
    })().catch(error => {
        console.error('Error fetching rooms:', error);
        res.status(500).json({ error: 'Failed to fetch rooms' });
    });
});

// Get messages for a room endpoint
app.get('/api/rooms/:roomName/messages', (req, res) => {
    (async () => {
        try {
            const { roomName } = req.params;
            const limit = parseInt(req.query.limit as string) || 50;
            const offset = parseInt(req.query.offset as string) || 0;

            const messages = await chatDatabase.getMessages(roomName, limit, offset);
            res.json(messages);
        } catch (error) {
            console.error('Error fetching messages:', error);
            res.status(500).json({ error: 'Failed to fetch messages' });
        }
    })().catch(error => {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    });
});

// Search messages endpoint
app.get('/api/search', (req, res) => {
    (async () => {
        try {
            const { room, query, limit } = req.query;

            if (!room || !query) {
                return res.status(400).json({ error: 'Room and query parameters required' });
            }

            const messages = await chatDatabase.searchMessages(
                query as string,
                room as string,
                parseInt(limit as string) || 20
            );
            res.json(messages);
        } catch (error) {
            console.error('Error searching messages:', error);
            res.status(500).json({ error: 'Search failed' });
        }
    })().catch(error => {
        console.error('Error searching messages:', error);
        res.status(500).json({ error: 'Search failed' });
    });
});

// Get user search endpoint for mentions
app.get('/api/users/search', (req, res) => {
    (async () => {
        try {
            const { q } = req.query;

            if (!q || typeof q !== 'string') {
                return res.json([]);
            }

            const users = await chatDatabase.searchUsers(q);
            const userSuggestions = users.map(user => ({
                uuid: user.uuid,
                username: user.username,
                firstName: user.firstName,
                lastName: user.lastName,
                avatar: user.avatar,
                isOnline: user.isOnline
            }));

            res.json(userSuggestions);
        } catch (error) {
            console.error('Error searching users:', error);
            res.status(500).json([]);
        }
    })().catch(error => {
        console.error('Error searching users:', error);
        res.status(500).json([]);
    });
});

// Get all users endpoint
app.get('/api/users', (req, res) => {
    (async () => {
        try {
            const users = await chatDatabase.getAllUsers();
            const userList = users.map(user => ({
                uuid: user.uuid,
                username: user.username,
                firstName: user.firstName,
                lastName: user.lastName,
                avatar: user.avatar,
                isOnline: user.isOnline,
                lastSeen: user.lastSeen
            }));

            res.json(userList);
        } catch (error) {
            console.error('Error fetching users:', error);
            res.status(500).json([]);
        }
    })().catch(error => {
        console.error('Error fetching users:', error);
        res.status(500).json([]);
    });
});

// Room management endpoints - public rooms
app.get('/api/rooms/public', (req, res) => {
    (async () => {
        try {
            const publicRooms = await chatDatabase.getPublicRooms();
            res.json(publicRooms);
        } catch (error) {
            console.error('Error fetching rooms:', error);
            res.status(500).json([]);
        }
    })().catch(error => {
        console.error('Error fetching rooms:', error);
        res.status(500).json([]);
    });
});

app.get('/api/rooms/user', (req, res) => {
    (async () => {
        try {
            if (!req.session.user) {
                return res.status(401).json({ error: 'Not authenticated' });
            }

            const userRooms = await chatDatabase.getUserRooms(req.session.user.username);
            res.json(userRooms);
        } catch (error) {
            console.error('Error fetching user rooms:', error);
            res.status(500).json([]);
        }
    })().catch(error => {
        console.error('Error fetching user rooms:', error);
        res.status(500).json([]);
    });
});

app.post('/api/rooms/join', (req, res) => {
    (async () => {
        try {
            if (!req.session.user) {
                return res.status(401).json({ error: 'Not authenticated' });
            }

            const { roomName } = req.body as { roomName: string };
            if (!roomName) {
                return res.status(400).json({ error: 'Room name is required' });
            }

            await chatDatabase.joinRoom(req.session.user.uuid, roomName);
            res.json({ success: true });
        } catch (error) {
            console.error('Error joining room:', error);
            res.status(500).json({ error: 'Failed to join room' });
        }
    })().catch(error => {
        console.error('Error joining room:', error);
        res.status(500).json({ error: 'Failed to join room' });
    });
});

app.post('/api/rooms/leave', (req, res) => {
    (async () => {
        try {
            if (!req.session.user) {
                return res.status(401).json({ error: 'Not authenticated' });
            }

            const { roomName } = req.body as { roomName: string };
            if (!roomName) {
                return res.status(400).json({ error: 'Room name is required' });
            }

            await chatDatabase.leaveRoom(req.session.user.uuid, roomName);
            res.json({ success: true });
        } catch (error) {
            console.error('Error leaving room:', error);
            res.status(500).json({ error: 'Failed to leave room' });
        }
    })().catch(error => {
        console.error('Error leaving room:', error);
        res.status(500).json({ error: 'Failed to leave room' });
    });
});

app.post('/api/rooms/create', (req, res) => {
    (async () => {
        try {
            if (!req.session.user) {
                return res.status(401).json({ error: 'Not authenticated' });
            }

            const { name, description } = req.body as {
                name: string;
                description?: string;
                isPublic?: boolean; // Keep for API compatibility but not used
            };
            if (!name) {
                return res.status(400).json({ error: 'Room name is required' });
            }

            await chatDatabase.createRoom(name, description || '', req.session.user.uuid);
            res.json({ success: true });
        } catch (error) {
            console.error('Error creating room:', error);
            res.status(500).json({ error: 'Failed to create room' });
        }
    })().catch(error => {
        console.error('Error creating room:', error);
        res.status(500).json({ error: 'Failed to create room' });
    });
});

app.post('/api/rooms/invite', (req, res) => {
    (async () => {
        try {
            if (!req.session.user) {
                return res.status(401).json({ error: 'Not authenticated' });
            }

            const { roomName, username } = req.body as { roomName: string; username: string };
            if (!roomName || !username) {
                return res.status(400).json({ error: 'Room name and username are required' });
            }

            // Check if the inviter is in the room
            const isInRoom = await chatDatabase.isUserInRoom(req.session.user.uuid, roomName);
            if (!isInRoom) {
                return res.status(403).json({ error: 'You must be a member of the room to invite others' });
            }

            // Find the user to invite by username and get their UUID
            const userToInvite = await chatDatabase.getUserByUsername(username);
            if (!userToInvite) {
                return res.status(404).json({ error: 'User not found' });
            }

            await chatDatabase.joinRoom(userToInvite.uuid, roomName, req.session.user.uuid);
            res.json({ success: true });
        } catch (error) {
            console.error('Error inviting user:', error);
            res.status(500).json({ error: 'Failed to invite user' });
        }
    })().catch(error => {
        console.error('Error inviting user:', error);
        res.status(500).json({ error: 'Failed to invite user' });
    });
});

app.get('/api/session', (req, res) => {
    if (req.session.user) {
        res.json({
            authenticated: true,
            user: req.session.user
        });
    } else {
        res.json({ authenticated: false });
    }
});

initializeServer().catch(error => {
    console.error("Failed to initialize server:", error);
    process.exit(1);
});

io.on(Events.Connection, (socket: Socket) => {
    console.log('a user connected');

    // For authentication, wait for user_login event
    const userId = socket.id;
    let authenticationAttempted = false;

    // Handle user authentication
    socket.on('user_login', (userData: { username: string }) => {
        clearTimeout(tempUserTimeout); // Clear timeout immediately when auth starts
        authenticationAttempted = true;
        (async () => {
            try {
                console.log('Received user_login event for:', userData.username);
                const user = await chatDatabase.getUserByUsername(userData.username);
                console.log('User found in database:', user ? 'YES' : 'NO');
                if (user) {
                    // Update user online status
                    await chatDatabase.updateUserStatus(user.uuid, true);

                    const connectedUser: ConnectedUser = {
                        uuid: user.uuid,
                        username: user.username,
                        firstName: user.firstName,
                        lastName: user.lastName,
                        email: user.email,
                        socketId: socket.id,
                        currentRoom: 'General'
                    };

                    // Store user data
                    connectedUsers.set(socket.id, connectedUser);
                    console.log('User stored in connectedUsers:', user.username, 'UUID:', user.uuid);

                    socket.data = { userUuid: user.uuid, userName: user.username, room: 'General' };

                    // Join default room
                    void socket.join('General');
                    const room = getOrCreateRoom('General');
                    room.users.add(user.uuid);

                    // Add user to room membership
                    await chatDatabase.addUserToRoom(user.uuid, 'General');

                    // Notify others
                    socket.broadcast.to('General').emit(Events.UserJoined, user.username);

                    // Send recent messages
                    await sendRecentMessages(socket, 'General');

                    socket.emit('authentication_success', { username: user.username, uuid: user.uuid });
                } else {
                    console.log('User not found, sending authentication_failed');
                    socket.emit('authentication_failed', 'User not found');
                }
            } catch (error) {
                console.error('Authentication error:', error);
                socket.emit('authentication_failed', 'Authentication failed');
            }
        })().catch(console.error);
    });

    // Only create temp user if no authentication was attempted after a longer delay
    const tempUserTimeout = setTimeout(() => {
        if (!connectedUsers.has(socket.id) && !authenticationAttempted) {
            console.log('Creating temporary user for socket (no auth attempted)', socket.id);
            const tempUsername = `User${Math.floor(Math.random() * 1000)}`;
            const tempUuid = `temp-${socket.id}-${Date.now()}`;

            // This is a temporary user, so we'll create a partial ConnectedUser object.
            const tempUser: ConnectedUser = {
                uuid: tempUuid,
                username: tempUsername,
                firstName: 'Anonymous',
                lastName: 'User',
                email: `temp-${socket.id}@chat.app`,
                socketId: socket.id,
                currentRoom: 'General'
            };
            connectedUsers.set(socket.id, tempUser);

            socket.data = { userUuid: tempUuid, userName: tempUsername, room: 'General' };
            void socket.join('General');

            const room = getOrCreateRoom('General');
            room.users.add(tempUuid);

            socket.broadcast.to('General').emit(Events.UserJoined, tempUsername);
        } else if (connectedUsers.has(socket.id)) {
            console.log('User already authenticated for socket', socket.id);
        } else {
            console.log('Authentication was attempted but failed for socket', socket.id);
        }
    }, 10000); // Increased timeout to 10 seconds

    socket.on(Events.Disconnect, () => {
        (async () => {
            console.log('user disconnected');
            const userData = connectedUsers.get(socket.id);
            if (userData) {
                // Update user status in database
                try {
                    await chatDatabase.updateUserStatus(userData.username, false);
                } catch (error) {
                    console.error('Error updating user status:', error);
                }

                // Remove user from room
                const roomData = rooms.get(userData.currentRoom);
                if (roomData) {
                    roomData.users.delete(userData.uuid);
                }

                // Remove from typing users
                const typingInRoom = typingUsers.get(userData.currentRoom);
                if (typingInRoom) {
                    typingInRoom.delete(userData.username);
                    const roomTimeouts = typingTimeouts.get(userData.currentRoom);
                    if (roomTimeouts) {
                        const userTimeout = roomTimeouts.get(userData.username);
                        if (userTimeout) {
                            clearTimeout(userTimeout);
                            roomTimeouts.delete(userData.username);
                        }
                    }
                }

                socket.broadcast.to(userData.currentRoom).emit(Events.UserLeft, userData.username);
                connectedUsers.delete(socket.id);
            }
        })().catch(console.error);
    });

    socket.on(Events.JoinRoom, (newRoom: string) => {
        (async () => {
            const userData = connectedUsers.get(socket.id);
            if (!userData) return;

            const oldRoom = userData.currentRoom;

            // Leave old room
            void socket.leave(oldRoom);
            const oldRoomData = rooms.get(oldRoom);
            if (oldRoomData) {
                oldRoomData.users.delete(userData.uuid);
            }

            // Join new room
            void socket.join(newRoom);
            const newRoomData = getOrCreateRoom(newRoom);
            newRoomData.users.add(userData.uuid);

            // Update user data
            userData.currentRoom = newRoom;
            socket.data = { userName: userData.username, room: newRoom };

            // Notify rooms
            socket.broadcast.to(oldRoom).emit(Events.UserLeft, userData.username);
            socket.broadcast.to(newRoom).emit(Events.UserJoined, userData.username);

            // Send recent messages
            await sendRecentMessages(socket, newRoom);

            socket.emit(Events.JoinedRoom, newRoom);
        })().catch(console.error);
    });

    socket.on(Events.ChatMessage, (msg: string) => {
        (async () => {
            const userData = connectedUsers.get(socket.id);
            if (!userData) return;

            // Input validation and sanitization
            if (!msg || typeof msg !== 'string') return;
            const trimmedMsg = msg.trim();
            if (trimmedMsg === '') return;
            if (trimmedMsg.length > 1000) {
                const truncatedMsg = trimmedMsg.substring(0, 1000);
                msg = truncatedMsg;
            } else {
                msg = trimmedMsg;
            }

            const room = userData.currentRoom;
            console.log(`message in room ${room}: ${msg}`);

            // Save message to database
            try {
                // Ensure user exists in database (should exist but let's be safe)
                let user = await chatDatabase.getUserByUuid(userData.uuid);
                if (!user) {
                    user = await chatDatabase.createUser({
                        email: userData.email,
                        username: userData.username,
                        firstName: userData.firstName,
                        lastName: userData.lastName
                    });
                }

                // Ensure room exists in database
                const roomExists = await chatDatabase.getRoomByName(room);
                if (!roomExists) {
                    await chatDatabase.createRoom(room, `${room} chat room`, userData.uuid);
                }

                const messageData: Omit<Message, 'id'> = {
                    room: room,
                    user_uuid: userData.uuid,
                    content: msg,
                    timestamp: new Date().toISOString(),
                    messageType: 'text'
                };
                await chatDatabase.saveMessage(messageData);
            } catch (error) {
                console.error('Error saving message to database:', error);
            }

            // Broadcast the message to the current room
            io.to(room).emit(Events.ChatMessage, { user: userData, message: msg });

            // Handle @mentions
            const mentionRegex = /@(\w+)/g;
            const mentions = [...msg.matchAll(mentionRegex)].map(match => match[1]);

            mentions.forEach(mentionedUser => {
                // Find the mentioned user in active users
                for (const [socketId, user] of connectedUsers.entries()) {
                    if (user.username.toLowerCase() === mentionedUser.toLowerCase()) {
                        io.to(socketId).emit(Events.UserMention, {
                            from: userData.username,
                            message: msg,
                            room: room
                        });
                        break;
                    }
                }
            });

            // Handle bot interactions - only in Test Environment
            if (room === 'Test Environment') {
                // Check for @bot trigger
                const botTrigger = '@bot';
                if (msg.trim().toLowerCase().startsWith(botTrigger)) {
                    const command = msg.trim().substring(botTrigger.length);
                    const botResponse = getMainBotResponse(command);
                    if (botResponse) {
                        setTimeout(() => {
                            (async () => {
                                // Save bot message to database
                                try {
                                    // Create or get bot user with proper UUID
                                    const botUuid = 'bot-system-uuid';
                                    let botUser = await chatDatabase.getUserByUuid(botUuid);
                                    if (!botUser) {
                                        botUser = await chatDatabase.createUser({
                                            email: 'bot@chat.app',
                                            username: 'Bot',
                                            firstName: 'Chat',
                                            lastName: 'Bot'
                                        });
                                    }

                                    const botMessageData: Omit<Message, 'id'> = {
                                        room: room,
                                        user_uuid: botUser.uuid,
                                        content: botResponse,
                                        timestamp: new Date().toISOString(),
                                        messageType: 'text'
                                    };
                                    await chatDatabase.saveMessage(botMessageData);

                                    io.to(room).emit(Events.ChatMessage, { user: botUser, message: botResponse });
                                } catch (error) {
                                    console.error('Error saving bot message:', error);
                                }
                            })().catch(console.error);
                        }, 500 + (Math.random() * 500));
                    }
                }

                // Random test user responses (simulate activity)
                if (Math.random() < 0.3) { // 30% chance
                    const randomUser = TEST_USERS[Math.floor(Math.random() * TEST_USERS.length)];
                    const mentionedBot = mentions.includes('bot') || mentions.includes(randomUser.name);
                    const response = getTestBotResponse(randomUser, mentionedBot ? userData.username : undefined);

                    setTimeout(() => {
                        (async () => {
                            // Save test user message to database
                            try {
                                // Find the test user by username and get their UUID
                                const testUser = await chatDatabase.getUserByUsername(randomUser.name);
                                if (testUser) {
                                    const testMessageData: Omit<Message, 'id'> = {
                                        room: room,
                                        user_uuid: testUser.uuid,
                                        content: response,
                                        timestamp: new Date().toISOString(),
                                        messageType: 'text'
                                    };
                                    await chatDatabase.saveMessage(testMessageData);
                                    io.to(room).emit(Events.ChatMessage, { user: testUser, message: response });
                                }
                            } catch (error) {
                                console.error('Error saving test message:', error);
                            }
                        })().catch(console.error);
                    }, 1000 + (Math.random() * 2000));
                }
            }
        })().catch(console.error);
    });

    socket.on(Events.Typing, () => {
        const userData = connectedUsers.get(userId);
        if (!userData) return;

        const room = userData.currentRoom;

        // Add user to typing users for this room
        if (!typingUsers.has(room)) {
            typingUsers.set(room, new Set());
        }
        if (!typingTimeouts.has(room)) {
            typingTimeouts.set(room, new Map());
        }

        const typingInRoom = typingUsers.get(room)!;
        const roomTimeouts = typingTimeouts.get(room)!;

        // Clear existing timeout for this user
        const existingTimeout = roomTimeouts.get(userData.username);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
        }

        // Add user to typing list
        typingInRoom.add(userData.username);

        // Broadcast to the current room, except the sender
        socket.broadcast.to(room).emit(Events.Typing, userData.username);

        // Set new timeout to remove user from typing after delay
        const timeout = setTimeout(() => {
            typingInRoom.delete(userData.username);
            roomTimeouts.delete(userData.username);
            // Broadcast stop typing to the room
            socket.broadcast.to(room).emit(Events.StopTyping, userData.username);
        }, 3000);

        roomTimeouts.set(userData.username, timeout);
    });

    socket.on(Events.StopTyping, () => {
        const userData = connectedUsers.get(userId);
        if (!userData) return;

        const room = userData.currentRoom;
        const typingInRoom = typingUsers.get(room);
        const roomTimeouts = typingTimeouts.get(room);

        if (typingInRoom && typingInRoom.has(userData.username)) {
            typingInRoom.delete(userData.username);

            // Clear timeout
            if (roomTimeouts) {
                const userTimeout = roomTimeouts.get(userData.username);
                if (userTimeout) {
                    clearTimeout(userTimeout);
                    roomTimeouts.delete(userData.username);
                }
            }

            // Broadcast stop typing to the room
            socket.broadcast.to(room).emit(Events.StopTyping, userData.username);
        }
    });

    socket.on(Events.GetRooms, () => {
        socket.emit(Events.RoomsList, Array.from(rooms.keys()));
    });

    socket.on(Events.GetUsers, () => {
        (async () => {
            const userData = connectedUsers.get(socket.id);
            if (!userData) return;

            const room = userData.currentRoom;
            const roomData = rooms.get(room);
            const userUuidsInRoom = roomData ? Array.from(roomData.users) : [];

            // Get full user objects by UUIDs
            const usersInRoom = await chatDatabase.getUsersByUuids(userUuidsInRoom);

            socket.emit(Events.UsersList, usersInRoom);
        })().catch(console.error);
    });

    socket.on(Events.GetUserInfo, () => {
        const userData = connectedUsers.get(userId);
        if (!userData) return;

        // Emit user info
        socket.emit(Events.UserInfo, userData);
    });
});

// Add error handling middleware (must be last)
app.use(errorHandler);

server.listen(config.port, () => {
    console.log(`🚀 Server running on port ${config.port}`);
    console.log(`📱 Chat app available at: \x1b[36mhttp://localhost:${config.port}\x1b[0m`);
    console.log(`📋 Login page: \x1b[36mhttp://localhost:${config.port}/\x1b[0m`);
    console.log(`💬 Chat page: \x1b[36mhttp://localhost:${config.port}/chat\x1b[0m`);

    // Log memory usage in development
    if (!config.isProduction) {
        console.log(`🔧 Development mode - Performance monitoring enabled`);
        performanceMonitor.logMetrics();
    }
});