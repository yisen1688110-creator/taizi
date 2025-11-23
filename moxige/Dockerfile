# Frontend container (Vite build + preview)
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE
ARG VITE_ALPHAVANTAGE_KEY
ENV VITE_API_BASE=${VITE_API_BASE}
ENV VITE_ALPHAVANTAGE_KEY=${VITE_ALPHAVANTAGE_KEY}
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
RUN npm i -g serve
EXPOSE 5173
CMD ["serve","-s","dist","-l","5173"]