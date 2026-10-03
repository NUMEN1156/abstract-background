# Build-Stufe: Frontend und Abhängigkeiten
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Laufzeit-Stufe: Fastify liefert API, Streams und gebautes Frontend
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY server ./server
COPY --from=build /app/dist ./dist
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server/index.mjs"]