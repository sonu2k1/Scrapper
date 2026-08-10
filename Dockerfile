FROM mcr.microsoft.com/playwright:v1.49.1-noble

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy application files
COPY . .

# Expose server port
EXPOSE 3005

# Start Express server with Playwright support
CMD ["node", "server.js"]
