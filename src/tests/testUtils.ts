// Basic test utilities and setup
import type { User, Message, Room } from '../types/index.js';

export const testData = {
    users: [
        {
            username: 'testuser1',
            firstName: 'Test',
            lastName: 'User1',
            email: 'test1@example.com'
        },
        {
            username: 'testuser2',
            firstName: 'Test',
            lastName: 'User2',
            email: 'test2@example.com'
        }
    ] as const,

    rooms: [
        {
            name: 'TestRoom',
            description: 'Test room for testing',
            createdBy: 'testuser1'
        }
    ] as const,

    messages: [
        {
            room: 'TestRoom',
            username: 'testuser1',
            content: 'Hello, world!',
            timestamp: new Date().toISOString(),
            messageType: 'text' as const
        }
    ] as const
};

export class MockDatabase {
    private users: Map<string, User> = new Map();
    private messages: Message[] = [];
    private rooms: Map<string, Room> = new Map();

    async createUser(username: string, firstName: string, lastName: string, email?: string): Promise<void> {
        this.users.set(username, {
            id: this.users.size + 1,
            uuid: `test-uuid-${this.users.size + 1}`,
            username,
            firstName,
            lastName,
            email: email || `${username}@test.com`,
            lastSeen: new Date().toISOString(),
            isOnline: true,
            createdAt: new Date().toISOString()
        });
        return Promise.resolve();
    }

    async getUserByUsername(username: string): Promise<User | null> {
        return Promise.resolve(this.users.get(username) || null);
    }

    async saveMessage(message: Omit<Message, 'id'>): Promise<number> {
        const id = this.messages.length + 1;
        this.messages.push({ ...message, id });
        return Promise.resolve(id);
    }

    async getMessages(room: string, limit: number = 50): Promise<Message[]> {
        return Promise.resolve(
            this.messages
                .filter(msg => msg.room === room)
                .slice(-limit)
        );
    }

    clear(): void {
        this.users.clear();
        this.messages = [];
        this.rooms.clear();
    }
}

export function createTestUser(overrides: Partial<User> = {}): User {
    return {
        id: 1,
        uuid: 'test-uuid-1',
        username: 'testuser',
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com',
        lastSeen: new Date().toISOString(),
        isOnline: true,
        createdAt: new Date().toISOString(),
        ...overrides
    };
}
