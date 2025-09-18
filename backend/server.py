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
# This is the section that fixes the connection error
origins = [
    "http://localhost:3000",  # The address of your frontend
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# --- End of CORS Configuration ---


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

    return {"token": token}