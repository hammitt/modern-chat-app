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

        // Users table
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                first_name TEXT NOT NULL,
                last_name TEXT NOT NULL,
                email TEXT,
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
                created_by TEXT NOT NULL,
                FOREIGN KEY (created_by) REFERENCES users(username)
            )
        `);

        // Room memberships table
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS room_memberships (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room_name TEXT NOT NULL,
                username TEXT NOT NULL,
                joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
                invited_by TEXT,
                UNIQUE(room_name, username),
                FOREIGN KEY (room_name) REFERENCES rooms(name),
                FOREIGN KEY (username) REFERENCES users(username),
                FOREIGN KEY (invited_by) REFERENCES users(username)
            )
        `);

        // Messages table
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room TEXT NOT NULL,
                username TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                message_type TEXT DEFAULT 'text',
                file_name TEXT,
                file_url TEXT,
                file_size INTEGER,
                edited BOOLEAN DEFAULT 0,
                edited_at TEXT,
                FOREIGN KEY (room) REFERENCES rooms(name),
                FOREIGN KEY (username) REFERENCES users(username)
            )
        `);

        // Create indexes for better performance
        await this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room);
        `);

        await this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
        `);

        await this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        `);

        // Create system user first
        try {
            await this.db.run(
                'INSERT OR IGNORE INTO users (username, first_name, last_name, last_seen, is_online) VALUES (?, ?, ?, ?, ?)',
                'system', 'System', 'Bot', new Date().toISOString(), 0
            );
        } catch (error) {
            console.log('System user already exists or error creating it:', error);
        }

        // Insert default rooms if they don't exist
        await this.createRoom('General', 'General chat room', 'system');
        await this.createRoom('Technology', 'Technology discussions', 'system');
        await this.createRoom('Test Environment', 'Test environment with bots', 'system');
    }    // User operations
    async createUser(username: string, firstName: string, lastName: string, email?: string): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');

        try {
            await this.db.run(
                'INSERT OR IGNORE INTO users (username, first_name, last_name, email, last_seen, is_online) VALUES (?, ?, ?, ?, ?, ?)',
                [username, firstName, lastName, email || null, new Date().toISOString(), true]
            );
        } catch (error) {
            console.error('Error creating user:', error);
        }
    }

    async getUserByUsername(username: string): Promise<User | null> {
        if (!this.db) throw new Error('Database not initialized');

        const row = await this.db.get<UserRowData>(
            'SELECT * FROM users WHERE username = ?',
            [username]
        );

        if (!row) return null;

        return {
            id: row.id,
            username: row.username,
            firstName: row.first_name,
            lastName: row.last_name,
            email: row.email,
            avatar: row.avatar,
            lastSeen: row.last_seen,
            isOnline: row.is_online,
            createdAt: row.created_at
        };
    }

    async getAllUsers(): Promise<User[]> {
        if (!this.db) throw new Error('Database not initialized');

        const rows = await this.db.all<UserRowData[]>('SELECT * FROM users ORDER BY username');
        return rows.map(row => ({
            id: row.id,
            username: row.username,
            firstName: row.first_name,
            lastName: row.last_name,
            email: row.email,
            avatar: row.avatar,
            lastSeen: row.last_seen,
            isOnline: row.is_online,
            createdAt: row.created_at
        }));
    }

    async searchUsers(query: string): Promise<User[]> {
        if (!this.db) throw new Error('Database not initialized');

        const rows = await this.db.all<UserRowData[]>(
            `SELECT * FROM users 
             WHERE username LIKE ? OR first_name LIKE ? OR last_name LIKE ?
             ORDER BY username LIMIT 10`,
            [`%${query}%`, `%${query}%`, `%${query}%`]
        );

        return rows.map(row => ({
            id: row.id,
            username: row.username,
            firstName: row.first_name,
            lastName: row.last_name,
            email: row.email,
            avatar: row.avatar,
            lastSeen: row.last_seen,
            isOnline: row.is_online,
            createdAt: row.created_at
        }));
    }

    async updateUserStatus(username: string, isOnline: boolean): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');

        await this.db.run(
            'UPDATE users SET is_online = ?, last_seen = ? WHERE username = ?',
            [isOnline, new Date().toISOString(), username]
        );
    }

    async getOnlineUsers(): Promise<User[]> {
        if (!this.db) throw new Error('Database not initialized');

        return await this.db.all(
            'SELECT * FROM users WHERE is_online = 1 ORDER BY username'
        );
    }

    async getRooms(): Promise<Room[]> {
        if (!this.db) throw new Error('Database not initialized');

        return await this.db.all('SELECT * FROM rooms ORDER BY created_at ASC');
    }

    // Message operations
    async saveMessage(message: Omit<Message, 'id'>): Promise<number> {
        if (!this.db) throw new Error('Database not initialized');

        const result = await this.db.run(
            `INSERT INTO messages (room, username, content, timestamp, message_type, file_name, file_url, file_size)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                message.room,
                message.username,
                message.content,
                message.timestamp,
                message.messageType || 'text',
                message.fileName || null,
                message.fileUrl || null,
                message.fileSize || null
            ]
        );

        return result.lastID as number;
    }

    async getMessages(room: string, limit: number = 50, offset: number = 0): Promise<Message[]> {
        if (!this.db) throw new Error('Database not initialized');

        return await this.db.all<MessageRowData[]>(
            `SELECT * FROM messages 
             WHERE room = ? 
             ORDER BY timestamp DESC 
             LIMIT ? OFFSET ?`,
            [room, limit, offset]
        );
    }

    async getRecentMessages(room: string, limit: number = 50): Promise<Message[]> {
        if (!this.db) throw new Error('Database not initialized');

        const messages = await this.db.all<MessageRowData[]>(
            `SELECT * FROM messages 
             WHERE room = ? 
             ORDER BY timestamp ASC 
             LIMIT ?`,
            [room, limit]
        );

        return messages.reverse(); // Return in chronological order
    }

    async editMessage(messageId: number, newContent: string): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');

        await this.db.run(
            'UPDATE messages SET content = ?, edited = 1, edited_at = ? WHERE id = ?',
            [newContent, new Date().toISOString(), messageId]
        );
    }

    async deleteMessage(messageId: number): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');

        await this.db.run('DELETE FROM messages WHERE id = ?', [messageId]);
    }

    async searchMessages(room: string, query: string, limit: number = 20): Promise<Message[]> {
        if (!this.db) throw new Error('Database not initialized');

        return await this.db.all<MessageRowData[]>(
            `SELECT * FROM messages 
             WHERE room = ? AND content LIKE ? 
             ORDER BY timestamp DESC 
             LIMIT ?`,
            [room, `%${query}%`, limit]
        );
    }

    // Statistics
    async getMessageCount(room: string): Promise<number> {
        if (!this.db) throw new Error('Database not initialized');

        const result = await this.db.get<{ count: number }>(
            'SELECT COUNT(*) as count FROM messages WHERE room = ?',
            [room]
        );

        return result?.count || 0;
    }

    async getUserMessageCount(username: string): Promise<number> {
        if (!this.db) throw new Error('Database not initialized');

        const result = await this.db.get<{ count: number }>(
            'SELECT COUNT(*) as count FROM messages WHERE username = ?',
            [username]
        );

        return result?.count || 0;
    }

    // Cleanup and maintenance
    async cleanupOldMessages(daysOld: number = 30): Promise<number> {
        if (!this.db) throw new Error('Database not initialized');

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);

        const result = await this.db.run(
            'DELETE FROM messages WHERE timestamp < ?',
            [cutoffDate.toISOString()]
        );

        return result.changes || 0;
    }

    // Room Management Methods
    async joinRoom(username: string, roomName: string, invitedBy?: string): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');

        await this.db.run(
            `INSERT OR IGNORE INTO room_memberships (room_name, username, invited_by) 
             VALUES (?, ?, ?)`,
            [roomName, username, invitedBy || null]
        );
    }

    async leaveRoom(username: string, roomName: string): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');

        await this.db.run(
            'DELETE FROM room_memberships WHERE room_name = ? AND username = ?',
            [roomName, username]
        );
    }

    async getUserRooms(username: string): Promise<RoomRowData[]> {
        if (!this.db) throw new Error('Database not initialized');

        return await this.db.all<RoomRowData[]>(
            `SELECT r.name, r.description, r.is_public, r.created_by, rm.joined_at, rm.invited_by
             FROM rooms r
             JOIN room_memberships rm ON r.name = rm.room_name
             WHERE rm.username = ?
             ORDER BY rm.joined_at DESC`,
            [username]
        );
    }

    async getPublicRooms(): Promise<RoomRowData[]> {
        if (!this.db) throw new Error('Database not initialized');

        return await this.db.all<RoomRowData[]>(
            `SELECT name, description, created_by, created_at,
                    (SELECT COUNT(*) FROM room_memberships WHERE room_name = rooms.name) as member_count
             FROM rooms 
             WHERE is_public = 1
             ORDER BY created_at DESC`
        );
    }

    async getRoomMembers(roomName: string): Promise<UserRowData[]> {
        if (!this.db) throw new Error('Database not initialized');

        return await this.db.all<UserRowData[]>(
            `SELECT u.username, u.first_name, u.last_name, rm.joined_at, rm.invited_by
             FROM users u
             JOIN room_memberships rm ON u.username = rm.username
             WHERE rm.room_name = ?
             ORDER BY rm.joined_at ASC`,
            [roomName]
        );
    }

    async isUserInRoom(username: string, roomName: string): Promise<boolean> {
        if (!this.db) throw new Error('Database not initialized');

        const result = await this.db.get<{ exists: number }>(
            'SELECT 1 as exists FROM room_memberships WHERE username = ? AND room_name = ?',
            [username, roomName]
        );

        return !!result;
    }

    async createRoom(name: string, description: string, createdBy: string, isPublic: boolean = true): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');

        try {
            await this.db.run(
                'INSERT OR IGNORE INTO rooms (name, description, created_by, is_public) VALUES (?, ?, ?, ?)',
                [name, description, createdBy, isPublic ? 1 : 0]
            );

            // Automatically join the creator to the room if the room was created
            await this.joinRoom(createdBy, name);
        } catch (error) {
            // Log but don't throw error for existing rooms
            console.log(`Room '${name}' already exists or error creating it:`, error);
        }
    }

    async close(): Promise<void> {
        if (this.db) {
            await this.db.close();
            this.db = null;
        }
    }
}

// Export singleton instance
export const chatDatabase = new ChatDatabase();
