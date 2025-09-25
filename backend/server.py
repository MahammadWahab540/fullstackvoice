import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from livekit import api

# Load environment variables from the project's .env file
load_dotenv()

# Securely retrieve LiveKit credentials from environment variables
livekit_url = os.getenv('LIVEKIT_URL')
livekit_api_key = os.getenv('LIVEKIT_API_KEY')
livekit_api_secret = os.getenv('LIVEKIT_API_SECRET')

# Initialize the FastAPI application
app = FastAPI()

# --- CORS Middleware Configuration ---
# Configured for Replit environment
origins = [
    "http://localhost:3000",  # Local development
    "http://localhost:5000",  # Replit frontend port
    "https://ad14fee7-e6bd-4157-a28d-1b72b6619c74-00-nufa4jcmu1c6.pike.replit.dev",  # Replit frontend domain
    "https://8000-ad14fee7-e6bd-4157-a28d-1b72b6619c74-00-nufa4jcmu1c6.pike.replit.dev",  # Replit backend domain
    "*"  # Allow all for development
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# --- End of CORS Configuration ---


@app.get("/")
async def root():
    """
    Root endpoint - redirect to frontend
    """
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="http://localhost:5000")

@app.get("/get-token")
async def get_token(room_name: str, identity: str):
    """
    This endpoint generates a secure LiveKit access token.
    """
    token = api.AccessToken(livekit_api_key, livekit_api_secret) \
        .with_identity(identity) \
        .with_name(identity) \
        .with_grants(api.VideoGrants(
            room_join=True,
            room=room_name,
        )).to_jwt()

    return {"token": token, "livekit_url": livekit_url}
