# DBrief - Daily Journaling App

## Project Overview
A comprehensive daily journaling app with voice recording, customizable metric tracking, and AI-powered insights. Built with React, TypeScript, Express, and PostgreSQL/in-memory storage.

## User Preferences
- Score circles must always remain at the top of the main dashboard
- Scores should persist until the next day, then reset to blank for new inputs
- Integration with Oura Ring API for automated health data (Sleep Quality, Readiness, Steps, Sleep Hours)
- Scores must be logged in calendar and displayed when dates are clicked alongside journal entries
- Duolingo-style streak tracking for user engagement

## Project Architecture
- **Frontend**: React with TypeScript, Wouter for routing, TanStack Query for data fetching
- **Backend**: Express server with Drizzle ORM
- **Storage**: In-memory storage (MemStorage) with fallback from PostgreSQL due to database connection issues
- **UI**: Shadcn/ui components with Tailwind CSS
- **Voice**: Web Speech API for voice-to-text transcription
- **AI**: OpenAI integration for journal insights and pattern analysis
- **Health Tracking**: Oura Ring API integration for automatic health metrics syncing

## Recent Changes
- **2025-11-14**: Fully integrated Oura Ring API for automatic health metric syncing:
  - Created Oura API service module (server/oura.ts) with support for multiple endpoints
  - Added POST /api/oura/sync/:date endpoint for fetching and storing Oura data
  - Implemented automatic sync on dashboard load for today's date
  - Added manual "Sync Oura" button with loading state and toast notifications
  - Syncs four key health metrics: Sleep Quality, Readiness, Steps, Sleep Hours
  - Auto-synced scores display "Auto-synced" badge instead of trend comparison
  - Changed "Recovery" metric to "Readiness" to match Oura terminology
  - Updated all metrics to support different scales (0-10 and 0-100)
- **2025-06-30**: Fixed score persistence logic - scores now remain blank until inputted, then persist until next day
- **2025-06-30**: Enhanced trends page with comprehensive analytics dashboard featuring:
  - Multiple chart types: Line, Area, Bar, and Heat Map visualizations
  - Extended time ranges: 1 Week to 1 Year analysis
  - Statistical insights: averages, trends, consistency metrics, and goal progress
  - Interactive metric selection and weekly/monthly comparisons
- **2025-06-30**: Improved calendar integration to display scores alongside journal entries
- **2025-06-30**: Enhanced health tracker integration with auto-sync indicators
- **2025-06-30**: Fixed score circle display to show blank state correctly before input

## Features Implemented
- ✅ Voice recording with speech-to-text transcription
- ✅ Calendar-based journal entry retrieval
- ✅ Customizable metric tracking with score circles
- ✅ AI-powered insights using OpenAI
- ✅ Trends visualization with interactive charts
- ✅ Streak tracking system
- ✅ Oura Ring API integration with automatic syncing:
  - Sleep Quality (0-100 scale)
  - Readiness (0-100 scale, formerly "Recovery")
  - Steps (0-100 scale)
  - Sleep Hours (0-100 scale)
- ✅ Manual and automatic health data synchronization
- ✅ Multi-scale metric support (0-10 for wellness, 0-100 for health tracking)

## Technical Implementation Notes
- **Oura API**: Uses v2 endpoints (daily_sleep, sleep, daily_readiness, daily_activity)
- **Sleep Hours**: Fetched from /sleep endpoint's total_sleep_duration field (converted from seconds to hours)
- **Auto-sync**: Triggers once per day on dashboard load for today's date
- **Concurrency**: Prevents multiple simultaneous sync operations
- **Error Handling**: Gracefully handles missing Oura data with informative error messages

## Next Steps
- Monitor Oura API rate limits and optimize sync frequency
- Add historical data backfill option for past dates
- Consider adding more Oura metrics (HRV, body temperature, etc.)