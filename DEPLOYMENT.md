# Deployment Guide

This guide covers various deployment options for the Chat Application.

## Prerequisites

- Node.js 16+ installed
- npm or yarn package manager
- Git for version control

## Production Build

### 1. Install Dependencies
```bash
npm install --production
```

### 2. Build Application
```bash
npm run build
```

### 3. Environment Variables
Create a `.env` file in the project root:
```env
NODE_ENV=production
PORT=3000
SESSION_SECRET=your-secure-random-session-secret-here
DATABASE_PATH=/path/to/production/database.db
UPLOAD_DIR=/path/to/uploads
```

### 4. Database Setup
```bash
# The database will be created automatically on first run
# Ensure the directory has proper permissions
mkdir -p /path/to/database/directory
```

## Deployment Options

### Option 1: PM2 (Recommended for VPS)

#### Install PM2
```bash
npm install -g pm2
```

#### Create PM2 Configuration
Create `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'chat-app',
    script: 'dist/server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
```

#### Deploy with PM2
```bash
# Create logs directory
mkdir -p logs

# Start application
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

### Option 2: Docker Deployment

#### Create Dockerfile
```dockerfile
FROM node:16-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build application
RUN npm run build

# Create uploads directory
RUN mkdir -p public/uploads

# Expose port
EXPOSE 3000

# Set user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S chatapp -u 1001
USER chatapp

# Start application
CMD ["npm", "start"]
```

#### Create docker-compose.yml
```yaml
version: '3.8'
services:
  chat-app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - SESSION_SECRET=your-secure-session-secret
    volumes:
      - ./data:/app/data
      - ./uploads:/app/public/uploads
    restart: unless-stopped
```

#### Deploy with Docker
```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f
```

### Option 3: Traditional VPS Deployment

#### 1. Setup Server
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
sudo apt install -y nodejs

# Install nginx (for reverse proxy)
sudo apt install -y nginx
```

#### 2. Clone and Setup Application
```bash
# Clone repository
git clone https://github.com/username/chat-app.git
cd chat-app

# Install dependencies
npm install

# Build application
npm run build

# Create production directories
sudo mkdir -p /var/www/chat-app
sudo cp -r . /var/www/chat-app/
sudo chown -R www-data:www-data /var/www/chat-app
```

#### 3. Configure Nginx
Create `/etc/nginx/sites-available/chat-app`:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/chat-app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 4. Setup SSL (Optional but Recommended)
```bash
# Install certbot
sudo apt install -y certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d your-domain.com
```

### Option 4: Heroku Deployment

#### 1. Prepare for Heroku
Create `Procfile`:
```
web: npm start
```

Update `package.json` to include heroku-postbuild:
```json
{
  "scripts": {
    "heroku-postbuild": "npm run build"
  }
}
```

#### 2. Deploy to Heroku
```bash
# Install Heroku CLI
# Create Heroku app
heroku create chat-app-name

# Set environment variables
heroku config:set NODE_ENV=production
heroku config:set SESSION_SECRET=your-secure-session-secret

# Deploy
git push heroku main
```

### Option 5: DigitalOcean App Platform

#### 1. Create .do/app.yaml
```yaml
name: chat-app
services:
- name: web
  source_dir: /
  github:
    repo: username/chat-app
    branch: main
  run_command: npm start
  build_command: npm run build
  environment_slug: node-js
  instance_count: 1
  instance_size_slug: basic-xxs
  http_port: 3000
  env:
  - key: NODE_ENV
    value: production
  - key: SESSION_SECRET
    value: your-secure-session-secret
    type: SECRET
```

## Security Considerations

### 1. Environment Variables
- Never commit sensitive data
- Use strong session secrets
- Configure proper CORS settings

### 2. Database Security
- Regular backups
- Proper file permissions
- Consider encryption for sensitive data

### 3. File Upload Security
- Limit file types and sizes
- Scan uploads for malware
- Store uploads outside web root if possible

### 4. Network Security
- Use HTTPS in production
- Configure firewall rules
- Regular security updates

## Monitoring and Maintenance

### 1. Logging
```bash
# With PM2
pm2 logs chat-app

# With Docker
docker-compose logs -f

# System logs
sudo journalctl -u chat-app -f
```

### 2. Health Checks
Create health check endpoint in server:
```javascript
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});
```

### 3. Backup Script
```bash
#!/bin/bash
# backup.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/chat-app"

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup database
cp /path/to/chat.db $BACKUP_DIR/chat_$DATE.db

# Backup uploads
tar -czf $BACKUP_DIR/uploads_$DATE.tar.gz /path/to/uploads

# Keep only last 30 days of backups
find $BACKUP_DIR -name "*.db" -mtime +30 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +30 -delete
```

Make executable and add to cron:
```bash
chmod +x backup.sh
crontab -e
# Add line: 0 2 * * * /path/to/backup.sh
```

## Performance Optimization

### 1. Enable Gzip Compression
In nginx configuration:
```nginx
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;
```

### 2. Static File Caching
```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

### 3. Database Optimization
- Regular VACUUM operations for SQLite
- Monitor query performance
- Add indexes for frequent queries

## Troubleshooting

### Common Issues

#### Port Already in Use
```bash
# Find process using port 3000
lsof -i :3000
# Kill process
kill -9 PID
```

#### Permission Issues
```bash
# Fix file permissions
sudo chown -R $USER:$USER /path/to/chat-app
chmod -R 755 /path/to/chat-app
```

#### Database Lock Issues
```bash
# Check for database locks
fuser /path/to/chat.db
# Kill locking processes if necessary
```

### Log Analysis
```bash
# Check application logs
tail -f /var/log/chat-app/error.log

# Monitor system resources
htop
df -h
free -m
```

This deployment guide should cover most common deployment scenarios for the chat application.
