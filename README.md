# NIGEL

**Navigation, Incident Guidance, and Emergency Localization & Control** — a mission-control style interface for the Future Interfaces hackathon. It turns VSLAM (visual mapping) data and radio-style audio into a live 3D tactical view so dispatch can see where units are and what they’re reporting.

Think of it as **air traffic control, but for firefighters on a floor plan**: multiple video feeds, a growing 3D map from the helmet rig, and a radio panel that can drive what you see on the map.

## What’s in this repo

| Path | Role |
|------|------|
| [`frontend/`](frontend/) | Next.js app: dispatcher dashboard, Three.js point-cloud view, WebSocket feeds, API routes |
| [`ros2/`](ros2/) | ROS 2 workspace: Odin driver, SLAM cloud accumulator, launch files |
| [`features.md`](features.md) | Product / UX spec (panels, semantic radio, stretch goals) |

### Frontend highlights

- **Dispatcher** (`/dispatcher`) — multi-unit viewports, central 3D map, blueprint search, radio / transcript UX  
- **Firefighter** (`/firefighter`) — field-facing UI  
- **WebSockets** — live SLAM / camera data; see [`frontend/docs/WEBSOCKET_ARCHITECTURE.md`](frontend/docs/WEBSOCKET_ARCHITECTURE.md) and [`ros2/src/slam_cloud_accumulator/WEBSOCKET_API.md`](ros2/src/slam_cloud_accumulator/WEBSOCKET_API.md)

### ROS 2 packages

- **`odin_ros_driver`** — depth / point cloud pipeline for Odin hardware ([package README](ros2/src/odin_ros_driver/README.md))  
- **`slam_cloud_accumulator`** — accumulates SLAM clouds for streaming to the web stack

## Prerequisites

- **Node.js** 20+ (matches frontend tooling)  
- **ROS 2** (Jazzy or your team’s distro) for the `ros2/` workspace  
- Optional: TLS certs under `frontend/certificates/` for HTTPS dev (otherwise the dev server falls back to HTTP — see `frontend/server.js`)

## Quick start — web UI

```bash
cd frontend
npm install
npm run dev          # HTTPS if certs exist, else HTTP on :3000
# or: npm run dev:http   # plain Next dev server
```

Open [http://localhost:3000](http://localhost:3000) or [https://localhost:3000](https://localhost:3000) depending on your setup.

More detail: [`frontend/README.md`](frontend/README.md).

## Quick start — ROS 2 (outline)

From the `ros2` workspace root (after installing ROS 2 and dependencies):

```bash
cd ros2
source /opt/ros/<distro>/setup.bash
colcon build
source install/setup.bash
# Launch files live under ros2/src/odin_ros_driver/launch_ROS2/
```

Use the scripts in `ros2/src/odin_ros_driver/script/` if your environment expects them.

## License / third-party

The Odin driver subtree includes its own license; see `ros2/src/odin_ros_driver/LICENSE`.
