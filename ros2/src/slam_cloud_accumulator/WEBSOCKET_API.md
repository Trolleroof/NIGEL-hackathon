# WebSocket API — `slam_cloud_accumulator`

## Connection

```
ws://localhost:9090
```

Single endpoint. All message types share the same connection.
Port is configurable via the `ws_port` ROS parameter (default `9090`).

All frames are **binary**. The first 4 bytes are always a plain-ASCII magic
string that identifies the message type. All multi-byte numeric values are
**little-endian**.

---

## Message types

### `PTCL` — Accumulated point cloud

Sent by the node on a timer (default **2 Hz**).
Only sent when at least one client is connected.

**Source ROS topic:** `/odin1/cloud_slam` (accumulated + voxel-filtered into the fixed frame)

```
Offset       Size        Type        Description
──────────────────────────────────────────────────────────────────────────────
0            4           char[4]     Magic: "PTCL"
4            4           uint32 LE   Point count N
8            N × 12      float32[]   XYZ positions — x₀,y₀,z₀ … xₙ,yₙ,zₙ
8 + N×12     N × 3       uint8[]     RGB colours   — r₀,g₀,b₀ … rₙ,gₙ,bₙ
```

Total frame size: `8 + N×15` bytes.

**Three.js decode**

```js
const dv  = new DataView(event.data);
const N   = dv.getUint32(4, true);
const xyz = new Float32Array(event.data, 8, N * 3);
const rgb = new Uint8Array(event.data, 8 + N * 12, N * 3);

// BufferGeometry
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(xyz.slice(), 3));

// Normalise RGB → 0..1 for Three.js vertex colours
const colorsF = new Float32Array(N * 3);
for (let i = 0; i < N * 3; i++) colorsF[i] = rgb[i] / 255;
geo.setAttribute('color', new THREE.BufferAttribute(colorsF, 3));

const cloud = new THREE.Points(geo, new THREE.PointsMaterial({ vertexColors: true, size: 0.02 }));
```

**Parameters**

| ROS parameter            | Default | Description                              |
|--------------------------|---------|------------------------------------------|
| `fixed_frame`            | `odom`  | TF frame for accumulation                |
| `input_topic`            | `/odin1/cloud_slam` | Source point cloud topic      |
| `publish_hz`             | `2.0`   | Broadcast rate (Hz)                      |
| `voxel_size`             | `0.05`  | Voxel filter leaf size (m)               |
| `refilter_every_n_scans` | `10`    | Full re-filter period (scans)            |

---

### `IMAG` — Camera frame (JPEG)

Sent from the image subscription callback, throttled to `image_hz`.
Only sent when at least one client is connected.

**Source ROS topic:** `/odin1/image/undistored` (`sensor_msgs/Image`)

```
Offset   Size          Type      Description
──────────────────────────────────────────────────────────────────────────────
0        4             char[4]   Magic: "IMAG"
4        variable      bytes     Complete JPEG file (self-contained)
```

Total frame size: `4 + sizeof(JPEG)` bytes.

**Three.js decode**

```js
const blob = new Blob([event.data.slice(4)], { type: 'image/jpeg' });
const url  = URL.createObjectURL(blob);
imgElement.onload = () => URL.revokeObjectURL(url);  // free memory
imgElement.src = url;

// To use as a Three.js texture on a mesh:
const tex = new THREE.Texture(imgElement);
imgElement.onload = () => { tex.needsUpdate = true; URL.revokeObjectURL(url); };
imgElement.src = url;
```

**Parameters**

| ROS parameter  | Default                    | Description                          |
|----------------|----------------------------|--------------------------------------|
| `image_topic`  | `/odin1/image/undistored`  | Source image topic                   |
| `image_hz`     | `10.0`                     | Max broadcast rate (Hz); `0` = every frame |
| `jpeg_quality` | `80`                       | JPEG quality 1–100                   |
| `image_scale`  | `1.0`                      | Downscale factor before encoding (e.g. `0.5` = half res) |

---

### `ODOM` — Current pose

Sent from the odometry subscription callback, throttled to `odom_hz`.
Only sent when at least one client is connected.

**Source ROS topic:** `/odin1/odometry` (`nav_msgs/Odometry`)

```
Offset   Size   Type       Description
──────────────────────────────────────────────────────────────────────────────
0        4      char[4]    Magic: "ODOM"
4        4      float32    x  (position, metres)
8        4      float32    y
12       4      float32    z
16       4      float32    qx (orientation quaternion)
20       4      float32    qy
24       4      float32    qz
28       4      float32    qw
```

