# CARO Platform

Industrial Automation System with Tag Registry Admin Tool.

## Workspaces

- `packages/shared` - @caro/shared - Shared validation and business logic
- `packages/ui` - @caro/ui - Shared UI components and design tokens
- `apps/tag-registry` - Tag Registry Admin Tool

## Getting Started

1. Copy `.env.example` to `.env` and configure:
   ```bash
   cp .env.example .env
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the Tag Registry development servers:
   ```bash
   # Terminal 1 - Backend
   npm run dev:server

   # Terminal 2 - Frontend
   npm run dev:client
   ```

## Phase 1 Scope

Phase 1 is file-based only. No database. Template editing with client-side validation and in-memory registry preview.

See `apps/tag-registry/docs/` for full specifications.
