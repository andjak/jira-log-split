# Use an official Node.js runtime as a parent image (Node 22 to match local env).
# Use bookworm-slim and avoid apt entirely to prevent timestamp/apt repo issues.
FROM node:22-bookworm-slim

# The agent will handle cloning the repository and installing dependencies.
# No additional system packages required for this project.

# Install minimal tools required by the agent (git for repo ops).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Use the built-in non-root 'node' user provided by the base image.
WORKDIR /home/node
USER node
