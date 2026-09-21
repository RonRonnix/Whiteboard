# Whiteboard Lab

A room-based collaborative whiteboard with authenticated users, Socket.IO presence/chat/drawing, and a PostgreSQL database managed by Prisma.

## Stack

- React, TypeScript, Vite, Tailwind CSS, Zustand
- Express, Socket.IO, Zod, Helmet, and JWT cookie authentication
- PostgreSQL and Prisma

## Run locally

1. Copy `.env.example` to `.env` and set `VITE_API_URL` if the API is not on port 4000.
2. Copy `server/.env.example` to `server/.env`, then set `DATABASE_URL` and a strong `JWT_SECRET`.
3. Create the PostgreSQL database named in `DATABASE_URL`.
4. Install dependencies in both folders:

   ```powershell
   npm install
   Set-Location server
   npm install
   npm run prisma:generate
   npm run prisma:deploy
   ```

5. In separate terminals, start the API and web app:

   ```powershell
   Set-Location server
   npm run dev
   ```

   ```powershell
   npm run dev
   ```

The client runs at `http://localhost:5173`; the API runs at `http://localhost:4000`.

## Room permissions

Each room membership has one of these roles:

- **Owner** — manages member roles and invite settings; can draw and chat.
- **Editor** — can draw and chat.
- **Viewer** — can view, move their cursor, and chat, but cannot alter the board.

Joining with an active invite always grants the **viewer** role. The owner can promote or demote members using the room’s member list. Permissions are checked on the server for every protected Socket.IO action.

## Invite controls

The owner can set a 24-hour expiry, remove expiry, revoke the current code, or rotate it. Revoking/rotating blocks new joins using the old code; it never removes existing members.

## Board tools

Editors and owners can choose a pen or eraser and adjust its size. Erasing is recorded as a board operation, so it remains synchronized for everyone in the room. Each collaborator can undo and redo their own drawing operations using the toolbar or `Ctrl/Cmd+Z`, `Ctrl+Y`, and `Ctrl/Cmd+Shift+Z`.

## Checks

```powershell
npm run build
npm run lint

Set-Location server
npm run build
```

## Current scope

Room identities, memberships, roles, and invite controls are persisted. Live cursors, chat, and whiteboard strokes are currently in server memory, so they reset when the server restarts. Persisting those collaboration records is the next planned phase.
