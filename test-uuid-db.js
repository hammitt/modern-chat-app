// Simple test script for the new UUID-based database
import { randomUUID } from 'crypto';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';

async function testNewUuidDatabase() {
    console.log('🧪 Testing new UUID-based database structure...\n');

    // Delete old database
    const dbPath = path.join(process.cwd(), 'chat.db');
    try {
        const fs = await import('fs');
        fs.unlinkSync(dbPath);
        console.log('🗑️  Deleted old database file');
    } catch (error) {
        console.log('ℹ️  No existing database to delete');
    }

    // Open new database
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    await db.exec('PRAGMA foreign_keys = ON');

    console.log('📋 Creating new tables with UUID structure...');

    // Create new tables
    await db.exec(`
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            username TEXT NOT NULL,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            avatar TEXT,
            last_seen TEXT NOT NULL,
            is_online BOOLEAN DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.exec(`
        CREATE TABLE rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            description TEXT,
            is_public BOOLEAN DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            created_by TEXT NOT NULL,
            FOREIGN KEY (created_by) REFERENCES users(uuid)
        )
    `);

    await db.exec(`
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room TEXT NOT NULL,
            user_uuid TEXT NOT NULL,
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

    console.log('✅ Tables created successfully\n');

    // Create system user
    const systemUuid = 'system-uuid-0000-0000-000000000000';
    await db.run(
        `INSERT INTO users (uuid, email, username, first_name, last_name, last_seen) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [systemUuid, 'system@chat.app', 'system', 'System', 'Bot', new Date().toISOString()]
    );
    console.log('🤖 Created system user');

    // Create default rooms
    const now = new Date().toISOString();
    await db.run(
        'INSERT INTO rooms (name, description, created_by, created_at) VALUES (?, ?, ?, ?)',
        ['General', 'General chat room', systemUuid, now]
    );
    await db.run(
        'INSERT INTO rooms (name, description, created_by, created_at) VALUES (?, ?, ?, ?)',
        ['Technology', 'Technology discussions', systemUuid, now]
    );
    await db.run(
        'INSERT INTO rooms (name, description, created_by, created_at) VALUES (?, ?, ?, ?)',
        ['Random', 'Random conversations', systemUuid, now]
    );
    console.log('🏠 Created default rooms\n');

    // Create test users
    const testUsers = [
        { email: 'john@example.com', username: 'johndoe', firstName: 'John', lastName: 'Doe' },
        { email: 'jane@example.com', username: 'janesmith', firstName: 'Jane', lastName: 'Smith' },
        { email: 'mike@example.com', username: 'mikej', firstName: 'Mike', lastName: 'Johnson' },
        { email: 'sarah@example.com', username: 'sarahw', firstName: 'Sarah', lastName: 'Wilson' },
        { email: 'scooby@example.com', username: 'scoobyd', firstName: 'Scooby', lastName: 'Doo' }
    ];

    console.log('👥 Creating test users...');
    for (const userData of testUsers) {
        const uuid = randomUUID();
        const result = await db.run(
            `INSERT INTO users (uuid, email, username, first_name, last_name, last_seen) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [uuid, userData.email, userData.username, userData.firstName, userData.lastName, new Date().toISOString()]
        );
        console.log(`   ✅ ${userData.firstName} ${userData.lastName} (@${userData.username}) - UUID: ${uuid}`);
    }

    // Add a test message
    const johnUser = await db.get('SELECT * FROM users WHERE username = ?', ['johndoe']);
    if (johnUser) {
        await db.run(
            `INSERT INTO messages (room, user_uuid, content, timestamp) 
             VALUES (?, ?, ?, ?)`,
            ['General', johnUser.uuid, 'Hello from the new UUID system!', new Date().toISOString()]
        );
        console.log('💬 Added test message from John');
    }

    // Test queries
    console.log('\n🔍 Testing queries...');

    // Get user by email
    const userByEmail = await db.get('SELECT * FROM users WHERE email = ?', ['john@example.com']);
    console.log('📧 User by email:', {
        uuid: userByEmail.uuid,
        email: userByEmail.email,
        username: userByEmail.username,
        name: `${userByEmail.first_name} ${userByEmail.last_name}`
    });

    // Get messages with user info
    const messagesWithUsers = await db.all(`
        SELECT m.*, u.username, u.first_name, u.last_name, u.email
        FROM messages m
        JOIN users u ON m.user_uuid = u.uuid
        WHERE m.room = ?
        ORDER BY m.timestamp
    `, ['General']);

    console.log('💬 Messages with user info:');
    messagesWithUsers.forEach(msg => {
        console.log(`   ${msg.first_name} ${msg.last_name} (@${msg.username}): ${msg.content}`);
        console.log(`   User UUID: ${msg.user_uuid}`);
    });

    await db.close();
    console.log('\n🎉 UUID database test completed successfully!');
    console.log('\n📊 Summary of improvements:');
    console.log('   ✅ Users have permanent UUIDs');
    console.log('   ✅ Email is the unique login credential');
    console.log('   ✅ Username is display name (changeable)');
    console.log('   ✅ Messages reference users by UUID');
    console.log('   ✅ Rooms reference creators by UUID');
    console.log('   ✅ Proper foreign key relationships');
}

testNewUuidDatabase().catch(console.error);
