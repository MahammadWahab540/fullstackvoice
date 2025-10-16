import os
import asyncio
import json
from dotenv import load_dotenv

from livekit import agents, rtc
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
AGENT_SPOKEN_NAME = "Maya"
AGENT_ROLE = "Registration Expert"
CALLING_FROM_COMPANY = "NxtWave"

PRE_SYSTEM_PROMPT = (
    "You are a Program Registration Expert (PRE) representing NxtWave. "
    "Your mission is to guide newly registered students and their parents through the Intro Call onboarding journey, "
    "ensuring clarity, trust, and completion of the loan setup process. "
    "You act as a voice-guided onboarding assistant who explains the process, answers queries clearly, "
    "and ensures the family completes all actions (document uploads, verification, confirmations) during this session. "
    "Your tone must be warm and confident, clear, jargon-free, and human, supportive but outcome-focused, "
    "and firm when needed to drive completion. Never sound robotic, salesy, or overly formal. "
    "Speak naturally, as a real advisor who wants the family to succeed."
)

STAGE_FOCUS_PROMPTS: dict[str, str] = {
    "greeting": (
        "Focus on greeting the family warmly, introduce yourself as Maya from NxtWave, confirm the learner's name, "
        "and set clear expectations for the onboarding flow before discussing payment options. "
        "Use natural Telugu with helpful English words when it keeps the family comfortable."
    ),
    "payment_options": (
        "Share the three payment choices: Credit Card, Full Payment, and 0 percent Interest Loan with NBFC (EMI). "
        "Present them in a crisp, reassuring manner. Encourage the family to pick the option that fits them best "
        "and clarify that you will guide them through the next steps. Keep the tone confident yet friendly."
    ),
    "nbfc_selection": (
        "Guide the family through selecting an NBFC partner for the EMI path. "
        "Explain approval steps, timelines, and required documents so they feel prepared to continue immediately. "
        "Reinforce trust and keep momentum toward completion."
    ),
    "kyc": (
        "Walk the family through uploading PAN, address proof, and bank statements. "
        "Check for understanding, resolve doubts, and reassure them that you are staying with them until every document is submitted correctly."
    ),
    "rca": (
        "Summarize commitments, confirm the agreed timelines, and close the session with decisive next steps. "
        "Make sure the family feels confident about what happens after this call."
    ),
}

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
        Settings.llm = GoogleGenAI(model="models/gemini-2.5-flash")
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
        self.current_stage = "greeting"
        self.user_payment_choice = None
        # Store the agent's session to generate replies from any method
        self.agent_session: AgentSession | None = None

    async def on_user_turn_completed(self, turn_ctx: ChatContext, new_message: ChatMessage):
        user_query = new_message.text_content().lower()
        print(f"User said: {user_query}")

        # Payment option validation logic
        if self.current_stage == "payment_options":
            if any(keyword in user_query for keyword in ["credit card", "credit", "card"]):
                self.user_payment_choice = "credit_card"
                await self._handle_payment_selection(turn_ctx)
                return
            elif any(keyword in user_query for keyword in ["full payment", "full", "upfront", "one time"]):
                self.user_payment_choice = "full_payment"
                await self._handle_payment_selection(turn_ctx)
                return
            elif any(keyword in user_query for keyword in ["emi", "loan", "nbfc", "installment", "monthly"]):
                self.user_payment_choice = "nbfc_emi"
                await self._handle_payment_selection(turn_ctx)
                return

        # --- RAG Integration Logic ---
        # If the RAG engine is ready and the user asks a question, use it.
        if self.query_engine and "?" in user_query:
            print("User asked a question, querying RAG pipeline...")
            try:
                rag_response = self.query_engine.query(user_query)
                rag_context = str(rag_response)
                print(f"RAG Response: {rag_context}")

                rag_prompt = (
                    f"User asked: '{user_query}'. Context: {rag_context}. "
                    f"Answer briefly in Telugu. Don't mention knowledge base."
                )
                await turn_ctx.session.generate_reply(instructions=rag_prompt)
                return

            except Exception as e:
                print(f"Error querying RAG pipeline: {e}")

        # Default reply generation
        await turn_ctx.session.generate_reply()

    async def _handle_payment_selection(self, turn_ctx: ChatContext):
        """Handle payment option selection with validation logic"""
        if self.user_payment_choice in ["credit_card", "full_payment"]:
            await self._process_payment_transition(
                next_stage="flow_complete",
                agent_message="Our human agent will contact you shortly for the payment process.",
                reply_session=turn_ctx.session,
            )
        elif self.user_payment_choice == "nbfc_emi":
            await self._process_payment_transition(
                next_stage="nbfc_selection",
                agent_message="Great! Let me unlock the 0% EMI loan steps for you.",
                reply_session=turn_ctx.session,
            )

    async def on_data_received(self, data: bytes, participant_identity: str):
        try:
            payload = json.loads(data.decode())
            if payload.get("action") == "force_reply":
                print("Received force_reply from frontend. Re-engaging user.")
                re_engagement_prompt = (
                    f"{PRE_SYSTEM_PROMPT} You are reconnecting with the family during the '{self.current_stage}' stage. "
                    "Ask a concise, warm Telugu question (mix in natural English words if helpful) that nudges them to continue."
                )
                if self.agent_session:
                    await self.agent_session.generate_reply(instructions=re_engagement_prompt)
                return
            if payload.get('type') == 'payment_option.selected':
                choice = payload.get('choice')
                next_stage = payload.get('next_stage')
                agent_message = payload.get('agent_message')
                self._map_payment_choice(choice)
                if next_stage:
                    await self._process_payment_transition(
                        next_stage=next_stage,
                        agent_message=agent_message,
                        reply_session=self.agent_session,
                    )
                return
            if 'stage' in payload:
                new_stage = payload['stage']
                print(f"Received new stage from frontend: {new_stage}")
                self.current_stage = new_stage
                await self.update_agent_for_stage()
            elif 'payment_choice' in payload:
                choice = payload['payment_choice']
                choice_title = payload.get('choice_title', choice)
                print(f"Received payment choice from frontend: {choice} ({choice_title})")

                self._map_payment_choice(choice)

                if self.agent_session:
                    await self._handle_payment_selection_direct()
        except Exception as e:
            print(f"Error handling data message: {e}")

    async def _handle_payment_selection_direct(self):
        """Handle payment option selection sent directly from frontend"""
        if self.user_payment_choice in ["credit_card", "full_payment"]:
            await self._process_payment_transition(
                next_stage="flow_complete",
                agent_message="Our human agent will contact you shortly for the payment process.",
                reply_session=self.agent_session,
            )
        elif self.user_payment_choice == "nbfc_emi":
            await self._process_payment_transition(
                next_stage="nbfc_selection",
                agent_message="Great! Let me unlock the 0% EMI loan steps for you.",
                reply_session=self.agent_session,
            )

    def _map_payment_choice(self, choice: str | None) -> None:
        if not choice:
            return
        if choice in ['credit-card', 'credit-card-emi']:
            self.user_payment_choice = "credit_card"
        elif choice == 'full-payment':
            self.user_payment_choice = "full_payment"
        elif choice in ['nbfc-emi', '0%-interest-loan-with-nbfc-(emi)']:
            self.user_payment_choice = "nbfc_emi"

    async def _process_payment_transition(
        self,
        next_stage: str,
        agent_message: str | None,
        reply_session: AgentSession | None,
    ) -> None:
        if agent_message and reply_session:
            prompt_text = "Say: '{}' in Telugu.".format(agent_message)
            await reply_session.generate_reply(instructions=prompt_text)

        if next_stage == "flow_complete":
            self.current_stage = "completed"
            await self._notify_flow_complete(agent_message)
            return

        self.current_stage = next_stage
        await self._notify_stage_update(next_stage, agent_message)
        await self.update_agent_for_stage()

    async def _notify_flow_complete(self, agent_message: str | None) -> None:
        if hasattr(self.agent_session, 'room') and self.agent_session.room:
            try:
                payload = {"status": "ended", "message": "conversation_completed"}
                if agent_message:
                    payload["agent_message"] = agent_message
                await self.agent_session.room.local_participant.publish_data(
                    json.dumps(payload).encode(), reliable=True
                )
            except Exception as e:
                print(f"Failed to send ended status: {e}")

    async def _notify_stage_update(self, next_stage: str, agent_message: str | None) -> None:
        if hasattr(self.agent_session, 'room') and self.agent_session.room:
            try:
                payload = {"stage": next_stage, "advance_stage": True}
                if agent_message:
                    payload["agent_message"] = agent_message
                await self.agent_session.room.local_participant.publish_data(
                    json.dumps(payload).encode(), reliable=True
                )
            except Exception as e:
                print(f"Failed to send stage advance: {e}")

    async def update_agent_for_stage(self):
        if self.current_stage in ["completed", "flow_complete"]:
            return  # Conversation has ended

        stage_guidance = STAGE_FOCUS_PROMPTS.get(self.current_stage)
        if not stage_guidance or not self.agent_session:
            return

        stage_title = self.current_stage.replace("_", " ")
        stage_instructions = (
            f"{PRE_SYSTEM_PROMPT} "
            f"You are currently guiding the '{stage_title}' stage. "
            f"{stage_guidance} Respond in Telugu with natural English phrases when they build comfort."
        )

        await self.agent_session.generate_reply(instructions=stage_instructions)

