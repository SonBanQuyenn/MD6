import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

/** Phải khớp với backend/src/realtime/realtime.events.ts */
export const WS_EVENTS = {
  SUBSCRIBE: 'order:subscribe',
  STATUS: 'order:status',
} as const;

export interface OrderStatusEvent {
  orderId: string;
  code: string;
  status: string;
  statusLabel: string;
  paymentStatus: string;
  note: string | null;
  at: string;
}

export type TrackingState =
  | 'connecting'
  | 'live' // đã kết nối + đã đăng ký theo dõi
  | 'reconnecting'
  | 'forbidden'
  | 'unauthorized';

interface Options {
  /** Trả access token MỚI NHẤT — gọi lại ở mỗi lần kết nối lại (token có thể đã được refresh). */
  getToken: () => string | null;
  onStatus: (event: OrderStatusEvent) => void;
  /** Gọi sau mỗi lần kết nối lại: tải lại đơn qua REST để bù sự kiện bị lỡ khi mất mạng. */
  onResync?: () => void;
}

/**
 * F02 — Theo dõi 1 đơn hàng theo thời gian thực.
 *  - Socket.IO tự kết nối lại khi mất mạng (backoff 1s → 10s).
 *  - MỖI lần kết nối (kể cả kết nối lại) đều gửi lại `order:subscribe`, vì phòng (room) ở server
 *    gắn với kết nối cũ đã mất (F02.4).
 *  - Sau khi kết nối lại → onResync() để lấy trạng thái mới nhất qua REST.
 */
export function useOrderTracking(
  orderId: string | undefined,
  options: Options,
): TrackingState {
  const [state, setState] = useState<TrackingState>('connecting');
  // Giữ callback mới nhất mà không phải kết nối lại mỗi lần component render.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!orderId) return;
    let connectedBefore = false;

    const socket = io({
      path: '/api/socket.io',
      // auth dạng hàm → mỗi lần (kết nối lại) đều lấy token mới nhất
      auth: (cb) => cb({ token: optionsRef.current.getToken() ?? '' }),
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    });

    socket.on('connect', async () => {
      try {
        const ack = await socket
          .timeout(5_000)
          .emitWithAck(WS_EVENTS.SUBSCRIBE, { orderId });
        if (!ack.ok) {
          setState('forbidden');
          socket.disconnect();
          return;
        }
        setState('live');
        if (connectedBefore) optionsRef.current.onResync?.();
        connectedBefore = true;
      } catch {
        // mất kết nối giữa chừng → lần 'connect' sau sẽ đăng ký lại
      }
    });

    socket.on(WS_EVENTS.STATUS, (event: OrderStatusEvent) => {
      if (event.orderId === orderId) optionsRef.current.onStatus(event);
    });

    socket.on('disconnect', () => setState('reconnecting'));

    socket.on('connect_error', (error) => {
      if (error.message === 'UNAUTHORIZED') {
        // Token hết hạn/sai: thử lại sau khi app refresh token (auth là hàm nên lấy token mới).
        setState('unauthorized');
      } else {
        setState('reconnecting');
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [orderId]);

  return state;
}
