// Test environment with bot users and test data
export interface TestUser {
    id: string;
    name: string;
    email: string;
    responses: string[];
}

export const TEST_USERS: TestUser[] = [
    {
        id: 'alice-bot',
        name: 'Alice',
        email: 'alice@bot.com',
        responses: [
            'Hi there! How can I help you?',
            'That sounds interesting!',
            'I agree with that.',
            'Tell me more about it.',
            'Great point!'
        ]
    },
    {
        id: 'bob-bot',
        name: 'Bob',
        email: 'bob@bot.com',
        responses: [
            'Hey! What\'s up?',
            'Sounds good to me.',
            'I\'m working on some coding projects.',
            'Nice! Keep it up.',
            'That\'s awesome!'
        ]
    },
    {
        id: 'charlie-bot',
        name: 'Charlie',
        email: 'charlie@bot.com',
        responses: [
            'Hello everyone!',
            'I love discussing technology.',
            'JavaScript is my favorite language.',
            'Have you tried the new framework?',
            'Let\'s code something together!'
        ]
    }
];

export const TEST_ROOMS = [
    'General',
    'Technology',
    'Test Environment',
    'Random Chat',
    'Development'
];

export function getTestBotResponse(user: TestUser, mention?: string): string {
    const randomResponse = user.responses[Math.floor(Math.random() * user.responses.length)];

    if (mention) {
        return `@${mention} ${randomResponse}`;
    }

    return `${user.name}: ${randomResponse}`;
}
