/**
 * Hook to project 3D SLAM coordinates to 2D canvas coordinates
 * This bridges the real-time 3D odometry data with the 2D overlay canvas
 */

import { useEffect, useState } from 'react';
import { useSlamStore } from '@/store/slam-store';

interface Pos2D {
  x: number;
  y: number;
}

interface SlamProjection {
  firefighterPosition: Pos2D;
  breadcrumbs: Pos2D[];
}

// Convert 3D ROS coordinates to 2D canvas coordinates
// This is a simple top-down projection (ignoring Z for now)
// You can enhance this to use the actual Three.js camera projection
function project3DTo2D(x: number, y: number, _z: number, canvasWidth: number, canvasHeight: number): Pos2D {
  // Scale factor (adjust based on your map size)
  const scale = 50; // pixels per meter
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;

  return {
    x: centerX + x * scale,
    y: centerY - y * scale, // flip Y for canvas coordinates
  };
}

export function useSlamProjection(canvasWidth: number, canvasHeight: number): SlamProjection {
  const currentPosition = useSlamStore((state) => state.currentPosition);
  const breadcrumbTrail = useSlamStore((state) => state.breadcrumbTrail);

  const [projection, setProjection] = useState<SlamProjection>({
    firefighterPosition: { x: canvasWidth / 2, y: canvasHeight / 2 },
    breadcrumbs: [],
  });

  useEffect(() => {
    // Update firefighter position
    let firefighterPos = { x: canvasWidth / 2, y: canvasHeight / 2 };
    if (currentPosition) {
      firefighterPos = project3DTo2D(
        currentPosition.x,
        currentPosition.y,
        currentPosition.z,
        canvasWidth,
        canvasHeight
      );
    }

    // Update breadcrumbs
    const breadcrumbs: Pos2D[] = [];
    if (breadcrumbTrail && breadcrumbTrail.pointCount > 0) {
      for (let i = 0; i < breadcrumbTrail.pointCount; i++) {
        const x = breadcrumbTrail.positions[i * 3];
        const y = breadcrumbTrail.positions[i * 3 + 1];
        const z = breadcrumbTrail.positions[i * 3 + 2];
        breadcrumbs.push(project3DTo2D(x, y, z, canvasWidth, canvasHeight));
      }
    }

    setProjection({
      firefighterPosition: firefighterPos,
      breadcrumbs,
    });
  }, [currentPosition, breadcrumbTrail, canvasWidth, canvasHeight]);

  return projection;
}
