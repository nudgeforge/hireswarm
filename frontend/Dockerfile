FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Next resolves rewrites while building. Render passes a service environment
# variable with this same key through as a Docker build argument, so set
# BACKEND_URL to the public FastAPI Render URL before the frontend deploys.
ARG BACKEND_URL=http://api:8000
ENV BACKEND_URL=$BACKEND_URL
RUN npm run build
# Render assigns PORT dynamically; Next must bind to that supplied port.
CMD ["sh", "-c", "npm run start -- --port ${PORT:-3000}"]
