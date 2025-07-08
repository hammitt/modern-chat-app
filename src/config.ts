import dotenv from 'dotenv';

dotenv.config();

export const config = {
    port: parseInt(process.env.PORT || '3000'),
    sessionSecret: process.env.SESSION_SECRET || 'chat-app-secret-key-change-in-production',
    dbPath: process.env.DB_PATH || 'chat.db',
    uploadPath: process.env.UPLOAD_PATH || 'public/uploads',
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760'), // 10MB
    maxMessageLength: parseInt(process.env.MAX_MESSAGE_LENGTH || '2000'),
    isProduction: process.env.NODE_ENV === 'production',

    // Security settings
    cors: {
        origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
        credentials: true
    },

    session: {
        secure: process.env.NODE_ENV === 'production', // HTTPS only in production
        maxAge: parseInt(process.env.SESSION_MAX_AGE || '86400000') // 24 hours
    },

    // Rate limiting
    rateLimit: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '900000'), // 15 minutes
        max: parseInt(process.env.RATE_LIMIT_MAX || '100') // requests per window
    }
};
