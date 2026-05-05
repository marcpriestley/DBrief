# DBrief - Daily Performance Engineering App

## Overview
DBrief is a personal performance engineering app designed to enhance daily performance using an F1 debrief framework. It offers AI-driven conversational debriefs, customizable wellness metric tracking, and data-driven pattern analysis. The app aims to transform daily self-improvement into a high-performance pursuit, guiding users toward an "Infinite Goal" supported by "Long-Term Targets" and "Daily Goals" through "Performance Telemetry" and "Daily Debriefs" to unlock "AI Insights."

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
- **Authentication**: Supports session-based email/password authentication and Google Sign-In via Google Identity Services SDK.
- **AI Integration**: Centralized use of OpenAI API for conversational debriefs, journal insights, pattern analysis, goal refinement, and habit suggestions, featuring an AI Performance Engineer persona.
- **Voice Features**: Utilizes Web Speech API for speech-to-text (`useInlineVoice`) and text-to-speech (`useTTS`). Voice Notes record continuous audio via MediaRecorder API and transcribe using OpenAI Whisper.
- **Health Tracking**: Integration with Apple Health (HealthKit) for 15 metrics, with auto-sync capabilities for native iOS builds.
- **Notification System**: Dual-path system using Web Push API for browsers and Apple Push Notifications (APNs) for native iOS.
- **Data Security**: Sensitive user data is encrypted at rest using AES-256-GCM.
- **User Onboarding & Profile**: A 5-step F1-themed onboarding process and a "Driver Profile" for personalized AI interactions.
- **Goal Systems**: "Infinite Goal," up to three "Long-Term Targets," and "Daily Goals."
- **Habit Lab**: Supports habit formation with streak tracking, milestones, habit stacking, and AI guidance.
- **Performance Telemetry**: Daily metric tracking on a 0-100 scale.
- **Streak Tracking**: Duolingo-style system with milestone celebrations and Streak Saves (streak freezes). Freezes auto-consume when exactly one day is missed. Earned at 7-day intervals, 30/90/365-day bonuses, and every 500 activity-point threshold. Max 5 saves. Tracked in `streak_freeze_events` table. Streak pill in header taps to open Streak Saves popover (freeze pill removed from header).
- **Three-tier AI intelligence**: Includes Weekly Race Report (7-day debrief), Data Pattern Analysis (30-day correlations), and Mission Intelligence (90-day goal alignment).
- **Retrospective Editing**: Allows input of scores and journal entries for past dates.
- **Mood Check-in**: Slider-based daily mood tracking.
- **Color Theme**: Neutral cool-grey light mode (hsl 220°, 90% lightness base) with dark mode unchanged. All panels use the same unified grey surface — no contrast difference between page bg and cards. Amber accent (#F59E0B) unchanged.
- **Team Functionality**: Users can connect with others via unique "Driver Callsigns" for accountability. Features shared streak, consistency, points, leaderboards, and challenges (habit and score-based).
- **Activity Points**: A system rewarding daily engagement, habit completion, and goal achievement, displayed on a dashboard banner and in Trends.
- **Navigation**: Fixed bottom navigation bar with swipe gestures for page transitions, optimized for iOS safe areas.
- **Monetization (Corporate Tier)**: A feature-flagged corporate tier with organizations, seat management, custom branding, and administrative dashboards, integrated with Stripe for subscriptions.
- **Monetization (Premium Tier)**: "DBrief Premium" offers unlimited metric tracking, Voice Notes, Team features, and advanced AI insights. Managed via Stripe subscriptions with a free tier offering basic features.

## External Dependencies
- **PostgreSQL**: Primary database.
- **Apple Health (HealthKit)**: For syncing health metrics on iOS devices.
- **OpenAI API**: Powers all AI-driven features.
- **Stripe**: For subscription management and payment processing (both Premium and Corporate tiers).
- **Web Push API**: For browser-based push notifications.
- **express-session**: For server-side session management and authentication.
- **react-icons**: Icon library.
- **framer-motion**: For animations.
- **Google Identity Services SDK**: For Google Sign-In.
- **@capacitor/push-notifications**: For native iOS push notifications.
- **@capacitor/browser**: For in-app browser functionality on native iOS.