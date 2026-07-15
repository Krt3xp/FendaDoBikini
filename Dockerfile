FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Since we're not using prisma, we don't need prisma generate.
# Let's just build the Next.js app.
ENV NEXT_TELEMETRY_DISABLED 1
ENV BACKEND_URL "http://backend:8000"

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
