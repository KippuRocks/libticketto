export interface EventSubscription<T> {
  /// Informs the subscriber whenever a relevant new event is pushed.
  on(callback: (event: T) => void): void;
}
