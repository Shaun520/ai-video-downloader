# syntax=docker/dockerfile:1
# SaveAny 核心容器服务（Cloudflare Containers）
# 构建：在 monorepo 根目录执行
#   docker build -f apps/container/Dockerfile -t saveany-core .
# 运行：docker run --env PORT=8788 -p 8788:8788 saveany-core
# 接口：GET /health   POST /parse | /direct-url | /subtitle

FROM node:22-slim AS base
# 运行时依赖：ffmpeg（音视频合并）+ python3/pip + yt-dlp
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip \
  && rm -rf /var/lib/apt/lists/* \
  && pip3 install --no-cache-dir --break-system-packages -U yt-dlp \
  && yt-dlp --version
WORKDIR /app

FROM base AS build
# 仅复制容器服务所需片段，缩小构建上下文
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY packages/shared ./packages/shared
COPY packages/core ./packages/core
COPY apps/container ./apps/container
RUN npm install -g pnpm@10
RUN pnpm install --filter @saveany/container... --no-frozen-lockfile
RUN pnpm --filter @saveany/core build

FROM base AS runtime
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/container ./apps/container
ENV PORT=8788
EXPOSE 8788
CMD ["node", "apps/container/server.mjs"]