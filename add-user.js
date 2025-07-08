// Script to add a user to the database
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';

async function addUser() {
    try {
        const dbPath = path.join(process.cwd(), 'chat.db');
        const db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        // Add the beatrices user
        await db.run(
            'INSERT OR REPLACE INTO users (username, first_name, last_name, email, last_seen, is_online) VALUES (?, ?, ?, ?, ?, ?)',
            ['beatrices', 'Beatrice', 'Smith', 'beatrice@example.com', new Date().toISOString(), false]
        );

        console.log('✅ User beatrices added successfully');

        // Verify the user was added
        const user = await db.get('SELECT * FROM users WHERE username = ?', ['beatrices']);
        console.log('User in database:', user);

        await db.close();
    } catch (error) {
        console.error('❌ Error adding user:', error);
    }
}

addUser();
