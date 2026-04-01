# DBrief - Daily Performance Engineering App

## Overview
DBrief is a personal performance engineering app built around the F1 debrief framework. It helps users extract maximum performance from their daily lives through AI-driven conversational debriefs (like a race engineer reviewing telemetry with their driver), customizable wellness metric tracking (0-100 scale), and data-driven pattern analysis. The app frames daily self-improvement as a high-performance pursuit — not therapy, but a structured approach to performing better every day.

## Core Concepts
- **Infinite Goal**: An overarching aspirational target that can never be fully achieved but always drives forward (like an F1 team's pursuit of perfection). Displayed at the top of the dashboard. AI assists users in articulating it. Weekly alignment check during debriefs.
- **Long-Term Targets**: Up to 3 bigger objectives the user is working toward. Sits between daily goals and the infinite goal. Each has a progress slider (0–100%), a tick-to-complete button, completion celebration overlay, and a 7-day review nudge when stale.
- **Daily Goals**: Recurring daily actions that compound over time.
- **Performance Telemetry**: 0-100 metric scores tracked daily.
- **Daily Debrief**: AI-guided conversational review of the day's "session" — framed as a post-race debrief.
- **AI Insights Access**: Two-phase gate. Phase 1 (initial unlock): requires a 7-day consecutive streak — stored permanently in `longestStreak`. Phase 2 (ongoing access): requires ≥5 of the last 7 days with data (`recentActiveDays`), allowing 1 missed day without losing access. Missing 3+ days pauses insights; logging any day restores them automatically without needing to rebuild the 7-day streak. Three UI states: Locked / Standby (amber) / Active.

## User Preferences
- Infinite goal banner always at the very top of the dashboard
- Score circles sit below the infinite goal
- Daily goals section, then long-term targets, then debrief panel, calendar at the bottom
- All scores use a unified 0-100 scale (compatible with Apple Health)
- Score input uses a slider (0-100) — dialog closes immediately after saving, no confirmation steps
- Apple Health metric sync is customizable per-metric in Settings — 18 real HealthKit metric types across Activity, Sleep, Heart, Body, Mindfulness, Respiratory, and Nutrition categories
- Apple Health auto-sync requires a native iOS app build — currently all metrics are manually tracked; selecting a metric in Settings adds it as a dashboard circle
- Scores should persist until the next day, then reset to blank for new inputs
- Manual metrics remain blank until first input - start blank each day
- Once inputted, all scores persist and display for that date
- Trend graphs should pop up when tapping metric circles
- Journal entries and scores should display in a dialog when holding calendar dates (2 seconds)
- No highlight box during calendar long-press
- Journal entries must persist in textarea after saving
- Duolingo-style streak tracking with milestones (3, 7, 14, 30, 50, 100, 365 days), animations, and motivational messages
- Analytics/trends show only user-input data (auto-synced scores excluded)
- Trends page supports 7 day, 30 day, 6 month, and lifetime timelines
- Two daily reminders (morning at 9 AM, evening at 9 PM by default) - both customizable in settings
- Notifications enabled by default - can be turned off in settings modal
- Data encryption at rest - journal entries, debrief messages, summaries, infinite goal, and long-term goals encrypted with AES-256-GCM
- Language throughout the app uses F1/high-performance framing, not therapy/wellness speak

## System Architecture
**Frontend**: React with TypeScript, Wouter for routing, and TanStack Query for data fetching, utilizing Shadcn/ui components and Tailwind CSS for styling.
**Backend**: Express server with Drizzle ORM and express-session for authentication.
**Authentication**: Session-based email/password authentication. Google Sign-In implemented via Google Identity Services SDK (requires `GOOGLE_CLIENT_ID` + `VITE_GOOGLE_CLIENT_ID` env vars). Apple Sign-In available in the native iOS app only.
**Database**: PostgreSQL for persistent storage, managed by Drizzle ORM.
**AI Integration**: OpenAI API powers conversational debriefs, journal insights, pattern analysis, infinite goal refinement, and habit suggestions. Voice recording uses Web Speech API for speech-to-text.
**Health Tracking**: Apple Health (HealthKit) via `capacitor-health` plugin. Supports 15 metrics: Steps, Active Energy, Exercise Minutes, Flights Climbed, Walking Distance, Sleep Duration, Sleep Quality, Heart Rate, Resting Heart Rate, HRV, Blood Oxygen, Body Weight, Body Fat %, Mindful Minutes, Respiratory Rate. Auto-syncs today + yesterday on launch (native iOS, if authorized). "Connect Apple Health" button in Settings requests permissions. Xcode requires: HealthKit capability, NSHealthShareUsageDescription + NSHealthUpdateUsageDescription in Info.plist, then `npx cap sync ios`.
**Notifications**: Dual-path notification system — Web Push API (VAPID/service worker) for browser users; Apple Push Notifications (APNs via `node-apn`) for native iOS. Uses `@capacitor/push-notifications` for device token registration. Requires `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_AUTH_KEY` env secrets + Push Notifications entitlement in Xcode. Speech recognition uses `@capacitor-community/speech-recognition` natively.
**Key Features**:
- AI Debrief: F1-style performance debrief with 3 core exchanges, then opt-in to continue deeper. Performance engineer persona reviews "telemetry" (scores, goals, mood). Weekly infinite goal alignment check on Sundays. Voice + text input. Auto-summarization.
- Infinite Goal: AI-assisted articulation of an overarching never-completable aspiration. Always displayed at dashboard top. Weekly debrief alignment check. Prompt to set one if unset.
- Long-Term Targets: Up to 3 medium-term objectives between daily goals and the infinite goal. Encrypted at rest.
- Customizable Metric Tracking: Interactive 0-100 score circles with simplified input flow.
- Streak Tracking: Duolingo-style system with milestone celebrations and motivational messages.
- Trends & Analytics: Dedicated page with various timeline options and AI-driven insights, focusing on user-input data.
- Daily Goals System: Goal templates with daily instances, one-tap completion, and tracking on the Trends page.
- Onboarding: 5-step flow (welcome, performance toolkit, privacy/encryption, driver profile, debrief timing preference) with F1 high-performance language.
- Driver Profile: 7 multiple-choice questions (`client/src/lib/profileData.ts`) stored in `users.userProfile` jsonb. Step 4 of onboarding (skippable). Editable in Settings modal. `GET /api/user/profile`, `PUT /api/user/profile`. `buildSystemPrompt` receives `userProfile` and `displayName` for personalised AI debrief tone.
- Driver Name: Collected on the onboarding welcome step. Stored in `users.display_name`. Passed to `buildSystemPrompt` — AI uses it naturally in conversation. Editable via Settings modal ("Driver Name" field).
- Voice Readback (TTS): `useTTS` hook in DebriefPanel wraps `window.speechSynthesis`. Speaker icon toggle in debrief chat header — amber when on. AI responses spoken aloud after streaming completes. Preference persisted in localStorage (`dbrief_tts_enabled`). Defaults to enabled. AI Insights card also has a manual play/stop TTS button.
- App Tour: 6-step first-run tutorial (`client/src/components/AppTour.tsx`) shows 1.2s after first login. Covers Infinite Goal, telemetry circles, debrief, goals, analytics. Persisted via localStorage (`dbrief_tour_v1_complete`). "Replay app tour" button in Settings dispatches `dbrief:replay-tour` custom event. Tour utility in `client/src/lib/tour.ts`.
- Push Notifications (Web): Service worker at `client/public/sw.js` handles push events and notification clicks. `client/public/icon-192.png` used as notification icon. Web push subscription via `navigator.serviceWorker.register('/sw.js')` in SettingsModal.
- Retrospective Editing: Users can input scores and journal entries for past dates.
- Mood Check-in: Slider-based modal with time-of-day labels, integrated into trends.
- Data Encryption: AES-256-GCM encryption for sensitive user data at rest.
- Haptics: `client/src/lib/haptics.ts` — light/medium/heavy/select/success/error vibration patterns via `navigator.vibrate`. Used on mic, send, tabs, toggle, goals.
- Smart Default View: Morning journalers see Yesterday by default if opening before 12pm; evening journalers always see Today.
- Color Theme: Grey + yellow (`hsl(40, 95%, 48%)` amber primary on clean grey backgrounds). Updated across all components.

## Database Tables
- `users` - Auth, settings, onboarding status, journal preference
- `journal_entries` - Daily journal content (encrypted)
- `daily_scores` - Performance metric scores per day
- `user_metrics` - User-configured metrics to track
- `streaks` - Streak tracking data
- `ai_insights` - AI-generated pattern analysis
- `goal_templates` - Recurring daily goal definitions
- `daily_goals` - Daily goal instances
- `infinite_goals` - User's infinite goal (encrypted, one per user)
- `long_term_goals` - Up to 3 long-term targets per user (encrypted)
- `debriefs` / `debrief_messages` - AI debrief conversations (encrypted)
- `mood_checkins` - Mood check-in data
- `push_subscriptions` - Web push notification subscriptions + APNs device tokens (`apns_token` column)
- `journal_attachments` - File attachments for journal entries

## External Dependencies
- **PostgreSQL**: Primary database for all persistent data.
- **Apple Health (HealthKit)**: For syncing health metrics (Sleep Quality, Readiness, Activity) via Capacitor.
- **OpenAI API**: Core for AI-powered features (debriefs, insights, analysis, infinite goal refinement).
- **Web Push API**: For browser push notifications and reminders (requires VAPID keys).
- **express-session**: Middleware for session-based user authentication.
- **react-icons**: Used for UI icons, including social sign-in buttons.
- **framer-motion**: Animations for onboarding, goal celebrations, and UI transitions.
