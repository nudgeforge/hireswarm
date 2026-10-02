# Build the Next.js user interface as static assets. The FastAPI process below
# serves both these assets and the real API on one Railway public origin.
FROM node:20-alpine AS frontend-build
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ENV STATIC_EXPORT=true
# Explicit empty base means client requests /api/* and /healthz on this same host.
ENV NEXT_PUBLIC_API_BASE=""
RUN npm run build

# Runtime: API plus generated frontend, no separate Railway service required.
FROM python:3.13-slim AS runtime
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HIRESWARM_STATIC_DIR=/app/frontend/out
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY --from=frontend-build /web/out ./frontend/out
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --no-server-header"]
