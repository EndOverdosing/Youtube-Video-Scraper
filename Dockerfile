FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 ffmpeg curl chromium \
    --no-install-recommends \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p downloads

EXPOSE 7860

CMD ["node", "headers.js"]