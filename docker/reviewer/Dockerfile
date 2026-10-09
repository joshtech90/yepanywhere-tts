# Build the application first with pnpm build:bundle, then use the repo root:
# docker build -f docker/reviewer/Dockerfile -t yep-reviewer .
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY dist/npm-package/ ./
RUN npm install --omit=dev --no-audit --no-fund
COPY docker/reviewer/seed.mjs /app/reviewer-seed.mjs
COPY docker/reviewer/provider.mjs /app/reviewer-provider.mjs
USER node
ENV NODE_ENV=production USE_MOCK_SDK=true ENABLED_PROVIDERS=claude \
    HOME=/demo/home YEP_DATA_DIR=/demo/data \
    HOST=127.0.0.1 PORT=3400 LOG_TO_FILE=false
CMD ["node", "--import", "./reviewer-provider.mjs", "dist/index.js"]
