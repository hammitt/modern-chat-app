# Git Setup and Version Control Guide

This document provides a comprehensive guide for setting up version control for the Chat Application project.

## Initial Git Setup

If Git is not already initialized in your project, run these commands in the project root:

```bash
# Initialize Git repository
git init

# Add all files to staging
git add .

# Create initial commit
git commit -m "Initial commit: Modern chat application with full feature set

- Real-time messaging with Socket.io
- User authentication and session management
- SQLite database integration with persistent storage
- File sharing functionality with upload/download
- @mention system with autocomplete dropdown
- Modern responsive UI with dark theme
- Mobile-first design with hamburger menu
- Room management with join/leave functionality
- TypeScript integration for client and server
- Comprehensive build system with Webpack and ESLint"
```

## Recommended Branching Strategy

### Main Branches
- `main` - Production-ready code
- `develop` - Integration branch for features

### Feature Branches
- `feature/feature-name` - New features
- `bugfix/bug-description` - Bug fixes
- `hotfix/critical-fix` - Critical production fixes

### Example Workflow
```bash
# Create and switch to feature branch
git checkout -b feature/improved-mentions

# Make changes and commit
git add .
git commit -m "Improve mention dropdown with better keyboard navigation"

# Switch back to develop and merge
git checkout develop
git merge feature/improved-mentions

# Delete feature branch
git branch -d feature/improved-mentions
```

## Commit Message Conventions

Use conventional commit format for better change tracking:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### Examples
```bash
git commit -m "feat: add file drag-and-drop functionality"
git commit -m "fix: resolve mention dropdown positioning on mobile"
git commit -m "docs: update README with deployment instructions"
git commit -m "refactor: improve database query performance"
```

## Important Files and Directories

### Files to Always Commit
- Source code (`src/`)
- Configuration files (`package.json`, `tsconfig.json`, etc.)
- Public assets (`public/` except uploads)
- Documentation (`README.md`, `CHANGELOG.md`)
- Build configuration (`webpack.config.js`, `eslint.config.js`)

### Files to Never Commit (already in .gitignore)
- `node_modules/` - Dependencies
- `dist/` - Built code
- `*.db` - Database files
- `public/uploads/*` - Uploaded files
- `.env` - Environment variables
- Build artifacts and logs

### Directory Structure in Git
```
chat-app/
├── .vscode/              # VS Code workspace settings
├── public/
│   ├── uploads/.gitkeep  # Preserve directory structure
│   └── *.html, *.css     # Static assets
├── src/                  # Source code
├── package.json          # Dependencies
├── README.md             # Documentation
├── CHANGELOG.md          # Version history
├── .gitignore           # Git ignore rules
└── LICENSE              # License file
```

## Tagging Releases

Tag important releases for easy reference:

```bash
# Create annotated tag for release
git tag -a v1.3.0 -m "Version 1.3.0: Major modernization release

- Complete database integration
- User authentication system
- @mention autocomplete
- File sharing functionality
- Modern responsive UI"

# Push tags to remote
git push origin --tags
```

## Remote Repository Setup

### GitHub Setup
```bash
# Add GitHub remote
git remote add origin https://github.com/username/chat-app.git

# Push to GitHub
git push -u origin main
```

### GitLab or Other Providers
```bash
# Add remote
git remote add origin https://gitlab.com/username/chat-app.git

# Push
git push -u origin main
```

## Development Workflow

### Daily Workflow
```bash
# Start of day - get latest changes
git checkout develop
git pull origin develop

# Create feature branch
git checkout -b feature/new-feature

# Work on feature, commit regularly
git add .
git commit -m "feat: implement new feature component"

# Push feature branch
git push origin feature/new-feature

# Create pull request when ready
# After review and merge, clean up
git checkout develop
git pull origin develop
git branch -d feature/new-feature
```

### Before Major Changes
```bash
# Create backup branch
git checkout -b backup-before-refactor

# Switch back to working branch
git checkout develop
```

## Git Hooks (Optional)

Create pre-commit hooks to ensure code quality:

### Pre-commit Hook
Create `.git/hooks/pre-commit`:
```bash
#!/bin/sh
# Run linting before commit
npm run lint
if [ $? -ne 0 ]; then
  echo "Linting failed. Please fix errors before committing."
  exit 1
fi

# Run type checking
npm run build:server
if [ $? -ne 0 ]; then
  echo "TypeScript compilation failed. Please fix errors before committing."
  exit 1
fi
```

Make it executable:
```bash
chmod +x .git/hooks/pre-commit
```

## Backup and Recovery

### Create Backup
```bash
# Bundle repository for backup
git bundle create chat-app-backup.bundle --all
```

### Restore from Backup
```bash
# Clone from bundle
git clone chat-app-backup.bundle chat-app-restored
```

## Collaboration Guidelines

### Pull Request Process
1. Create feature branch from `develop`
2. Make changes and test thoroughly
3. Update documentation if needed
4. Create pull request with descriptive title and body
5. Request review from team members
6. Address feedback and make necessary changes
7. Merge after approval

### Code Review Checklist
- [ ] Code follows project conventions
- [ ] Tests pass (if applicable)
- [ ] Documentation is updated
- [ ] No sensitive data committed
- [ ] Commit messages are clear and descriptive

## Deployment Considerations

### Production Deployment
```bash
# Create release branch
git checkout -b release/v1.3.0

# Final testing and bug fixes
# Update version numbers
# Update CHANGELOG.md

# Merge to main
git checkout main
git merge release/v1.3.0

# Tag the release
git tag -a v1.3.0 -m "Release v1.3.0"

# Deploy from main branch
```

### Environment Branches
- `main` - Production
- `staging` - Staging environment
- `develop` - Development environment

## Useful Git Commands

### Viewing History
```bash
git log --oneline --graph --all
git log --since="2 weeks ago"
git log --author="username"
```

### Undoing Changes
```bash
# Undo last commit (keep changes)
git reset --soft HEAD~1

# Undo changes to specific file
git checkout -- filename

# Reset to specific commit
git reset --hard commit-hash
```

### Cleaning Up
```bash
# Remove untracked files
git clean -fd

# Remove remote-tracking branches that no longer exist
git remote prune origin
```

This version control setup provides a solid foundation for maintaining and collaborating on the chat application project.
