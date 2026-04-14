# DBrief - Daily Performance Engineering App

## Overview
DBrief is a personal performance engineering app built around the F1 debrief framework. It helps users extract maximum performance from their daily lives through AI-driven conversational debriefs, customizable wellness metric tracking, and data-driven pattern analysis. The app frames daily self-improvement as a high-performance pursuit, offering a structured approach to performing better every day. It aims to empower users to achieve an "Infinite Goal" supported by "Long-Term Targets" and "Daily Goals," all while tracking "Performance Telemetry" and engaging in "Daily Debriefs" to unlock "AI Insights."

## User Preferences
- Infinite goal banner always at the very top of the dashboard
- Dashboard order: InfiniteGoalBanner → DebriefPanel → GoalsSection → HabitsSection → LongTermGoals → ScoreDashboard → WeeklyRaceReport → DataPatternAnalysis → MissionIntelligence
- Attention rings: pulsing amber dot + glow ring shown on sections that need input (today only) — debrief (no session yet), goals (some incomplete), habits (some undone), scores (nothing logged)
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
The application uses a **React with TypeScript** frontend, styled with **Shadcn/ui components and Tailwind CSS**, and **Wouter** for routing. Data fetching is managed by **TanStack Query**. The backend is an **Express server** utilizing **Drizzle ORM** for PostgreSQL interaction and `express-session` for authentication.

**Key Architectural Decisions & Features:**
- **Authentication**: Session-based email/password authentication is supported, along with Google Sign-In via the Google Identity Services SDK.
- **AI Integration**: OpenAI API is central to conversational debriefs, journal insights, pattern analysis, infinite goal refinement, and habit suggestions. It also powers an AI Debrief feature with a performance engineer persona.
- **Voice Features**: The Web Speech API provides speech-to-text for voice input. A `useTTS` hook enables text-to-speech for AI responses. Live Voice Mode uses the OpenAI Realtime API for real-time voice conversations with server-side VAD for turn detection.
- **Health Tracking**: Integration with Apple Health (HealthKit) via `capacitor-health` plugin allows tracking of 15 metrics, with auto-sync capabilities for native iOS builds.
- **Notification System**: A dual-path system uses Web Push API for browsers and Apple Push Notifications (APNs) for native iOS, managed by `@capacitor/push-notifications`.
- **Data Management**: Sensitive user data, including journal entries, debrief messages, and goals, is encrypted at rest using AES-256-GCM.
- **User Onboarding & Profile**: A 5-step onboarding process introduces users to the app with F1-themed language. A "Driver Profile" captures user details for personalized AI interactions.
- **Goal Systems**: Includes "Infinite Goal" (an aspirational target), "Long-Term Targets" (up to 3 medium-term objectives), and "Daily Goals" (recurring daily actions).
- **Habit Lab**: A dedicated feature for habit formation with streak tracking, milestone progress, habit stacking, and AI-guided setup.
- **Performance Telemetry**: Users track daily metric scores on a 0-100 scale.
- **Streak Tracking**: A Duolingo-style system with milestone celebrations and motivational messages.
- **Three-tier AI intelligence**: Weekly Race Report (7-day narrative debrief), Data Pattern Analysis (30-day score-to-score correlations), Mission Intelligence (90-day goal trajectory alignment against Infinite Goal and Long-Term Targets). Each gated by streak/data requirements.
- **Retrospective Editing**: Users can input scores and journal entries for past dates.
- **Mood Check-in**: Slider-based modal for daily mood tracking.
- **Color Theme**: Uses a grey and yellow (amber primary) color scheme with dark mode support.
- **Weekly Race Report**: AI-generated summary of the past week, available on-demand or automatically.
- **Performance Patterns**: AI analyzes 30 days of user data to identify correlations and insights.
- **Haptics**: Implemented for tactile feedback on various UI interactions.
- **Squad (Accountability Pairs + Leaderboard)**: Users can connect with trusted people via username search. Accepted connections see each other's streak, 7-day consistency %, today's avg score, 30-day avg, and last logged date. Journal, goal content, debriefs stay private. Connection requests trigger push notifications. Found at `/squad` via the nav tab. The "Board" tab shows a ranked leaderboard of yourself + all accepted connections, sortable by streak, 7-day consistency, or score. Ties broken by secondary metric. Rank badges for top 3 (crown, silver, bronze).

## External Dependencies
- **PostgreSQL**: Primary database.
- **Apple Health (HealthKit)**: For syncing health metrics on iOS devices via Capacitor.
- **OpenAI API**: Powers all AI-driven features.
- **Web Push API**: For browser-based push notifications.
- **express-session**: For server-side session management and authentication.
- **react-icons**: Icon library for UI elements.
- **framer-motion**: For animations and UI transitions.