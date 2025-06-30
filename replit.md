# DBrief - Daily Journaling App

## Project Overview
A comprehensive daily journaling app with voice recording, customizable metric tracking, and AI-powered insights. Built with React, TypeScript, Express, and PostgreSQL/in-memory storage.

## User Preferences
- Score circles must always remain at the top of the main dashboard
- Scores should persist until the next day, then reset to blank for new inputs
- Integration with health tracker APIs for automated data (steps, sleep, recovery)
- Scores must be logged in calendar and displayed when dates are clicked alongside journal entries
- Duolingo-style streak tracking for user engagement

## Project Architecture
- **Frontend**: React with TypeScript, Wouter for routing, TanStack Query for data fetching
- **Backend**: Express server with Drizzle ORM
- **Storage**: In-memory storage (MemStorage) with fallback from PostgreSQL due to database connection issues
- **UI**: Shadcn/ui components with Tailwind CSS
- **Voice**: Web Speech API for voice-to-text transcription
- **AI**: OpenAI integration for journal insights and pattern analysis

## Recent Changes
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
- ✅ Basic health metrics (Steps)

## Next Steps
- Enhance sleep tracking metrics
- Improve health tracker API integration
- Ensure complete score persistence across date changes
- Fix any remaining TypeScript errors