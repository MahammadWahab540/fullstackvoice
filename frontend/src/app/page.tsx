'use client'; // This line is crucial for Next.js

import React, { useState } from 'react';
import { Room } from 'livekit-client';

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';
const roomName = process.env.NEXT_PUBLIC_LIVEKIT_ROOM_NAME ?? 'test-call';
const participantIdentity = process.env.NEXT_PUBLIC_LIVEKIT_IDENTITY ?? 'Parent';

export default function HomePage() {
    // State to manage the LiveKit room and connection status
    const [room, setRoom] = useState<Room | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);

    // Function to connect to the LiveKit room
    const connectToRoom = async () => {
        try {
            setIsConnecting(true);

            const tokenUrl = new URL('/get-token', backendUrl);
            tokenUrl.searchParams.set('room_name', roomName);
            tokenUrl.searchParams.set('identity', participantIdentity);

            const response = await fetch(tokenUrl.toString());
            if (!response.ok) {
                throw new Error(`Failed to fetch token: ${response.status} ${response.statusText}`);
            }

            const data: { token?: string; livekit_url?: string } = await response.json();
            if (!data.token) {
                throw new Error('Backend response did not include a token');
            }
            if (!data.livekit_url) {
                throw new Error('Backend response did not include a LiveKit URL');
            }

            // 2. Create a new room object
            const newRoom = new Room();
            setRoom(newRoom);

            // Set up your browser's microphone
            await newRoom.prepareAudio();

            // 3. Connect to the LiveKit room using the URL returned by the backend
            await newRoom.connect(data.livekit_url, data.token);

            // 4. Publish your microphone audio so the agent can hear you
            await newRoom.localParticipant.setMicrophoneEnabled(true);

            setIsConnected(true);
            console.log('Successfully connected to LiveKit room!');
        } catch (error) {
            console.error('Connection failed:', error);
            alert('Failed to connect to the call. Make sure your backend server and agent are running.');
        } finally {
            setIsConnecting(false);
        }
    };

    // Function to send a stage command to your Python agent
    const sendStageUpdate = (stage: string) => {
        if (!room) return;
        const message = JSON.stringify({ stage });
        const encoder = new TextEncoder();
        room.localParticipant.publishData(encoder.encode(message), { reliable: true });
        console.log(`Sent stage update to agent: ${stage}`);
    };

    return (
        <main className="flex flex-col items-center justify-center min-h-screen p-8 bg-gray-900 text-white">
            <div className="w-full max-w-md text-center">
                <h1 className="text-4xl font-bold mb-8 text-blue-400">NxtWave Onboarding Call</h1>

                {!isConnected ? (
                    <button
                        onClick={connectToRoom}
                        disabled={isConnecting}
                        className="w-full px-8 py-4 bg-blue-600 text-white rounded-lg text-xl font-semibold hover:bg-blue-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {isConnecting ? 'Connecting...' : 'Start Call'}
                    </button>
                ) : (
                    <div className="p-6 bg-gray-800 rounded-lg shadow-lg">
                        <div className="flex items-center justify-center text-green-400 mb-6">
                            <svg className="w-8 h-8 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                            <p className="text-xl font-medium">Connected to the call!</p>
                        </div>
                        <h2 className="text-lg font-semibold mb-4 text-gray-400">Control Agent Stages:</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <button onClick={() => sendStageUpdate('introduction')} className="px-4 py-2 bg-gray-700 text-white rounded-md hover:bg-gray-600">
                                1. Introduction
                            </button>
                            <button onClick={() => sendStageUpdate('payment')} className="px-4 py-2 bg-gray-700 text-white rounded-md hover:bg-gray-600">
                                2. Payment
                            </button>
                            <button onClick={() => sendStageUpdate('kyc')} className="px-4 py-2 bg-gray-700 text-white rounded-md hover:bg-gray-600">
                                3. KYC Process
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </main>
    );
}
