# Use an official Node.js runtime as a parent image (Node 22 to match local env).
# Use Alpine to avoid apt entirely and keep the image minimal.
FROM node:22-alpine

# The agent will handle cloning the repository and installing dependencies.
# No additional system packages required for this project.

# Install minimal tools required by the agent (git for repo ops).
RUN apk add --no-cache git ca-certificates

# Use the built-in non-root 'node' user provided by the base image.
WORKDIR /home/node
USER node
