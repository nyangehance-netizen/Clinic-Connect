FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production TZ=Africa/Dar_es_Salaam
RUN apk add --no-cache tzdata
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
# The database lives in a volume so it survives updates.
VOLUME ["/app/data"]
EXPOSE 3000
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
