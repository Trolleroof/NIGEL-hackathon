/**
 * SLAM Store - Real-time state management for FireCommand/NIGEL
 * Manages firefighter position, breadcrumb trail, and waypoints
 */

import { create } from 'zustand';
import * as THREE from 'three';

export interface FirefighterPosition {
  x: number;
  y: number;
  z: number;
  qx: number;  // quaternion
  qy: number;
  qz: number;
  qw: number;
  timestamp: number;
}

export interface BreadcrumbTrail {
  positions: Float32Array;
  pointCount: number;
  timestamp: number;
}

export interface Waypoint {
  id: string;
  position: THREE.Vector3;
  label: string;
  type: 'hazard' | 'objective' | 'exit' | 'incident';
  timestamp: number;
}

interface SlamState {
  // Firefighter position
  currentPosition: FirefighterPosition | null;
  setCurrentPosition: (position: FirefighterPosition) => void;

  // Breadcrumb trail
  breadcrumbTrail: BreadcrumbTrail | null;
  setBreadcrumbTrail: (trail: BreadcrumbTrail) => void;

  // Waypoints
  waypoints: Waypoint[];
  addWaypoint: (waypoint: Waypoint) => void;
  removeWaypoint: (id: string) => void;
  clearWaypoints: () => void;

  // Connection status
  isReceivingOdom: boolean;
  isReceivingPath: boolean;
  setReceivingOdom: (receiving: boolean) => void;
  setReceivingPath: (receiving: boolean) => void;
}

export const useSlamStore = create<SlamState>((set) => ({
  // Initial state
  currentPosition: null,
  breadcrumbTrail: null,
  waypoints: [],
  isReceivingOdom: false,
  isReceivingPath: false,

  // Actions
  setCurrentPosition: (position) => {
    set({ currentPosition: position, isReceivingOdom: true });
  },

  setBreadcrumbTrail: (trail) => {
    set({ breadcrumbTrail: trail, isReceivingPath: true });
  },

  addWaypoint: (waypoint) => {
    set((state) => ({
      waypoints: [...state.waypoints, waypoint],
    }));
  },

  removeWaypoint: (id) => {
    set((state) => ({
      waypoints: state.waypoints.filter((w) => w.id !== id),
    }));
  },

  clearWaypoints: () => {
    set({ waypoints: [] });
  },

  setReceivingOdom: (receiving) => {
    set({ isReceivingOdom: receiving });
  },

  setReceivingPath: (receiving) => {
    set({ isReceivingPath: receiving });
  },
}));
