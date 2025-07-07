// types/express-session.d.ts
import 'express-session';
import type { SessionUser } from './index.js';

declare module 'express-session' {
    interface SessionData {
        user?: SessionUser;
    }
}
