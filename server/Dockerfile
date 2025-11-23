FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm ci --only=production || npm install --production
COPY index.js ./
ENV PORT=5210 NODE_ENV=production
EXPOSE 5210
CMD ["node", "index.js"]