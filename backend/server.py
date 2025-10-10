import os
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from livekit import api

# Load environment variables from the backend's .env file, regardless of CWD
dotenv_path = Path(__file__).resolve().parent / ".env"
if dotenv_path.exists():
    load_dotenv(dotenv_path=dotenv_path, override=False)
else:
    load_dotenv()

# Securely retrieve LiveKit credentials from environment variables
livekit_url = os.getenv('LIVEKIT_URL')
livekit_api_key = os.getenv('LIVEKIT_API_KEY')
livekit_api_secret = os.getenv('LIVEKIT_API_SECRET')

# Initialize the FastAPI application
app = FastAPI()

# --- CORS Middleware Configuration ---
default_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5000",
]

# Optional comma-separated extra origins can be supplied via ALLOWED_ORIGINS
extra_origins = os.getenv("ALLOWED_ORIGINS", "")
parsed_extra = [origin.strip() for origin in extra_origins.split(",") if origin.strip()]

origins: list[str] = []
for origin in (*default_origins, *parsed_extra):
    if origin not in origins:
        origins.append(origin)

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
    if not livekit_api_key or not livekit_api_secret:
        raise HTTPException(
            status_code=500,
            detail="LiveKit credentials are not configured on the server.",
        )

    token = api.AccessToken(livekit_api_key, livekit_api_secret) \
        .with_identity(identity) \
        .with_name(identity) \
        .with_grants(api.VideoGrants(
            room_join=True,
            room=room_name,
        )).to_jwt()

    return {"token": token, "livekit_url": livekit_url}
