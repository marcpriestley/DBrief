# DBrief - Daily Journaling App

## Project Overview
A comprehensive daily journaling app with voice recording, customizable metric tracking, and AI-powered insights. Built with React, TypeScript, Express, and PostgreSQL/in-memory storage.

## User Preferences
- Score circles must always remain at the top of the main dashboard
- Scores should persist until the next day, then reset to blank for new inputs
- Integration with Oura Ring API for automated health data (Sleep Quality, Readiness, Steps)
- Trend graphs should pop up when tapping metric circles
- Journal entries and scores should display in a dialog when holding calendar dates
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
- **2025-11-14**: Enhanced journal entry with timestamps and appending functionality:
  - Changed calendar long-press duration from 500ms to 3 seconds for better UX
  - Journal entries now append with timestamps for today's date
  - Each new text or voice input adds a timestamped paragraph
  - First entry of the day gets an initial timestamp
  - Timestamps format: [HH:MM AM/PM]
  - Added debug logging to Oura sync for troubleshooting
- **2025-11-14**: Added interactive trend graphs and calendar long-press features:
  - Removed Sleep Hours metric (only Sleep Quality, Readiness, Steps remain)
  - Changed Steps metric scale from 0-100 to 0-50000 to accurately reflect step counts
  - Implemented trend graph dialog that opens when tapping metric circles:
    - Shows 14-day line chart with historical data
    - Displays current value, 7-day average, and comparison stats
    - Includes "Edit Score" button to update values
    - After saving, returns to updated trend view
  - Added long-press functionality to calendar dates:
    - Hold any calendar date for 3 seconds to view details
    - Dialog shows journal entry and all daily scores for that date
    - Score circles display with proper scaling and auto-sync indicators
    - Implemented using ref-based timer management for stability
- **2025-11-14**: Fully integrated Oura Ring API for automatic health metric syncing:
  - Created Oura API service module (server/oura.ts) with support for multiple endpoints
  - Added POST /api/oura/sync/:date endpoint for fetching and storing Oura data
  - Implemented automatic sync on dashboard load for today's date
  - Added manual "Sync Oura" button with loading state and toast notifications
  - Syncs three key health metrics: Sleep Quality, Readiness, Steps
  - Auto-synced scores display "Auto-synced" badge instead of trend comparison
  - Changed "Recovery" metric to "Readiness" to match Oura terminology
  - Updated all metrics to support different scales (0-10 and 0-50000)
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
  - Steps (0-50000 scale)
- ✅ Manual and automatic health data synchronization
- ✅ Multi-scale metric support (0-10 for wellness, 0-50000 for steps, 0-100 for health tracking)
- ✅ Interactive trend graph dialogs:
  - Tap metric circles to view 14-day trend charts
  - Edit scores directly from trend view
  - See current value, 7-day average, and trend direction
- ✅ Calendar long-press feature:
  - Hold calendar dates to view journal entry and daily scores in a dialog
  - Timer-based detection with 3 second delay
  - Displays all metrics with score circles and auto-sync indicators

## Technical Implementation Notes
- **Oura API**: Uses v2 endpoints (daily_sleep, daily_readiness, daily_activity) - removed /sleep endpoint
  - Note: Activity data (Steps) may not be available immediately and processes later in the day
  - Debug logging added to track API responses
- **Auto-sync**: Triggers once per day on dashboard load for today's date
- **Concurrency**: Prevents multiple simultaneous sync operations
- **Error Handling**: Gracefully handles missing Oura data with informative error messages
- **Metric History**: GET /api/metric-history/:metricName?days=14 endpoint for trend graphs
- **Long-Press**: Ref-based timer management with per-date timeout tracking to avoid memory leaks (3 second delay)
- **Trend Dialog**: Two-mode dialog (trend/edit) with proper state management and query invalidation
- **Journal Timestamps**: Automatic timestamping for all new entries, appending behavior for today's entries only

## Next Steps
- Monitor Oura API rate limits and optimize sync frequency
- Add historical data backfill option for past dates
- Consider adding more Oura metrics (HRV, body temperature, etc.)
- Add visual feedback during long-press (progress indicator)
- Implement keyboard shortcuts for accessibility