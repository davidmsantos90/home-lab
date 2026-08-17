FROM node:22-alpine AS ui-build
WORKDIR /app/ui
ARG VITE_ACCESS_CONTROL_API_URL
ENV VITE_ACCESS_CONTROL_API_URL=${VITE_ACCESS_CONTROL_API_URL}
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ ./
COPY openapi.json /app/openapi.json
RUN npm run build

FROM python:3.12-alpine
WORKDIR /app
COPY api.py serve.py sync.py openapi.json ./
COPY aliases.json.example policies.json.example ./
COPY --from=ui-build /app/ui/dist ./ui/dist
ENV ACCESS_CONTROL_HOST=0.0.0.0
ENV ACCESS_CONTROL_PORT=8787
EXPOSE 8787
CMD ["python3", "./serve.py"]
