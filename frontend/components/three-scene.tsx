'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WebSocketManager, PointCloudData, ConnectionStatus } from '@/lib/websocket-manager';

interface ThreeSceneProps {
  wsHost?: string;
  wsPort?: number;
  className?: string;
}

export default function ThreeScene({
  wsHost = process.env.NEXT_PUBLIC_WS_HOST || 'localhost',
  wsPort = parseInt(process.env.NEXT_PUBLIC_WS_PORT_POINTCLOUD || '9090'),
  className = '',
}: ThreeSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const pointCloudRef = useRef<THREE.Points | null>(null);
  const wsManagerRef = useRef<WebSocketManager | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [pointCount, setPointCount] = useState<number>(0);
  const [lastUpdateTime, setLastUpdateTime] = useState<number>(0);

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize Three.js scene
    initScene();

    // Initialize WebSocket connection
    initWebSocket();

    // Start animation loop
    animate();

    // Cleanup on unmount
    return () => {
      cleanup();
    };
  }, [wsHost, wsPort]);

  /**
   * Initialize Three.js scene, camera, renderer, and controls
   */
  const initScene = () => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Create scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a); // Dark background
    sceneRef.current = scene;

    // Create camera
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.set(5, 5, 5);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Create renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Create orbit controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 1;
    controls.maxDistance = 100;
    controls.maxPolarAngle = Math.PI;
    controlsRef.current = controls;

    // Add grid helper
    const gridHelper = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
    scene.add(gridHelper);

    // Add axes helper
    const axesHelper = new THREE.AxesHelper(5);
    scene.add(axesHelper);

    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    // Add directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.4);
    directionalLight.position.set(5, 10, 5);
    scene.add(directionalLight);

    // Handle window resize
    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;

      const newWidth = containerRef.current.clientWidth;
      const newHeight = containerRef.current.clientHeight;

      cameraRef.current.aspect = newWidth / newHeight;
      cameraRef.current.updateProjectionMatrix();

      rendererRef.current.setSize(newWidth, newHeight);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  };

  /**
   * Initialize WebSocket connection for point cloud data
   */
  const initWebSocket = () => {
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
  };

  /**
   * Handle incoming point cloud data from WebSocket
   */
  const handlePointCloudData = (data: PointCloudData) => {
    if (!sceneRef.current) return;

    // Remove old point cloud if it exists
    if (pointCloudRef.current) {
      sceneRef.current.remove(pointCloudRef.current);
      pointCloudRef.current.geometry.dispose();
      if (Array.isArray(pointCloudRef.current.material)) {
        pointCloudRef.current.material.forEach(mat => mat.dispose());
      } else {
        pointCloudRef.current.material.dispose();
      }
    }

    // Create new point cloud geometry
    const geometry = new THREE.BufferGeometry();

    // Set position attribute
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(data.positions, 3)
    );

    // Convert RGB colors (0-255) to normalized colors (0-1)
    const normalizedColors = new Float32Array(data.colors.length);
    for (let i = 0; i < data.colors.length; i++) {
      normalizedColors[i] = data.colors[i] / 255;
    }

    // Set color attribute
    geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(normalizedColors, 3)
    );

    // Compute bounding sphere for proper camera frustum culling
    geometry.computeBoundingSphere();

    // Create point cloud material
    const material = new THREE.PointsMaterial({
      size: 0.05,
      vertexColors: true,
      sizeAttenuation: true,
    });

    // Create point cloud mesh
    const pointCloud = new THREE.Points(geometry, material);
    sceneRef.current.add(pointCloud);
    pointCloudRef.current = pointCloud;

    // Update stats
    setPointCount(data.pointCount);
    setLastUpdateTime(data.timestamp);
  };

  /**
   * Animation loop
   */
  const animate = () => {
    animationFrameRef.current = requestAnimationFrame(animate);

    if (controlsRef.current) {
      controlsRef.current.update();
    }

    if (sceneRef.current && cameraRef.current && rendererRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  };

  /**
   * Cleanup resources
   */
  const cleanup = () => {
    // Stop animation loop
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    // Disconnect WebSocket
    if (wsManagerRef.current) {
      wsManagerRef.current.disconnect();
    }

    // Dispose Three.js resources
    if (pointCloudRef.current) {
      pointCloudRef.current.geometry.dispose();
      if (Array.isArray(pointCloudRef.current.material)) {
        pointCloudRef.current.material.forEach(mat => mat.dispose());
      } else {
        pointCloudRef.current.material.dispose();
      }
    }

    if (rendererRef.current) {
      rendererRef.current.dispose();
      if (containerRef.current?.contains(rendererRef.current.domElement)) {
        containerRef.current.removeChild(rendererRef.current.domElement);
      }
    }

    if (controlsRef.current) {
      controlsRef.current.dispose();
    }
  };

  /**
   * Get status indicator color
   */
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
      {/* Three.js container */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Status overlay */}
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
      </div>

      {/* Controls hint */}
      <div className="absolute bottom-4 right-4 bg-black/80 text-white px-4 py-2 rounded-lg text-xs font-mono">
        <div>Left click: Rotate</div>
        <div>Right click: Pan</div>
        <div>Scroll: Zoom</div>
      </div>
    </div>
  );
}
