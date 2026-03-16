# DBrief - Daily Journaling App

## Overview
DBrief is a daily journaling application designed to enhance self-reflection and well-being. It features AI-driven conversational debriefs, customizable wellness metric tracking (0-100 scale), and data-driven insights. The app guides users through a daily reflection process with personalized AI prompts, integrating with health devices for automated data collection and providing trend visualizations. Its core purpose is to provide a thoughtful, direct, and data-informed journaling experience, helping users track progress, gain insights, and improve their daily habits.

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
- Two daily reminders (morning at 9 AM, evening at 9 PM by default) - both customizable in settings
- Notifications enabled by default - can be turned off in settings modal
- Data encryption at rest - journal entries, debrief messages, and summaries encrypted with AES-256-GCM

## System Architecture
**Frontend**: React with TypeScript, Wouter for routing, and TanStack Query for data fetching, utilizing Shadcn/ui components and Tailwind CSS for styling.
**Backend**: Express server with Drizzle ORM and express-session for authentication.
**Authentication**: Session-based email/password authentication, with UI support for Google/Apple social sign-in.
**Database**: PostgreSQL for persistent storage, managed by Drizzle ORM.
**AI Integration**: OpenAI API powers conversational debriefs, journal insights, pattern analysis, and habit suggestions. Voice recording uses Web Speech API for speech-to-text.
**Health Tracking**: Apple Health (HealthKit via Capacitor) integration for automatic synchronization of Sleep Quality, Readiness, and Activity metrics, normalized to a 0-100 scale.
**Notifications**: Web Push API with service workers and VAPID keys for secure push notifications and cron-scheduled daily reminders.
**Key Features**:
- AI Debrief: Rosebud-style conversational reflection with 3 core prompts, then opt-in to continue deeper. Users choose "keep going" or "that's enough" at each checkpoint. Voice + text input. Streaming via SSE. Auto-summarization. User responses saved as journal entries.
- Customizable Metric Tracking: Interactive 0-100 score circles with simplified input flow.
- Streak Tracking: Duolingo-style system with milestone celebrations and motivational messages.
- Trends & Analytics: Dedicated page with various timeline options and AI-driven insights, focusing on user-input data.
- Daily Goals System: Goal templates with daily instances, one-tap completion, and tracking on the Trends page.
- Retrospective Editing: Users can input scores and journal entries for past dates.
- Mood Check-in: Slider-based modal with time-of-day labels, integrated into trends.
- Data Encryption: AES-256-GCM encryption for sensitive user data at rest.

## External Dependencies
- **PostgreSQL**: Primary database for all persistent data.
- **Apple Health (HealthKit)**: For syncing health metrics (Sleep Quality, Readiness, Activity) via Capacitor.
- **OpenAI API**: Core for AI-powered features (debriefs, insights, analysis).
- **Web Push API**: For browser push notifications and reminders (requires VAPID keys).
- **express-session**: Middleware for session-based user authentication.
- **react-icons**: Used for UI icons, including social sign-in buttons.