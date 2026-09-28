// Extend ServiceWorkerRegistration to include pushManager
// This is part of the Push API but not included in all TS lib configurations
interface ServiceWorkerRegistration {
  readonly pushManager: PushManager;
}
