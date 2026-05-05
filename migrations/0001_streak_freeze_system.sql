-- Migration: Streak Freeze System (Pit Stop Shields)
-- Adds freeze balance + audit log to the streak subsystem.

ALTER TABLE "streaks"
  ADD COLUMN IF NOT EXISTS "streak_freezes" integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "freeze_used_date" date;

CREATE TABLE IF NOT EXISTS "streak_freeze_events" (
  "id"         serial PRIMARY KEY NOT NULL,
  "user_id"    integer NOT NULL,
  "event_type" text NOT NULL,
  "reason"     text NOT NULL,
  "amount"     integer DEFAULT 1 NOT NULL,
  "created_at" timestamp DEFAULT now()
);
