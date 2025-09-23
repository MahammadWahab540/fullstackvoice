import os
import asyncio
import json
from dotenv import load_dotenv

from livekit import agents
from livekit.agents import (
    AgentSession,
    Agent,
    JobContext,
    WorkerOptions,
    ChatContext,
    ChatMessage,
)
# This is the corrected import for the Google plugin
from livekit.plugins import google

# Note: LlamaIndex imports are here for when you add the RAG logic back.
from llama_index.core import VectorStoreIndex, SimpleDirectoryReader, Settings
from llama_index.llms.google_genai import GoogleGenAI
from llama_index.embeddings.google_genai import GoogleGenAIEmbedding

load_dotenv()

QUERY_ENGINE = None
AGENT_SPOKEN_NAME = "Harshitha"
AGENT_ROLE = "Registration Expert"
CALLING_FROM_COMPANY = "NxtWave"

def initialize_rag_pipeline_globally():
    # You can add your LlamaIndex logic here later to read from a data folder
    print("RAG pipeline placeholder initialized.")
    pass

class NxtWaveOnboardingAgent(agents.Agent):
    def __init__(self, query_engine, llm_instructions):
        super().__init__(instructions=llm_instructions)
        self.query_engine = query_engine
        self.current_stage = "introduction"

    async def on_user_turn_completed(self, turn_ctx: ChatContext, new_message: ChatMessage):
        print(f"User said: {new_message.text_content()}")
        # This makes the agent reply after the user speaks
        await turn_ctx.session.generate_reply()

    async def on_data_received(self, data: bytes, participant_identity: str):
        try:
            payload = json.loads(data.decode())
            if 'stage' in payload:
                new_stage = payload['stage']
                print(f"Received new stage from frontend: {new_stage}")
                self.current_stage = new_stage
                await self.update_agent_for_stage()
        except Exception as e:
            print(f"Error handling data message: {e}")

    async def update_agent_for_stage(self):
        stage_instructions = ""
        if self.current_stage == "introduction":
            stage_instructions = f"You are in the introduction stage. Greet the user, introduce yourself as {AGENT_SPOKEN_NAME} from {CALLING_FROM_COMPANY}, and build rapport."
        elif self.current_stage == "payment":
            stage_instructions = "You are now in the payment stage. Proactively explain the payment options (Full Payment vs. No-Cost EMI)."
        elif self.current_stage == "kyc":
            stage_instructions = "You are in the KYC stage. Proactively explain the documents needed for the loan process."

        # Use self.session here because this method is part of the class, not a direct callback
        await self.session.generate_reply(
            instructions=f"The conversation has moved to the {self.current_stage} stage. Proactively begin this part of the conversation in Telugu, following these instructions: {stage_instructions}"
        )

async def entrypoint(ctx: JobContext):
    llm_instructions = (
        f"You are '{AGENT_SPOKEN_NAME}', a NxtWave '{AGENT_ROLE}'. Speak only Telugu. Your goal: guide parents through onboarding. "
        f"You will receive stage updates. Follow them precisely to lead the conversation."
    )

    session = agents.AgentSession(
        llm=google.beta.realtime.RealtimeModel(
            model="gemini-2.5-flash-exp-native-audio-thinking-dialog",
            voice="Aoede",
            temperature=0.8,
            instructions=llm_instructions,
        ),
    )

    agent_instance = NxtWaveOnboardingAgent(query_engine=QUERY_ENGINE, llm_instructions=llm_instructions)

    # This line registers your function so it can receive messages from the frontend
    agent_instance.on_data_received = agent_instance.on_data_received

    await session.start(room=ctx.room, agent=agent_instance)
    await ctx.connect()
    print(f"{AGENT_SPOKEN_NAME} connected. Waiting for user interaction.")

    # This makes the agent greet the user proactively
    initial_greeting_prompt = (
        f"The call has just connected. As '{AGENT_SPOKEN_NAME}', begin the conversation immediately in Telugu. "
        f"Greet the parent warmly, introduce yourself, and state the call's purpose. "
        f"Then, pause and wait for the human to respond."
    )
    await session.generate_reply(instructions=initial_greeting_prompt)

if __name__ == "__main__":
    initialize_rag_pipeline_globally()
    agents.cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))