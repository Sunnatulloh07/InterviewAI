#!/bin/bash

# InterviewAI Pro - Docker Development Environment Startup Script

echo "🚀 Starting InterviewAI Pro Development Environment..."
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  No .env file found. Creating from template..."
    if [ -f env.template ]; then
        cp env.template .env
        echo "✅ Created .env file from template"
        echo "⚠️  Please update .env with your actual credentials before proceeding"
        echo ""
    else
        echo "❌ env.template not found!"
        exit 1
    fi
fi

# Start Docker Compose
echo "🐳 Starting Docker containers..."
docker-compose up -d

# Wait for services to be healthy
echo ""
echo "⏳ Waiting for services to be ready..."
sleep 5

# Check service status
echo ""
echo "📊 Service Status:"
docker-compose ps

echo ""
echo "✅ Development environment is ready!"
echo ""
echo "📍 Service URLs:"
echo "   - MongoDB:          mongodb://localhost:27017"
echo "   - MongoDB Express:  http://localhost:8081 (admin/admin123)"
echo "   - Redis:            redis://localhost:6379"
echo "   - Redis Commander:  http://localhost:8082 (admin/admin123)"
echo ""
echo "💡 Useful commands:"
echo "   - View logs:        docker-compose logs -f"
echo "   - Stop services:    docker-compose stop"
echo "   - Remove volumes:   docker-compose down -v"
echo ""
echo "🎯 Next steps:"
echo "   1. Update .env file with your credentials"
echo "   2. Run: npm install"
echo "   3. Run: npm run start:dev"
echo ""

