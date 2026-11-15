FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN mkdir -p /data && chown node:node /data
COPY --chown=node:node server/package.json ./package.json
COPY --chown=node:node server/src ./src
USER node
EXPOSE 3000
CMD ["node", "src/main.ts"]
