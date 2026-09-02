# Imagen de producción para Railway.
# Etapa 1: instala dependencias y compila. Etapa 2: solo lo necesario para correr.

FROM node:22-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev


FROM node:22-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Railway asigna PORT en tiempo de ejecución; 3000 es solo el valor por defecto.
EXPOSE 3000

CMD ["node", "dist/main"]
