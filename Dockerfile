FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 pip curl ffmpeg \
    chromium chromium-driver \
    --no-install-recommends && \
    pip install yt-dlp --break-system-packages && \
    apt-get clean

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

ENV PORT=7860
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

EXPOSE 7860
CMD ["node", "headers.js"]