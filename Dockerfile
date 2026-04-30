FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime image ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# git is needed by claude-code internals; wget for healthcheck
RUN apk add --no-cache git wget

WORKDIR /app

# Install production deps fresh (no devDependencies)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Install claude-code globally (needed by claude-agent-sdk)
RUN npm install -g @anthropic-ai/claude-code

# Agent working directory — must be /app/workspace to match orchestrator.ts path
RUN mkdir -p /app/workspace && chmod 777 /app/workspace

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD wget -q -O- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
