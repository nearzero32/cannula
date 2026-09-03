# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14 AS base
WORKDIR /usr/src/app

FROM base AS install
RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

FROM base AS release
ENV NODE_ENV=production

COPY --from=install /temp/prod/node_modules ./node_modules
COPY package.json bun.lock ./
COPY tsconfig.json ./
COPY src ./src

RUN chown -R bun:bun /usr/src/app

USER bun
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD bun -e "const r=await fetch('http://127.0.0.1:3001/api/health/live');process.exit(r.ok?0:1)"
CMD ["bun", "run", "start"]
