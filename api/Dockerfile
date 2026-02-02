# ============================================
# Build Stage: Compile TypeScript
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests first (for better caching)
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDependencies for build)
# Use npm ci for faster, more reliable installs in CI/CD
RUN npm ci --legacy-peer-deps

# Copy source code
COPY . .

# Build TypeScript to JavaScript
RUN npm run build

# ============================================
# Production Stage: Minimal runtime image
# ============================================
FROM node:20-alpine

WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json ./

# Install ONLY production dependencies
RUN npm ci --only=production --legacy-peer-deps && \
    npm cache clean --force

# Copy compiled application from builder
COPY --from=builder /app/dist ./dist

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Expose the API port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

# Start the application
CMD ["node", "dist/main.js"]
