import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import session from 'express-session';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { Events } from './events.js';
import { TEST_USERS, TEST_ROOMS, getBotResponse as getTestBotResponse, getMainBotResponse } from './testEnvironment.js';
import { chatDatabase } from './database.js';
import type { Message } from './types/index.js';


// Extend socket.data interface
declare module 'socket.io' {
    interface SocketData {
        userName?: string;
        room?: string;
    }
}

// Extend session interface to include user data
declare module 'express-session' {
    interface SessionData {
        user?: {
            username: string;
            firstName: string;
            lastName: string;
            email?: string;
        };
    }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

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
    users: Set<string>;
}

interface UserData {
    id: string;
    name: string;
    currentRoom: string;
}

const rooms = new Map<string, RoomData>();
const users = new Map<string, UserData>();
const typingUsers = new Map<string, Set<string>>(); // room -> set of user names who are typing
const typingTimeouts = new Map<string, Map<string, NodeJS.Timeout>>(); // room -> user -> timeout

// Initialize database and default rooms
async function initializeServer() {
    try {
        await chatDatabase.init();

        // Create default rooms in database
        for (const roomName of TEST_ROOMS) {
            await chatDatabase.createRoom(roomName, `Default ${roomName} room`, 'system');
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
        // Create room in database asynchronously
        void chatDatabase.createRoom(roomName, '', 'system').catch(console.error);
    }
    return rooms.get(roomName)!;
}

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/dist', express.static(path.join(__dirname, '..', 'dist')));
app.use(express.json()); // Parse JSON requests

// Session configuration
app.use(session({
    secret: 'chat-app-secret-key', // In production, use a secure random key
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true if using HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Authentication routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'chat.html'));
});

app.post('/api/login', (req, res) => {
    (async () => {
        try {
            const { firstName, lastName, username, email } = req.body as {
                firstName: string;
                lastName: string;
                username: string;
                email?: string;
            };

            // Validate required fields
            if (!firstName || !lastName || !username) {
                return res.status(400).json({
                    success: false,
                    error: 'First name, last name, and username are required'
                });
            }

            // Check if username already exists
            const existingUser = await chatDatabase.getUserByUsername(username);
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    error: 'Username already taken. Please choose another.'
                });
            }

            // Create new user
            await chatDatabase.createUser(username, firstName, lastName, email);

            // Get the created user
            const newUser = await chatDatabase.getUserByUsername(username);

            // Create session
            req.session.user = {
                username: newUser!.username,
                firstName: newUser!.firstName,
                lastName: newUser!.lastName,
                email: newUser!.email
            };

            // Join the user to the General room by default
            await chatDatabase.joinRoom(username, 'General');

            res.json({
                success: true,
                user: {
                    username: newUser?.username,
                    firstName: newUser?.firstName,
                    lastName: newUser?.lastName,
                    fullName: `${newUser?.firstName} ${newUser?.lastName}`,
                    email: newUser?.email
                }
            });

        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({
                success: false,
                error: 'Server error. Please try again.'
            });
        }
    })().catch(error => {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error. Please try again.'
        });
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
            const roomList = await chatDatabase.getRooms();
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
                room as string,
                query as string,
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
                username: user.username,
                fullName: `${user.firstName} ${user.lastName}`,
                firstName: user.firstName,
                lastName: user.lastName,
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
                username: user.username,
                fullName: `${user.firstName} ${user.lastName}`,
                firstName: user.firstName,
                lastName: user.lastName,
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

            await chatDatabase.joinRoom(req.session.user.username, roomName);
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

            await chatDatabase.leaveRoom(req.session.user.username, roomName);
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

            const { name, description, isPublic } = req.body as {
                name: string;
                description?: string;
                isPublic?: boolean;
            };
            if (!name) {
                return res.status(400).json({ error: 'Room name is required' });
            }

            await chatDatabase.createRoom(name, description || '', req.session.user.username, isPublic !== false);
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
            const isInRoom = await chatDatabase.isUserInRoom(req.session.user.username, roomName);
            if (!isInRoom) {
                return res.status(403).json({ error: 'You must be a member of the room to invite others' });
            }

            await chatDatabase.joinRoom(username, roomName, req.session.user.username);
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

