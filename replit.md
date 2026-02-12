# DBrief - Daily Journaling App

## Overview
DBrief is a daily journaling application designed to help users track their well-being through journal entries, customizable metric tracking, and AI-powered insights. It integrates with health devices for automated data collection and provides trend visualizations to help users understand their patterns over time. The project aims to offer a comprehensive and intuitive platform for personal reflection and self-improvement.

## User Preferences
- Score circles must always remain at the top of the main dashboard
- Journal panel sits directly under score circles, calendar at the bottom
- All scores use a unified 0-100 scale (compatible with Oura, Whoop, Apple Health)
- Scores should persist until the next day, then reset to blank for new inputs
- Integration with Oura Ring API for automated health data (Sleep Quality, Readiness only)
- Oura metrics auto-sync when app opens - Sleep Quality and Readiness automatically populate
- Manual metrics remain blank until first input - Happiness, Productivity, Energy, Nutrition start blank each day
- Once inputted, all scores persist and display for that date
- Trend graphs should pop up when tapping metric circles
- Journal entries and scores should display in a dialog when holding calendar dates (2 seconds)
- No highlight box during calendar long-press
- Journal entries must persist in textarea after saving
- Duolingo-style streak tracking with milestones (3, 7, 14, 30, 50, 100, 365 days), animations, and motivational messages
- Analytics/trends show only user-input data (auto-synced scores excluded)
- Trends page supports 7 day, 30 day, 6 month, and lifetime timelines
- **Daily reminders at 9pm (UTC) by default** - customizable time in settings
- **Notifications enabled by default** - can be turned off in settings modal

## System Architecture
**Frontend**: React with TypeScript, Wouter for routing, and TanStack Query for data fetching.
**Backend**: Express server utilizing Drizzle ORM with express-session for authentication.
**Authentication**: Session-based auth with email/password login/register. Social sign-in buttons (Google, Apple) are UI-ready.
**Storage**: PostgreSQL database with Drizzle ORM for persistent storage.
**UI/UX**: Built with Shadcn/ui components and styled using Tailwind CSS.
**Voice**: Web Speech API for voice-to-text transcription.
**AI**: OpenAI integration for generating journal insights, pattern analysis, and habit improvement suggestions.
**Health Tracking**: Oura Ring API integration for automatic health metrics synchronization (Sleep Quality, Readiness). All health API scores normalized to 0-100 scale.
**Push Notifications**: Web Push API with service worker for daily score reminders. VAPID keys for secure delivery. Cron scheduler for timed notifications.
**Feature Specifications**:
- Welcome/Auth page with email+password login/register and Google/Apple sign-in buttons
- Session-based authentication with logout support
- Voice recording with speech-to-text.
- Calendar-based journal entry and score retrieval.
- Customizable metric tracking with interactive score circles (all 0-100 scale).
- Interactive trend graph dialogs showing 14-day history, averages, and edit functionality.
- Calendar long-press to view daily journal and scores.
- Duolingo-style streak tracking with milestone celebrations (3, 7, 14, 30, 50, 100, 365 days).
- Unified 0-100 scale for all metrics (wellness, health, activity).
- Journal entries append with timestamps and preserve whitespace.
- Score input flow simplified to two steps: tap circle to edit, then save.
- AI Insights on dashboard and trends page - analyzes scores, journal entries, and streaks.
- Trends page with 7 day, 30 day, 6 month, and lifetime timeline options.
- Analytics filters to show only user-input scores, excluding auto-synced data.

## Pages & Routing
- `/` - Welcome/Auth page (unauthenticated) or Dashboard (authenticated)
- `/dashboard` - Main dashboard with scores, journal, calendar, AI insights
- `/trends` - Trends & Insights page with charts, AI analysis, timeline filters

## External Dependencies
- **PostgreSQL**: Database for persistent storage (currently on fallback to in-memory).
- **Oura Ring API**: For syncing Sleep Quality and Readiness metrics.
- **OpenAI API**: For AI-powered journal insights and analysis.
- **Web Push API**: For browser push notifications (requires VAPID keys: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL).
- **express-session**: For session-based authentication.
- **react-icons**: For social sign-in button icons (Google, Apple).

## Recent Updates (Feb 12, 2026)
- ✅ **Welcome/Auth Page**: New users see login/register page with email+password and Google/Apple sign-in buttons
- ✅ **Session-Based Authentication**: express-session for user sessions, auth routes for register/login/logout/me
- ✅ **Dashboard Layout Reorganized**: Scores → Journal → Calendar → AI Insights (top to bottom)
- ✅ **Unified 0-100 Scale**: All metrics now use 0-100 scale for consistency with health APIs (Oura, Whoop, Apple Health)
- ✅ **Enhanced Trends Page**: Timeline options: 7 days, 30 days, 6 months, lifetime. AI insights integrated into trends.
- ✅ **Enhanced AI Insights**: Analyzes 14 days of scores + journal entries + streak data for habit improvement suggestions
- ✅ **Duolingo-Style Streak System**: Milestone celebrations at 3, 7, 14, 30, 50, 100, 365 days with animations and motivational messages
- ✅ **StreakDisplay Component**: Dedicated streak component with animations, milestone popups, and progress tracking
- ✅ **Capacitor Mobile Setup**: Configured Capacitor for iOS/Android app publishing. PWA manifest, safe area support, app icons, and build guide included.
- ✅ **Persistent Database Storage**: Switched from in-memory to PostgreSQL. All user accounts, journal entries, scores, and streaks persist permanently.
- ✅ **Persistent Sessions**: Sessions stored in PostgreSQL via connect-pg-simple. Users stay logged in across server restarts (30-day session cookies).
- ✅ **Password Hashing**: User passwords hashed with bcrypt for security.
