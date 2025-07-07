// Test environment with bot users and test data
export interface TestUser {
    id: string;
    name: string;
    responses: string[];
}

export const TEST_USERS: TestUser[] = [
    {
        id: 'alice-bot',
        name: 'Alice',
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

export function getBotResponse(user: TestUser, mention?: string): string {
    const randomResponse = user.responses[Math.floor(Math.random() * user.responses.length)];

    if (mention) {
        return `@${mention} ${randomResponse}`;
    }

    return `${user.name}: ${randomResponse}`;
}

export function getMainBotResponse(msg: string): string | null {
    const lowerCaseMsg = msg.trim().toLowerCase();
    if (lowerCaseMsg === "") {
        return 'Bot: You called? Try asking for "time" or "help".';
    }
    if (lowerCaseMsg.includes("hello") || lowerCaseMsg.includes("hi")) {
        return 'Bot: Hello there! Ask me for the "time" or for "help".';
    }
    if (lowerCaseMsg.includes("time")) {
        return `Bot: The current time is ${new Date().toLocaleTimeString()}.`;
    }
    if (lowerCaseMsg.includes("help")) {
        return 'Bot: I am a simple chatbot. You can say "hi" or ask for the "time".';
    }
    return null;
}
