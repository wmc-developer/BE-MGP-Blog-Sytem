# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

MGP Blogs is an internal tool for WingMan Creative to generate blog posts using AI (ChatGPT). A user provides a title and optional notes, and the AI writes the full post. The user can then refine it through a chat-like interface ("make the intro shorter", "add more detail about X") and the AI regenerates with full conversation context. Once happy, the user clicks Select to save it to past posts.

**Key features:**
- Generate blog posts from just a title + optional notes
- Chat-based refinement — keep editing with AI until satisfied
- Writing guidelines stored in DB and automatically injected into every AI prompt
- User-controlled number of recent posts used as tone/style reference during generation
- Save finalized posts with full chat history so AI refinement can resume anytime

## Commands

```bash
npm install       # install dependencies
npm run dev       # start with nodemon (auto-restart)
npm start         # start without nodemon
```

## Environment

Copy `.env.example` to `.env` and fill in:
- `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` — from Supabase project settings
- `OPENAI_API_KEY` — OpenAI key
- `OPENAI_MODEL` — e.g. `gpt-5.4` or `gpt-4o-mini` (defaults to `gpt-4o` if not set)
- `PORT` — defaults to 3000

## Architecture

Small Express API for AI-powered blog post generation. No auth — internal company tool.

**Entry point:** `src/index.js` — mounts three routers under `/api`.

**Lib clients:**
- `src/lib/supabase.js` — single Supabase client instance
- `src/lib/openai.js` — single OpenAI client instance

**Routes:**
- `src/routes/generate.js` — core AI logic. `POST /api/generate` starts a new post (title + optional notes), `POST /api/generate/refine` continues the chat with an instruction. Both return `{ title, content, messages }` — the `messages` array is the full GPT conversation history and must be stored by the frontend and sent back on each refine call.
- `src/routes/posts.js` — CRUD for saved posts. `POST /api/posts` saves a finalized post including the `messages` array so AI chat can resume later. `PUT /api/posts/:id` updates a saved post.
- `src/routes/guidelines.js` — CRUD for writing guidelines fed into the AI system prompt.

**AI context:** On every generation, the system prompt is built with all guidelines + N most recent saved posts for tone/style reference. N is passed by the frontend as `recentPostsLimit` in the request body (defaults to 3). Frontend should call `GET /api/posts/count` first to know the max available, then let the user pick a number.

## Database

Run `supabase.sql` in Supabase SQL Editor to create tables:
- `posts` — `id, title, content, notes, messages (jsonb), created_at, updated_at`
- `guidelines` — `id, title, content, created_at`
