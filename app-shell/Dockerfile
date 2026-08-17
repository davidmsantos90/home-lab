FROM node:22-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json tsconfig.node.json vite.config.ts app-shell.config.ts index.html ./
COPY src ./src
RUN npm ci
RUN npm run build

FROM python:3.12-alpine
WORKDIR /app
RUN apk add --no-cache bash jq
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts
RUN mkdir -p /app/dist/scripts && cp -R /app/scripts/. /app/dist/scripts/
COPY serve.py ./serve.py
ENV APP_SHELL_HOST=0.0.0.0
ENV APP_SHELL_PORT=3000
ENV APP_SHELL_CONFIG_PATH=/config/app-shell.config.json
EXPOSE 3000
CMD ["python3", "./serve.py"]
