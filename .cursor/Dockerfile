# Use an official Node.js runtime as a parent image (Node 22 to match local env).
# Use Debian (glibc) – required because vm-daemon binary is glibc-linked (Alpine/musl breaks with fcntl64 errors)
FROM node:22-bookworm-slim

# The agent will handle cloning the repository and installing dependencies.
# No additional system packages required for this project.

# Install minimal tools (git, bash, CA). Bypass repo time-checks to avoid clock skew failures
RUN apt-get update -o Acquire::Check-Valid-Until=false -o Acquire::Check-Date=false \
  && apt-get install -y --no-install-recommends git ca-certificates bash \
  && rm -rf /var/lib/apt/lists/*
SHELL ["/bin/bash", "-lc"]

# Use root so the agent can chown workspace; it will still run your terminals as configured
WORKDIR /home/node
USER root
