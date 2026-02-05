FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./

RUN npm ci
COPY . .

RUN npm run generate-json
RUN npm run generate-types
RUN npm run build

FROM node:24-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY --from=build /app/dist ./dist
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -q --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
