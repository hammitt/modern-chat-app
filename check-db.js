// Check what's in the database
const { chatDatabase } = require('./dist/database');

async function checkDatabase() {
    await chatDatabase.init();

    console.log('All users in database:');
    const users = await chatDatabase.getAllUsers();
    console.log(JSON.stringify(users, null, 2));

    console.log('\nSearching for "john":');
    const searchResults = await chatDatabase.searchUsers('john');
    console.log(JSON.stringify(searchResults, null, 2));
}

checkDatabase().catch(console.error);
