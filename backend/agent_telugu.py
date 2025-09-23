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
from livekit.plugins import google

# LlamaIndex imports for RAG
from llama_index.core import VectorStoreIndex, SimpleDirectoryReader, Settings
from llama_index.llms.google_genai import GoogleGenAI
from llama_index.embeddings.google_genai import GoogleGenAIEmbedding

load_dotenv()

# This will hold our RAG query engine
QUERY_ENGINE = None
AGENT_SPOKEN_NAME = "Harshitha"
AGENT_ROLE = "Registration Expert"
CALLING_FROM_COMPANY = "NxtWave"

def initialize_rag_pipeline_globally():
    """
    Initializes the RAG pipeline using LlamaIndex.
    It loads documents from the ./data directory, creates embeddings,
    and prepares a query engine for the agent to use.
    """
    global QUERY_ENGINE
    try:
        # Configure the LLM and embedding models from Google GenAI
        # Make sure the GOOGLE_API_KEY is set in your .env file
        Settings.llm = GoogleGenAI(model="models/gemini-1.5-flash-latest")
        Settings.embed_model = GoogleGenAIEmbedding(model_name="models/embedding-001")

        # Load all documents from the 'data' directory
        print("Loading documents from ./data directory...")
        documents = SimpleDirectoryReader("./data").load_data()
        if not documents:
            print("⚠️ No documents found in the ./data directory. RAG will be inactive.")
            return

        # Create a vector store index from the documents
        print("Creating vector store index... (This may take a moment)")
        index = VectorStoreIndex.from_documents(documents)

        # Create the query engine that the agent will use
        QUERY_ENGINE = index.as_query_engine()
        print("✅ RAG pipeline initialized successfully.")

    except Exception as e:
        print(f"❌ Failed to initialize RAG pipeline: {e}")
        print("The agent will run without RAG capabilities.")

class NxtWaveOnboardingAgent(agents.Agent):
    def __init__(self, query_engine, llm_instructions):
        super().__init__(instructions=llm_instructions)
        self.query_engine = query_engine
        self.current_stage = "introduction"
        # Store the agent's session to generate replies from any method
        self.agent_session: AgentSession | None = None

    async def on_user_turn_completed(self, turn_ctx: ChatContext, new_message: ChatMessage):
        user_query = new_message.text_content()
        print(f"User said: {user_query}")

        # --- RAG Integration Logic ---
        # If the RAG engine is ready and the user asks a question, use it.
        if self.query_engine and "?" in user_query:
            print("User asked a question, querying RAG pipeline...")
            try:
                rag_response = self.query_engine.query(user_query)
                rag_context = str(rag_response)
                print(f"RAG Response: {rag_context}")

                rag_prompt = (
                    f"A user asked: '{user_query}'.\n"
                    f"You have the following information from your knowledge base to help answer:\n\n"
                    f"--- Context ---\n{rag_context}\n-----------------\n\n"
                    f"Based on this context, provide a helpful and concise answer in Telugu. "
                    f"Frame the answer positively. Do not mention your knowledge base. "
                    f"If the context doesn't seem to answer the question, say you will find out and get back to them."
                )
                await turn_ctx.session.generate_reply(instructions=rag_prompt)
                return

            except Exception as e:
                print(f"Error querying RAG pipeline: {e}")
                # Fallback to default behavior if RAG fails

        # Default reply generation if not a RAG query
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
            stage_instructions = (
                f"You are in the introduction stage. Greet the user warmly, introduce yourself as {AGENT_SPOKEN_NAME} "
                f"from {CALLING_FROM_COMPANY}, and confirm you are speaking with the parent. Build a friendly rapport."
            )
        elif self.current_stage == "payment":
            # This is now enhanced with context from your PDF
            stage_instructions = (
                "You are now in the payment stage. Proactively explain how NxtWave makes education affordable for everyone. "
                "Mention that financial partners (NBFCs) ensure that upfront costs are not a barrier, allowing education to be an investment in their child's future. "
                "Explain the benefits of No-Cost EMI options. Be ready to answer questions about this."
            )
        elif self.current_stage == "kyc":
            # This is also enhanced with context from your PDF
            stage_instructions = (
                "You are in the KYC stage. Explain that this process is simple, digital, and secure because we partner with trusted, "
                "RBI-registered financial institutions. Reassure them that this adds credibility and makes the financial process safe. "
                "Proactively explain the documents needed for the loan process."
            )

        if self.agent_session:
             await self.agent_session.generate_reply(
                instructions=f"The conversation has moved to the '{self.current_stage}' stage. "
                             f"Proactively begin this part of the conversation in Telugu, following these instructions: {stage_instructions}"
            )

async def entrypoint(ctx: JobContext):
    # Instructions are updated to make the agent aware of its RAG capabilities
    llm_instructions = (
        f"You are '{AGENT_SPOKEN_NAME}', a friendly and professional '{AGENT_ROLE}' from {CALLING_FROM_COMPANY}. "
        f"Your primary language for this conversation is Telugu. "
        f"Your goal is to guide parents through the NxtWave onboarding process smoothly. "
        f"You will receive stage updates to direct the conversation. Follow them precisely. "
        f"If the user asks a specific question, you have access to a knowledge base to provide accurate answers."
    )

    session = agents.AgentSession(
        llm=google.beta.realtime.RealtimeModel(
            model="gemini-2.5-flash-exp-native-audio-thinking-dialog",
            voice="Aoede",
            temperature=0.8,
            instructions=llm_instructions,
        ),
    )
    
    # Pass the initialized query engine to the agent
    agent_instance = NxtWaveOnboardingAgent(query_engine=QUERY_ENGINE, llm_instructions=llm_instructions)
    agent_instance.agent_session = session  # Give agent access to its own session
    
    # Register the data received handler
    agent_instance.on_data_received = agent_instance.on_data_received

    await session.start(room=ctx.room, agent=agent_instance)
    await ctx.connect()
    print(f"{AGENT_SPOKEN_NAME} connected. Waiting for user interaction.")

    # Proactive greeting
    initial_greeting_prompt = (
        f"The call has just connected. As '{AGENT_SPOKEN_NAME}', begin the conversation immediately in Telugu. "
        f"Greet the parent warmly, introduce yourself and {CALLING_FROM_COMPANY}, and state the call's purpose. "
        f"Then, pause and wait for the human to respond."
    )
    await session.generate_reply(instructions=initial_greeting_prompt)

if __name__ == "__main__":
    # Initialize the RAG pipeline when the script starts
    initialize_rag_pipeline_globally()
    agents.cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))