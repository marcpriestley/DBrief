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
- **Voice Features**: The Web Speech API provides speech-to-text for voice input via `useInlineVoice` (defined in DebriefPanel). A `useTTS` hook enables text-to-speech for AI responses. **Voice Notes** use `useVoiceNoteRecorder` (MediaRecorder API) to record continuous raw audio for up to 5 minutes with no silence cutoffs, then transcribe via OpenAI Whisper (`POST /api/voice-note/transcribe`). Falls back to the STT restart loop on unsupported devices.
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
- **Driver Callsign (Unique Handle)**: Each user picks a unique @handle during onboarding (auto-suggested from their first name). Live availability check with 450ms debounce. Handle is stored in `driver_handle` column (unique constraint). Used for Crew search — search is callsign-only (not email-based). Connection requests sent by handle. Handle changeable in Settings (Profile section) with same live availability check. Existing users can add a callsign via Settings if they didn't set one during onboarding.
- **App Splash Screen**: HTML-level splash screen in `index.html` renders instantly (before JS loads) with dark background + amber "D" logo. Dismissed with fade-out once React auth check resolves. Eliminates the white-flash/loading-screen startup experience.
- **iOS Safe Area / White Band Fix**: White bands at top and bottom of screen on iOS are eliminated by setting dark backgrounds in the native iOS project (not fixable from the web layer alone). `AppDelegate.swift` sets `window?.backgroundColor` to `#141414`. `ViewController.swift` `viewDidLoad` sets `view.backgroundColor`, `webView?.backgroundColor`, `webView?.scrollView.backgroundColor` all to `#141414` and `webView?.isOpaque = false`. The Capacitor config also has `Keyboard: { resize: 'none' }` to prevent WKWebView frame resizing on keyboard events.
- **Team (Accountability Pairs + Leaderboard + Challenges)**: Users can connect with trusted people via username search. Accepted connections see each other's streak, 7-day consistency %, points, and last logged date. Journal, goal content, debriefs stay private. Connection requests trigger push notifications. Found at `/squad` via the "Team" nav tab. Challenge creator can edit title, extend end date, and invite more crew via the edit (pencil) button on a challenge card. The "Board" tab shows a ranked leaderboard of yourself + all accepted connections, sortable by streak, 7-day consistency, or points. Rank badges for top 3 (crown, silver, bronze). Points system: 10 pts per active streak day; +50 per milestone hit (3/7/14/30/50/100/365); +10 per day logged in last 30; +5 per habit completed / +20 bonus for full day; +5 per goal completed / +20 bonus for full day. The "Challenges" tab supports: (1) Habit challenges — everyone commits to the same habit, each person sets their own personal target (e.g. "100 pushups" vs "20 pushups"), marked done when they hit their commitment; (2) Score challenges — everyone tracks the same metric, scores are hidden until ALL participants submit for that day so no one can chase a known target. Creator can set invite-only or open to all connections. Challenges support frequency: Daily, Every Other Day, or Weekly. Score challenges auto-install the metric in the joiner's daily scores panel on accept. Tables: challenges (with frequency column), challenge_participants (with commitment column), challenge_logs.
- **Points Banner**: Shows "This week" (last-7-day activity points) alongside "Lifetime" total at the top of the dashboard (below InfiniteGoalBanner). Animates the counter and triggers a burst animation + haptic whenever points increase. Weekly = habits + goals + consistency for the last 7 days (excludes streak/milestone). `/api/me/points` returns `{ points, weeklyPoints }`.
- **Nav**: Fixed bottom nav bar (Instagram-style) with icon-only tabs for all 4 pages (Home, History, Trends, Team); active tab shows icon + short label beneath. `padding-bottom: env(safe-area-inset-bottom)` fills the home-indicator zone so there is no empty band at the bottom edge. Swipe left/right anywhere in the main content area to navigate between pages (60px threshold, horizontal-dominant only).
- **Activity Points analytics**: `/api/me/daily-points?days=N` returns per-day habit+goal+consistency points. A bar chart card titled "Activity Points" appears in the Trends page above Mood Patterns.
- **Habit all-done celebration**: When the last remaining habit for the day is completed, a toast slides up ("All habits locked in!") with haptic feedback, distinct from the milestone overlay.

## Monetization (Stripe)
- **Stripe integration** connected via Replit. Packages: `stripe@20`, `stripe-replit-sync@1`.
- **Product**: "DBrief Premium" — £5.99/month (introductory), created via `scripts/seed-products.ts`.
- **Free tier**: Debriefs (text), up to 3 daily score metrics, goals, habits, mood, history, trends (basic), streaks, journal.
- **Premium tier** (`subscriptionStatus = 'premium'`): Unlimited metric tracking, Voice Notes in Debriefs, Team section (Squad/Leaderboard/Challenges), Weekly Race Report, Data Pattern Analysis, Mission Intelligence.
- **Beta tier** (`subscriptionStatus = 'beta'`): Full premium access without payment — granted manually via `POST /api/admin/grant-beta` with `{ username, grant: true, adminCode }`. Admin code stored in `ADMIN_CODE` env var (value: `dbrief-beta-2025`).
- **Webhook**: `POST /api/stripe/webhook` — registered BEFORE `express.json()` in `server/index.ts`. Handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` to update `users.subscriptionStatus`.
- **Schema columns added**: `stripe_customer_id`, `subscription_status` (default 'free'), `subscription_current_period_end` on `users` table.
- **Frontend gate**: `useSubscription` hook reads `isPremium` from `/api/auth/me`. `PaywallContext` provides `openPaywall(featureName?)` to any component. `PaywallModal` slides up from bottom with amber F1 design, feature list, and Stripe Checkout link. Team nav tab shows paywall instead of navigating when not premium.
- **Checkout flow (native iOS)**: `POST /api/subscription/checkout { native: true }` → creates Stripe Checkout Session tied to the user's `stripeCustomerId` → returns URL → `Browser.open(url)` from `@capacitor/browser` opens SFSafariViewController in-app (WKWebView stays alive, no white safe-area bands) → Apple Pay supported → on user tapping "Done" `browserFinished` event fires → sync + `invalidateQueries` + toast if premium. Session URL expires in 24h — fetched fresh each time the PaywallModal opens.
- **Checkout flow (web)**: `POST /api/subscription/checkout {}` → session URL → `window.location.href = url` → hosted Stripe page → `?subscription=success` redirect back.
- **Customer portal**: `POST /api/subscription/portal` → returns Stripe billing portal URL for subscription management.
- **Stripe init**: Non-blocking at server startup: `runMigrations` → `getStripeSync` → `findOrCreateManagedWebhook` → `syncBackfill`.
- **Seed script**: `npx tsx scripts/seed-products.ts` — idempotent, creates DBrief Premium product + £5.99/month price.

## External Dependencies
- **PostgreSQL**: Primary database.
- **Apple Health (HealthKit)**: For syncing health metrics on iOS devices via Capacitor.
- **OpenAI API**: Powers all AI-driven features.
- **Web Push API**: For browser-based push notifications.
- **express-session**: For server-side session management and authentication.
- **react-icons**: Icon library for UI elements.
- **framer-motion**: For animations and UI transitions.