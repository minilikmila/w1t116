# Learning Center Platform

## About

Learning Center Platform is a browser-based learning center management application built with Svelte. It runs entirely in the browser with no backend server — all data is stored locally in IndexedDB.

## Requirements

- Node 20 or higher
- Docker and Docker Compose (optional, for containerised run)

## Getting started without Docker

```bash
npm install
npm run dev
npm run build
npm run preview
```

Alternatively, run `bash start.sh` to install dependencies, build, and start the dev server in one step.

The app runs on http://localhost:5173

## Getting started with Docker

```bash
docker compose up --build -d
docker compose down
```

Alternatively, run `bash start-docker.sh` to build and start the container in one step.

The app is available on http://localhost:5173 after startup.

## Running tests

```bash
bash run_tests.sh
```

Runs unit and API-level tests covering services, stores, and core application logic using Vitest.

## Initial admin account

On first load the application automatically creates a seed admin account. The default credentials are:

- **Username:** `admin`
- **Password:** `admin`

Change the password immediately after first login.

## Tech stack

- **Framework:** Svelte 5
- **Build tool:** Vite 8
- **Storage:** IndexedDB (browser-local)
- **Language:** TypeScript
