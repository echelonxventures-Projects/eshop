FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/app.js ./app.js
COPY --from=build /app/platform.js ./platform.js
COPY --from=build /app/platform-config.json ./platform-config.json
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
COPY --from=build /app/styles.css ./styles.css
COPY --from=build /app/white-label.css ./white-label.css
COPY --from=build /app/index.html ./index.html
COPY --from=build /app/favicon.svg ./favicon.svg
COPY --from=build /app/admin ./admin
RUN chown -R node:node /app
USER node
EXPOSE 8899
CMD ["node", "server/index.js"]
