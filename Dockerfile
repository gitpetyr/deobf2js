# ── Stage 1: Base with dependencies ──
FROM node:22-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && \
    rm -rf /root/.npm /tmp/*
COPY src/ src/

# ── slim: JSDOM sandbox only (~300MB) ──
FROM base AS slim
RUN groupadd -r appuser && useradd -r -g appuser -d /app appuser && \
    chown -R appuser:appuser /app
USER appuser
ENV MCP_TRANSPORT=stdio
ENTRYPOINT ["node", "src/mcp-server.mjs"]

# ── full: Playwright + Chromium (~1.5GB) ──
FROM base AS full
# Install Chromium and deps as root
RUN npx playwright install --with-deps chromium && \
    rm -rf /root/.npm /tmp/*
# Create non-root user and fix permissions
RUN groupadd -r appuser && useradd -r -g appuser -d /app appuser && \
    chown -R appuser:appuser /app
USER appuser
ENV MCP_TRANSPORT=stdio
# Chromium in Docker needs --no-sandbox when not using user namespaces
ENV CHROMIUM_NO_SANDBOX=1
ENTRYPOINT ["node", "src/mcp-server.mjs"]
