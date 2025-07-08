import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { chatDatabase } from './database.js';
import {
    initializeServer,
    getUserFromSession,
    getRoomUsers
} from './chatService.js';
import { getBotResponse } from './bot.js';
import { TEST_USERS, getTestBotResponse } from './testEnvironment.js';
import { errorHandler } from './errorHandler.js';
import { performanceMiddleware, performanceMonitor } from './performance.js';
// import { upload } from './middleware/fileUpload.js';
import { config } from './config.js';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import { Events } from './events.js';
import type { Message, SessionUser } from './types/index.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Store room data and user information (keeping in-memory for real-time features)
interface RoomData {
    users: Set<string>; // Store user UUIDs instead of usernames
}

const rooms = new Map<string, RoomData>();
const connectedUsers = new Map<string, ConnectedUser>(); // key is socket.id
const typingUsers = new Map<string, Set<string>>(); // room -> set of user UUIDs who are typing
const typingTimeouts = new Map<string, Map<string, NodeJS.Timeout>>(); // room -> user UUID -> timeout

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

app.use(performanceMiddleware);

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

            const userRooms = await chatDatabase.getUserRooms(req.session.user.uuid);
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

            const { roomId } = req.body;
            await chatDatabase.addUserToRoom(req.session.user.uuid, roomId);
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

