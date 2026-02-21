'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useRef, useState } from 'react';
import { WebSocketManager, PointCloudData, ConnectionStatus } from '@/lib/websocket-manager';

interface ThreeSceneProps {
  wsHost?: string;
  wsPort?: number;
  className?: string;
  showOverlay?: boolean;
}

const THREE_CDN_URL = 'https://esm.sh/three@0.183.1';
const ORBIT_CDN_URL = 'https://esm.sh/three@0.183.1/examples/jsm/controls/OrbitControls.js';

export default function ThreeScene({
  wsHost = process.env.NEXT_PUBLIC_WS_HOST || 'localhost',
  wsPort = parseInt(process.env.NEXT_PUBLIC_WS_PORT_POINTCLOUD || '9090'),
  className = '',
  showOverlay = true,
}: ThreeSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const rendererRef = useRef<any>(null);
  const controlsRef = useRef<any>(null);
  const pointCloudRef = useRef<any>(null);
  const wsManagerRef = useRef<WebSocketManager | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const threeRef = useRef<any>(null);
  const orbitControlsCtorRef = useRef<any>(null);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [pointCount, setPointCount] = useState<number>(0);
  const [lastUpdateTime, setLastUpdateTime] = useState<number>(0);
  const [sceneLoadError, setSceneLoadError] = useState<string | null>(null);

  const handlePointCloudData = useCallback((data: PointCloudData) => {
    const THREE = threeRef.current;
    if (!THREE || !sceneRef.current) return;

    // Remove old point cloud if it exists
    if (pointCloudRef.current) {
      sceneRef.current.remove(pointCloudRef.current);
      pointCloudRef.current.geometry.dispose();
      if (Array.isArray(pointCloudRef.current.material)) {
        pointCloudRef.current.material.forEach((mat: any) => mat.dispose());
      } else {
        pointCloudRef.current.material.dispose();
      }
    }

    if (data.pointCount === 0) {
      setPointCount(0);
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));

    const normalizedColors = new Float32Array(data.colors.length);
    for (let i = 0; i < data.colors.length; i += 1) {
      normalizedColors[i] = data.colors[i] / 255;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(normalizedColors, 3));
    geometry.computeBoundingSphere();

    const material = new THREE.PointsMaterial({
      size: 0.05,
      vertexColors: true,
      sizeAttenuation: true,
    });

    const pointCloud = new THREE.Points(geometry, material);
    // Convert ROS Z-up coordinates to Three.js Y-up.
    pointCloud.rotation.x = -Math.PI / 2;
    sceneRef.current.add(pointCloud);
    pointCloudRef.current = pointCloud;

    setPointCount(data.pointCount);
    setLastUpdateTime(data.timestamp);
  }, []);

  const initWebSocket = useCallback(() => {
    const wsManager = new WebSocketManager({
      host: wsHost,
      port: wsPort,
      autoReconnect: true,
      reconnectInterval: 3000,
      maxReconnectAttempts: 10,
      onMessage: handlePointCloudData,
      onStatusChange: setConnectionStatus,
      onError: (error) => {
        console.error('WebSocket error:', error);
      },
    });

    wsManager.connect();
    wsManagerRef.current = wsManager;
  }, [wsHost, wsPort, handlePointCloudData]);

  const animate = useCallback(() => {
    animationFrameRef.current = requestAnimationFrame(animate);

    if (controlsRef.current) {
      controlsRef.current.update();
    }

    if (sceneRef.current && cameraRef.current && rendererRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  }, []);

  const cleanup = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (wsManagerRef.current) {
      wsManagerRef.current.disconnect();
      wsManagerRef.current = null;
    }

    if (pointCloudRef.current) {
      pointCloudRef.current.geometry.dispose();
      if (Array.isArray(pointCloudRef.current.material)) {
        pointCloudRef.current.material.forEach((mat: any) => mat.dispose());
      } else {
        pointCloudRef.current.material.dispose();
      }
      pointCloudRef.current = null;
    }

    if (rendererRef.current) {
      rendererRef.current.dispose();
      if (containerRef.current?.contains(rendererRef.current.domElement)) {
        containerRef.current.removeChild(rendererRef.current.domElement);
      }
      rendererRef.current = null;
    }

    if (controlsRef.current) {
      controlsRef.current.dispose();
      controlsRef.current = null;
    }

    sceneRef.current = null;
    cameraRef.current = null;
  }, []);

  const initializeScene = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return () => {};

    const threeModule = await import(/* webpackIgnore: true */ THREE_CDN_URL);
    const orbitModule = await import(/* webpackIgnore: true */ ORBIT_CDN_URL);

    const THREE = threeModule;
    const OrbitControls = orbitModule.OrbitControls;
    if (!THREE?.Scene || !OrbitControls) {
      throw new Error('Failed to load three.js runtime modules');
    }

    threeRef.current = THREE;
    orbitControlsCtorRef.current = OrbitControls;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.set(5, 5, 5);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new orbitControlsCtorRef.current(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 1;
    controls.maxDistance = 100;
    controls.maxPolarAngle = Math.PI;
    controlsRef.current = controls;

    const gridHelper = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
    scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(5);
    scene.add(axesHelper);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.4);
    directionalLight.position.set(5, 10, 5);
    scene.add(directionalLight);

    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      const newWidth = containerRef.current.clientWidth;
      const newHeight = containerRef.current.clientHeight;
      cameraRef.current.aspect = newWidth / newHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(newWidth, newHeight);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    let mounted = true;
    let resizeCleanup: (() => void) | null = null;

    const init = async () => {
      try {
        setSceneLoadError(null);
        resizeCleanup = await initializeScene();
        if (!mounted) return;
        initWebSocket();
        animate();
      } catch (error) {
        console.error('Failed to initialize three.js scene:', error);
        if (!mounted) return;
        setSceneLoadError('three.js failed to load in this environment');
      }
    };

    void init();

    return () => {
      mounted = false;
      if (resizeCleanup) resizeCleanup();
      cleanup();
    };
  }, [initializeScene, initWebSocket, animate, cleanup]);

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'bg-green-500';
      case 'connecting':
        return 'bg-yellow-500';
      case 'disconnected':
        return 'bg-gray-500';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  return (
    <div className={`relative w-full h-full ${className}`}>
      <div ref={containerRef} className="w-full h-full" />

      {showOverlay && (
        <>
          <div className="absolute top-4 left-4 bg-black/80 text-white px-4 py-2 rounded-lg text-sm font-mono space-y-1">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
              <span>WebSocket: {connectionStatus}</span>
            </div>
            <div>Points: {pointCount.toLocaleString()}</div>
            {lastUpdateTime > 0 && (
              <div>
                Last update: {new Date(lastUpdateTime).toLocaleTimeString()}
              </div>
            )}
            <div className="text-xs text-gray-400 mt-2">
              {wsHost}:{wsPort}
            </div>
            {sceneLoadError && (
              <div className="text-xs text-red-400 mt-2">
                {sceneLoadError}
              </div>
            )}
          </div>

          <div className="absolute bottom-4 right-4 bg-black/80 text-white px-4 py-2 rounded-lg text-xs font-mono">
            <div>Left click: Rotate</div>
            <div>Right click: Pan</div>
            <div>Scroll: Zoom</div>
          </div>
        </>
      )}

      {!showOverlay && sceneLoadError && (
        <div className="absolute top-2 right-2 bg-black/80 text-red-400 px-2 py-1 rounded text-xs font-mono">
          {sceneLoadError}
        </div>
      )}
    </div>
  );
}
