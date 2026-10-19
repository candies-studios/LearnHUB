# Container image for Railway, Fly.io, a VPS, or any Docker host.
# Mount a persistent volume at /data — that is where all LearnHub data is kept.
FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production \
    PORT=3000 \
    LH_DATA=/data
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
