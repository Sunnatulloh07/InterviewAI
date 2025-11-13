#!/bin/bash

# InterviewAI Pro - Docker Development Environment Shutdown Script

echo "🛑 Stopping InterviewAI Pro Development Environment..."
echo ""

# Stop Docker Compose
docker-compose stop

echo ""
echo "✅ All services stopped"
echo ""
echo "💡 To remove all data volumes, run: docker-compose down -v"
echo ""

