import { randomUUID } from 'crypto';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import path from 'path';
import type { User, Message, Room, UserRowData, MessageRowData, RoomRowData } from './types/index.js';

class ChatDatabase {
    private db: Database | null = null;

    async init(): Promise<void> {
        try {
            // Create database in project root for easy access
            const dbPath = path.join(process.cwd(), 'chat.db');

            this.db = await open({
                filename: dbPath,
                driver: sqlite3.Database
            });

            // Enable foreign keys
            await this.db.exec('PRAGMA foreign_keys = ON');

            // Create tables
            await this.createTables();

            console.log('✅ Database initialized successfully at:', dbPath);
        } catch (error) {
            console.error('❌ Failed to initialize database:', error);
            throw error;
        }
    }

    private async createTables(): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');

        // Users table with UUID as primary identifier and email as login credential
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT UNIQUE NOT NULL,              -- Permanent user identifier
                email TEXT UNIQUE NOT NULL,             -- Login credential (required)
                username TEXT NOT NULL,                 -- Display name (changeable)
                first_name TEXT NOT NULL,
                last_name TEXT NOT NULL,
                avatar TEXT,
                last_seen TEXT NOT NULL,
                is_online BOOLEAN DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Rooms table
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS rooms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                description TEXT,
                is_public BOOLEAN DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                created_by TEXT NOT NULL,               -- User UUID who created the room
                FOREIGN KEY (created_by) REFERENCES users(uuid)
            )
        `);

        // Room memberships table
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS room_memberships (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room_name TEXT NOT NULL,
                user_uuid TEXT NOT NULL,               -- User UUID instead of username
                joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
                invited_by TEXT,                       -- User UUID who invited
                UNIQUE(room_name, user_uuid),
                FOREIGN KEY (room_name) REFERENCES rooms(name),
                FOREIGN KEY (user_uuid) REFERENCES users(uuid),
                FOREIGN KEY (invited_by) REFERENCES users(uuid)
            )
        `);

        // Messages table
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room TEXT NOT NULL,
                user_uuid TEXT NOT NULL,               -- User UUID instead of username
                content TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                message_type TEXT DEFAULT 'text',
                file_name TEXT,
                file_url TEXT,
                file_size INTEGER,
                edited BOOLEAN DEFAULT 0,
                edited_at TEXT,
                FOREIGN KEY (room) REFERENCES rooms(name),
                FOREIGN KEY (user_uuid) REFERENCES users(uuid)
            )
        `);

        // Create indexes for better performance
        await this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            CREATE INDEX IF NOT EXISTS idx_users_uuid ON users(uuid);
            CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room);
            CREATE INDEX IF NOT EXISTS idx_messages_user_uuid ON messages(user_uuid);
            CREATE INDEX IF NOT EXISTS idx_room_memberships_user_uuid ON room_memberships(user_uuid);
        `);

        // Create system user for default rooms
        const systemUuid = await this.createSystemUser();

        // Insert default rooms if they don't exist
        await this.createRoom('General', 'General chat room', systemUuid);
        await this.createRoom('Technology', 'Technology discussions', systemUuid);
        await this.createRoom('Random', 'Random conversations', systemUuid);
    }

    private async createSystemUser(): Promise<string> {
        if (!this.db) throw new Error('Database not initialized');

        const systemUuid = 'system-uuid-0000-0000-000000000000';

        await this.db.run(
            `INSERT OR IGNORE INTO users (uuid, email, username, first_name, last_name, last_seen) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [systemUuid, 'system@chat.app', 'system', 'System', 'Bot', new Date().toISOString()]
        );

        return systemUuid;
    }

    // User operations
    async createUser(userData: { email: string; username: string; firstName: string; lastName: string }): Promise<User> {
        if (!this.db) throw new Error('Database not initialized');

        const uuid = randomUUID();
        const now = new Date().toISOString();

        const result = await this.db.run(
            `INSERT INTO users (uuid, email, username, first_name, last_name, last_seen) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [uuid, userData.email, userData.username, userData.firstName, userData.lastName, now]
        );

        return {
            id: result.lastID,
            uuid,
            email: userData.email,
            username: userData.username,
            firstName: userData.firstName,
            lastName: userData.lastName,
            lastSeen: now,
            isOnline: false,
            createdAt: now
        };
    }

    async getUserByEmail(email: string): Promise<User | null> {
        if (!this.db) throw new Error('Database not initialized');

        const row = await this.db.get<UserRowData>(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );

        if (!row) return null;

        return this.mapUserRowToUser(row);
    }

    async getUserByUuid(uuid: string): Promise<User | null> {
        if (!this.db) throw new Error('Database not initialized');

        const row = await this.db.get<UserRowData>(
            'SELECT * FROM users WHERE uuid = ?',
            [uuid]
        );

        if (!row) return null;

        return this.mapUserRowToUser(row);
    }

    async getUsersByUuids(uuids: string[]): Promise<User[]> {
        if (!this.db) throw new Error('Database not initialized');
        if (uuids.length === 0) return [];

        const placeholders = uuids.map(() => '?').join(',');
        const rows = await this.db.all<UserRowData[]>(
            `SELECT * FROM users WHERE uuid IN (${placeholders})`,
            uuids
        );

        return rows.map(row => this.mapUserRowToUser(row));
    }

    async getAllUsers(): Promise<User[]> {
        if (!this.db) throw new Error('Database not initialized');

        const rows = await this.db.all<UserRowData[]>('SELECT * FROM users ORDER BY username');
        return rows.map(row => this.mapUserRowToUser(row));
    }

    async setUserOnlineStatus(uuid: string, isOnline: boolean): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');

        await this.db.run(
            'UPDATE users SET is_online = ?, last_seen = ? WHERE uuid = ?',
            [isOnline ? 1 : 0, new Date().toISOString(), uuid]
        );
    }

    private mapUserRowToUser(row: UserRowData): User {
        return {
            id: row.id,
            uuid: row.uuid,
            email: row.email,
            username: row.username,
            firstName: row.first_name,
            lastName: row.last_name,
            avatar: row.avatar || undefined,
            lastSeen: row.last_seen,
            isOnline: Boolean(row.is_online),
            createdAt: row.created_at
        };
    }

    // Message operations
    async addMessage(message: Omit<Message, "id">): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');

        await this.db.run(
            `INSERT INTO messages (room, user_uuid, content, timestamp, message_type, file_name, file_url, file_size) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                message.room,
                message.user_uuid,
                message.content,
                message.timestamp,
                message.messageType || 'text',
                message.fileName || null,
                message.fileUrl || null,
                message.fileSize || null
            ]
        );
    }

    async getRecentMessages(roomName: string, limit: number = 50): Promise<Message[]> {
        if (!this.db) throw new Error('Database not initialized');

        const rows = await this.db.all<MessageRowData[]>(
            `SELECT m.*, u.username, u.first_name, u.last_name, u.avatar
             FROM messages m
             JOIN users u ON m.user_uuid = u.uuid
             WHERE m.room = ?
             ORDER BY m.timestamp DESC
             LIMIT ?`,
            [roomName, limit]
        );

        const messages = rows.map(row => this.mapMessageRowToMessage(row)).reverse();
        return messages;
    }

    async getMessagesByUser(userUuid: string, limit: number = 50): Promise<Message[]> {
        if (!this.db) throw new Error('Database not initialized');

        const rows = await this.db.all<MessageRowData[]>(
            `SELECT m.*, u.username, u.first_name, u.last_name, u.avatar
             FROM messages m
             JOIN users u ON m.user_uuid = u.uuid
             WHERE m.user_uuid = ?
             ORDER BY m.timestamp DESC
             LIMIT ?`,
            [userUuid, limit]
        );

        return rows.map(row => this.mapMessageRowToMessage(row));
    }

    async getMessages(roomName: string, limit: number = 50, offset: number = 0): Promise<Message[]> {
        if (!this.db) throw new Error('Database not initialized');

        const rows = await this.db.all<MessageRowData[]>(
            `SELECT m.*, u.username, u.first_name, u.last_name, u.avatar
             FROM messages m
             JOIN users u ON m.user_uuid = u.uuid
             WHERE m.room = ? 
             ORDER BY m.timestamp DESC 
             LIMIT ? OFFSET ?`,
            [roomName, limit, offset]
        );

        return rows.map((row) => this.mapMessageRowToMessage(row));
    }

    async searchMessages(query: string, roomName?: string, limit: number = 50): Promise<Message[]> {
        if (!this.db) throw new Error('Database not initialized');

        let sql = `
            SELECT m.*, u.username, u.first_name, u.last_name, u.avatar
            FROM messages m
            JOIN users u ON m.user_uuid = u.uuid
            WHERE m.content LIKE ?
        `;
        const params: (string | number)[] = [`%${query}%`];

        if (roomName) {
            sql += ' AND m.room = ?';
            params.push(roomName);
        }

        sql += ' ORDER BY m.timestamp DESC LIMIT ?';
        params.push(limit);

        const rows = await this.db.all<MessageRowData[]>(sql, params);
        return rows.map((row) => this.mapMessageRowToMessage(row));
    }

    async searchUsers(query: string, limit: number = 50): Promise<User[]> {
        if (!this.db) throw new Error('Database not initialized');

        const result = await this.db.all(`
            SELECT id, uuid, email, username, first_name, last_name, 
                   avatar, last_seen, is_online, created_at
            FROM users 
            WHERE username LIKE ? OR first_name LIKE ? OR last_name LIKE ?
            ORDER BY username 
            LIMIT ?
        `, [`%${query}%`, `%${query}%`, `%${query}%`, limit]);

        return result.map((row) => this.mapUserRowToUser(row as UserRowData));
    }

    private mapMessageRowToMessage(row: MessageRowData & { username?: string; first_name?: string; last_name?: string; avatar?: string }): Message {
        return {
            id: row.id,
            user_uuid: row.user_uuid,
            room: row.room,
            content: row.content,
            timestamp: row.timestamp,
            messageType: row.message_type as 'text' | 'system' | 'file',
            fileName: row.file_name || undefined,
            fileUrl: row.file_url || undefined,
            fileSize: row.file_size || undefined,
            edited: Boolean(row.edited),
            editedAt: row.edited_at || undefined,
            user: row.username ? {
                uuid: row.user_uuid,
                username: row.username,
                firstName: row.first_name || '',
                lastName: row.last_name || '',
                avatar: row.avatar || undefined
            } : undefined
        };
    }

    // Room operations
    async createRoom(name: string, description: string, createdBy: string): Promise<Room> {
        if (!this.db) throw new Error('Database not initialized');

        const now = new Date().toISOString();

        await this.db.run(
            'INSERT OR IGNORE INTO rooms (name, description, created_by, created_at) VALUES (?, ?, ?, ?)',
            [name, description, createdBy, now]
        );

        return {
            name,
            description,
            createdBy,
            createdAt: now,
            isPublic: true
        };
    }

    async getRoomByName(name: string): Promise<Room | null> {
        if (!this.db) throw new Error('Database not initialized');

        const row = await this.db.get<RoomRowData>(
            'SELECT * FROM rooms WHERE name = ?',
            [name]
        );

        if (!row) return null;

        return {
            id: row.id,
            name: row.name,
            description: row.description,
            createdBy: row.created_by,
            createdAt: row.created_at,
            isPublic: Boolean(row.is_public)
        };
    }

    async getAllRooms(): Promise<Room[]> {
        if (!this.db) throw new Error('Database not initialized');

        const rows = await this.db.all<RoomRowData[]>('SELECT * FROM rooms ORDER BY name');
        return rows.map(row => ({
            id: row.id,
            name: row.name,
            description: row.description,
            createdBy: row.created_by,
            createdAt: row.created_at,
            isPublic: Boolean(row.is_public)
        }));
    }

    async getPublicRooms(): Promise<Room[]> {
        if (!this.db) throw new Error('Database not initialized');

        const rows = await this.db.all<RoomRowData[]>('SELECT * FROM rooms WHERE is_public = 1 ORDER BY name');
        return rows.map(row => ({
            id: row.id,
            name: row.name,
            description: row.description,
            createdBy: row.created_by,
            createdAt: row.created_at,
            isPublic: Boolean(row.is_public)
        }));
    }

    // Room membership operations
    async addUserToRoom(userUuid: string, roomName: string, invitedBy?: string): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');

        await this.db.run(
            'INSERT OR IGNORE INTO room_memberships (user_uuid, room_name, invited_by) VALUES (?, ?, ?)',
            [userUuid, roomName, invitedBy || null]
        );
    }

    async removeUserFromRoom(userUuid: string, roomName: string): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');

        await this.db.run(
            'DELETE FROM room_memberships WHERE user_uuid = ? AND room_name = ?',
            [userUuid, roomName]
        );
    }

    async getUsersInRoom(roomName: string): Promise<User[]> {
        if (!this.db) throw new Error('Database not initialized');

        const rows = await this.db.all<UserRowData[]>(
            `SELECT u.* FROM users u
             JOIN room_memberships rm ON u.uuid = rm.user_uuid
             WHERE rm.room_name = ?
             ORDER BY u.username`,
            [roomName]
        );

        return rows.map(row => this.mapUserRowToUser(row));
    }

    async getUserRooms(userUuid: string): Promise<Room[]> {
        if (!this.db) throw new Error('Database not initialized');

        const rows = await this.db.all<RoomRowData[]>(
            `SELECT r.* FROM rooms r
             JOIN room_memberships rm ON r.name = rm.room_name
             WHERE rm.user_uuid = ?
             ORDER BY r.name`,
            [userUuid]
        );

        return rows.map(row => ({
            id: row.id,
            name: row.name,
            description: row.description,
            createdBy: row.created_by,
            createdAt: row.created_at,
            isPublic: Boolean(row.is_public)
        }));
    }

    // Room membership management (legacy compatibility methods)
    async joinRoom(userUuid: string, roomName: string, invitedBy?: string): Promise<void> {
        // This is just an alias for addUserToRoom for backward compatibility
        await this.addUserToRoom(userUuid, roomName, invitedBy);
    }

    async leaveRoom(userUuid: string, roomName: string): Promise<void> {
        // This is just an alias for removeUserFromRoom for backward compatibility
        await this.removeUserFromRoom(userUuid, roomName);
    }

    async isUserInRoom(userUuid: string, roomName: string): Promise<boolean> {
        if (!this.db) throw new Error('Database not initialized');

        const result: unknown = await this.db.get(`
            SELECT 1 FROM room_memberships 
            WHERE user_uuid = ? AND room_name = ?
        `, [userUuid, roomName]);

        return !!result;
    }

    async close(): Promise<void> {
        if (this.db) {
            await this.db.close();
            this.db = null;
        }
    }
}

export const chatDatabase = new ChatDatabase();