app.post('/api/rooms/invite', (req, res) => {
    (async () => {
        try {
            if (!req.session.user) {
                return res.status(401).json({ error: 'Not authenticated' });
            }

            const { roomId, email } = req.body;
            const userToInvite = await chatDatabase.getUserByEmail(email); // Assuming username is an email for invite

            if (!userToInvite) {
                return res.status(404).json({ error: 'User to invite not found' });
            }

            await chatDatabase.addUserToRoom(userToInvite.uuid, roomId);
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

app.use(errorHandler);

// Socket.IO middleware for session handling
io.use((socket, next) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    sessionMiddleware(socket.request as any, {} as any, next as any);
});

// Main Socket.IO connection handler
io.on(Events.Connection, (socket) => {
    (async () => {
        try {
            // Authenticate user based on session
            const sessionUser = await getUserFromSession(socket);
            if (sessionUser?.uuid) {
                const user = await chatDatabase.getUserByUuid(sessionUser.uuid);
                if (user) {
                    socket.data.userUuid = user.uuid;
                    socket.data.userName = user.username;

                    // Add user to connected users list
                    connectedUsers.set(socket.id, {
                        uuid: user.uuid,
                        username: user.username,
                        firstName: user.firstName,
                        lastName: user.lastName,
                        email: user.email,
                        socketId: socket.id,
                        currentRoom: ''
                    });

                    // Set user as online
                    await chatDatabase.setUserOnlineStatus(user.uuid, true);

                    // Notify other clients of the new user
                    socket.broadcast.emit(Events.UserConnected, {
                        uuid: user.uuid,
                        username: user.username,
                        firstName: user.firstName,
                        lastName: user.lastName,
                        avatar: user.avatar,
                        isOnline: true
                    });
                }
            } else {
                // Handle unauthenticated connection
                console.log('Unauthenticated user connected');
                // Optionally disconnect
                // socket.disconnect();
            }

            console.log(`🔌 User connected: ${socket.id}, authenticated as ${socket.data.userName || 'guest'}`);

            socket.on(Events.JoinRoom, (roomName: string) => {
                (async () => {
                    try {
                        const userUuid = socket.data.userUuid;
                        if (!userUuid) return;

                        // Leave previous room if any
                        if (socket.data.room) {
                            socket.leave(socket.data.room);
                            const roomData = rooms.get(socket.data.room);
                            if (roomData) {
                                roomData.users.delete(userUuid);
                                io.to(socket.data.room).emit(Events.RoomUsers, Array.from(roomData.users));
                            }
                        }

                        // Join new room
                        socket.join(roomName);
                        socket.data.room = roomName;

                        const roomData = getOrCreateRoom(roomName);
                        roomData.users.add(userUuid);

                        // Update connected user's current room
                        const connectedUser = connectedUsers.get(socket.id);
                        if (connectedUser) {
                            connectedUser.currentRoom = roomName;
                        }

                        // Send recent messages to the user
                        await sendRecentMessages(socket, roomName);

                        // Notify room about the new user
                        io.to(roomName).emit(Events.UserJoined, {
                            userUuid,
                            username: socket.data.userName
                        });

                        // Update room user list
                        const roomUsers = await getRoomUsers(roomName);
                        io.to(roomName).emit(Events.RoomUsers, roomUsers);

                    } catch (error) {
                        console.error(`Error joining room ${roomName}:`, error);
                    }
                })().catch(error => console.error('Async error in JoinRoom:', error));
            });

            socket.on(Events.ChatMessage, (msg: Message) => {
                (async () => {
                    try {
                        const { room, content, messageType, fileName, fileUrl, fileSize } = msg;
                        const userUuid = socket.data.userUuid;

                        if (!userUuid || !room) {
                            return; // Ignore messages from users not in a room
                        }

                        const user = await chatDatabase.getUserByUuid(userUuid);
                        if (!user) {
                            return; // Ignore messages from unknown users
                        }

                        const newMessage: Message = {
                            user_uuid: userUuid,
                            room,
                            content,
                            timestamp: new Date().toISOString(),
                            messageType: messageType || 'text',
                            fileName,
                            fileUrl,
                            fileSize,
                            user: {
                                uuid: user.uuid,
                                username: user.username,
                                firstName: user.firstName,
                                lastName: user.lastName,
                                avatar: user.avatar
                            }
                        };

                        // Save message to database
                        await chatDatabase.addMessage(newMessage);

                        // Broadcast message to the room
                        io.to(room).emit(Events.ChatMessage, newMessage);

                        // Handle bot responses for test environment
                        if (room === 'Test Environment') {
                            if (TEST_USERS.length > 0) {
                                const randomUser = TEST_USERS[Math.floor(Math.random() * TEST_USERS.length)];
                                const testUser = await chatDatabase.getUserByEmail(randomUser.email);

                                if (testUser) {
                                    const botMessage: Message = {
                                        user_uuid: testUser.uuid,
                                        room,
                                        content: getTestBotResponse(randomUser, socket.data.userName),
                                        timestamp: new Date().toISOString(),
                                        messageType: 'text',
                                        user: {
                                            uuid: testUser.uuid,
                                            username: testUser.username,
                                            firstName: testUser.firstName,
                                            lastName: testUser.lastName,
                                            avatar: testUser.avatar
                                        }
                                    };
                                    await chatDatabase.addMessage(botMessage);
                                    io.to(room).emit(Events.ChatMessage, botMessage);
                                }
                            }
                        }

                        // Handle main bot response
                        const mainBotResponse = getBotResponse(content);
                        if (mainBotResponse) {
                            const systemUser = await chatDatabase.getUserByEmail('system@chat.app');
                            if (systemUser) {
                                const botMessage: Message = {
                                    user_uuid: systemUser.uuid,
                                    room,
                                    content: mainBotResponse,
                                    timestamp: new Date().toISOString(),
                                    messageType: 'system',
                                    user: {
                                        uuid: systemUser.uuid,
                                        username: systemUser.username,
                                        firstName: systemUser.firstName,
                                        lastName: systemUser.lastName,
                                        avatar: systemUser.avatar
                                    }
                                };
                                await chatDatabase.addMessage(botMessage);
                                io.to(room).emit(Events.ChatMessage, botMessage);
                            }
                        }

                    } catch (error) {
                        console.error('Error handling chat message:', error);
                    }
                })().catch(error => console.error('Async error in ChatMessage:', error));
            });

            socket.on(Events.Typing, (room: string) => {
                const userUuid = socket.data.userUuid;
                if (!userUuid) return;

                if (!typingUsers.has(room)) {
                    typingUsers.set(room, new Set());
                }
                typingUsers.get(room)!.add(userUuid);

                if (!typingTimeouts.has(room)) {
                    typingTimeouts.set(room, new Map());
                }

                // Clear previous timeout if any
                if (typingTimeouts.get(room)!.has(userUuid)) {
                    clearTimeout(typingTimeouts.get(room)!.get(userUuid)!);
                }

                // Set a new timeout to remove user from typing list
                const timeout = setTimeout(() => {
                    if (typingUsers.has(room)) {
                        typingUsers.get(room)!.delete(userUuid);
                        io.to(room).emit(Events.Typing, Array.from(typingUsers.get(room)!));
                    }
                }, 3000); // 3 seconds

                typingTimeouts.get(room)!.set(userUuid, timeout);

                io.to(room).emit(Events.Typing, Array.from(typingUsers.get(room)!));
            });

            socket.on(Events.Disconnect, () => {
                (async () => {
                    try {
                        const userUuid = socket.data.userUuid;
                        if (userUuid) {
                            // Remove user from room
                            const roomName = socket.data.room;
                            if (roomName) {
                                const roomData = rooms.get(roomName);
                                if (roomData) {
                                    roomData.users.delete(userUuid);
                                    io.to(roomName).emit(Events.RoomUsers, Array.from(roomData.users));
                                }
                            }

                            // Remove from connected users
                            connectedUsers.delete(socket.id);

                            // Set user as offline
                            await chatDatabase.setUserOnlineStatus(userUuid, false);

                            // Notify other clients
                            socket.broadcast.emit(Events.UserDisconnected, { uuid: userUuid });
                        }
                        console.log(`🔌 User disconnected: ${socket.id}`);
                    } catch (error) {
                        console.error('Error on disconnect:', error);
                    }
                })().catch(error => console.error('Async error in Disconnect:', error));
            });

        } catch (error) {
            console.error('Error in socket connection handler:', error);
        }
    })().catch(error => console.error('Async error in connection handler:', error));
});

const PORT = process.env.PORT || 3000;

// Graceful shutdown
const gracefulShutdown = () => {
    console.log('Server is shutting down...');
    // Cleanly close the server and database connection
    io.close();
    server.close(() => {
        chatDatabase.close();
        performanceMonitor.logMetrics();
        console.log('Server has been shut down.');
        process.exit(0);
    });

    // Force shutdown after a timeout
    setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Initialize and start the server
(async () => {
    try {
        await initializeServer();
        server.listen(PORT, () => {
            console.log(`✅ Server is running on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
})().catch(error => {
    console.error('❌ Unhandled error during server startup:', error);
    process.exit(1);
});