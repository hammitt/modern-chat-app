// Core application types

export interface User {
    uuid: string;           // Permanent unique identifier (UUID)
    email: string;          // Unique login credential (required)
    username: string;       // Display name (changeable, can be non-unique with discriminator)
    firstName: string;
    lastName: string;
    avatar?: string;
    lastSeen?: string;
    isOnline?: boolean;
    createdAt?: string;
    // Internal database ID (not exposed to client)
    id?: number;
}

export interface Message {
    id?: number;
    user_uuid: string;      // Reference to user by UUID
    room: string;
    content: string;
    timestamp: string;
    messageType?: 'text' | 'system' | 'file';
    fileName?: string;
    fileUrl?: string;
    fileSize?: number;
    edited?: boolean;
    editedAt?: string;
    // Populated user data for display
    user?: {
        uuid: string;
        username: string;
        firstName: string;
        lastName: string;
        avatar?: string;
    };
}

export interface Room {
    id?: number;
    name: string;
    description?: string;
    createdAt?: string;
    createdBy?: string;    // User UUID who created the room
    isPublic?: boolean;
}

export interface FileUpload {
    filename: string;
    originalName: string;
    mimetype: string;
    size: number;
    path: string;
    url: string;
}

export interface AuthResponse {
    success: boolean;
    user?: User;
    error?: string;
}

export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    users?: User[];
    rooms?: Room[];
    file?: FileUpload;
    count?: number;
}

export interface SocketEventData {
    userUuid?: string;
    room?: string;
    message?: string;
    [key: string]: unknown;
}

export interface DatabaseRow {
    [key: string]: unknown;
}

// Authentication and login types
export interface LoginCredentials {
    email: string;
    password?: string;  // For future password implementation
}

export interface RegisterCredentials {
    email: string;
    username: string;
    firstName: string;
    lastName: string;
    password?: string;  // For future password implementation
}

export interface SessionUser {
    uuid: string;
    email: string;
    username: string;
    firstName: string;
    lastName: string;
    avatar?: string;
}

// Database row types with proper UUID references
export interface UserRowData {
    id: number;
    uuid: string;
    email: string;
    username: string;
    first_name: string;
    last_name: string;
    avatar: string | null;
    last_seen: string;
    is_online: number;
    created_at: string;
}

export interface MessageRowData {
    id: number;
    user_uuid: string;
    room: string;
    content: string;
    timestamp: string;
    message_type: string;
    file_name: string | null;
    file_url: string | null;
    file_size: number | null;
    edited: number;
    edited_at: string | null;
}

export interface RoomRowData {
    id: number;
    name: string;
    description?: string;
    is_public: boolean;
    created_by: string;
    created_at: string;
}
