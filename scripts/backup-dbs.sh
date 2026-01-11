#!/bin/bash

# Create backups directory if it doesn't exist
mkdir -p backups

echo "Backing up IM Database from Docker volume..."
# Copy chat.db from the running mxg-im-main container (which mounts im-data volume)
# We use docker cp from the container path /app/data/chat.db
# Note: It's safer to use 'docker cp' than accessing volume path directly on host if possible, 
# but volumes usually need a helper or direct path.
# Since we know the container 'mxg-im-main' has the volume mounted at /app/data, we can try docker cp.

# Check if container is running
if [ "$(docker ps -q -f name=mxg-im-main)" ]; then
    docker cp mxg-im-main:/app/data/chat.db ./backups/chat.db
    echo "IM Database (chat.db) backed up."
else
    echo "Container mxg-im-main is not running. Attempting to mount volume via temporary container..."
    docker run --rm -v im-data:/data -v $(pwd)/backups:/backup alpine cp /data/chat.db /backup/chat.db
    echo "IM Database (chat.db) backed up via temporary container."
fi


echo "Backing up Backend Database..."
# Backend DB is a bind mount at ./server/data/app.db
if [ -f "./server/data/app.db" ]; then
    cp ./server/data/app.db ./backups/app.db
    echo "Backend Database (app.db) backed up."
else
    echo "Warning: ./server/data/app.db not found!"
fi

echo "Backup complete. Files in ./backups/:"
ls -lh ./backups/
