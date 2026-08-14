# Pipupi backend image. Build context: the repository root.
#
# One image, three entry points (docs/DEPLOYMENT.md section 2): the API is the default
# CMD; the worker and the cron runner are the same bundle with a different file:
#
#   docker run <image> bun backend/dist/worker.js
#   docker run <image> bun backend/dist/cron.js
#
# Migrations travel in the same image (the Prisma CLI lives in node_modules):
#
#   docker run <image> bun run --cwd backend prisma:migrate:deploy

FROM oven/bun:1.3.11-slim AS deps
WORKDIR /app
COPY bunfig.toml ./
COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY webapp/package.json webapp/package.json
COPY website/package.json website/package.json
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.11-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY . .
RUN bun run --cwd backend prisma:generate
RUN bun run --cwd backend build

FROM oven/bun:1.3.11-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/backend/prisma backend/prisma
COPY --from=build /app/backend/prisma.config.ts backend/prisma.config.ts
COPY --from=build /app/backend/package.json backend/package.json
COPY --from=build /app/package.json package.json

EXPOSE 8080

CMD ["bun", "backend/dist/api.js"]
