/**
 * Camera WebSocket Manager for FireCommand/NIGEL
 * Handles MJPEG video stream over WebSocket
 */

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface CameraFrameData {
  frameNumber: number;
  timestamp: number;
  jpegData: Blob;
  blobUrl: string;
}

export interface CameraWebSocketConfig {
  host: string;
  port: number;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  onFrame?: (data: CameraFrameData) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
  onError?: (error: Event) => void;
}

export class CameraWebSocket {
  private ws: WebSocket | null = null;
  private config: Required<CameraWebSocketConfig>;
  private reconnectAttempts = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private status: ConnectionStatus = 'disconnected';
  private previousBlobUrl: string | null = null;

  constructor(config: CameraWebSocketConfig) {
    this.config = {
      autoReconnect: true,
      reconnectInterval: 3000,
      maxReconnectAttempts: 10,
      onFrame: () => {},
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
      console.warn('[CameraWS] Already connected');
      return;
    }

    const url = `ws://${this.config.host}:${this.config.port}`;
    console.log(`[CameraWS] Connecting to: ${url}`);

    this.updateStatus('connecting');

    try {
      this.ws = new WebSocket(url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
      this.ws.onerror = this.handleError.bind(this);
      this.ws.onclose = this.handleClose.bind(this);
    } catch (error) {
      console.error('[CameraWS] Failed to create WebSocket:', error);
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

    // Revoke previous blob URL to prevent memory leak
    if (this.previousBlobUrl) {
      URL.revokeObjectURL(this.previousBlobUrl);
      this.previousBlobUrl = null;
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
    console.log('[CameraWS] Connected');
    this.reconnectAttempts = 0;
    this.updateStatus('connected');
  }

  /**
   * Handle WebSocket message event
   */
  private async handleMessage(event: MessageEvent): Promise<void> {
    const buffer = await this.toArrayBuffer(event.data);
    if (!buffer) {
      console.warn('[CameraWS] Received non-binary message');
      return;
    }

    try {
      const frameData = this.parseCameraFrame(buffer);

      // Revoke previous blob URL before creating new one
      if (this.previousBlobUrl) {
        URL.revokeObjectURL(this.previousBlobUrl);
      }

      this.previousBlobUrl = frameData.blobUrl;
      this.config.onFrame(frameData);
    } catch (error) {
      console.error('[CameraWS] Failed to parse camera frame:', error);
    }
  }

  /**
   * Handle WebSocket error event
   */
  private handleError(event: Event): void {
    console.error('[CameraWS] Error:', event);
    this.updateStatus('error');
    this.config.onError(event);
  }

  /**
   * Handle WebSocket close event
   */
  private handleClose(): void {
    console.log('[CameraWS] Closed');
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
      console.error('[CameraWS] Max reconnect attempts reached');
      this.updateStatus('error');
      return;
    }

    this.reconnectAttempts++;
    console.log(
      `[CameraWS] Scheduling reconnect attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts} in ${this.config.reconnectInterval}ms`
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
   * Convert message payload to ArrayBuffer
   */
  private async toArrayBuffer(payload: unknown): Promise<ArrayBuffer | null> {
    if (payload instanceof ArrayBuffer) return payload;

    if (typeof Blob !== 'undefined' && payload instanceof Blob) {
      return payload.arrayBuffer();
    }

    return null;
  }

  /**
   * Parse binary camera frame message with 'IMAG' format
   * (from slam_cloud_accumulator)
   *
   * Format:
   * [0..3]         char[4]    'IMAG' (magic bytes)
   * [4..)          uint8[]    Complete JPEG file
   */
  private parseCameraFrame(buffer: ArrayBuffer): CameraFrameData {
    const view = new DataView(buffer);

    // Verify magic bytes 'IMAG'
    const magic = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    );

    if (magic !== 'IMAG') {
      throw new Error(`[CameraWS] Invalid magic bytes: expected 'IMAG', got '${magic}'`);
    }

    // Extract JPEG data (everything after the 4-byte magic header)
    const jpegData = new Blob(
      [new Uint8Array(buffer, 4)],
      { type: 'image/jpeg' }
    );

    // Create blob URL for display
    const blobUrl = URL.createObjectURL(jpegData);

    // Generate frame number and timestamp locally (not in protocol)
    const frameNumber = Date.now(); // Use timestamp as frame number
    const timestamp = Date.now();

    return {
      frameNumber,
      timestamp,
      jpegData,
      blobUrl,
    };
  }
}
