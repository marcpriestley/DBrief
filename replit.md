# DBrief - Daily Journaling App

## Overview
DBrief is a daily journaling application designed to help users track their well-being through journal entries, customizable metric tracking, and AI-powered insights. It integrates with health devices for automated data collection and provides trend visualizations to help users understand their patterns over time. The project aims to offer a comprehensive and intuitive platform for personal reflection and self-improvement.

## User Preferences
- Score circles must always remain at the top of the main dashboard
- Scores should persist until the next day, then reset to blank for new inputs
- Integration with Oura Ring API for automated health data (Sleep Quality, Readiness only)
- Oura metrics auto-sync when app opens - Sleep Quality and Readiness automatically populate
- Manual metrics remain blank until first input - Happiness, Productivity, Energy, Nutrition start blank each day
- Once inputted, all scores persist and display for that date
- Trend graphs should pop up when tapping metric circles
- Journal entries and scores should display in a dialog when holding calendar dates (2 seconds)
- No highlight box during calendar long-press
- Journal entries must persist in textarea after saving
- Duolingo-style streak tracking for user engagement based on score inputs (not journal entries)
- Analytics/trends show only user-input data (auto-synced scores excluded)
- **Daily reminders at 9pm (UTC) by default** - customizable time in settings
- **Notifications enabled by default** - can be turned off in settings modal

## System Architecture
**Frontend**: React with TypeScript, Wouter for routing, and TanStack Query for data fetching.
**Backend**: Express server utilizing Drizzle ORM.
**Storage**: In-memory storage (MemStorage) with a PostgreSQL fallback (currently experiencing database connection issues).
**UI/UX**: Built with Shadcn/ui components and styled using Tailwind CSS.
**Voice**: Web Speech API for voice-to-text transcription.
**AI**: OpenAI integration for generating journal insights and pattern analysis.
**Health Tracking**: Oura Ring API integration for automatic health metrics synchronization (Sleep Quality, Readiness).
**Push Notifications**: Web Push API with service worker for daily score reminders. VAPID keys for secure delivery. Cron scheduler for timed notifications.
**Feature Specifications**:
- Voice recording with speech-to-text.
- Calendar-based journal entry and score retrieval.
- Customizable metric tracking with interactive score circles.
- Interactive trend graph dialogs showing 14-day history, averages, and edit functionality.
- Calendar long-press to view daily journal and scores.
- Streak tracking for user engagement based on manual score inputs.
- Multi-scale metric support (e.g., 0-10 for wellness, 0-100 for health).
- Journal entries append with timestamps and preserve whitespace.
- Score input flow simplified to two steps: tap circle to edit, then save.
- AI Insights displayed at the bottom of the page.
- Analytics filters to show only user-input scores, excluding auto-synced data.

## External Dependencies
- **PostgreSQL**: Database for persistent storage (currently on fallback to in-memory).
- **Oura Ring API**: For syncing Sleep Quality and Readiness metrics.
- **OpenAI API**: For AI-powered journal insights and analysis.
- **Web Push API**: For browser push notifications (requires VAPID keys: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL).

## Recent Updates (Nov 15, 2025)
- ✅ **Push Notification System**: Daily reminders at customizable time (default 9pm UTC)
  - Service worker (/sw.js) handles push notifications
  - Settings modal for notification preferences
  - Backend cron scheduler checks every minute for due reminders
  - Notifications gracefully degrade if VAPID keys not configured
  - User preferences: notificationsEnabled, reminderTime, timezone
- ✅ **Simplified Score Input UX**: Tap circle → Enter score → Save (2 steps)
  - Removed trend comparison from score circles  
  - "View Trends" button accessible from edit dialog
- ✅ **Clean Slate Start**: Removed seed data for today's scores and journal
  - Streak starts at 0
  - Manual metrics blank until user input
  - Oura metrics auto-sync on first load
- ✅ **AI Insights Repositioned**: Moved to bottom of page after calendar/journal grid