# Modern Chat Application

A real-time chat application built with Node.js, Socket.io, TypeScript, and SQLite. Features modern UI, file sharing, user authentication, and @mention system.

## Features

### 🚀 Core Functionality
- **Real-time messaging** with Socket.io
- **User authentication** with sessions
- **Room-based chat** with join/leave functionality
- **File sharing** with upload and download
- **@mention system** with autocomplete dropdown
- **Typing indicators** with real-time updates
- **Message persistence** with SQLite database

### 🎨 Modern UI/UX
- **Responsive design** that works on desktop and mobile
- **Dark theme** with professional gradient colors
- **Mobile-first approach** with hamburger menu
- **Smooth animations** and transitions
- **File message previews** and download capabilities
- **Mention dropdown** with keyboard navigation

### 👥 User Management
- **User profiles** with first name, last name, username, and email
- **Online presence** tracking
- **User search** for mentions with fuzzy matching
- **Session management** with automatic login persistence

### 🏠 Room Management
- **Public and private rooms**
- **Room creation** and membership tracking
- **Invitation system** for private rooms
- **Default rooms**: General, Technology, Test Environment

## Tech Stack

- **Backend**: Node.js, Express, TypeScript
- **Frontend**: TypeScript, Webpack, Socket.io Client
- **Database**: SQLite with better-sqlite3
- **Real-time**: Socket.io
- **File Upload**: Multer
- **Session Management**: express-session
- **Build Tools**: TypeScript, Webpack, ESLint

## Project Structure

```
chat-app/
├── src/
│   ├── server.ts           # Main server file with Express and Socket.io
│   ├── client.ts           # Client-side TypeScript code
│   ├── database.ts         # SQLite database operations
│   ├── events.ts           # Shared event constants
│   ├── bot.ts             # Bot response system
│   ├── testEnvironment.ts # Test users and bot responses
│   └── types/
│       └── express-session.d.ts # Session type extensions
├── public/
│   ├── chat.html          # Main chat interface
│   ├── login.html         # Login/registration page
│   ├── style.css          # Main styles
│   ├── theme-dark-blue.css # Dark theme variables
│   └── uploads/           # File upload directory
├── dist/                  # Compiled TypeScript output
├── package.json           # Dependencies and scripts
├── tsconfig.json          # TypeScript configuration
├── webpack.config.js      # Webpack configuration
├── eslint.config.js       # ESLint configuration
├── test-users.js          # Script to create test users
└── check-db.js           # Database inspection script
```

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd chat-app
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the application**
   ```bash
   npm run build
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

5. **Access the application**
   - Open your browser and go to `http://localhost:3000`
   - You'll be redirected to the login page to create an account

## Available Scripts

- `npm run build` - Build both client and server
- `npm run build:client` - Build client-side code with Webpack
- `npm run build:server` - Compile TypeScript server code
- `npm run watch:client` - Watch and rebuild client code on changes
- `npm run dev` - Start development server with ts-node
- `npm start` - Start production server (requires build first)
- `npm run clean` - Clean the dist directory

## Development

### Creating Test Users

Run the test user creation script:
```bash
node test-users.js
```

This creates test users:
- johndoe (John Doe)
- janesmith (Jane Smith)
- mikej (Mike Johnson)
- sarahw (Sarah Wilson)

### Database Inspection

Check the database contents:
```bash
node check-db.js
```

### File Structure

The application follows a clean architecture:

- **Frontend**: All client code is in `src/client.ts` and gets bundled to `public/client.bundle.js`
- **Backend**: Server code is in `src/server.ts` with modular components
- **Database**: SQLite database with proper schema and relationships
- **Styling**: Modern CSS with CSS custom properties for theming

## Database Schema

### Users Table
- `id`, `username`, `first_name`, `last_name`, `email`, `avatar`, `last_seen`, `is_online`, `created_at`

### Rooms Table
- `id`, `name`, `description`, `is_public`, `created_at`, `created_by`

### Messages Table
- `id`, `room`, `username`, `content`, `timestamp`, `message_type`, `file_name`, `file_url`, `file_size`, `edited`, `edited_at`

### Room Memberships Table
- `id`, `room_name`, `username`, `joined_at`, `invited_by`

## Features in Detail

### Real-time Messaging
- Messages are instantly delivered to all users in a room
- Proper error handling and message validation
- Support for text messages and file uploads

### @Mention System
- Type `@` followed by a username to trigger autocomplete
- Fuzzy search matches usernames and full names
- Keyboard navigation with arrow keys and enter
- Real-time user search from the database

### File Sharing
- Drag and drop or click to upload files
- File type validation and size limits
- Secure file storage with proper naming
- Download links and file previews

### Mobile Experience
- Touch-friendly interface
- Responsive sidebar with overlay
- Mobile-optimized input handling
- Proper viewport and accessibility support

## Security Features

- Input validation and sanitization
- SQL injection prevention with prepared statements
- File upload security (type and size validation)
- Session-based authentication
- CORS protection

## Browser Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Mobile browsers (iOS Safari, Chrome Mobile)
- Progressive enhancement approach

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Version History

- **v1.0.0** - Initial release with core chat functionality
- **v1.1.0** - Added file sharing and improved UI
- **v1.2.0** - Implemented user authentication and @mentions
- **v1.3.0** - Added room management and database persistence

## Support

For issues and questions, please open an issue on the GitHub repository.
