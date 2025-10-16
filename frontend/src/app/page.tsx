'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatTranscript } from '@/components/ui/ChatTranscript';
import {
    ConnectionState,
    DataPacket_Kind,
    DefaultReconnectPolicy,
    LocalParticipant,
    Participant,
    RemoteParticipant,
    Room,
    RoomEvent,
    Track,
    TrackPublication,
} from 'livekit-client';

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';
const roomName = process.env.NEXT_PUBLIC_LIVEKIT_ROOM_NAME ?? 'test-call';
const defaultLivekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL ?? 'wss://voiceagent-495b9yge.livekit.cloud';

type AvatarState = 'idle' | 'thinking' | 'speaking' | 'error';

interface UserProfile {
    name: string;
    phone: string;
}

interface LoginPageProps {
    onStartCall: (profile: UserProfile) => void;
}

interface CallPageProps {
    user: UserProfile;
    onReset: () => void;
}

const AgentPromptButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
    <div className="group relative">
        <button
            type="button"
            onClick={onClick}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-500 text-white shadow-lg animate-blink focus:outline-none focus:ring-2 focus:ring-sky-300"
        >
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9" strokeLinecap="round" strokeLinejoin="round" />
                <path
                    d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
        </button>
        <div className="pointer-events-none absolute bottom-full mb-2 w-max max-w-xs rounded-lg bg-slate-700 px-3 py-2 text-sm font-medium text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
            Agent paused? Click to continue.
            <div className="tooltip-arrow" data-popper-arrow />
        </div>
    </div>
);

const UserSpeakingIndicator: React.FC = () => (
    <div className="flex h-4 w-6 items-end justify-center gap-0.5">
        <span
            className="w-1 animate-[speak_0.8s_ease-in-out_infinite] rounded-full bg-sky-400"
            style={{ animationDelay: '0.1s', height: '80%' }}
        />
        <span
            className="w-1 animate-[speak_0.8s_ease-in-out_infinite] rounded-full bg-sky-400"
            style={{ animationDelay: '0.3s', height: '100%' }}
        />
        <span
            className="w-1 animate-[speak_0.8s_ease-in-out_infinite] rounded-full bg-sky-400"
            style={{ animationDelay: '0.5s', height: '60%' }}
        />
        <span
            className="w-1 animate-[speak_0.8s_ease-in-out_infinite] rounded-full bg-sky-400"
            style={{ animationDelay: '0.2s', height: '90%' }}
        />
    </div>
);

const waitForParticipantActive = async (participant: LocalParticipant, timeoutMs = 8000) => {
    if (participant.isActive) {
        return true;
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            participant.waitUntilActive(),
            new Promise<void>((_, reject) => {
                timeoutHandle = setTimeout(() => {
                    reject(new Error('Timed out waiting for LiveKit participant activation'));
                }, timeoutMs);
            }),
        ]);
        return true;
    } catch (error) {
        console.warn('LiveKit participant did not become active before timeout', error);
        return false;
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
};

const waitForReliableDataChannel = async (room: Room, timeoutMs = 8000) => {
    const engine = room.engine;
    if (!engine) {
        throw new Error('LiveKit engine not initialised');
    }

    await engine.ensureDataTransportConnected(DataPacket_Kind.RELIABLE, false);

    const reliableChannel = engine.dataChannelForKind(DataPacket_Kind.RELIABLE);
    if (!reliableChannel) {
        throw new Error('Reliable data channel not available');
    }
    if (reliableChannel.readyState === 'open') {
        return;
    }

    await new Promise<void>((resolve, reject) => {
        const handleOpen = () => {
            cleanup();
            resolve();
        };
        const handleClose = () => {
            cleanup();
            reject(new Error('Reliable data channel closed before opening'));
        };
        const cleanup = () => {
            reliableChannel.removeEventListener('open', handleOpen);
            reliableChannel.removeEventListener('close', handleClose);
            clearTimeout(timeout);
        };
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('Timed out waiting for LiveKit reliable data channel'));
        }, timeoutMs);

        reliableChannel.addEventListener('open', handleOpen);
        reliableChannel.addEventListener('close', handleClose);
    });
};


type StageKey = 'greeting' | 'payment_options' | 'nbfc_selection' | 'kyc' | 'rca';

interface StageConfig {
    key: StageKey;
    title: string;
    guidance: string;
    microcopy: string;
    ctaLabel: string;
    accent: string;
}

interface PaymentOption {
    key: string;
    title: string;
    subtitle: string;
    description: string;
}

interface DocumentItem {
    key: string;
    label: string;
    helper: string;
    optional?: boolean;
}

const STAGE_FLOW: StageConfig[] = [
    {
        key: 'greeting',
        title: 'Greeting',
        guidance: 'Maya will welcome you and confirm your learner details.',
        microcopy: 'Most families complete this welcome in under 2 minutes.',
        ctaLabel: 'Proceed to payment options',
        accent: 'from-sky-300 to-indigo-400',
    },
    {
        key: 'payment_options',
        title: 'Payment Options',
        guidance: 'Choose NBFC EMI, Credit Card EMI, or one-time full payment.',
        microcopy: 'You can revisit your choice with the agent at any time.',
        ctaLabel: 'Confirm Payment Option',
        accent: 'from-emerald-300 to-sky-400',
    },
    {
        key: 'nbfc_selection',
        title: 'NBFC Selection',
        guidance: 'Pick the 0% EMI partner and review approval details together.',
        microcopy: 'Fast digital approvals keep the momentum going.',
        ctaLabel: 'Continue to KYC',
        accent: 'from-indigo-300 to-violet-400',
    },
    {
        key: 'kyc',
        title: 'KYC Verification',
        guidance: 'Upload or verify documents so we can wrap compliance quickly.',
        microcopy: 'Most families finish documents in under 10 minutes.',
        ctaLabel: 'Mark Documents Complete',
        accent: 'from-amber-300 to-rose-300',
    },
    {
        key: 'rca',
        title: 'RCA Wrap-up',
        guidance: 'Summarize commitments, confirm timelines, and close confidently.',
        microcopy: 'We keep the finale crisp and action-oriented.',
        ctaLabel: 'Finish Call',
        accent: 'from-purple-300 to-fuchsia-400',
    },
];

