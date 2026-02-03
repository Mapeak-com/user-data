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

CMD ["node", "dist/index.js"]
