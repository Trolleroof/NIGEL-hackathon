/**
 * WebSocket Manager for FireCommand/NIGEL
 * Handles WebSocket connections with auto-reconnect and binary message parsing
 */

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface PointCloudData {
  pointCount: number;
  positions: Float32Array;
  colors: Uint8Array;
  timestamp: number;
}

export interface OdometryData {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  timestamp: number;
}

export interface PathData {
  pointCount: number;
  positions: Float32Array;
  timestamp: number;
}

export interface ImageData {
  jpegBlob: Blob;
  timestamp: number;
}

type BinaryFrameType = 'PTCL' | 'IMAG' | 'ODOM' | 'PATH' | 'UNKNOWN';

export interface WebSocketManagerConfig {
  host: string;
  port: number;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  onPointCloud?: (data: PointCloudData) => void;
  onOdometry?: (data: OdometryData) => void;
  onPath?: (data: PathData) => void;
  onImage?: (data: ImageData) => void;
  onMessage?: (data: PointCloudData) => void; // deprecated, use onPointCloud
  onStatusChange?: (status: ConnectionStatus) => void;
  onError?: (error: Event) => void;
}

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private config: Required<WebSocketManagerConfig>;
  private reconnectAttempts = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private status: ConnectionStatus = 'disconnected';

  constructor(config: WebSocketManagerConfig) {
    this.config = {
      autoReconnect: true,
      reconnectInterval: 3000,
      maxReconnectAttempts: 10,
      onPointCloud: config.onMessage || (() => {}), // backward compatibility
      onOdometry: () => {},
      onPath: () => {},
      onImage: () => {},
      onMessage: () => {},
      onStatusChange: () => {},
      onError: () => {},
      ...config,
    };
  }

  /**
   * Connect to WebSocket server
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.warn('WebSocket already connected');
      return;
    }

    const url = `ws://${this.config.host}:${this.config.port}`;
    console.log(`Connecting to WebSocket: ${url}`);

    this.updateStatus('connecting');

    try {
      this.ws = new WebSocket(url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
      this.ws.onerror = this.handleError.bind(this);
      this.ws.onclose = this.handleClose.bind(this);
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this.updateStatus('error');
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.updateStatus('disconnected');
    this.reconnectAttempts = 0;
  }

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * Handle WebSocket open event
   */
  private handleOpen(): void {
    console.log('WebSocket connected');
    this.reconnectAttempts = 0;
    this.updateStatus('connected');
  }

  /**
   * Handle WebSocket message event
   */
  private async handleMessage(event: MessageEvent): Promise<void> {
    const buffer = await this.toArrayBuffer(event.data);
    if (!buffer) return;

    const frameType = this.getBinaryFrameType(buffer);

    try {
      switch (frameType) {
        case 'PTCL': {
          const data = this.parsePointCloudMessage(buffer);
          this.config.onPointCloud?.(data);
          this.config.onMessage?.(data); // backward compatibility
          break;
        }
        case 'ODOM': {
          const data = this.parseOdometryMessage(buffer);
          this.config.onOdometry?.(data);
          break;
        }
        case 'PATH': {
          const data = this.parsePathMessage(buffer);
          this.config.onPath?.(data);
          break;
        }
        case 'IMAG': {
          const data = this.parseImageMessage(buffer);
          this.config.onImage?.(data);
          break;
        }
        default:
          console.warn(`Unknown frame type: ${frameType}`);
      }
    } catch (error) {
      console.error(`Failed to parse ${frameType} message:`, error);
    }
  }

  /**
   * Handle WebSocket error event
   */
  private handleError(event: Event): void {
    console.error('WebSocket error:', event);
    this.updateStatus('error');
    this.config.onError(event);
  }

  /**
   * Handle WebSocket close event
   */
  private handleClose(): void {
    console.log('WebSocket closed');
    this.updateStatus('disconnected');
    this.scheduleReconnect();
  }

  /**
   * Schedule automatic reconnection
   */
  private scheduleReconnect(): void {
    if (!this.config.autoReconnect) {
      return;
    }

    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      this.updateStatus('error');
      return;
    }

    this.reconnectAttempts++;
    console.log(
      `Scheduling reconnect attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts} in ${this.config.reconnectInterval}ms`
    );

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, this.config.reconnectInterval);
  }

  /**
   * Update connection status and notify listeners
   */
  private updateStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.config.onStatusChange(status);
    }
  }

  private async toArrayBuffer(payload: unknown): Promise<ArrayBuffer | null> {
    if (payload instanceof ArrayBuffer) return payload;

    if (typeof Blob !== 'undefined' && payload instanceof Blob) {
      return payload.arrayBuffer();
    }

    if (typeof payload === 'string') {
      return null;
    }

    return null;
  }

  private getBinaryFrameType(buffer: ArrayBuffer): BinaryFrameType {
    if (buffer.byteLength < 4) return 'UNKNOWN';

    const view = new DataView(buffer);
    const magic = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3),
    );

    if (magic === 'PTCL' || magic === 'IMAG' || magic === 'ODOM' || magic === 'PATH') {
      return magic;
    }

    return 'UNKNOWN';
  }

  /**
   * Parse binary point cloud message with 'PTCL' format
   *
   * Format:
   * [0..3]         char[4]    'PTCL' (magic bytes)
   * [4..7]         uint32     Point count N
  * [8..8+N*12)    float32[]  XYZ positions (x0,y0,z0, x1,y1,z1, ...)
  * [8+N*12..)     uint8[]    RGB colors (r0,g0,b0, r1,g1,b1, ...)
  */
  private parsePointCloudMessage(buffer: ArrayBuffer): PointCloudData {
    const view = new DataView(buffer);

    // Verify magic bytes 'PTCL'
    const magic = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    );

    if (magic !== 'PTCL') {
      throw new Error(`Invalid magic bytes: expected 'PTCL', got '${magic}'`);
    }

    // Read point count
    const pointCount = view.getUint32(4, true); // little-endian

    // Calculate offsets
    const positionsOffset = 8;
    const positionsSize = pointCount * 12; // 3 floats (xyz) * 4 bytes
    const colorsOffset = positionsOffset + positionsSize;
    const colorsSize = pointCount * 3; // 3 bytes (rgb)

    // Validate buffer size
    const expectedSize = colorsOffset + colorsSize;
    if (buffer.byteLength < expectedSize) {
      throw new Error(
        `Buffer size mismatch: expected at least ${expectedSize} bytes, got ${buffer.byteLength}`
      );
    }

    // Extract positions (Float32Array)
    const positions = new Float32Array(
      buffer,
      positionsOffset,
      pointCount * 3
    );

    // Extract colors (Uint8Array)
    const colors = new Uint8Array(
      buffer,
      colorsOffset,
      pointCount * 3
    );

    return {
      pointCount,
      positions,
      colors,
      timestamp: Date.now(),
    };
  }

  /**
   * Parse binary odometry message with 'ODOM' format
   *
   * Format:
   * [0..3]    char[4]     'ODOM' (magic bytes)
   * [4..7]    float32     x (position, metres)
   * [8..11]   float32     y
   * [12..15]  float32     z
   * [16..19]  float32     qx (orientation quaternion)
   * [20..23]  float32     qy
   * [24..27]  float32     qz
   * [28..31]  float32     qw
   */
  private parseOdometryMessage(buffer: ArrayBuffer): OdometryData {
    const view = new DataView(buffer);

    // Verify magic bytes 'ODOM'
    const magic = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    );

    if (magic !== 'ODOM') {
      throw new Error(`Invalid magic bytes: expected 'ODOM', got '${magic}'`);
    }

    // Validate buffer size (32 bytes fixed)
    if (buffer.byteLength < 32) {
      throw new Error(
        `Buffer size mismatch: expected 32 bytes, got ${buffer.byteLength}`
      );
    }

    return {
      x: view.getFloat32(4, true),
      y: view.getFloat32(8, true),
      z: view.getFloat32(12, true),
      qx: view.getFloat32(16, true),
      qy: view.getFloat32(20, true),
      qz: view.getFloat32(24, true),
      qw: view.getFloat32(28, true),
      timestamp: Date.now(),
    };
  }

  /**
   * Parse binary path message with 'PATH' format
   *
   * Format:
   * [0..3]       char[4]     'PATH' (magic bytes)
   * [4..7]       uint32      Pose count N
   * [8..8+N*12)  float32[]   XYZ positions (x0,y0,z0 … xn,yn,zn)
   */
  private parsePathMessage(buffer: ArrayBuffer): PathData {
    const view = new DataView(buffer);

    // Verify magic bytes 'PATH'
    const magic = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    );

    if (magic !== 'PATH') {
      throw new Error(`Invalid magic bytes: expected 'PATH', got '${magic}'`);
    }

    // Read point count
    const pointCount = view.getUint32(4, true); // little-endian

    // Calculate size
    const positionsOffset = 8;
    const positionsSize = pointCount * 12; // 3 floats (xyz) * 4 bytes

    // Validate buffer size
    const expectedSize = positionsOffset + positionsSize;
    if (buffer.byteLength < expectedSize) {
      throw new Error(
        `Buffer size mismatch: expected at least ${expectedSize} bytes, got ${buffer.byteLength}`
      );
    }

    // Extract positions (Float32Array)
    const positions = new Float32Array(
      buffer,
      positionsOffset,
      pointCount * 3
    );

    return {
      pointCount,
      positions,
      timestamp: Date.now(),
    };
  }

  /**
   * Parse binary image message with 'IMAG' format
   *
   * Format:
   * [0..3]      char[4]  'IMAG' (magic bytes)
   * [4..)       bytes    Complete JPEG file
   */
  private parseImageMessage(buffer: ArrayBuffer): ImageData {
    const view = new DataView(buffer);

    // Verify magic bytes 'IMAG'
    const magic = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    );

    if (magic !== 'IMAG') {
      throw new Error(`Invalid magic bytes: expected 'IMAG', got '${magic}'`);
    }

    // Extract JPEG data (skip 4-byte header)
    const jpegData = buffer.slice(4);
    const jpegBlob = new Blob([jpegData], { type: 'image/jpeg' });

    return {
      jpegBlob,
      timestamp: Date.now(),
    };
  }
}
