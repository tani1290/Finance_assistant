#!/usr/bin/env bash
# ====================================================================
# Jinay Finance AI — macOS / Linux Setup Script
# ====================================================================

set -e

echo "======================================================="
echo "  JINAY FINANCE AI — UNIX SETUP"
echo "======================================================="

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js v22 LTS."
    exit 1
fi

echo "✅ Node.js detected: $(node -v)"

# Copy environment files
if [ ! -f .env ] && [ -f .env.example ]; then
    cp .env.example .env
    echo "✅ Created .env from .env.example"
fi

if [ ! -f node-backend/.env ] && [ -f node-backend/.env.example ]; then
    cp node-backend/.env.example node-backend/.env
    echo "✅ Created node-backend/.env from node-backend/.env.example"
fi

# Harden sensitive local credentials permissions
echo ""
echo "🔒 Hardening sensitive local file permissions (chmod 600)..."
for f in .env .env.local node-backend/.env mobile/android/key.properties mobile/android/finpro-release.jks; do
    if [ -f "$f" ]; then
        chmod 600 "$f"
        echo "  - Secured: $f (600)"
    fi
done

# Install Git pre-commit security hook
if [ -d .git/hooks ] && [ -f scripts/git-hooks/pre-commit ]; then
    echo ""
    echo "🛡️ Installing Git pre-commit security hook..."
    TARGET_HOOK=".git/hooks/pre-commit"
    if [ -f "$TARGET_HOOK" ] && ! cmp -s scripts/git-hooks/pre-commit "$TARGET_HOOK"; then
        BACKUP_HOOK=".git/hooks/pre-commit.backup.$(date +%s)"
        cp "$TARGET_HOOK" "$BACKUP_HOOK"
        echo "  - Existing pre-commit hook backed up to: $BACKUP_HOOK"
    fi
    cp scripts/git-hooks/pre-commit "$TARGET_HOOK"
    chmod +x "$TARGET_HOOK"
    echo "  - Pre-commit security hook installed & active."
fi

# Install dependencies
echo ""
echo "📦 Installing backend dependencies..."
cd node-backend
npm install

# Generate Prisma Client
echo ""
echo "🔧 Generating Prisma client..."
npx prisma generate

cd ..

echo ""
echo "======================================================="
echo "  SETUP COMPLETE!"
echo "  Run: npm run dev"
echo "======================================================="
