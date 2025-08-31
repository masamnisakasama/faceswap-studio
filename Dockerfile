FROM node:20-alpine

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./
RUN npm ci

COPY . .
# オフラインAPIパスをビルド時に組み込む
COPY .env.local.offline .env.local

RUN npm run build
EXPOSE 3000
# 0.0.0.0 で待受（コンテナ外からアクセス可）
CMD ["npm","run","start","--","-p","3000","-H","0.0.0.0"]
