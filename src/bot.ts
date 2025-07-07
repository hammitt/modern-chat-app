export function getBotResponse(msg: string): string | null {
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