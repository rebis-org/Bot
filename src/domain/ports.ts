import type {
  CheckInDraft,
  CheckOutDraft,
  ClosedSession,
  Work
} from './work.ts';
import type { Pin, PinDraft } from './pin.ts';

export interface Delivery {
  deliveryId: string,
  createdAt: string
}

export interface WorkStore {
  checkIn(input: CheckInDraft): Promise<boolean>,
  checkOut(input: CheckOutDraft): Promise<ClosedSession | null>,
  sessions(chatId: number, userId?: number, since?: string): Promise<Work[]>,
  open(chatId: number): Promise<Work[]>,
  recentUsers(chatId: number, since: string): Promise<Array<{ userId: number, name: string }>>
}

export interface PinStore {
  upsert(input: PinDraft): Promise<void>,
  list(chatId: number, limit?: number): Promise<Pin[]>,
  get(chatId: number, messageId: number): Promise<Pin | undefined>,
  remove(chatId: number, messageId: number, timestamp: string): Promise<boolean>,
  search(chatId: number, query: string, limit: number): Promise<Pin[]>
}

export interface BindingStore {
  bind(provider: string, target: string, chatId: number): Promise<void>,
  unbind(provider: string, target: string, chatId: number): Promise<boolean>,
  targets(provider: string, chatId: number): Promise<string[]>,
  chats(provider: string, target: string): Promise<number[]>
}

export interface DeliveryStore {
  record(deliveryId: string, timestamp: string): Promise<boolean>,
  drop(deliveryId: string): Promise<void>
}

export interface SystemStore {
  ping(): Promise<number>,
  deliveries(limit: number): Promise<Delivery[]>,
  purge(): Promise<void>
}

export type Stores = WorkStore & PinStore & BindingStore & DeliveryStore & SystemStore;

export interface BindingProvider {
  id: string,
  label: string,
  targetLabel: string,
  targetLabelPlural: string,
  value: string
}
