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

export interface WebSocketManagerConfig {
  host: string;
  port: number;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  onMessage?: (data: PointCloudData) => void;
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
  private handleMessage(event: MessageEvent): void {
    if (!(event.data instanceof ArrayBuffer)) {
      console.warn('Received non-binary message, ignoring');
      return;
    }

    try {
      const pointCloudData = this.parsePointCloudMessage(event.data);
      this.config.onMessage(pointCloudData);
    } catch (error) {
      console.error('Failed to parse point cloud message:', error);
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
    console.log('Parsing point cloud message, buffer size:', buffer.byteLength);

    const view = new DataView(buffer);

    // Verify magic bytes 'PTCL'
    const magic = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    );

    console.log('Magic bytes:', magic);

    if (magic !== 'PTCL') {
      throw new Error(`Invalid magic bytes: expected 'PTCL', got '${magic}'`);
    }

    // Read point count
    const pointCount = view.getUint32(4, true); // little-endian
    console.log('Point count:', pointCount);

    // Calculate offsets
    const positionsOffset = 8;
    const positionsSize = pointCount * 12; // 3 floats (xyz) * 4 bytes
    const colorsOffset = positionsOffset + positionsSize;
    const colorsSize = pointCount * 3; // 3 bytes (rgb)

    console.log('Data layout:', {
      positionsOffset,
      positionsSize,
      colorsOffset,
      colorsSize,
      expectedTotalSize: colorsOffset + colorsSize,
      actualBufferSize: buffer.byteLength,
    });

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

    console.log('Parsed data:', {
      positionsLength: positions.length,
      colorsLength: colors.length,
      firstPosition: [positions[0], positions[1], positions[2]],
      firstColor: [colors[0], colors[1], colors[2]],
    });

    return {
      pointCount,
      positions,
      colors,
      timestamp: Date.now(),
    };
  }
}
