FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --only=production || npm install --production
COPY server ./server
COPY public ./public
ENV PORT=3000
EXPOSE 3000
CMD ["node","server/index.js"]