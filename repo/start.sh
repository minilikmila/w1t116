#!/bin/bash

set -e

echo "Installing dependencies..."
npm install

echo ""
echo "Building for production..."
npm run build

echo ""
echo "Starting development server..."
npm run dev