const PAYMENT_OPTIONS: PaymentOption[] = [
    {
        key: 'credit-card',
        title: 'Credit Card',
        subtitle: 'Use your existing credit limit',
        description: 'Swipe once, convert to EMIs with minimal bank charges and instant confirmation.',
    },
    {
        key: 'full-payment',
        title: 'Full Payment',
        subtitle: 'One-time secure transfer',
        description: 'Pay upfront via UPI or net banking with automatic receipt generation.',
    },
    {
        key: 'nbfc-emi',
        title: '0% Interest Loan with NBFC (EMI)',
        subtitle: 'Most flexible monthly plans',
        description: 'Instant, paperless approval with auto-debit mandate to keep cash flow light.',
    },
];

const NBFC_PARTNERS = [
    {
        key: 'bajaj',
        title: 'Bajaj Finserv',
        turnaround: 'Instant approval',
        description: 'Digital KYC with Aadhaar OTP and auto-debit mandate setup in-call.',
    },
    {
        key: 'hdfc',
        title: 'HDFC Credila',
        turnaround: 'Within 30 minutes',
        description: 'Zero-processing fee offer for NxtWave learners with simple bank statement upload.',
    },
    {
        key: 'tata',
        title: 'Tata Capital',
        turnaround: 'Same-day confirmation',
        description: 'Flexible 6-18 month repayment options with multilingual support.',
    },
];

const RCA_SUMMARY_POINTS = [
    'Confirm the learner’s batch start date and onboarding checklist.',
    'Share support channel details and escalation contact for the family.',
    'Remind them when the welcome kit and LMS access details will arrive.',
];

const DOCUMENT_CHECKLIST: DocumentItem[] = [
    {
        key: 'pan',
        label: 'PAN Card',
        helper: 'Required for verification. Keep a clear scan or photo ready.',
    },
    {
        key: 'address-proof',
        label: 'Address Proof',
        helper: 'Aadhaar, passport, or utility bill works for this step.',
    },
    {
        key: 'bank-statement',
        label: 'Recent Bank Statement',
        helper: 'Last 3 months help us assess repayment comfort.',
        optional: true,
    },
    {
        key: 'income-proof',
        label: 'Income Proof',
        helper: 'Latest salary slip or ITR summary speeds up approvals.',
        optional: true,
    },
];


const GREETING_POINTS = [
    'Warm hello and quick verification of your learner details.',
    'Short overview of the course flow and mentor support you will receive.',
    'Set expectations on payment assistance and escalation paths.',
];

const avatarShellMap: Record<AvatarState, string> = {
    idle: 'bg-sky-300 shadow-[0_0_32px_-12px_rgba(56,189,248,0.9)] animate-pulse',
    thinking: 'bg-indigo-300 shadow-[0_0_35px_-12px_rgba(79,70,229,0.9)] animate-[pulse_2.8s_ease-in-out_infinite]',
    speaking: 'bg-emerald-300 shadow-[0_0_40px_-10px_rgba(16,185,129,0.9)] scale-110',
    error: 'bg-rose-400 shadow-[0_0_35px_-8px_rgba(244,63,94,0.9)]',
};

const avatarStateLabelMap: Record<AvatarState, string> = {
    idle: 'Listening',
    thinking: 'Thinking',
    speaking: 'Speaking',
    error: 'Needs attention',
};


const AgentAvatar: React.FC<{ state: AvatarState; agentName: string }> = ({ state, agentName }) => {
    const shellClass = avatarShellMap[state];
    return (
        <div className="relative flex h-52 w-52 items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-sky-200 via-white to-slate-200 shadow-2xl" />
            <div
                className={`relative flex h-36 w-36 items-center justify-center rounded-full transition-all duration-500 ${shellClass}`}
            >
                <span className="text-lg font-semibold text-slate-800">{agentName}</span>
                {state === 'thinking' && (
                    <span
                        className="absolute h-44 w-44 rounded-full border-4 border-indigo-200/70 border-t-transparent"
                        style={{ animation: 'spin 6s linear infinite' }}
                    />
                )}
                {state === 'speaking' && <span className="absolute inset-0 rounded-full bg-emerald-200/30 animate-ping" />}
                {state === 'error' && <span className="absolute inset-0 rounded-full bg-rose-200/70" />}
            </div>
        </div>
    );
};

const LoginPage: React.FC<LoginPageProps> = ({ onStartCall }) => {
    const [fullName, setFullName] = useState('');
    const [phoneNumber, setPhoneNumber] = useState('');
    const isDisabled = fullName.trim().length === 0 || phoneNumber.trim().length === 0;
    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (isDisabled) {
            return;
        }
        onStartCall({ name: fullName.trim(), phone: phoneNumber.trim() });
    };
    return (
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-sky-50 via-white to-slate-100 px-6 py-16">
            <form
                onSubmit={handleSubmit}
                className="w-full max-w-md space-y-6 rounded-3xl bg-white/80 p-8 shadow-2xl backdrop-blur"
            >
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-800">NxtWave Voice Agent</h1>
                    <p className="mt-2 text-sm text-slate-500">Enter your details to begin the onboarding call.</p>
                </div>
                <label className="block space-y-1">
                    <span className="text-sm font-medium text-slate-600">Full Name</span>
                    <input
                        type="text"
                        value={fullName}
                        onChange={(event) => setFullName(event.target.value)}
                        placeholder="Jane Doe"
                        className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-800 shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-200"
                        required
                    />
                </label>
                <label className="block space-y-1">
                    <span className="text-sm font-medium text-slate-600">Phone Number</span>
                    <input
                        type="tel"
                        value={phoneNumber}
                        onChange={(event) => setPhoneNumber(event.target.value)}
                        placeholder="98765 43210"
                        className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-800 shadow-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-200"
                        required
                    />
                </label>
                <button
                    type="submit"
                    disabled={isDisabled}
                    className="flex w-full items-center justify-center rounded-xl bg-sky-500 px-6 py-3 text-lg font-semibold text-white shadow-lg transition hover:bg-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                >
                    Start Call
                </button>
            </form>
        </div>
    );
};
const agentDisplayName = 'Maya';

