'use client';

import { useRef, useEffect, useState } from 'react';
import { CameraWebSocket, CameraFrameData, ConnectionStatus } from '@/lib/camera-websocket';

interface CameraWebSocketFeedProps {
  wsHost?: string;
  wsPort?: number;
  className?: string;
  showStatus?: boolean;
}

export default function CameraWebSocketFeed({
  wsHost = process.env.NEXT_PUBLIC_WS_HOST || 'localhost',
  wsPort = parseInt(process.env.NEXT_PUBLIC_WS_PORT_POINTCLOUD || '9090'), // Use unified WebSocket port
  className = '',
  showStatus = false,
}: CameraWebSocketFeedProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const wsRef = useRef<CameraWebSocket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [currentFrame, setCurrentFrame] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState<number>(0);
  const [fps, setFps] = useState<number>(0);
  const lastFrameTimeRef = useRef<number>(0);
  const frameTimesRef = useRef<number[]>([]);

  useEffect(() => {
    // Initialize WebSocket connection
    const ws = new CameraWebSocket({
      host: wsHost,
      port: wsPort,
      autoReconnect: true,
      reconnectInterval: 3000,
      maxReconnectAttempts: 10,
      onFrame: handleFrame,
      onStatusChange: setConnectionStatus,
      onError: (error) => {
        console.error('[CameraFeed] WebSocket error:', error);
      },
    });

    ws.connect();
    wsRef.current = ws;

    // Cleanup on unmount
    return () => {
      if (wsRef.current) {
        wsRef.current.disconnect();
      }
    };
  }, [wsHost, wsPort]);

  /**
   * Handle incoming camera frame
   */
  const handleFrame = (data: CameraFrameData) => {
    setCurrentFrame(data.blobUrl);
    setFrameCount(data.frameNumber);

    // Calculate FPS
    const now = performance.now();
    if (lastFrameTimeRef.current > 0) {
      const frameDelta = now - lastFrameTimeRef.current;
      frameTimesRef.current.push(frameDelta);

      // Keep only last 30 frame times for averaging
      if (frameTimesRef.current.length > 30) {
        frameTimesRef.current.shift();
      }

      // Calculate average FPS
      const avgFrameDelta =
        frameTimesRef.current.reduce((a, b) => a + b, 0) / frameTimesRef.current.length;
      const calculatedFps = 1000 / avgFrameDelta;
      setFps(Math.round(calculatedFps * 10) / 10);
    }

    lastFrameTimeRef.current = now;
  };

  /**
   * Get status indicator color
   */
  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return '#22c55e';
      case 'connecting':
        return '#eab308';
      case 'disconnected':
        return '#666';
      case 'error':
        return '#ff3131';
      default:
        return '#666';
    }
  };

  return (
    <div className={`relative w-full h-full ${className}`}>
      {/* Camera feed */}
      {currentFrame ? (
        <img
          ref={imgRef}
          src={currentFrame}
          alt="Camera feed"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#000',
            color: '#666',
            fontSize: '12px',
            fontFamily: 'monospace',
          }}
        >
          {connectionStatus === 'connecting' && 'CONNECTING...'}
          {connectionStatus === 'disconnected' && 'NO SIGNAL'}
          {connectionStatus === 'error' && 'CONNECTION ERROR'}
        </div>
      )}

      {/* Status overlay (optional) */}
      {showStatus && (
        <div
          style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            background: 'rgba(0, 0, 0, 0.7)',
            padding: '6px 10px',
            borderRadius: '4px',
            fontFamily: 'monospace',
            fontSize: '10px',
            color: '#fff',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: getStatusColor(),
              }}
            />
            <span>{connectionStatus.toUpperCase()}</span>
          </div>
          {connectionStatus === 'connected' && (
            <>
              <div>Frame: {frameCount}</div>
              <div>FPS: {fps.toFixed(1)}</div>
            </>
          )}
          <div style={{ fontSize: '8px', color: '#999', marginTop: '4px' }}>
            {wsHost}:{wsPort}
          </div>
        </div>
      )}
    </div>
  );
}
