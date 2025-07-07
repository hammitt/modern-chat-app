// Core application types

export interface User {
    id?: number;
    username: string;
    firstName: string;
    lastName: string;
    email?: string;
    avatar?: string;
    lastSeen?: string;
    isOnline?: boolean;
    createdAt?: string;
}

export interface Message {
    id?: number;
    user_id?: number;
    room: string;
    username: string;
    content: string;
    timestamp: string;
    messageType?: 'text' | 'system' | 'file';
    fileName?: string;
    fileUrl?: string;
    fileSize?: number;
    file_path?: string;
    file_name?: string;
    file_size?: number;
    edited?: boolean;
    editedAt?: string;
}

export interface Room {
    id?: number;
    name: string;
    description?: string;
    createdAt?: string;
    createdBy?: string;
    is_private?: boolean;
    created_by?: number;
    created_at?: string;
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
    userName?: string;
    room?: string;
    message?: string;
    [key: string]: unknown;
}

export interface DatabaseRow {
    [key: string]: unknown;
}

export interface SessionUser {
    username: string;
    firstName: string;
    lastName: string;
    email?: string;
}

// API Response types for specific endpoints
export interface UserSearchResponse {
    success: boolean;
    users?: User[];
    error?: string;
}

export interface RoomListResponse {
    success: boolean;
    rooms?: Room[];
    error?: string;
}

export interface FileUploadResponse {
    success: boolean;
    file?: FileUpload;
    error?: string;
}

// Socket.IO event data types
export interface JoinRoomData {
    userName: string;
    room: string;
}

export interface ChatMessageData {
    userName: string;
    room: string;
    message: string;
}

export interface TypingData {
    userName: string;
    room: string;
}

// Database query result types
export interface UserRowData {
    id: number;
    username: string;
    first_name: string;
    last_name: string;
    email?: string;
    avatar?: string;
    last_seen: string;
    is_online: boolean;
    created_at: string;
}

export interface MessageRowData {
    id: number;
    user_id: number;
    room: string;
    username: string;
    content: string;
    timestamp: string;
    message_type: string;
    file_name?: string;
    file_url?: string;
    file_size?: number;
    file_path?: string;
    edited: boolean;
    edited_at?: string;
}

export interface RoomRowData {
    id: number;
    name: string;
    description?: string;
    is_private: boolean;
    created_by: number;
    created_at: string;
}