async def entrypoint(ctx: JobContext):
    # Instructions are updated to make the agent aware of its RAG capabilities
    llm_instructions = (
        f"{PRE_SYSTEM_PROMPT} "
        f"Introduce yourself as {AGENT_SPOKEN_NAME} from {CALLING_FROM_COMPANY}. "
        "Lead the onboarding conversation in Telugu with natural English phrases, keep momentum across each stage, "
        "and confirm every required action is complete before ending the session."
    )

    session = agents.AgentSession(
        llm=google.beta.realtime.RealtimeModel(
            model="gemini-2.5-flash-exp-native-audio-thinking-dialog",
            voice="Aoede",
            temperature=0.3,
            instructions=llm_instructions,
        ),
    )
    
    # Pass the initialized query engine to the agent
    agent_instance = NxtWaveOnboardingAgent(query_engine=QUERY_ENGINE, llm_instructions=llm_instructions)
    agent_instance.agent_session = session  # Give agent access to its own session
    
    # Register the data received handler
    agent_instance.on_data_received = agent_instance.on_data_received

    await session.start(room=ctx.room, agent=agent_instance)
    # Configure the agent to use a reliable connection (TCP/relay)
    rtc_config = rtc.RTCConfiguration(ice_transport_policy=rtc.IceTransportPolicy.RELAY)
    await ctx.connect(options=rtc.RoomOptions(rtc_config=rtc_config))
    await asyncio.sleep(4)  # allow connection to stabilize before speaking
    print(f"{AGENT_SPOKEN_NAME} connected. Waiting for user interaction.")

    # Proactive greeting in Tenglish to engage immediately
    initial_greeting_prompt = (
        "Start immediately in Tenglish (a mix of modern Telugu and English). "
        "Say: 'Namaste! Nenu me onboarding agent, Maya. I will guide you through the process until you get learning access.' "
        "Be friendly and welcoming."
    )
    await session.generate_reply(instructions=initial_greeting_prompt)

if __name__ == "__main__":
    # Initialize the RAG pipeline when the script starts
    initialize_rag_pipeline_globally()
    agents.cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
