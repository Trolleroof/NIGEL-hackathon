'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useRef, useState } from 'react';
import { WebSocketManager, PointCloudData, OdometryData, PathData, ConnectionStatus } from '@/lib/websocket-manager';
import { useSlamStore } from '@/store/slam-store';

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
  const breadcrumbLineRef = useRef<any>(null);
  const firefighterMarkerRef = useRef<any>(null);
  const wsManagerRef = useRef<WebSocketManager | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const threeRef = useRef<any>(null);
  const orbitControlsCtorRef = useRef<any>(null);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [pointCount, setPointCount] = useState<number>(0);
  const [lastUpdateTime, setLastUpdateTime] = useState<number>(0);
  const [sceneLoadError, setSceneLoadError] = useState<string | null>(null);

  // Zustand store actions and state
  const setCurrentPosition = useSlamStore((state) => state.setCurrentPosition);
  const setBreadcrumbTrail = useSlamStore((state) => state.setBreadcrumbTrail);
  const waypoints = useSlamStore((state) => state.waypoints);
  const addWaypoint = useSlamStore((state) => state.addWaypoint);

  // Waypoint markers (refs for each waypoint)
  const waypointMarkersRef = useRef<Map<string, any>>(new Map());

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

    // Convert ROS coordinates (Z-up) to Three.js (Y-up)
    // In ROS: X=forward, Y=left, Z=up
    // In Three.js: X=right, Y=up, Z=forward
    const convertedPositions = new Float32Array(data.pointCount * 3);
    for (let i = 0; i < data.pointCount; i++) {
      const rosX = data.positions[i * 3];
      const rosY = data.positions[i * 3 + 1];
      const rosZ = data.positions[i * 3 + 2];

      convertedPositions[i * 3] = rosX;      // Three.js X = ROS X
      convertedPositions[i * 3 + 1] = rosZ;  // Three.js Y = ROS Z
      convertedPositions[i * 3 + 2] = -rosY; // Three.js Z = -ROS Y
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(convertedPositions, 3));

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
    sceneRef.current.add(pointCloud);
    pointCloudRef.current = pointCloud;

    setPointCount(data.pointCount);
    setLastUpdateTime(data.timestamp);
  }, []);

  const handleOdometryData = useCallback((data: OdometryData) => {
    const THREE = threeRef.current;
    if (!THREE || !sceneRef.current) return;

    // Update Zustand store
    setCurrentPosition({
      x: data.x,
      y: data.y,
      z: data.z,
      qx: data.qx,
      qy: data.qy,
      qz: data.qz,
      qw: data.qw,
      timestamp: data.timestamp,
    });

    // Create or update firefighter marker (an upright red cone)
    if (!firefighterMarkerRef.current) {
      const geometry = new THREE.ConeGeometry(0.2, 0.5, 8);
      const material = new THREE.MeshStandardMaterial({
        color: 0xff3131, // Signal red from styling guide
        emissive: 0xff3131,
        emissiveIntensity: 0.5,
      });
      const cone = new THREE.Mesh(geometry, material);

      // Position cone so the tip is at the origin (bottom of cone at firefighter position)
      cone.position.y = 0.25; // Half the cone height

      const markerGroup = new THREE.Group();
      markerGroup.add(cone);

      sceneRef.current.add(markerGroup);
      firefighterMarkerRef.current = markerGroup;
    }

    // Update position - convert ROS coordinates (Z-up) to Three.js (Y-up)
    // In ROS: X=forward, Y=left, Z=up
    // In Three.js: X=right, Y=up, Z=forward
    firefighterMarkerRef.current.position.set(data.x, data.z, -data.y);
  }, [setCurrentPosition]);

  const handlePathData = useCallback((data: PathData) => {
    const THREE = threeRef.current;
    if (!THREE || !sceneRef.current) return;

    // Update Zustand store
    setBreadcrumbTrail({
      positions: data.positions,
      pointCount: data.pointCount,
      timestamp: data.timestamp,
    });

    if (data.pointCount === 0) return;

    // Create or update breadcrumb line
    if (!breadcrumbLineRef.current) {
      const geometry = new THREE.BufferGeometry();
      const material = new THREE.LineBasicMaterial({
        color: 0x00ff88, // Bright green for visibility
        linewidth: 2,
      });
      const line = new THREE.Line(geometry, material);

      sceneRef.current.add(line);
      breadcrumbLineRef.current = line;
    }

    // Convert ROS coordinates (Z-up) to Three.js (Y-up) for breadcrumb positions
    // In ROS: X=forward, Y=left, Z=up
    // In Three.js: X=right, Y=up, Z=forward
    const convertedPositions = new Float32Array(data.pointCount * 3);
    for (let i = 0; i < data.pointCount; i++) {
      const rosX = data.positions[i * 3];
      const rosY = data.positions[i * 3 + 1];
      const rosZ = data.positions[i * 3 + 2];

      convertedPositions[i * 3] = rosX;      // Three.js X = ROS X
      convertedPositions[i * 3 + 1] = rosZ;  // Three.js Y = ROS Z
      convertedPositions[i * 3 + 2] = -rosY; // Three.js Z = -ROS Y
    }

    // Update line geometry
    const geometry = breadcrumbLineRef.current.geometry;
    geometry.setAttribute('position', new THREE.BufferAttribute(convertedPositions, 3));
    geometry.setDrawRange(0, data.pointCount);
    geometry.attributes.position.needsUpdate = true;
    geometry.computeBoundingSphere();
  }, [setBreadcrumbTrail]);

  const initWebSocket = useCallback(() => {
    const wsManager = new WebSocketManager({
      host: wsHost,
      port: wsPort,
      autoReconnect: true,
      reconnectInterval: 3000,
      maxReconnectAttempts: 10,
      onPointCloud: handlePointCloudData,
      onOdometry: handleOdometryData,
      onPath: handlePathData,
      onStatusChange: setConnectionStatus,
      onError: (error) => {
        console.error('WebSocket error:', error);
      },
    });

    wsManager.connect();
    wsManagerRef.current = wsManager;
  }, [wsHost, wsPort, handlePointCloudData, handleOdometryData, handlePathData]);

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

    if (breadcrumbLineRef.current) {
      breadcrumbLineRef.current.geometry.dispose();
      breadcrumbLineRef.current.material.dispose();
      breadcrumbLineRef.current = null;
    }

    if (firefighterMarkerRef.current) {
      firefighterMarkerRef.current.traverse((child: any) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((mat: any) => mat.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      firefighterMarkerRef.current = null;
    }

    // Clean up waypoint markers
    for (const marker of waypointMarkersRef.current.values()) {
      marker.traverse((child: any) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((mat: any) => mat.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    }
    waypointMarkersRef.current.clear();

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

  // Sync waypoints from Zustand store to Three.js scene
  useEffect(() => {
    const THREE = threeRef.current;
    if (!THREE || !sceneRef.current) return;

    // Get current waypoint IDs
    const currentIds = new Set(waypoints.map((w) => w.id));
    const markerIds = new Set(waypointMarkersRef.current.keys());

    // Remove deleted waypoints
    for (const id of markerIds) {
      if (!currentIds.has(id)) {
        const marker = waypointMarkersRef.current.get(id);
        if (marker) {
          sceneRef.current.remove(marker);
          marker.traverse((child: any) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
              if (Array.isArray(child.material)) {
                child.material.forEach((mat: any) => mat.dispose());
              } else {
                child.material.dispose();
              }
            }
          });
          waypointMarkersRef.current.delete(id);
        }
      }
    }

    // Add new waypoints
    for (const waypoint of waypoints) {
      if (!waypointMarkersRef.current.has(waypoint.id)) {
        // Create waypoint marker (a pulsing sphere with crosshair)
        const color = waypoint.type === 'hazard' ? 0xffa500 : 0xff3131;

        const sphereGeometry = new THREE.SphereGeometry(0.15, 16, 16);
        const sphereMaterial = new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.6,
          transparent: true,
          opacity: 0.8,
        });
        const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);

        // Add crosshair ring
        const ringGeometry = new THREE.RingGeometry(0.2, 0.25, 32);
        const ringMaterial = new THREE.MeshBasicMaterial({
          color,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.5,
        });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.rotation.x = -Math.PI / 2;

        const markerGroup = new THREE.Group();
        markerGroup.add(sphere);
        markerGroup.add(ring);

        // Convert ROS coordinates (Z-up) to Three.js (Y-up)
        // Waypoint position is already a THREE.Vector3, so we need to transform it
        markerGroup.position.set(
          waypoint.position.x,   // Three.js X = ROS X
          waypoint.position.z,   // Three.js Y = ROS Z
          -waypoint.position.y   // Three.js Z = -ROS Y
        );

        sceneRef.current.add(markerGroup);
        waypointMarkersRef.current.set(waypoint.id, markerGroup);
      }
    }
  }, [waypoints]);

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
