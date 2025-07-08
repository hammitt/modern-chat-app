// Chat service layer for business logic separation
import { chatDatabase } from './database.js';
import type { User, Message } from './types/index.js';
import { AppError, DatabaseError } from './errorHandler.js';
import { validators } from './validation.js';

export class ChatService {
    // User management
    async createUser(userData: {
        username: string;
        firstName: string;
        lastName: string;
        email?: string;
    }): Promise<User> {
        const { username, firstName, lastName, email } = userData;

        // Validation
        if (!validators.username(username)) {
            throw new AppError('Invalid username format', 400);
        }

        if (!firstName?.trim() || !lastName?.trim()) {
            throw new AppError('First name and last name are required', 400);
        }

        try {
            // Check if user exists
            const existingUser = await chatDatabase.getUserByUsername(username);
            if (existingUser) {
                throw new AppError('Username already taken', 409);
            }

            // Create user
            await chatDatabase.createUser(username, firstName.trim(), lastName.trim(), email);

            // Auto-join General room
            await chatDatabase.joinRoom(username, 'General');

            const newUser = await chatDatabase.getUserByUsername(username);
            if (!newUser) {
                throw new DatabaseError('Failed to retrieve created user');
            }

            return newUser;
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new DatabaseError('Failed to create user', error as Error);
        }
    }

    // Message management
    async sendMessage(messageData: {
        username: string;
        room: string;
        content: string;
        messageType?: 'text' | 'file' | 'system';
    }): Promise<Message> {
        const { username, room, content, messageType = 'text' } = messageData;

        // Validation
        if (!validators.messageContent(content)) {
            throw new AppError('Message too long', 400);
        }

        const sanitizedContent = validators.sanitizeMessage(content);

        try {
            const message: Omit<Message, 'id'> = {
                room,
                username,
                content: sanitizedContent,
                timestamp: new Date().toISOString(),
                messageType
            };

            const messageId = await chatDatabase.saveMessage(message);
            return { ...message, id: messageId };
        } catch (error) {
            throw new DatabaseError('Failed to save message', error as Error);
        }
    }

    // Room management
    async createRoom(roomData: {
        name: string;
        description?: string;
        createdBy: string;
        isPublic?: boolean;
    }): Promise<void> {
        const { name, description = '', createdBy, isPublic = true } = roomData;

        if (!validators.roomName(name)) {
            throw new AppError('Invalid room name format', 400);
        }

        try {
            await chatDatabase.createRoom(name.trim(), description.trim(), createdBy, isPublic);
        } catch (error) {
            throw new DatabaseError('Failed to create room', error as Error);
        }
    }

    // Enhanced user search with caching
    private userSearchCache = new Map<string, { users: User[]; timestamp: number }>();
    private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    async searchUsers(query: string): Promise<User[]> {
        const cacheKey = query.toLowerCase();
        const cached = this.userSearchCache.get(cacheKey);

        if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
            return cached.users;
        }

        try {
            const users = await chatDatabase.searchUsers(query);
            this.userSearchCache.set(cacheKey, { users, timestamp: Date.now() });

            // Clean old cache entries
            if (this.userSearchCache.size > 100) {
                this.clearOldCacheEntries();
            }

            return users;
        } catch (error) {
            throw new DatabaseError('Failed to search users', error as Error);
        }
    }

    private clearOldCacheEntries(): void {
        const now = Date.now();
        for (const [key, value] of this.userSearchCache.entries()) {
            if ((now - value.timestamp) >= this.CACHE_TTL) {
                this.userSearchCache.delete(key);
            }
        }
    }
}

export const chatService = new ChatService();
