# git is not optional: core shells out to it for history, and a brain without a
# repository loses commit-per-write.
FROM node:20-slim AS build

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/search/package.json packages/search/
COPY packages/skills/package.json packages/skills/
COPY apps/mcp/package.json apps/mcp/
COPY apps/cli/package.json apps/cli/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json turbo.json ./
COPY packages/ packages/
COPY apps/ apps/

RUN pnpm build && pnpm prune --prod


FROM node:20-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps ./apps
COPY --from=build /app/package.json ./

# The presets and example content are read at runtime by `gbrain init` and by
# the zero-config first run.
COPY seed/ ./seed/

# The brain is a mounted volume. Never bake one into the image: it would ship
# somebody's notes to everyone who pulls it.
ENV BRAIN_ROOT=/brain
ENV MCP_TRANSPORT=stdio
ENV GIT_AUTOCOMMIT=false
VOLUME /brain

# git refuses to operate on a directory owned by another user, which a mounted
# volume usually is.
RUN git config --system --add safe.directory /brain

ENTRYPOINT ["node", "apps/mcp/dist/index.js"]
