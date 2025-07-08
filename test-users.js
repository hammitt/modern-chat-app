// Simple script to add test users with proper names
import http from 'http';

const testUsers = [
    {
        firstName: "John",
        lastName: "Doe",
        username: "johndoe",
        email: "john@example.com"
    },
    {
        firstName: "Jane",
        lastName: "Smith",
        username: "janesmith",
        email: "jane@example.com"
    },
    {
        firstName: "Mike",
        lastName: "Johnson",
        username: "mikej",
        email: "mike@example.com"
    },
    {
        firstName: "Sarah",
        lastName: "Wilson",
        username: "sarahw",
        email: "sarah@example.com"
    }
];

async function createUser(user) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(user);

        const options = {
            hostname: 'localhost',
            port: 3000,
            path: '/api/login',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                console.log(`Created user ${user.username}: ${res.statusCode}`);
                resolve(data);
            });
        });

        req.on('error', (err) => {
            console.error(`Error creating user ${user.username}:`, err);
            reject(err);
        });

        req.write(postData);
        req.end();
    });
}

async function createAllUsers() {
    console.log('Creating test users...');

    for (const user of testUsers) {
        try {
            await createUser(user);
            await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
        } catch (error) {
            console.error('Failed to create user:', error);
        }
    }

    console.log('Finished creating test users');
}

createAllUsers();
