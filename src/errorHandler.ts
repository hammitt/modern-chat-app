// Error handling utilities and middleware
import type { Request, Response, NextFunction } from 'express';
import type { Socket } from 'socket.io';

export class AppError extends Error {
    constructor(
        message: string,
        public statusCode: number = 500,
        public isOperational: boolean = true
    ) {
        super(message);
        this.name = 'AppError';
        Error.captureStackTrace(this, this.constructor);
    }
}

export class DatabaseError extends AppError {
    constructor(message: string, originalError?: Error) {
        super(`Database operation failed: ${message}`, 500);
        this.name = 'DatabaseError';
        if (originalError) {
            this.stack = originalError.stack;
        }
    }
}

export class ValidationError extends AppError {
    constructor(message: string, _field?: string) {
        super(message, 400);
        this.name = 'ValidationError';
    }
}

// Express error handling middleware
export function errorHandler(
    err: Error,
    req: Request,
    res: Response,
    _next: NextFunction
): void {
    console.error('Error:', err);

    if (err instanceof AppError) {
        res.status(err.statusCode).json({
            success: false,
            error: err.message,
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        });
        return;
    }

    // Default error response
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && {
            message: err.message,
            stack: err.stack
        })
    });
}

// Async wrapper to catch promise rejections
export function asyncHandler(
    fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

// Socket error handling
export function handleSocketError(socket: Socket, error: Error, event?: string): void {
    console.error(`Socket error${event ? ` on ${event}` : ''}:`, error);

    if (error instanceof AppError) {
        socket.emit('error', {
            message: error.message,
            code: error.statusCode
        });
    } else {
        socket.emit('error', {
            message: 'An unexpected error occurred',
            code: 500
        });
    }
}
