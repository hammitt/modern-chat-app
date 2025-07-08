import { chatDatabase } from './src/database.js';

async function createTestUsers() {
    try {
        await chatDatabase.init();

        console.log('Creating test users with new UUID system...');

        const testUsers = [
            {
                email: 'john@example.com',
                username: 'johndoe',
                firstName: 'John',
                lastName: 'Doe'
            },
            {
                email: 'jane@example.com',
                username: 'janesmith',
                firstName: 'Jane',
                lastName: 'Smith'
            },
            {
                email: 'mike@example.com',
                username: 'mikej',
                firstName: 'Mike',
                lastName: 'Johnson'
            },
            {
                email: 'sarah@example.com',
                username: 'sarahw',
                firstName: 'Sarah',
                lastName: 'Wilson'
            },
            {
                email: 'scooby@example.com',
                username: 'scoobyd',
                firstName: 'Scooby',
                lastName: 'Doo'
            }
        ];

        for (const userData of testUsers) {
            try {
                const user = await chatDatabase.createUser(userData);
                console.log(`✅ Created user: ${user.username} (${user.email}) with UUID: ${user.uuid}`);

                // Add user to General room
                await chatDatabase.addUserToRoom(user.uuid, 'General');
                console.log(`   Added to General room`);
            } catch (error) {
                if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
                    console.log(`⚠️  User ${userData.username} already exists, skipping...`);
                } else {
                    console.error(`❌ Failed to create user ${userData.username}:`, error);
                }
            }
        }

        // List all users
        const allUsers = await chatDatabase.getAllUsers();
        console.log('\n📋 All users in database:');
        allUsers.forEach(user => {
            console.log(`   ${user.firstName} ${user.lastName} (@${user.username}) - ${user.email} - UUID: ${user.uuid}`);
        });

        await chatDatabase.close();
        console.log('\n✅ Test users creation completed!');
    } catch (error) {
        console.error('❌ Error creating test users:', error);
        process.exit(1);
    }
}

createTestUsers();
