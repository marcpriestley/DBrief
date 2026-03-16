# DBrief - Daily Journaling App

## Overview
DBrief is a daily journaling application with AI-driven conversational debriefs (Rosebud-inspired), customizable wellness metric tracking (0-100 scale), and data-driven insights. The app guides users through a daily reflection conversation with personalized AI prompts based on their scores, goals, and mood data. It integrates with health devices for automated data collection and provides trend visualizations. The design draws subtle F1 debrief inspiration — thoughtful, direct, and data-informed — without being over-the-top.

## User Preferences
- Score circles must always remain at the top of the main dashboard
- Debrief panel (conversational AI journal) sits directly under goals, calendar at the bottom
- All scores use a unified 0-100 scale (compatible with Apple Health)
- Scores should persist until the next day, then reset to blank for new inputs
- Integration with Apple Health (HealthKit via Capacitor) for automated health data (Sleep Quality, Readiness, Activity)
- Health metrics sync via client-side HealthKit reads that POST to `/api/health/sync`
- Manual metrics remain blank until first input - start blank each day
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
**AI**: OpenAI integration for conversational debrief prompts, journal insights, pattern analysis, and habit improvement suggestions.
**Health Tracking**: Apple Health (HealthKit) integration via Capacitor native plugin for automatic health metrics synchronization (Sleep Quality, Readiness, Activity). Client-side reads POST to `/api/health/sync`. All scores normalized to 0-100 scale.
**Push Notifications**: Web Push API with service worker for daily score reminders. VAPID keys for secure delivery. Cron scheduler for timed notifications.
**Feature Specifications**:
- Welcome/Auth page with email+password login/register and Google/Apple sign-in buttons
- Session-based authentication with logout support
- **AI Debrief (Rosebud-style)**: Conversational daily reflection with personalized AI prompts based on scores, goals, mood. Streams responses via SSE. Auto-generates summary on completion. Saves user responses as journal entries.
- Voice recording with speech-to-text.
- Calendar-based journal entry and score retrieval.
- Customizable metric tracking with interactive score circles (all 0-100 scale).
- Interactive trend graph dialogs showing 14-day history, averages, and edit functionality.
- Calendar long-press to view daily debrief conversations and scores.
- Duolingo-style streak tracking with milestone celebrations (3, 7, 14, 30, 50, 100, 365 days).
- Unified 0-100 scale for all metrics (wellness, health, activity).
- Score input flow simplified to two steps: tap circle to edit, then save.
- AI Insights on dashboard and trends page - analyzes scores, journal entries, and streaks.
- Trends page with 7 day, 30 day, 6 month, and lifetime timeline options.
- Analytics filters to show only user-input scores, excluding auto-synced data.

## Pages & Routing
- `/` - Welcome/Auth page (unauthenticated) or Dashboard (authenticated)
- `/dashboard` - Main dashboard with scores, goals, debrief, calendar, AI insights
- `/trends` - Trends & Insights page with charts, AI analysis, timeline filters

## External Dependencies
- **PostgreSQL**: Database for persistent storage (currently on fallback to in-memory).
- **Apple Health (HealthKit)**: For syncing Sleep Quality, Readiness, and Activity metrics via Capacitor.
- **OpenAI API**: For AI-powered journal insights and analysis.
- **Web Push API**: For browser push notifications (requires VAPID keys: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL).
- **express-session**: For session-based authentication.
- **react-icons**: For social sign-in button icons (Google, Apple).

## Recent Updates (Mar 16, 2026 - Latest)
- **Apple Health Integration**: Replaced Oura Ring API with Apple Health (HealthKit via Capacitor). Server accepts health data via `POST /api/health/sync` from native client. Sleep Quality, Readiness, and Activity auto-sync on iOS.
- **Visual Polish**: Complete redesign of all components for professional, cohesive look. SVG ring charts replace conic-gradient circles. Refined card layouts, tighter spacing, consistent typography across ScoreDashboard, Trends, Welcome, Settings, Mood Check-in, and Streak Display.
- **Trends Page Redesign**: Matches main app design system — sticky blurred header, max-w-2xl layout, area chart gradient fills, compact metric filter pills, refined AI insights section.
- **Welcome Page Refresh**: Cleaner auth page with subtle design, proper card styling, matching color system.
- **Settings Enhancement**: Added Apple Health info section, compact notification controls, refined layout.

## Previous Updates (Mar 16, 2026)
- ✅ **Rosebud-Inspired Redesign**: Journal feature replaced with AI-driven conversational debrief system
- ✅ **Debrief Panel**: Chat-style interface where AI asks personalized prompts based on day's scores, goals, and mood data. Streams responses in real-time via SSE.
- ✅ **Debrief Backend**: New `debriefs` and `debrief_messages` tables. API routes for start, respond (streaming), and complete debriefs. Auto-generates conversation summary on completion.
- ✅ **Journal Integration**: Completed debriefs save user responses as journal entries for trends/AI insights analysis
- ✅ **Calendar Debrief View**: Long-press on calendar dates now shows debrief conversation alongside scores
- ✅ **Visual Refresh**: Cleaner, more modern color palette (blue-based primary). Narrower max-width layout (max-w-2xl). Sticky header with backdrop blur. Subtle card shadows and refined spacing.
- ✅ **F1 Debrief Tone**: AI system prompt acts as "personal debrief engineer" — warm, direct, perceptive. One question at a time, 3-5 exchange conversations.

