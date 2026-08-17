FROM node:22-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json tsconfig.node.json vite.config.ts app-shell.config.ts app-shell.config.json index.html ./
COPY src ./src
RUN npm install
RUN npm run build

FROM python:3.12-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY serve.py ./serve.py
COPY app-shell.config.json ./app-shell.config.json
ENV APP_SHELL_HOST=0.0.0.0
ENV APP_SHELL_PORT=3000
ENV APP_SHELL_CONFIG_PATH=/app/app-shell.config.json
EXPOSE 3000
CMD ["python3", "./serve.py"]