const CallPage: React.FC<CallPageProps> = ({ user, onReset }) => {
    const [room, setRoom] = useState<Room | null>(null);
    const [isConnecting, setIsConnecting] = useState(true);
    const [isMuted, setIsMuted] = useState(false);
    const [isUserSpeaking, setIsUserSpeaking] = useState(false);
    const [showPromptButton, setShowPromptButton] = useState(false);

    const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected);
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const [avatarState, setAvatarState] = useState<AvatarState>('idle');
    const [currentStageIndex, setCurrentStageIndex] = useState(0);
    const [selectedPaymentRoute, setSelectedPaymentRoute] = useState<PaymentOption['key']>('nbfc-emi');
    const [flowCompleted, setFlowCompleted] = useState(false);
    const [agentFollowup, setAgentFollowup] = useState<string | null>(null);
    const [documentState, setDocumentState] = useState<Record<string, boolean>>(() =>
        Object.fromEntries(DOCUMENT_CHECKLIST.map((doc) => [doc.key, false])),
    );
    const currentStage = STAGE_FLOW[currentStageIndex];
    const stageProgressPercent =
        STAGE_FLOW.length > 1 ? (currentStageIndex / (STAGE_FLOW.length - 1)) * 100 : 0;
    const connectionStateLabel = String(connectionState)
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
    const avatarStateLabel = avatarStateLabelMap[avatarState];
    const visualProgressPercent = currentStageIndex === 0 ? 4 : stageProgressPercent;
    const isPrimaryDisabled = (isConnecting && !room) || flowCompleted;
    const audioRootRef = useRef<HTMLDivElement | null>(null);
    const roomRef = useRef<Room | null>(null);
    const avatarStateRef = useRef<AvatarState>('idle');
    const activeSpeakerTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const thinkingFallbackTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const promptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const autoPromptTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const agentHasSpokenRef = useRef(false);
    const hasAttemptedConnection = useRef(false);
    const updateAvatarState = useCallback((nextState: AvatarState) => {
        avatarStateRef.current = nextState;
        setAvatarState(nextState);
    }, []);
    const clearTimers = useCallback(() => {
        if (activeSpeakerTimeout.current) {
            clearTimeout(activeSpeakerTimeout.current);
            activeSpeakerTimeout.current = null;
        }
        if (thinkingFallbackTimeout.current) {
            clearTimeout(thinkingFallbackTimeout.current);
            thinkingFallbackTimeout.current = null;
        }
    }, []);
    const cleanupRoom = useCallback(async () => {
        clearTimers();
        const currentRoom = roomRef.current;
        roomRef.current = null;
        setRoom(null);
        setConnectionState(ConnectionState.Disconnected);
        setIsMuted(false);
        setIsUserSpeaking(false);
        setShowPromptButton(false);
        agentHasSpokenRef.current = false;
        if (promptTimerRef.current) {
            clearTimeout(promptTimerRef.current);
            promptTimerRef.current = null;
        }
        if (autoPromptTimeoutRef.current) {
            clearTimeout(autoPromptTimeoutRef.current);
            autoPromptTimeoutRef.current = null;
        }
        if (currentRoom && currentRoom.state !== ConnectionState.Disconnected) {
            try {
                await currentRoom.disconnect();
            } catch (error) {
                console.warn('Failed to disconnect room during cleanup', error);
            }
        }
    }, [clearTimers]);
    const scheduleAutoPrompt = useCallback(() => {
        if (autoPromptTimeoutRef.current) {
            clearTimeout(autoPromptTimeoutRef.current);
        }
        autoPromptTimeoutRef.current = setTimeout(async () => {
            autoPromptTimeoutRef.current = null;
            if (agentHasSpokenRef.current || !roomRef.current) {
                return;
            }
            try {
                const payload = new TextEncoder().encode(
                    JSON.stringify({ action: 'force_reply', reason: 'auto_prompt' }),
                );
                await roomRef.current.localParticipant.publishData(payload, { reliable: true });
            } catch (error) {
                console.error('Failed to auto prompt agent', error);
            }
        }, 6000);
    }, []);

    const connectToLiveKit = useCallback(async () => {
        try {
            setIsConnecting(true);
            setConnectionError(null);
            updateAvatarState('thinking');
            setFlowCompleted(false);
            setAgentFollowup(null);
            setCurrentStageIndex(0);
            agentHasSpokenRef.current = false;
            if (autoPromptTimeoutRef.current) {
                clearTimeout(autoPromptTimeoutRef.current);
                autoPromptTimeoutRef.current = null;
            }
            const tokenUrl = new URL('/get-token', backendUrl);
            tokenUrl.searchParams.set('room_name', roomName);
            tokenUrl.searchParams.set('identity', user.name);
            const response = await fetch(tokenUrl.toString());
            if (!response.ok) {
                throw new Error(`Failed to fetch token: ${response.status} ${response.statusText}`);
            }
            const data: { token?: string; livekit_url?: string } = await response.json();
            if (!data.token) {
                throw new Error('Backend response did not include a LiveKit token');
            }
            const livekitUrl = data.livekit_url ?? defaultLivekitUrl;
            const newRoom = new Room({ 
                adaptiveStream: false, // This is the change
                dynacast: true,
                reconnectPolicy: new DefaultReconnectPolicy(),
                publishDefaults: {
                    audioPreset: {
                        maxBitrate: 20_000,
                    }
                }
            });
            roomRef.current = newRoom;
            
            // Connect to room first
            await newRoom.connect(livekitUrl, data.token, { rtcConfig: { iceTransportPolicy: 'relay' } });

            const [participantActive] = await Promise.all([
                waitForParticipantActive(newRoom.localParticipant),
                waitForReliableDataChannel(newRoom),
            ]);
            if (!participantActive) {
                console.warn('Proceeding before LiveKit participant reported as active');
            }
            
            // Enable microphone with proper error handling
            try {
                await newRoom.localParticipant.setMicrophoneEnabled(true);
            } catch (micError) {
                console.warn('Failed to enable microphone:', micError);
                throw new Error('Unable to enable microphone. Please check your microphone permissions.');
            }
            
            // Listen for agent data messages
            newRoom.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
                try {
                    const data = JSON.parse(new TextDecoder().decode(payload));
                    if (data.status === 'ended') {
                        if (typeof data.agent_message === 'string') {
                            setAgentFollowup(data.agent_message);
                        }
                        setFlowCompleted(true);
                        // Conversation ended, disconnect
                        setTimeout(() => {
                            newRoom.disconnect();
                            onReset();
                        }, 3000); // Wait 3 seconds for final message
                    } else if (data.advance_stage && data.stage) {
                        if (typeof data.agent_message === 'string') {
                            setAgentFollowup(data.agent_message);
                        }
                        if (data.stage === 'flow_complete') {
                            setFlowCompleted(true);
                        }
                        // Advance to next stage
                        const stageIndex = STAGE_FLOW.findIndex(s => s.key === data.stage);
                        if (stageIndex !== -1) {
                            setCurrentStageIndex(stageIndex);
                        }
                    }
                } catch (error) {
                    console.error('Failed to parse agent data:', error);
                }
            });
            
            setRoom(newRoom);
            setIsMuted(false);
            setConnectionState(newRoom.state);
            updateAvatarState('speaking');
            
            // Immediately sync to greeting stage
            setCurrentStageIndex(0);

            const publishInitialStage = async () => {
                await waitForReliableDataChannel(newRoom);
                const payload = new TextEncoder().encode(JSON.stringify({ stage: 'greeting', action: 'start' }));
                await newRoom.localParticipant.publishData(payload, { reliable: true });
            };

            const publishWithRetry = async (attempt = 1): Promise<void> => {
                try {
                    await publishInitialStage();
                } catch (error) {
                    console.warn(`Failed to send initial stage update (attempt ${attempt})`, error);
                    if (attempt >= 3) {
                        console.error('Giving up on initial stage update after retries', error);
                        return;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
                    await publishWithRetry(attempt + 1);
                }
            };

            await publishWithRetry();
            scheduleAutoPrompt();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error occurred while connecting';
            setConnectionError(message);
            updateAvatarState('error');
            await cleanupRoom();
        } finally {
            setIsConnecting(false);
        }
    }, [cleanupRoom, onReset, scheduleAutoPrompt, updateAvatarState, user.name]);
    useEffect(() => {
        if (hasAttemptedConnection.current) {
            return;
        }
        hasAttemptedConnection.current = true;
        void connectToLiveKit();
        return () => {
            void cleanupRoom();
        };
    }, [connectToLiveKit, cleanupRoom]);
    useEffect(() => {
        const currentRoom = room;
        if (!currentRoom) {
            return;
        }
        const handleConnectionStateChange = (state: ConnectionState) => {
            setConnectionState(state);
            if (state === ConnectionState.Connected && avatarStateRef.current === 'error') {
                updateAvatarState('idle');
            }
        };
        const handleActiveSpeakers = (speakers: Participant[]) => {
            const localIdentity = currentRoom.localParticipant.identity;
            const agentSpeaking = speakers.some(
                (participant) => participant.identity !== localIdentity,
            );
            const userSpeaking = speakers.some(
                (participant) => participant.identity === localIdentity,
            );
            setIsUserSpeaking(userSpeaking);
            if (agentSpeaking) {
                agentHasSpokenRef.current = true;
                if (autoPromptTimeoutRef.current) {
                    clearTimeout(autoPromptTimeoutRef.current);
                    autoPromptTimeoutRef.current = null;
                }
                clearTimers();
                updateAvatarState('speaking');
                return;
            }
            if (avatarStateRef.current === 'thinking') {
                if (activeSpeakerTimeout.current) {
                    clearTimeout(activeSpeakerTimeout.current);
                }
                activeSpeakerTimeout.current = setTimeout(() => {
                    updateAvatarState('idle');
                }, 1500);
            } else if (avatarStateRef.current === 'speaking') {
                updateAvatarState('idle');
            }
        };
        const handleDisconnected = () => {
            setConnectionState(ConnectionState.Disconnected);
            updateAvatarState('error');
            setIsUserSpeaking(false);
            setShowPromptButton(false);
            agentHasSpokenRef.current = false;
            if (autoPromptTimeoutRef.current) {
                clearTimeout(autoPromptTimeoutRef.current);
                autoPromptTimeoutRef.current = null;
            }
        };
        const handleSignalReconnecting = () => {
            setConnectionState(ConnectionState.SignalReconnecting);
            updateAvatarState('thinking');
            setIsUserSpeaking(false);
            setShowPromptButton(false);
            agentHasSpokenRef.current = false;
            if (autoPromptTimeoutRef.current) {
                clearTimeout(autoPromptTimeoutRef.current);
                autoPromptTimeoutRef.current = null;
            }
        };
        const handleSignalReconnected = () => {
            setConnectionState(ConnectionState.Connected);
            if (avatarStateRef.current !== 'speaking') {
                updateAvatarState('idle');
            }
            setIsUserSpeaking(false);
            setShowPromptButton(false);
            agentHasSpokenRef.current = false;
            scheduleAutoPrompt();
        };
        currentRoom.on(RoomEvent.ConnectionStateChanged, handleConnectionStateChange);
        currentRoom.on(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakers);
        currentRoom.on(RoomEvent.Disconnected, handleDisconnected);
        currentRoom.on(RoomEvent.SignalReconnecting, handleSignalReconnecting);
        currentRoom.on(RoomEvent.Reconnected, handleSignalReconnected);
        return () => {
            currentRoom.off(RoomEvent.ConnectionStateChanged, handleConnectionStateChange);
            currentRoom.off(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakers);
            currentRoom.off(RoomEvent.Disconnected, handleDisconnected);
            currentRoom.off(RoomEvent.SignalReconnecting, handleSignalReconnecting);
            currentRoom.off(RoomEvent.Reconnected, handleSignalReconnected);
        };
    }, [room, updateAvatarState, clearTimers, scheduleAutoPrompt]);
    useEffect(() => {
        const someoneActive = isUserSpeaking || avatarState === 'speaking';
        if (someoneActive) {
            if (promptTimerRef.current) {
                clearTimeout(promptTimerRef.current);
                promptTimerRef.current = null;
            }
            if (showPromptButton) {
                setShowPromptButton(false);
            }
            return;
        }

        if (!promptTimerRef.current) {
            promptTimerRef.current = setTimeout(() => {
                setShowPromptButton(true);
                promptTimerRef.current = null;
            }, 5000);
        }

        return () => {
            if (promptTimerRef.current) {
                clearTimeout(promptTimerRef.current);
                promptTimerRef.current = null;
            }
        };
    }, [isUserSpeaking, avatarState, showPromptButton]);
    useEffect(() => {
        const currentRoom = room;
        if (!currentRoom) {
            return;
        }
        const container = audioRootRef.current;
        const audioElements = new Map<string, HTMLMediaElement[]>();
        const attachAudio = (track: Track, participant: RemoteParticipant | LocalParticipant) => {
            if (track.kind !== Track.Kind.Audio) {
                return;
            }
            const key = track.sid ?? `${participant.sid ?? participant.identity}-${track.kind}`;
            if (audioElements.has(key)) {
                return;
            }
            const attachment = track.attach();
            const nodes = Array.isArray(attachment) ? attachment : [attachment];
            nodes.forEach((node) => {
                node.autoplay = true;
                node.playsInline = true;
                node.classList.add('hidden');
                container?.appendChild(node);
                const playAttempt = node.play();
                if (playAttempt && typeof playAttempt.catch === 'function') {
                    playAttempt
                        .then(() => {
                            console.info('LiveKit audio playback started', {
                                trackSid: track.sid,
                                participant: participant.identity,
                            });
                        })
                        .catch((playError: unknown) => {
                            console.error('LiveKit audio playback failed', {
                                error: playError,
                                trackSid: track.sid,
                                participant: participant.identity,
                            });
                        });
                } else {
                    console.warn('LiveKit audio playback promise unavailable; browser may block autoplay', {
                        trackSid: track.sid,
                        participant: participant.identity,
                    });
                }
            });
            audioElements.set(key, nodes);
        };
        const detachAudio = (track: Track, participant: RemoteParticipant | LocalParticipant) => {
            if (track.kind !== Track.Kind.Audio) {
                return;
            }
            const key = track.sid ?? `${participant.sid ?? participant.identity}-${track.kind}`;
            const nodes = audioElements.get(key);
            if (nodes) {
                nodes.forEach((node) => {
                    node.pause();
                    node.remove();
                });
                audioElements.delete(key);
            }
            track.detach();
        };
        currentRoom.remoteParticipants.forEach((participant) => {
            participant.trackPublications.forEach((publication) => {
                const track = publication.track;
                if (track) {
                    attachAudio(track, participant);
                }
            });
        });
        const onTrackSubscribed = (track: Track, _publication: TrackPublication, participant: RemoteParticipant) => {
            attachAudio(track, participant);
        };
        const onTrackUnsubscribed = (track: Track, _publication: TrackPublication, participant: RemoteParticipant) => {
            detachAudio(track, participant);
        };
        currentRoom.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
        currentRoom.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
        return () => {
            audioElements.forEach((nodes) => {
                nodes.forEach((node) => {
                    node.pause();
                    node.remove();
                });
            });
            audioElements.clear();
            currentRoom.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
            currentRoom.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
        };
    }, [room]);
    const sendStageUpdate = useCallback(
        async (stage: string) => {
            if (!room) {
                return;
            }
            try {
                const payload = new TextEncoder().encode(JSON.stringify({ stage }));
                await room.localParticipant.publishData(payload, { reliable: true });
            } catch (error) {
                console.error('Failed to send stage update', error);
            }
        },
        [room],
    );
    const publishAgentEvent = useCallback(
        async (data: Record<string, unknown>) => {
            if (!room) {
                return;
            }
            try {
                const payload = new TextEncoder().encode(JSON.stringify(data));
                await room.localParticipant.publishData(payload, { reliable: true });
            } catch (error) {
                console.error('Failed to publish agent event', error);
            }
        },
        [room],
    );
    const handleStageSelect = useCallback(
        (index: number) => {
            setCurrentStageIndex(index);
            void sendStageUpdate(STAGE_FLOW[index].key);
        },
        [sendStageUpdate],
    );
    const handlePaymentSelection = useCallback(
        async (option: PaymentOption) => {
            setSelectedPaymentRoute(option.key);
            const currentStageKey = STAGE_FLOW[currentStageIndex]?.key ?? 'payment_options';
            const basePayload = {
                type: 'payment_option.selected',
                stage: currentStageKey,
                choice: option.key,
                choice_title: option.title,
            };

            if (option.key === 'full-payment' || option.key === 'credit-card') {
                const agentMessage = 'Our human agent will contact you shortly for the payment process.';
                setAgentFollowup(agentMessage);
                setFlowCompleted(true);
                await publishAgentEvent({
                    ...basePayload,
                    next_stage: 'flow_complete',
                    agent_message: agentMessage,
                });
                void sendStageUpdate('flow_complete');
                return;
            }

            if (option.key === 'nbfc-emi') {
                const agentMessage = 'Great! Let me unlock the 0% EMI loan steps for you.';
                setAgentFollowup(agentMessage);
                setFlowCompleted(false);
                const nextStage: StageKey = 'nbfc_selection';
                await publishAgentEvent({
                    ...basePayload,
                    next_stage: nextStage,
                    agent_message: agentMessage,
                });
                const nextIndex = STAGE_FLOW.findIndex((stage) => stage.key === nextStage);
                if (nextIndex !== -1) {
                    setCurrentStageIndex(nextIndex);
                }
                void sendStageUpdate(nextStage);
                return;
            }

            await publishAgentEvent(basePayload);
        },
        [currentStageIndex, publishAgentEvent, sendStageUpdate],
    );

    const handlePrimaryAction = useCallback(() => {
        if (currentStageIndex >= STAGE_FLOW.length - 1) {
            void sendStageUpdate(STAGE_FLOW[currentStageIndex].key);
            if (STAGE_FLOW[currentStageIndex].key === 'kyc') {
                setDocumentState((previous) => ({ ...previous, pan: true }));
            }
            return;
        }
        const nextIndex = currentStageIndex + 1;
        setCurrentStageIndex(nextIndex);
        void sendStageUpdate(STAGE_FLOW[nextIndex].key);
    }, [currentStageIndex, sendStageUpdate, setDocumentState]);

    const stageDetailsContent = (() => {
        switch (currentStage.key) {
            case 'greeting':
                return (
                    <div className="space-y-4">
                        <p className="text-sm font-medium text-slate-600">During this step</p>
                        <ul className="space-y-3 text-sm text-slate-600">
                            {GREETING_POINTS.map((point, index) => (
                                <li key={point} className="flex items-start gap-3">
                                    <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-sky-100 text-xs font-semibold text-sky-600">
                                        {index + 1}
                                    </span>
                                    <span className="leading-relaxed">{point}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                );
            case 'payment_options':
                return (
                    <div className="space-y-4">
                        <p className="text-sm font-medium text-slate-600">Choose what fits you best</p>
                        <div className="grid gap-4 sm:grid-cols-3">
                            {PAYMENT_OPTIONS.map((option) => {
                                const isSelected = selectedPaymentRoute === option.key;
                                return (
                                    <button
                                        key={option.key}
                                        type="button"
                                        onClick={() => void handlePaymentSelection(option)}
                                        disabled={flowCompleted}
                                        className={`group flex flex-col gap-2 rounded-2xl border px-4 py-4 text-left transition ${
                                            isSelected
                                                ? 'border-sky-400 bg-sky-50 shadow-lg'
                                                : 'border-slate-200 bg-white hover:border-sky-200 hover:shadow-sm'
                                        }`}
                                    >
                                        <span
                                            className={`text-[11px] font-semibold uppercase tracking-wide ${
                                                isSelected ? 'text-sky-600' : 'text-slate-400'
                                            }`}
                                        >
                                            {isSelected ? 'Selected option' : 'Tap to select'}
                                        </span>
                                        <p className="text-base font-semibold text-slate-800">{option.title}</p>
                                        <p className="text-sm font-medium text-slate-500">{option.subtitle}</p>
                                        <p className="text-sm leading-relaxed text-slate-500">{option.description}</p>
                                    </button>
                                );
                            })}
                        </div>
                        {agentFollowup && (
                            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700 shadow-sm">
                                {agentFollowup}
                            </div>
                        )}
                    </div>
                );
            case 'nbfc_selection':
                return (
                    <div className="space-y-4">
                        <p className="text-sm font-medium text-slate-600">Recommended lending partners</p>
                        <div className="space-y-3">
                            {NBFC_PARTNERS.map((partner) => (
                                <div
                                    key={partner.key}
                                    className="flex flex-col gap-2 rounded-2xl border border-indigo-100 bg-white/80 px-4 py-4 shadow-sm"
                                >
                                    <div className="flex items-center justify-between">
                                        <p className="text-base font-semibold text-slate-800">{partner.title}</p>
                                        <span className="rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-600">
                                            {partner.turnaround}
                                        </span>
                                    </div>
                                    <p className="text-sm leading-relaxed text-slate-600">{partner.description}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            case 'kyc':
                return (
                    <div className="space-y-4">
                        <p className="text-sm font-medium text-slate-600">Document checklist</p>
                        <div className="space-y-3">
                            {DOCUMENT_CHECKLIST.map((doc) => {
                                const isComplete = documentState[doc.key];
                                return (
                                    <button
                                        key={doc.key}
                                        type="button"
                                        onClick={() =>
                                            setDocumentState((previous) => ({
                                                ...previous,
                                                [doc.key]: !previous[doc.key],
                                            }))
                                        }
                                        className={`flex w-full items-center justify-between rounded-2xl border px-4 py-4 text-left transition ${
                                            isComplete
                                                ? 'border-emerald-300 bg-emerald-50 shadow-sm'
                                                : 'border-slate-200 bg-white hover:border-sky-200 hover:shadow-sm'
                                        }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <span
                                                className={`mt-1 h-3.5 w-3.5 rounded-full ${
                                                    isComplete ? 'bg-emerald-500' : 'bg-slate-300'
                                                }`}
                                            />
                                            <div>
                                                <p className="text-sm font-semibold text-slate-700">{doc.label}</p>
                                                <p className="mt-1 text-xs text-slate-500 leading-relaxed">{doc.helper}</p>
                                                {doc.optional && (
                                                    <span className="mt-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
                                                        Optional
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        {isComplete && (
                                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white shadow">
                                                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                                                    <path d="M5 10.5L8.5 14l6.5-8" strokeLinecap="round" strokeLinejoin="round" />
                                                </svg>
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );
            case 'rca':
                return (
                    <div className="space-y-4">
                        <p className="text-sm font-medium text-slate-600">Before we wrap</p>
                        <ul className="space-y-3 text-sm text-slate-600">
                            {RCA_SUMMARY_POINTS.map((item, index) => (
                                <li key={item} className="flex items-start gap-3">
                                    <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-fuchsia-100 text-xs font-semibold text-fuchsia-600">
                                        {index + 1}
                                    </span>
                                    <span className="leading-relaxed">{item}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                );
            default:
                return null;
        }
    })();
    const toggleMute = useCallback(async () => {
        if (!room) {
            return;
        }
        const nextMuted = !isMuted;
        try {
            if (nextMuted) {
                await room.localParticipant.setMicrophoneEnabled(false);
            } else {
                await room.localParticipant.setMicrophoneEnabled(true);
            }
            setIsMuted(nextMuted);
        } catch (error) {
            console.error('Failed to toggle microphone', error);
        }
    }, [room, isMuted]);
    const handleHandoff = useCallback(() => {
        console.log('Handoff to human agent requested.');
    }, []);
    const handleLeave = useCallback(async () => {
        await cleanupRoom();
        onReset();
    }, [cleanupRoom, onReset]);
    const handlePromptClick = useCallback(async () => {
        if (promptTimerRef.current) {
            clearTimeout(promptTimerRef.current);
            promptTimerRef.current = null;
        }
        setShowPromptButton(false);
        if (!room) {
            scheduleAutoPrompt();
            return;
        }
        try {
            const payload = new TextEncoder().encode(JSON.stringify({ action: 'force_reply' }));
            await room.localParticipant.publishData(payload, { reliable: true });
        } catch (error) {
            console.error('Failed to publish agent prompt event', error);
        } finally {
            scheduleAutoPrompt();
        }
    }, [room, scheduleAutoPrompt]);

    const connectionBadgeClass = useMemo(() => {
        switch (connectionState) {
            case ConnectionState.Connected:
                return 'bg-emerald-100 text-emerald-700';
            case ConnectionState.Reconnecting:
                return 'bg-amber-100 text-amber-700';
            default:
                return 'bg-slate-200 text-slate-600';
        }
    }, [connectionState]);

return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-white to-sky-50 px-4 py-8 sm:px-6">
        <button
            type="button"
            onClick={handleHandoff}
            className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-lg shadow-sky-200/60 transition hover:-translate-y-0.5 hover:shadow-xl sm:bottom-8 sm:right-8"
        >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5z" />
                    <path d="M4 21a8 8 0 0 1 16 0" />
                </svg>
            </span>
            Talk to a Human (PRE)
        </button>
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-28">
            <header className="rounded-3xl bg-white/80 p-5 shadow-lg shadow-sky-100/60 backdrop-blur">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Voice Agent Journey</p>
                        <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                            <h1 className="text-2xl font-semibold text-slate-800">{user.name}</h1>
                            {isUserSpeaking && <UserSpeakingIndicator />}
                            <span className="text-sm text-slate-500">{user.phone}</span>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${connectionBadgeClass}`}>
                            {connectionStateLabel}
                        </span>
                        <button
                            type="button"
                            onClick={toggleMute}
                            disabled={!room}
                            className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                                isMuted
                                    ? 'border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    : 'border-transparent bg-sky-500 text-white shadow-lg hover:bg-sky-400'
                            } disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                            <span className={`flex h-8 w-8 items-center justify-center rounded-full ${
                                isMuted ? 'bg-white/80 text-slate-500' : 'bg-white/20 text-white'
                            }`}>
                                <svg
                                    viewBox="0 0 24 24"
                                    className="h-5 w-5"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    {isMuted ? (
                                        <>
                                            <line x1="4" y1="4" x2="20" y2="20" />
                                            <path d="M12 15a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" />
                                            <path d="M19 11a7 7 0 0 1-9 6.7" />
                                            <path d="M5 11a7 7 0 0 0 7 7" />
                                        </>
                                    ) : (
                                        <>
                                            <path d="M12 15a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" />
                                            <path d="M19 11a7 7 0 0 1-14 0" />
                                            <line x1="12" y1="19" x2="12" y2="23" />
                                            <line x1="8" y1="23" x2="16" y2="23" />
                                        </>
                                    )}
                                </svg>
                            </span>
                            {isMuted ? 'Unmute Mic' : 'Mute Mic'}
                        </button>
                        <button
                            type="button"
                            onClick={handleLeave}
                            className="hidden rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-600 shadow-sm transition hover:bg-rose-100 sm:flex"
                        >
                            End Call
                        </button>
                    </div>
                </div>
                <div className="mt-5 hidden sm:block">
                    <div className="relative px-1 pt-6">
                        <div className="absolute left-10 right-10 top-8 h-[3px] rounded-full bg-slate-200">
                            <div
                                className="h-full rounded-full bg-gradient-to-r from-sky-400 via-sky-500 to-indigo-500 transition-all duration-500 animate-[pulse_3s_ease-in-out_infinite]"
                                style={{ width: `${visualProgressPercent}%` }}
                            />
                        </div>
                        <div className="relative flex justify-between">
                            {STAGE_FLOW.map((stage, index) => {
                                const isActive = index === currentStageIndex;
                                const isCompleted = index < currentStageIndex;
                                return (
                                    <button
                                        key={stage.key}
                                        type="button"
                                        onClick={() => handleStageSelect(index)}
                                        className="group relative flex flex-col items-center gap-2 focus:outline-none"
                                    >
                                        <span
                                            className={`flex h-12 w-12 items-center justify-center rounded-full border-2 text-sm font-semibold transition ${
                                                isCompleted
                                                    ? 'border-emerald-300 bg-emerald-50 text-emerald-600 shadow-sm'
                                                    : isActive
                                                        ? 'border-transparent bg-gradient-to-br from-sky-100 via-white to-indigo-100 text-sky-600 shadow-md ring-2 ring-sky-200'
                                                        : 'border-slate-200 bg-white text-slate-400'
                                            }`}
                                        >
                                            {index + 1}
                                        </span>
                                        <span
                                            className={`text-xs font-semibold uppercase tracking-wide ${
                                                isActive ? 'text-slate-700' : 'text-slate-400'
                                            }`}
                                        >
                                            {stage.title}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:hidden">
                    {STAGE_FLOW.map((stage, index) => {
                        const isActive = index === currentStageIndex;
                        return (
                            <button
                                key={stage.key}
                                type="button"
                                onClick={() => handleStageSelect(index)}
                                className={`rounded-2xl border px-3 py-3 text-left text-xs font-semibold transition ${
                                    isActive ? 'border-sky-300 bg-sky-50 text-sky-700 shadow-sm' : 'border-slate-200 bg-white text-slate-500'
                                }`}
                            >
                                {index + 1}. {stage.title}
                            </button>
                        );
                    })}
                </div>
            </header>
            <main className="flex flex-col gap-6">
                <section className="relative flex flex-col items-center gap-6 rounded-3xl bg-white/90 p-8 shadow-xl shadow-sky-100/50 backdrop-blur">
                    {isConnecting && (
                        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-3xl bg-white/75 backdrop-blur">
                            <span className="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-sky-500" />
                            <p className="text-sm font-medium text-slate-600">Connecting to your AI agent...</p>
                        </div>
                    )}
                    <div className="relative flex flex-col items-center gap-4">
                        <div
                            className={`pointer-events-none absolute inset-x-0 -top-16 h-44 w-[520px] max-w-full rounded-full bg-gradient-to-r ${currentStage.accent} opacity-40 blur-3xl`}
                            aria-hidden
                        />
                        <AgentAvatar state={avatarState} agentName={agentDisplayName} />
                        <span className="rounded-full bg-slate-100 px-4 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {avatarStateLabel}
                        </span>
                    </div>
                    <div className="text-center">
                        <h2 className="text-2xl font-semibold text-slate-800">{currentStage.title}</h2>
                        <p className="mt-2 text-base text-slate-500">{currentStage.guidance}</p>
                        <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                            {currentStage.microcopy}
                        </p>
                    </div>
                    {connectionError && (
                        <div className="w-full rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
                            {connectionError}
                        </div>
                    )}
                </section>
                <section className="grid gap-6 lg:grid-cols-[1fr_1.15fr]">
                    <div className="flex flex-col rounded-3xl border border-slate-100 bg-white/80 p-6 shadow-inner backdrop-blur">
                        <div className="mb-4 flex items-center justify-between">
                            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Stage Guide</h3>
                            <span className="text-xs font-medium text-slate-400">
                                Step {currentStageIndex + 1} of {STAGE_FLOW.length}
                            </span>
                        </div>
                        {stageDetailsContent}
                    </div>
                    <div className="flex flex-col rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-inner backdrop-blur">
                        <div className="mb-4 flex items-center justify-between">
                            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Transcript</h3>
                            <span className="text-xs text-slate-400">Live conversation</span>
                        </div>
                        <ChatTranscript room={room} />
                    </div>
                </section>
                <section className="flex flex-col gap-4 rounded-3xl bg-white/90 px-6 py-5 shadow-lg shadow-sky-100/50 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1 text-sm text-slate-500">
                        <p>Need help? You can pause or switch to a human anytime.</p>
                        {currentStage.key === 'payment_options' && (
                            <p className="text-xs font-semibold text-slate-400">
                                Selected: {PAYMENT_OPTIONS.find((option) => option.key === selectedPaymentRoute)?.title}
                            </p>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        {showPromptButton && <AgentPromptButton onClick={handlePromptClick} />}
                        <button
                            type="button"
                            onClick={handlePrimaryAction}
                            disabled={isPrimaryDisabled}
                            className={`rounded-full px-6 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-sky-200 ${
                                isPrimaryDisabled
                                    ? 'bg-slate-200 text-slate-500'
                                    : 'bg-sky-500 text-white shadow-lg hover:bg-sky-400'
                            }`}
                        >
                            {currentStage.ctaLabel}
                        </button>
                        <button
                            type="button"
                            onClick={handleLeave}
                            className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-600 shadow-sm transition hover:bg-rose-100 sm:hidden"
                        >
                            End Call
                        </button>
                    </div>
                </section>
                <div ref={audioRootRef} className="hidden" aria-hidden />
            </main>
        </div>
    </div>
);
};

const HomePage: React.FC = () => {
    const [profile, setProfile] = useState<UserProfile | null>(null);
    if (!profile) {
        return <LoginPage onStartCall={setProfile} />;
    }
    return <CallPage user={profile} onReset={() => setProfile(null)} />;
};

export default HomePage;