Total frame size: 32 bytes (fixed).

**Three.js decode**

```js
const dv = new DataView(event.data);
const x  = dv.getFloat32( 4, true);
const y  = dv.getFloat32( 8, true);
const z  = dv.getFloat32(12, true);
const qx = dv.getFloat32(16, true);
const qy = dv.getFloat32(20, true);
const qz = dv.getFloat32(24, true);
const qw = dv.getFloat32(28, true);

robotMesh.position.set(x, y, z);
robotMesh.quaternion.set(qx, qy, qz, qw);
```

**Parameters**

| ROS parameter | Default             | Description                          |
|---------------|---------------------|--------------------------------------|
| `odom_topic`  | `/odin1/odometry`   | Source odometry topic                |
| `odom_hz`     | `20.0`              | Max broadcast rate (Hz); `0` = every message |

---

### `PATH` — Pose history

Sent on a slow timer (default **1 Hz**).
Contains the full accumulated position history of the robot since node start
(or last reset).  Positions are recorded only when the robot moves more than
`min_path_distance` from the previously recorded point, and the buffer is
capped at `max_path_poses` entries (oldest dropped when full).

```
Offset    Size       Type        Description
──────────────────────────────────────────────────────────────────────────────
0         4          char[4]     Magic: "PATH"
4         4          uint32 LE   Pose count N
8         N × 12     float32[]   XYZ positions — x₀,y₀,z₀ … xₙ,yₙ,zₙ
```

Total frame size: `8 + N×12` bytes.

**Three.js decode — render as a line**

```js
const N   = new DataView(event.data).getUint32(4, true);
const xyz = new Float32Array(event.data, 8, N * 3);

// Re-use the same geometry across frames to avoid GC pressure
pathGeo.setAttribute('position', new THREE.BufferAttribute(xyz.slice(), 3));
pathGeo.setDrawRange(0, N);
pathGeo.attributes.position.needsUpdate = true;

// Create once:
// const pathGeo  = new THREE.BufferGeometry();
// const pathLine = new THREE.Line(pathGeo, new THREE.LineBasicMaterial({ color: 0x00ff88 }));
// scene.add(pathLine);
```

**Parameters**

| ROS parameter       | Default | Description                                      |
|---------------------|---------|--------------------------------------------------|
| `path_hz`           | `1.0`   | PATH broadcast rate (Hz)                         |
| `max_path_poses`    | `10000` | Sliding-window cap on stored poses               |
| `min_path_distance` | `0.05`  | Min distance (m) between consecutive path points |

---

## Full client-side dispatcher

```js
const ws = new WebSocket('ws://localhost:9090');
ws.binaryType = 'arraybuffer';

ws.onopen  = () => console.log('connected');
ws.onclose = () => console.log('disconnected');

ws.onmessage = ({ data }) => {
  const magic = new TextDecoder().decode(new Uint8Array(data, 0, 4));

  switch (magic) {
    case 'PTCL': handleCloud(data); break;
    case 'IMAG': handleImage(data); break;
    case 'ODOM': handleOdom(data);  break;
    case 'PATH': handlePath(data);  break;
    default: console.warn('unknown frame type:', magic);
  }
};
```

---

## Reset service

Clears the accumulated point cloud **and** the path history.
Call via the ROS 2 service (not over WebSocket):

```bash
ros2 service call /slam_cloud_accumulator/reset std_srvs/srv/Trigger {}
```

---

## Timing summary

| Message | Trigger              | Default rate |
|---------|----------------------|--------------|
| `PTCL`  | Wall timer           | 2 Hz         |
| `IMAG`  | Image callback       | ≤ 10 Hz      |
| `ODOM`  | Odometry callback    | ≤ 20 Hz      |
| `PATH`  | Wall timer           | 1 Hz         |

All rates are tunable via ROS parameters at launch:

```bash
ros2 run slam_cloud_accumulator slam_cloud_accumulator \
  --ros-args \
  -p ws_port:=9090 \
  -p publish_hz:=2.0 \
  -p image_hz:=10.0 \
  -p jpeg_quality:=80 \
  -p image_scale:=1.0 \
  -p odom_hz:=20.0 \
  -p path_hz:=1.0 \
  -p max_path_poses:=10000 \
  -p min_path_distance:=0.05
```
