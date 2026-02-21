# WebSocket Architecture - FireCommand/NIGEL

## Overview

The FireCommand frontend uses a **unified WebSocket connection** to the `slam_cloud_accumulator` ROS2 node running on the ThinkPad. This single connection streams all sensor data types.

## Connection

```
ws://192.168.1.100:9090
```

**Single endpoint** - All message types share the same connection.

## Message Types

All messages are **binary** with a 4-byte ASCII magic header identifying the type:

### 1. `PTCL` - Point Cloud Data
- **Rate**: 2 Hz (configurable)
- **Source**: `/odin1/cloud_slam` (accumulated + voxel-filtered)
- **Frontend Component**: `<ThreeScene />` in `/components/three-scene.tsx`
- **WebSocket Manager**: `/lib/websocket-manager.ts`

**Format**:
```
[0..3]         char[4]    'PTCL'
[4..7]         uint32     Point count N
[8..8+N*12)    float32[]  XYZ positions (x,y,z ...)
[8+N*12..)     uint8[]    RGB colors (r,g,b ...)
```

### 2. `IMAG` - Camera Frames (JPEG)
- **Rate**: ≤10 Hz (configurable, throttled)
- **Source**: `/odin1/image/undistored` (sensor_msgs/Image)
- **Frontend Component**: `<CameraWebSocketFeed />` in `/components/camera-websocket-feed.tsx`
- **WebSocket Manager**: `/lib/camera-websocket.ts`

**Format**:
```
[0..3]    char[4]    'IMAG'
[4..)     bytes      Complete JPEG file
```

**Frontend usage**:
```tsx
const blob = new Blob([data.slice(4)], { type: 'image/jpeg' });
const url = URL.createObjectURL(blob);
imgElement.src = url;
```

### 3. `ODOM` - Current Pose (Coming in Phase 3)
- **Rate**: ≤20 Hz (configurable, throttled)
- **Source**: `/odin1/odometry` (nav_msgs/Odometry)

**Format**:
```
[0..3]     char[4]     'ODOM'
[4..7]     float32     x position
[8..11]    float32     y position
[12..15]   float32     z position
[16..19]   float32     qx quaternion
[20..23]   float32     qy quaternion
[24..27]   float32     qz quaternion
[28..31]   float32     qw quaternion
```

### 4. `PATH` - Breadcrumb Trail (Coming in Phase 3)
- **Rate**: 1 Hz
- **Contains**: Full position history since node start

**Format**:
```
[0..3]       char[4]     'PATH'
[4..7]       uint32      Pose count N
[8..8+N*12)  float32[]   XYZ positions (x,y,z ...)
```

## Backend Configuration

### Running slam_cloud_accumulator

```bash
cd /Users/sohummehta/math-notes/ros2
source install/setup.bash

ros2 run slam_cloud_accumulator slam_cloud_accumulator \
  --ros-args \
  -p ws_port:=9090 \
  -p publish_hz:=2.0 \
  -p image_topic:=/odin1/image/undistored \
  -p image_hz:=10.0 \
  -p jpeg_quality:=80 \
  -p odom_hz:=20.0 \
  -p path_hz:=1.0
```

### Firewall Setup

```bash
sudo ufw allow 9090/tcp
```

## Frontend Implementation

### Current (Phase 1 & 2)

1. **Point Cloud**: Uses dedicated WebSocket connection for PTCL messages
   - Component: `<ThreeScene />`
   - Manager: `websocket-manager.ts`

2. **Camera Feed**: Uses dedicated WebSocket connection for IMAG messages
   - Component: `<CameraWebSocketFeed />`
   - Manager: `camera-websocket.ts`

Both connect to **port 9090** but handle different message types.

### Future Optimization

For better efficiency, we could create a **unified WebSocket manager** that:
- Opens one connection to port 9090
- Dispatches messages to handlers based on magic bytes
- Reduces connection overhead

Example:
```typescript
const ws = new WebSocket('ws://192.168.1.100:9090');
ws.binaryType = 'arraybuffer';

ws.onmessage = ({ data }) => {
  const magic = String.fromCharCode(
    data[0], data[1], data[2], data[3]
  );

  switch (magic) {
    case 'PTCL': handlePointCloud(data); break;
    case 'IMAG': handleCameraFrame(data); break;
    case 'ODOM': handleOdometry(data); break;
    case 'PATH': handlePath(data); break;
  }
};
```

## Network Setup

### Two-Computer Architecture

```
ThinkPad (ROS2)              Display Computer (Next.js)
IP: 192.168.1.100            IP: 192.168.1.101
├─ slam_cloud_accumulator    └─ Frontend (localhost:3000)
│  └─ WebSocket :9090           ├─ ThreeScene → ws://192.168.1.100:9090
│     ├─ PTCL (2 Hz)            ├─ CameraFeed → ws://192.168.1.100:9090
│     ├─ IMAG (10 Hz)           └─ (Future: Odometry, Path)
│     ├─ ODOM (20 Hz)
│     └─ PATH (1 Hz)
```

## Bandwidth Usage

- **Point cloud**: ~100-400 KB/s @ 2 Hz
- **Camera feed**: ~225-450 KB/s @ 10 Hz
- **Odometry**: ~0.6 KB/s @ 20 Hz
- **Path**: ~1-5 KB/s @ 1 Hz
- **Total**: ~325-850 KB/s (2.6-6.8 Mbps) ✓ WiFi sufficient

## Troubleshooting

### No data on frontend

1. Check backend is running:
   ```bash
   ros2 node list | grep slam_cloud_accumulator
   ```

2. Check topics are publishing:
   ```bash
   ros2 topic hz /odin1/cloud_slam
   ros2 topic hz /odin1/image/undistored
   ```

3. Check firewall:
   ```bash
   sudo ufw status | grep 9090
   ```

4. Test WebSocket connection:
   ```bash
   nc -zv 192.168.1.100 9090
   ```

5. Check browser console for WebSocket errors

### High bandwidth usage

Reduce rates in slam_cloud_accumulator:
```bash
ros2 param set /slam_cloud_accumulator image_hz 5.0
ros2 param set /slam_cloud_accumulator publish_hz 1.0
```

## References

- Backend API: `/ros2/src/slam_cloud_accumulator/WEBSOCKET_API.md`
- Point Cloud Manager: `/frontend/lib/websocket-manager.ts`
- Camera Manager: `/frontend/lib/camera-websocket.ts`
- Three.js Scene: `/frontend/components/three-scene.tsx`
- Camera Feed: `/frontend/components/camera-websocket-feed.tsx`
