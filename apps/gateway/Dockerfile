# 모노레포 루트를 빌드 컨텍스트로 사용: docker build -f apps/gateway/Dockerfile .
FROM node:24-slim AS base
RUN corepack enable
WORKDIR /app

# 의존성 레이어 (락파일 기반 캐싱)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/gateway/package.json apps/gateway/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile --filter @hawker/gateway... --filter @hawker/db...

# 소스
COPY packages/db packages/db
COPY apps/gateway apps/gateway

ENV NODE_ENV=production
ENV PORT=8402
ENV HAWKER_DB_PATH=/data/hawker.db
EXPOSE 8402

# 시작 시 DB 디렉토리 보장 → 스키마 적용 → 게이트웨이 실행 (tsx 런타임 — MVP)
CMD ["sh", "-c", "mkdir -p \"$(dirname \"$HAWKER_DB_PATH\")\" && pnpm --filter @hawker/db push && pnpm --filter @hawker/gateway start"]