io.on(Events.Connection, (socket: Socket) => {
    console.log('a user connected');

    // For authentication, wait for user_login event
    const userId = socket.id;
    let userName: string;
    let authenticatedUser: { username: string; firstName: string; lastName: string; email?: string } | null = null;

    // Handle user authentication
    socket.on('user_login', (userData: { username: string }) => {
        (async () => {
            try {
                const user = await chatDatabase.getUserByUsername(userData.username);
                if (user) {
                    authenticatedUser = user;
                    userName = user.username;

                    // Update user online status
                    await chatDatabase.updateUserStatus(userName, true);

                    // Store user data
                    users.set(userId, {
                        id: userId,
                        name: userName,
                        currentRoom: 'General'
                    });

                    socket.data = { userName, room: 'General' };

                    // Join default room
                    void socket.join('General');
                    const room = getOrCreateRoom('General');
                    room.users.add(userName);

                    // Notify others
                    socket.broadcast.to('General').emit(Events.UserJoined, userName);

                    // Send recent messages
                    try {
                        const recentMessages = await chatDatabase.getRecentMessages('General', 50);
                        recentMessages.forEach(msg => {
                            socket.emit(Events.ChatMessage, msg.content);
                        });
                    } catch (error) {
                        console.error('Error loading recent messages:', error);
                    }

                    socket.emit('authentication_success', { username: userName });
                } else {
                    socket.emit('authentication_failed', 'User not found');
                }
            } catch (error) {
                console.error('Authentication error:', error);
                socket.emit('authentication_failed', 'Authentication failed');
            }
        })().catch(console.error);
    });

    // For backwards compatibility, create temp user if no authentication
    setTimeout(() => {
        if (!authenticatedUser) {
            userName = `User${Math.floor(Math.random() * 1000)}`;

            users.set(userId, {
                id: userId,
                name: userName,
                currentRoom: 'General'
            });

            socket.data = { userName, room: 'General' };
            void socket.join('General');

            const room = getOrCreateRoom('General');
            room.users.add(userName);

            socket.broadcast.to('General').emit(Events.UserJoined, userName);
        }
    }, 1000);

    socket.on(Events.Disconnect, () => {
        (async () => {
            console.log('user disconnected');
            const userData = users.get(userId);
            if (userData) {
                // Update user status in database
                try {
                    if (authenticatedUser) {
                        await chatDatabase.updateUserStatus(userData.name, false);
                    }
                } catch (error) {
                    console.error('Error updating user status:', error);
                }

                // Remove user from room
                const roomData = rooms.get(userData.currentRoom);
                if (roomData) {
                    roomData.users.delete(userData.name);
                }

                // Remove from typing users
                const typingInRoom = typingUsers.get(userData.currentRoom);
                if (typingInRoom) {
                    typingInRoom.delete(userData.name);
                    const roomTimeouts = typingTimeouts.get(userData.currentRoom);
                    if (roomTimeouts) {
                        const userTimeout = roomTimeouts.get(userData.name);
                        if (userTimeout) {
                            clearTimeout(userTimeout);
                            roomTimeouts.delete(userData.name);
                        }
                    }
                }

                socket.broadcast.to(userData.currentRoom).emit(Events.UserLeft, userData.name);
                users.delete(userId);
            }
        })().catch(console.error);
    });

    socket.on(Events.JoinRoom, (newRoom: string) => {
        (async () => {
            const userData = users.get(userId);
            if (!userData) return;

            const oldRoom = userData.currentRoom;

            // Leave old room
            void socket.leave(oldRoom);
            const oldRoomData = rooms.get(oldRoom);
            if (oldRoomData) {
                oldRoomData.users.delete(userData.name);
            }

            // Join new room
            void socket.join(newRoom);
            const newRoomData = getOrCreateRoom(newRoom);
            newRoomData.users.add(userData.name);

            // Update user data
            userData.currentRoom = newRoom;
            socket.data = { userName: userData.name, room: newRoom };

            // Notify rooms
            socket.broadcast.to(oldRoom).emit(Events.UserLeft, userData.name);
            socket.broadcast.to(newRoom).emit(Events.UserJoined, userData.name);

            // Send recent messages
            try {
                const recentMessages = await chatDatabase.getRecentMessages(newRoom, 50);
                recentMessages.forEach(msg => {
                    socket.emit(Events.ChatMessage, msg.content);
                });
            } catch (error) {
                console.error('Error loading messages:', error);
            }

            socket.emit(Events.JoinedRoom, newRoom);
        })().catch(console.error);
    });

    socket.on(Events.ChatMessage, (msg: string) => {
        (async () => {
            const userData = users.get(userId);
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

            // Format message with user name
            const formattedMsg = `${userData.name}: ${msg}`;

            // Save message to database
            try {
                const messageData: Omit<Message, 'id'> = {
                    room: room,
                    username: userData.name,
                    content: formattedMsg,
                    timestamp: new Date().toISOString(),
                    messageType: 'text'
                };
                await chatDatabase.saveMessage(messageData);
            } catch (error) {
                console.error('Error saving message to database:', error);
            }

            // Broadcast the message to the current room
            io.to(room).emit(Events.ChatMessage, formattedMsg);

            // Handle @mentions
            const mentionRegex = /@(\w+)/g;
            const mentions = [...msg.matchAll(mentionRegex)].map(match => match[1]);

            mentions.forEach(mentionedUser => {
                // Find the mentioned user in active users
                for (const [socketId, user] of users.entries()) {
                    if (user.name.toLowerCase() === mentionedUser.toLowerCase()) {
                        io.to(socketId).emit(Events.UserMention, {
                            from: userData.name,
                            message: formattedMsg,
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
                                    const botMessageData: Omit<Message, 'id'> = {
                                        room: room,
                                        username: 'Bot',
                                        content: botResponse,
                                        timestamp: new Date().toISOString(),
                                        messageType: 'text'
                                    };
                                    await chatDatabase.saveMessage(botMessageData);
                                } catch (error) {
                                    console.error('Error saving bot message:', error);
                                }

                                io.to(room).emit(Events.ChatMessage, botResponse);
                            })().catch(console.error);
                        }, 500 + (Math.random() * 500));
                    }
                }

                // Random test user responses (simulate activity)
                if (Math.random() < 0.3) { // 30% chance
                    const randomUser = TEST_USERS[Math.floor(Math.random() * TEST_USERS.length)];
                    const mentionedBot = mentions.includes('bot') || mentions.includes(randomUser.name);
                    const response = getTestBotResponse(randomUser, mentionedBot ? userData.name : undefined);

                    setTimeout(() => {
                        (async () => {
                            // Save test user message to database
                            try {
                                const testMessageData: Omit<Message, 'id'> = {
                                    room: room,
                                    username: randomUser.name,
                                    content: response,
                                    timestamp: new Date().toISOString(),
                                    messageType: 'text'
                                };
                                await chatDatabase.saveMessage(testMessageData);
                            } catch (error) {
                                console.error('Error saving test message:', error);
                            }

                            io.to(room).emit(Events.ChatMessage, response);
                        })().catch(console.error);
                    }, 1000 + (Math.random() * 2000));
                }
            }
        })().catch(console.error);
    });

    socket.on(Events.Typing, () => {
        const userData = users.get(userId);
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
        const existingTimeout = roomTimeouts.get(userData.name);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
        }

        // Add user to typing list
        typingInRoom.add(userData.name);

        // Broadcast to the current room, except the sender
        socket.broadcast.to(room).emit(Events.Typing, userData.name);

        // Set new timeout to remove user from typing after delay
        const timeout = setTimeout(() => {
            typingInRoom.delete(userData.name);
            roomTimeouts.delete(userData.name);
            // Broadcast stop typing to the room
            socket.broadcast.to(room).emit(Events.StopTyping, userData.name);
        }, 3000);

        roomTimeouts.set(userData.name, timeout);
    });

    socket.on(Events.StopTyping, () => {
        const userData = users.get(userId);
        if (!userData) return;

        const room = userData.currentRoom;
        const typingInRoom = typingUsers.get(room);
        const roomTimeouts = typingTimeouts.get(room);

        if (typingInRoom && typingInRoom.has(userData.name)) {
            typingInRoom.delete(userData.name);

            // Clear timeout
            if (roomTimeouts) {
                const userTimeout = roomTimeouts.get(userData.name);
                if (userTimeout) {
                    clearTimeout(userTimeout);
                    roomTimeouts.delete(userData.name);
                }
            }

            // Broadcast stop typing to the room
            socket.broadcast.to(room).emit(Events.StopTyping, userData.name);
        }
    });

    socket.on(Events.CreateRoom, (roomName: string) => {
        (async () => {
            if (!roomName || roomName.trim() === '') return;

            const cleanRoomName = roomName.trim();
            const userData = users.get(userId);
            if (!userData) return;

            // Create the room if it doesn't exist
            getOrCreateRoom(cleanRoomName);

            // Create room in database
            try {
                await chatDatabase.createRoom(cleanRoomName, '', userData.name);
            } catch (error) {
                console.error('Error creating room in database:', error);
            }

            // Emit room created event
            socket.emit(Events.RoomCreated, cleanRoomName);

            // Broadcast new room to all users
            io.emit(Events.RoomsList, Array.from(rooms.keys()));
        })().catch(console.error);
    });

    socket.on(Events.GetRooms, () => {
        socket.emit(Events.RoomsList, Array.from(rooms.keys()));
    });

    socket.on(Events.GetUsers, () => {
        const userData = users.get(userId);
        if (!userData) return;

        const room = userData.currentRoom;
        const roomData = rooms.get(room);
        const usersInRoom = roomData ? Array.from(roomData.users) : [];

        socket.emit(Events.UsersList, usersInRoom);
    });

    socket.on(Events.GetUserInfo, () => {
        const userData = users.get(userId);
        if (userData) {
            socket.emit(Events.UserInfo, {
                name: userData.name,
                currentRoom: userData.currentRoom
            });
        }
    });
});

// Initialize server and start listening
async function startServer() {
    await initializeServer();

    server.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    (async () => {
        console.log('\nShutting down gracefully...');
        await chatDatabase.close();
        process.exit(0);
    })().catch(console.error);
});

process.on('SIGTERM', () => {
    (async () => {
        console.log('\nShutting down gracefully...');
        await chatDatabase.close();
        process.exit(0);
    })().catch(console.error);
});

// Start the server
void startServer().catch(console.error);