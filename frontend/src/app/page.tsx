'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ConnectionState,
    LocalParticipant,
    ParticipantEvent,
    Participant,
    RemoteParticipant,
    Room,
    RoomEvent,
    Track,
    TrackPublication,
    TranscriptionSegment,

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

interface ChatTranscriptProps {
    room: Room | null;
    onUserFinalUtterance?: () => void;
}

interface TranscriptMessage {
    id: string;
    identity: string;
    role: 'user' | 'agent';
    text: string;
    isFinal: boolean;
}

const avatarShellMap: Record<AvatarState, string> = {
    idle: 'bg-sky-300 shadow-[0_0_32px_-12px_rgba(56,189,248,0.9)] animate-pulse',
    thinking: 'bg-indigo-300 shadow-[0_0_35px_-12px_rgba(79,70,229,0.9)] animate-[pulse_2.8s_ease-in-out_infinite]',
    speaking: 'bg-emerald-300 shadow-[0_0_40px_-10px_rgba(16,185,129,0.9)] scale-110',
    error: 'bg-rose-400 shadow-[0_0_35px_-8px_rgba(244,63,94,0.9)]',
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

const ChatTranscript: React.FC<ChatTranscriptProps> = ({ room, onUserFinalUtterance }) => {
    const [messages, setMessages] = useState<TranscriptMessage[]>([]);
    const containerRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        setMessages([]);
    }, [room]);
    useEffect(() => {
        const container = containerRef.current;
        if (container) {
            container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
        }
    }, [messages]);
    useEffect(() => {
        if (!room) {
            return;
        }
        const handleSegments = (segments: TranscriptionSegment[], participant?: Participant) => {
            const source = participant ?? room.localParticipant;
            if (!source) {
                return;
            }
            const isUser = source.identity === room.localParticipant.identity;
            const identity = source.identity || (isUser ? 'You' : 'Agent');
            setMessages((previous) => {
                const nextMessages = [...previous];
                const lastMessage = nextMessages[nextMessages.length - 1];
                const shouldStartNew = !lastMessage || lastMessage.identity !== identity || lastMessage.isFinal;
                let workingMessage: TranscriptMessage;
                if (shouldStartNew) {
                    workingMessage = {
                        id: `${identity}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                        identity,
                        role: isUser ? 'user' : 'agent',
                        text: '',
                        isFinal: false,
                    };
                    nextMessages.push(workingMessage);
                } else {
                    workingMessage = { ...lastMessage };
                    nextMessages[nextMessages.length - 1] = workingMessage;
                }
                let finalFlag = workingMessage.isFinal;
                segments.forEach((segment) => {
                    workingMessage.text += segment.text;
                    if (segment.final) {
                        finalFlag = true;
                    }
                });
                workingMessage.isFinal = finalFlag;
                return nextMessages;
            });
            if (isUser && segments.some((segment) => segment.final)) {
                onUserFinalUtterance?.();
            }
        };
        room.on(RoomEvent.TranscriptionReceived, handleSegments);
        return () => {
            room.off(RoomEvent.TranscriptionReceived, handleSegments);
        };
    }, [room, onUserFinalUtterance]);
    if (!room) {
        return (
            <div className="flex h-64 w-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/60 text-slate-500">
                Transcript will appear once the call connects.
            </div>
        );
    }
    return (
        <div
            ref={containerRef}
            className="h-96 w-full overflow-y-auto rounded-2xl border border-slate-100 bg-white/80 p-6 shadow-inner backdrop-blur"
        >
            <ul className="space-y-4">
                {messages.map((message) => {
                    const isUser = message.role === 'user';
                    return (
                        <li key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                            <div
                                className={`max-w-xs rounded-2xl px-4 py-3 text-sm sm:max-w-md ${
                                    isUser ? 'bg-sky-500 text-white shadow-lg' : 'bg-slate-100 text-slate-800 shadow'
                                }`}
                            >
                                <p className="text-xs font-semibold uppercase tracking-wide text-white/70">
                                    {isUser ? 'You' : 'Agent'}
                                </p>
                                <p className="mt-1 whitespace-pre-wrap leading-relaxed">{message.text || '...'}</p>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};

const agentDisplayName = 'Harshitha';

const CallPage: React.FC<CallPageProps> = ({ user, onReset }) => {
    const [room, setRoom] = useState<Room | null>(null);
    const [isConnecting, setIsConnecting] = useState(true);
    const [isMuted, setIsMuted] = useState(false);
    const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected);
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const [avatarState, setAvatarState] = useState<AvatarState>('idle');
    const audioRootRef = useRef<HTMLDivElement | null>(null);
    const roomRef = useRef<Room | null>(null);
    const avatarStateRef = useRef<AvatarState>('idle');
    const activeSpeakerTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const thinkingFallbackTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
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
        if (currentRoom && currentRoom.state !== ConnectionState.Disconnected) {
            try {
                await currentRoom.disconnect();
            } catch (error) {
                console.warn('Failed to disconnect room during cleanup', error);
            }
        }
    }, [clearTimers]);
    const connectToLiveKit = useCallback(async () => {
        try {
            setIsConnecting(true);
            setConnectionError(null);
            updateAvatarState('thinking');
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
            const newRoom = new Room({ adaptiveStream: true, dynacast: true });
            roomRef.current = newRoom;
            await newRoom.connect(livekitUrl, data.token);
            await newRoom.localParticipant.setMicrophoneEnabled(true);
            setRoom(newRoom);
            setIsMuted(false);
            setConnectionState(newRoom.state);
            updateAvatarState('idle');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error occurred while connecting';
            setConnectionError(message);
            updateAvatarState('error');
            await cleanupRoom();
        } finally {
            setIsConnecting(false);
        }
    }, [cleanupRoom, updateAvatarState, user.name]);
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
            const agentSpeaking = speakers.some(
                (participant) => participant.identity !== currentRoom.localParticipant.identity,
            );
            if (agentSpeaking) {
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
        };
        currentRoom.on(RoomEvent.ConnectionStateChanged, handleConnectionStateChange);
        currentRoom.on(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakers);
        currentRoom.on(RoomEvent.Disconnected, handleDisconnected);
        return () => {
            currentRoom.off(RoomEvent.ConnectionStateChanged, handleConnectionStateChange);
            currentRoom.off(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakers);
            currentRoom.off(RoomEvent.Disconnected, handleDisconnected);
        };
    }, [room, updateAvatarState, clearTimers]);
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
                node.play().catch((playError: unknown) => console.warn('Audio playback failed', playError));
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
    const handleUserFinalUtterance = useCallback(() => {
        if (thinkingFallbackTimeout.current) {
            clearTimeout(thinkingFallbackTimeout.current);
        }
        updateAvatarState('thinking');
        thinkingFallbackTimeout.current = setTimeout(() => {
            if (avatarStateRef.current === 'thinking') {
                updateAvatarState('idle');
            }
        }, 8000);
    }, [updateAvatarState]);
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
    const stageButtons = useMemo(
        () => [
            { key: 'introduction', label: 'Introduction' },
            { key: 'payment', label: 'Payment' },
            { key: 'kyc', label: 'KYC' },
        ],
        [],
    );
    const connectionBadgeClass = useMemo(() => {
        switch (connectionState) {
            case ConnectionState.Connected:
                return 'bg-emerald-100 text-emerald-700';
            case ConnectionState.Reconnecting:
            case ConnectionState.SignalReconnecting:
                return 'bg-amber-100 text-amber-700';
            default:
                return 'bg-slate-200 text-slate-600';
        }
    }, [connectionState]);
    return (
        <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-slate-100 px-4 py-10">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
                <header className="flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-white/70 px-6 py-4 shadow-lg backdrop-blur">
                    <div>
                        <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Connected as</p>
                        <h1 className="text-2xl font-semibold text-slate-800">{user.name}</h1>
                        <p className="text-sm text-slate-500">{user.phone}</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className={`rounded-full px-3 py-1 text-sm font-medium ${connectionBadgeClass}`}>{connectionState}</div>
                        <button
                            onClick={handleLeave}
                            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-600 shadow-sm transition hover:bg-rose-100"
                        >
                            End Call
                        </button>
                    </div>
                </header>
                <div className="relative flex flex-col items-center gap-8 rounded-3xl bg-white/80 p-8 shadow-xl backdrop-blur">
                    {isConnecting && (
                        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-3xl bg-white/70">
                            <span className="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-sky-500" />
                            <p className="text-sm font-medium text-slate-600">Connecting to your AI agent...</p>
                        </div>
                    )}
                    <AgentAvatar state={avatarState} agentName={agentDisplayName} />
                    {connectionError && (
                        <div className="w-full rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
                            {connectionError}
                        </div>
                    )}
                    <ChatTranscript room={room} onUserFinalUtterance={handleUserFinalUtterance} />
                    <div className="flex w-full flex-col gap-4 rounded-2xl border border-slate-100 bg-white/70 p-6 shadow-inner">
                        <div className="flex flex-wrap items-center gap-3">
                            <button
                                onClick={toggleMute}
                                disabled={!room}
                                className={`flex items-center gap-3 rounded-xl px-5 py-3 text-sm font-semibold transition shadow ${
                                    isMuted
                                        ? 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                                        : 'bg-sky-500 text-white hover:bg-sky-400'
                                } disabled:cursor-not-allowed disabled:opacity-50`}
                            >
                                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/40 bg-white/20 text-white/90">
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
                                onClick={handleHandoff}
                                className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm font-semibold text-amber-700 transition hover:bg-amber-100"
                            >
                                Talk to a Human (PRE)
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            {stageButtons.map((stage) => (
                                <button
                                    key={stage.key}
                                    onClick={() => sendStageUpdate(stage.key)}
                                    disabled={!room}
                                    className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow transition hover:border-sky-200 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {stage.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div ref={audioRootRef} className="hidden" aria-hidden />
                </div>
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




