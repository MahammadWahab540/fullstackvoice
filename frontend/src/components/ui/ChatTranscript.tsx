'use client';

import {
    LocalParticipant,
    ParticipantEvent,
    RemoteParticipant,
    Room,
    RoomEvent,
    Track,
    TrackEvent,
    TrackPublication,
} from 'livekit-client';
import React, { useEffect, useRef, useState } from 'react';

interface ChatTranscriptProps {
    room: Room | null;
}

interface Message {
    identity: string;
    text: string;
    isFinal: boolean;
}

export function ChatTranscript({ room }: ChatTranscriptProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const chatContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!room) return;

        const handleTranscription = (
            transcription: { segments: { text: string; final: boolean }[] },
            participant: LocalParticipant | RemoteParticipant | undefined
        ) => {
            if (!participant) return;

            setMessages((prevMessages) => {
                const newMessages = [...prevMessages];
                let lastMessage = newMessages[newMessages.length - 1];

                if (!lastMessage || lastMessage.identity !== participant.identity || lastMessage.isFinal) {
                    lastMessage = { identity: participant.identity, text: '', isFinal: false };
                    newMessages.push(lastMessage);
                }

                let isFinal = false;
                transcription.segments.forEach((segment) => {
                    lastMessage!.text += segment.text;
                    if (segment.final) {
                        isFinal = true;
                    }
                });

                lastMessage!.isFinal = isFinal;
                return newMessages;
            });
        };

        const handleTrackSubscribed = (track: Track, publication: TrackPublication, participant: RemoteParticipant) => {
            if (track.kind === Track.Kind.Audio) {
                track.on(TrackEvent.TranscriptionReceived, (transcription) =>
                    handleTranscription(transcription, participant)
                );
            }
        };

        const handleLocalTrackPublished = (publication: TrackPublication) => {
            const track = publication.track;
            if (track && track.kind === Track.Kind.Audio) {
                track.on(TrackEvent.TranscriptionReceived, (transcription: any) =>
                    handleTranscription(transcription, room.localParticipant)
                );
            }
        };

        room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
        room.localParticipant.on(ParticipantEvent.LocalTrackPublished, handleLocalTrackPublished);

        return () => {
            room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
            room.localParticipant.off(ParticipantEvent.LocalTrackPublished, handleLocalTrackPublished);
        };
    }, [room]);

    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [messages]);

    if (!room) return null;

    return (
        <div className="bg-gray-800 p-4 rounded-lg shadow-lg h-96 overflow-y-auto" ref={chatContainerRef}>
            <ul className="space-y-4">
                {messages.map((msg, index) => {
                    const isUser = msg.identity === room.localParticipant.identity;
                    return (
                        <li key={index} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                            <div
                                className={`max-w-xs md:max-w-md lg:max-w-lg px-4 py-2 rounded-xl ${
                                    isUser ? 'bg-blue-600 text-white' : 'bg-gray-600 text-white'
                                }`}
                            >
                                <p className="font-bold text-sm mb-1">{isUser ? 'You' : 'Agent'}</p>
                                <p>{msg.text}</p>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

export default ChatTranscript;
