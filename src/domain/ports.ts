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
  sessions(roomId: string, userId?: string, since?: string): Promise<Work[]>,
  open(roomId: string): Promise<Work[]>,
  recentUsers(roomId: string, since: string): Promise<Array<{ userId: string, name: string }>>,
  activeRooms(since: string): Promise<string[]>
}

export interface PinStore {
  upsert(input: PinDraft): Promise<void>,
  list(roomId: string, limit?: number): Promise<Pin[]>,
  get(roomId: string, eventId: string): Promise<Pin | undefined>,
  remove(roomId: string, eventId: string): Promise<boolean>,
  pinnedEventIds(roomId: string): Promise<string[]>,
  search(roomId: string, query: string, limit: number): Promise<Pin[]>
}

export interface MediaRef {
  roomId: string,
  eventId: string,
  urls: string[],
  ts: string
}

export interface MediaRefStore {
  saveMediaRef(ref: MediaRef): Promise<void>,
  mediaRefUrls(roomId: string, eventId: string): Promise<string[] | null>,
  dropMediaRef(roomId: string, eventId: string): Promise<void>
}

export interface BindingStore {
  bind(provider: string, target: string, roomId: string): Promise<boolean>,
  unbind(provider: string, target: string, roomId: string): Promise<boolean>,
  targets(provider: string, roomId: string): Promise<string[]>,
  chats(provider: string, target: string): Promise<string[]>
}

export interface DeliveryStore {
  record(deliveryId: string, timestamp: string): Promise<boolean>,
  drop(deliveryId: string): Promise<void>
}

export interface SystemStore {
  ping(): Promise<number>,
  deliveries(limit: number): Promise<Delivery[]>,
  recordTransaction(txnId: string, timestamp: string): Promise<boolean>,
  dropTransaction(txnId: string): Promise<void>,
  rateIncr(key: string, frameMs: number): Promise<number>,
  purge(): Promise<void>
}

export interface PollTally {
  question: string,
  options: string[],
  counts: number[]
}

export interface PollStore {
  pollCreate(
    roomId: string,
    eventId: string,
    question: string,
    options: string[],
    createdAt: string
  ): Promise<void>,
  pollVote(
    roomId: string,
    eventId: string,
    optionIndex: number,
    voter: string
  ): Promise<PollTally | null>
}

export interface SubscribeStore {
  subscribeTargets(): Promise<string[]>,
  subscribeAdvance(
    target: string,
    feed: string,
    entryId: string,
    at: string
  ): Promise<string | null>
}

export interface ReadMark {
  roomId: string,
  userId: string,
  eventId: string,
  eventTs: number
}

export interface BurnStore {
  burnRooms(): Promise<string[]>,
  burnEnable(roomId: string, at: string): Promise<void>,
  burnDisable(roomId: string): Promise<boolean>,
  readMarks(roomId: string): Promise<ReadMark[]>,
  upsertReadMark(mark: ReadMark, at: string): Promise<void>,
  stateGet(key: string): Promise<string | null>,
  stateSet(key: string, value: string): Promise<void>
}

export type Stores = WorkStore
  & PinStore
  & MediaRefStore
  & BindingStore
  & DeliveryStore
  & SystemStore
  & PollStore
  & SubscribeStore
  & BurnStore;

export interface BindingProvider {
  id: string,
  label: string,
  targetLabel: string,
  targetLabelPlural: string,
  value: string,
  restricted?: boolean
}