## Previous Updates (Feb 19, 2026)
- ✅ **Score Carryover Fix**: Daily scores no longer show stale cached values from previous days; staleTime:0 forces fresh data on each load
- ✅ **Consolidated Metric Management**: Removed duplicate "Customize" button; single "Manage" button handles all metric operations (add, edit, delete)
- ✅ **No Default Metrics**: New users start with zero metrics and add their own; no pre-populated defaults (Happiness, Productivity, etc.)
- ✅ **Oura Auto-Create Metrics**: Oura sync automatically creates Sleep Quality, Readiness, and Activity metrics if user doesn't have them; /api/oura/status endpoint checks if Oura token is configured; Sync Oura button only shows when configured

## Previous Updates (Feb 18, 2026)
- ✅ **AI Insights Rebuilt**: Uses Replit AI integration (AI_INTEGRATIONS_OPENAI_API_KEY/BASE_URL), analyzes scores + mood + journal + goals as data analyst & wellbeing coach
- ✅ **AI Insights Streak Gate**: Requires 7-day minimum streak to unlock; locked state shows progress bar with flame icon
- ✅ **Recurring Goals**: goal_templates has `recurring` boolean; only recurring templates auto-create daily goals; "Make my bed" is recurring by default
- ✅ **Chat Integration**: OpenAI chat routes registered with authentication; conversations and messages tables created
- ✅ **Oura Activity Score**: Added Activity score from Oura daily_activity endpoint; auto-syncs alongside Sleep Quality and Readiness
- ✅ **Customizable Metrics**: All metrics fully editable (rename, recolor, delete). Add new custom metrics anytime. Soft-delete preserves historical scores. Renaming updates all existing daily_scores. User ownership enforced on all metric operations.

## Previous Updates (Feb 15, 2026)
- ✅ **Back to Today Button**: Dashboard shows a "Back to Today" button when viewing a past date; section header displays selected date name
- ✅ **Goals Deduplication Fix**: ensureDailyGoals now checks per-template before creating; always creates daily goal when new template added; deleteGoalTemplate removes today/future daily goals
- ✅ **Calendar Data Dots**: Calendar dots now show for any input type (scores, journal entries, mood check-ins) via `/api/dates-with-data` endpoint

## Previous Updates (Feb 13, 2026)
- ✅ **Daily Goals System**: Goal templates with daily instances, one-tap toggle completion, inline editing, add/delete functionality
- ✅ **Goals Celebration Animation**: Confetti + party popper animation with haptic feedback when all daily goals complete (requires 3+ goals all completed)
- ✅ **Goals on Trends Page**: Goals completion percentage (0-100) trackable as a metric on the Trends page
- ✅ **Secure Goals API**: User ownership checks on all goal template update/delete and daily goal toggle operations
- ✅ **Default Goals**: "Make my bed" as the only default goal; GoalsSection shows 2 blank placeholder slots for users to fill
- ✅ **Goals Counter**: Always shows minimum 0/3 counter; progress bar denominator uses max(3, totalGoals)
- ✅ **Goals Auto-Create**: New goal templates automatically create daily goal entries for today so they can be toggled immediately
- ✅ **Past Date Protection**: ensureDailyGoals only creates goals for today/future, not for past dates
- ✅ **Date-Aware Scores**: ScoreDashboard shows scores for selected calendar date; past dates show blank if no data saved
- ✅ **Retrospective Editing**: Users can input scores and journal entries for any past date by selecting it on the calendar
- ✅ **Journal Display**: Only shows entries for the selected date; saved entries split by timestamp and displayed newest-first
- ✅ **File Attachments**: Journal entries support file attachments (images, PDFs, docs) up to 10MB via Replit object storage with presigned URL upload flow
- ✅ **Mood Check-in System**: Slider-based mood check-in modal (0-100 scale) with time-of-day labels (morning/afternoon/evening), accessible from dashboard header Smile icon
- ✅ **Mood Deep-Linking**: ?mood=checkin URL parameter opens mood check-in modal automatically (for push notification deep links)
- ✅ **Mood on Trends Page**: Mood check-in data averaged daily and displayed as a virtual "Mood" metric on the Trends page
- ✅ **Three Daily Mood Notifications**: Push notifications at 8am, 1pm, and 9pm (user's local time) for mood check-ins
- ✅ **Notification Permission Helper**: Settings modal shows browser notification permission status with step-by-step instructions to unblock if denied
- ✅ **Mood Check-in Reminders Info**: Settings modal displays info about the three daily mood check-in times

## Previous Updates (Feb 12, 2026)
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
