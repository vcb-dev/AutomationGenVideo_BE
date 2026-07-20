# Stage 1: Build
FROM node:20-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

# Skip Chromium download during dependency installation
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Install all dependencies (including devDependencies for building)
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source code and build — Nest emits dist/main.js (rootDir=src)
COPY . .
RUN npm run build \
  && test -f dist/main.js \
  && echo "Build OK — dist/main.js present"

# Prune devDependencies to keep only production dependencies in node_modules
RUN npm prune --omit=dev && npm cache clean --force

# Stage 2: Runtime
FROM node:20-alpine

RUN apk add --no-cache openssl ffmpeg

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Copy the pruned node_modules from builder stage
COPY --from=builder /app/node_modules ./node_modules

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

EXPOSE 3000

# Support both Nest layouts (dist/main.js with rootDir=src, or dist/src/main.js fallback)
CMD ["sh", "-c", "if [ -f dist/main.js ]; then exec node dist/main.js; elif [ -f dist/src/main.js ]; then exec node dist/src/main.js; else echo 'No dist/main.js found' >&2; ls -laR dist 2>/dev/null; exit 1; fi"]
