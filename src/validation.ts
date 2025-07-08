// Input validation utilities
export class ValidationError extends Error {
    constructor(message: string, public field?: string) {
        super(message);
        this.name = 'ValidationError';
    }
}

export const validators = {
    username: (value: string): boolean => {
        if (!value || value.length < 3 || value.length > 30) return false;
        return /^[a-zA-Z0-9._-]+$/.test(value);
    },

    roomName: (value: string): boolean => {
        if (!value || value.length < 1 || value.length > 50) return false;
        return /^[a-zA-Z0-9\s._-]+$/.test(value);
    },

    messageContent: (value: string): boolean => {
        return value.length <= 2000; // Reasonable message length limit
    },

    sanitizeMessage: (content: string): string => {
        // Basic HTML sanitization
        return content
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .trim();
    }
};
