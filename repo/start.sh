#!/bin/bash

set -e

node_major="$(node -p 'process.versions.node.split(".")[0]')"

if [ "$node_major" -lt 20 ]; then
  echo "Node 20 or higher is required. Current version: $(node -v)"
  echo "If you use nvm, run: nvm use 20"
  exit 1
fi

echo "Installing dependencies..."
npm install

echo ""
echo "Building for production..."
npm run build

echo ""
echo "Starting development server..."
npm run dev
