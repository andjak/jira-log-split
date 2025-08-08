# Use an official Node.js runtime as a parent image (Node 22 to match local env).
# Use bookworm-slim and avoid apt entirely to prevent timestamp/apt repo issues.
FROM node:22-bookworm-slim
# Temporary workaround: bypass apt timestamp checks (Cursor build VM clock may be off)
RUN apt-get -o Acquire::Check-Valid-Until=false -o Acquire::Check-Date=false update \
    && apt-get install -y --no-install-recommends \
        git \
        curl \
        unzip \
    && rm -rf /var/lib/apt/lists/*
# The agent will handle cloning the repository and installing dependencies.
# No additional system packages required for this project.

# Use the built-in non-root 'node' user provided by the base image.
WORKDIR /home/node
USER node
