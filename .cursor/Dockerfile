# Use an official Node.js runtime as a parent image (Node 22 to match local env).
# Use bookworm-slim and avoid apt entirely to prevent timestamp/apt repo issues.
FROM node:22-bookworm-slim

# The agent will handle cloning the repository and installing dependencies.
# No additional system packages required for this project.

# Use the built-in non-root 'node' user provided by the base image.
WORKDIR /home/node
USER node
