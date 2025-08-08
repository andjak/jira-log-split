# Use an official Node.js runtime as a parent image (Node 22 to match local env).
# Using a specific major version is recommended for reproducibility.
FROM node:22-bullseye

# The agent will handle cloning the repository and installing dependencies.
# You can add commands here to install any other necessary system-level development tools.
# For example:
# RUN sudo apt-get update && sudo apt-get install -y <your-tool>
# Install git and other basic dependencies. This should be done as root.
RUN apt-get update && apt-get install -y \
    git \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user.
# Running as a non-root user is a security best practice.
RUN useradd --create-home --shell /bin/bash ubuntu

# Set the working directory in the user's home directory.
# The agent will clone your project code here.
WORKDIR /home/ubuntu

# Now, switch to the non-root user.
USER ubuntu
