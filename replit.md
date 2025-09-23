# LiveKit Voice Agent Application

## Overview
This is a full-stack LiveKit-based AI voice agent application that provides Telugu language support through Google's Gemini AI. The application consists of a FastAPI backend server and a Next.js frontend for real-time voice communication.

## Project Structure
```
├── backend/
│   ├── server.py          # FastAPI server with LiveKit token generation
│   ├── agent_telugu.py    # LiveKit agent for Telugu voice interactions
│   ├── requirements.txt   # Python dependencies
│   └── data/             # Documents for RAG pipeline
├── frontend/
│   ├── src/              # Next.js application source
│   ├── package.json      # Node.js dependencies
│   ├── next.config.ts    # Next.js configuration (configured for Replit)
│   └── simple.html       # Temporary status page
```

## Current Status
✅ **Backend**: Running on port 8000 with FastAPI and LiveKit integration  
✅ **Frontend**: Configured for Replit environment with temporary server on port 5000  
✅ **Deployment**: Configured for production deployment  
🔄 **Dependencies**: Core dependencies installed, full frontend build pending  
🔄 **Environment**: Needs LiveKit and Google API credentials  

## Technology Stack
- **Backend**: Python, FastAPI, uvicorn, LiveKit, LlamaIndex
- **Frontend**: Next.js, React, TypeScript, LiveKit Client
- **AI/Voice**: LiveKit Agents, Google GenAI, Google Cloud Speech/TTS
- **Language**: Telugu language support with AI conversation capabilities

## Environment Setup Required
The following environment variables need to be configured:
- `LIVEKIT_URL`: LiveKit server URL
- `LIVEKIT_API_KEY`: LiveKit API key  
- `LIVEKIT_API_SECRET`: LiveKit API secret
- `GOOGLE_API_KEY`: Google GenAI API key for Gemini

## Development Workflows
- **Backend**: `cd backend && uvicorn server:app --reload --host localhost --port 8000`
- **Frontend**: Currently serving via Python HTTP server on port 5000

## Recent Changes (Sept 23, 2025)
- Configured Next.js for Replit environment with `allowedHosts: true`
- Updated backend CORS to work with Replit domain
- Set up development workflows for both frontend and backend
- Installed core Python dependencies (FastAPI, uvicorn, LiveKit, etc.)
- Configured deployment settings for production

## Notes
- The application is designed for voice-based AI interactions in Telugu
- Uses RAG (Retrieval Augmented Generation) with documents in backend/data/
- Frontend dependency installation may need optimization in Replit environment
- LiveKit environment variables are required for token generation functionality