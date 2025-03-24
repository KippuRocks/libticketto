import {
  EventSubscription as IEventSubscription,
  SystemEvent,
} from "@ticketto/protocol";

import { injectable } from "inversify";

type EventCallback<T> = (event: T) => void;

@injectable()
export class EventQueue {
  #subscribers: EventCallback<SystemEvent>[] = [];

  subscribe(subscriber: EventCallback<SystemEvent>) {
    this.#subscribers.push(subscriber);
  }

  depositEvent(event: SystemEvent) {
    for (const subscriber of this.#subscribers) {
      subscriber(event);
    }
  }
}

@injectable()
export class WebStubEventSubscribtion
  implements IEventSubscription<SystemEvent>
{
  constructor(private queue: EventQueue) {}

  on(callback: EventCallback<SystemEvent>): void {
    this.queue.subscribe(callback);
  }
}
