// Notification sound and browser notification utilities

// Create a simple notification sound using Web Audio API
let audioContext: AudioContext | null = null;

export const playNotificationSound = () => {
  try {
    if (!audioContext) {
      audioContext = new AudioContext();
    }

    // Create a pleasant notification tone
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Use a soft, pleasant frequency
    oscillator.frequency.setValueAtTime(830, audioContext.currentTime);
    oscillator.type = 'sine';

    // Envelope for soft sound
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.05);
    gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.3);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);

    // Second tone for a pleasant "ding-ding"
    setTimeout(() => {
      if (!audioContext) return;
      const osc2 = audioContext.createOscillator();
      const gain2 = audioContext.createGain();

      osc2.connect(gain2);
      gain2.connect(audioContext.destination);

      osc2.frequency.setValueAtTime(1046, audioContext.currentTime);
      osc2.type = 'sine';

      gain2.gain.setValueAtTime(0, audioContext.currentTime);
      gain2.gain.linearRampToValueAtTime(0.2, audioContext.currentTime + 0.05);
      gain2.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.25);

      osc2.start(audioContext.currentTime);
      osc2.stop(audioContext.currentTime + 0.25);
    }, 150);
  } catch (error) {
    console.log('Could not play notification sound:', error);
  }
};

// Browser notification permission state
export const getNotificationPermission = (): 'granted' | 'denied' | 'default' | 'unsupported' => {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return window.Notification.permission;
};

// Request browser notification permission
export const requestNotificationPermission = async (): Promise<boolean> => {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    console.log('Browser does not support notifications');
    return false;
  }

  if (window.Notification.permission === 'granted') {
    return true;
  }

  if (window.Notification.permission === 'denied') {
    return false;
  }

  const permission = await window.Notification.requestPermission();
  return permission === 'granted';
};

// Show browser notification with vibration for mobile
export const showBrowserNotification = (title: string, body: string, onClick?: () => void) => {
  // Check if we're in a browser environment
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return;
  }

  // Try to vibrate the device (works on mobile)
  try {
    if ('vibrate' in navigator) {
      navigator.vibrate([200, 100, 200]); // Vibrate pattern
    }
  } catch (e) {
    console.log('Vibration not supported');
  }

  if (!('Notification' in window)) {
    console.log('Browser does not support notifications');
    return;
  }
  
  if (window.Notification.permission !== 'granted') {
    console.log('Notification permission not granted');
    return;
  }

  try {
    const notification = new window.Notification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: `ignite-${Date.now()}`, // Unique tag to allow multiple notifications
      requireInteraction: true, // Keep notification visible until user interacts
      silent: false, // Allow sound
    });

    if (onClick) {
      notification.onclick = () => {
        window.focus();
        onClick();
        notification.close();
      };
    }

    // Auto close after 10 seconds
    setTimeout(() => notification.close(), 10000);
  } catch (error) {
    console.log('Could not show notification:', error);
    
    // Fallback: Try using Service Worker notification if available
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(registration => {
        registration.showNotification(title, {
          body,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: `ignite-${Date.now()}`,
          requireInteraction: true,
        } as NotificationOptions);
      }).catch(e => console.log('SW notification failed:', e));
    }
  }
};

// Combined notification function
export const notifyUser = (message: string, onClick?: () => void) => {
  playNotificationSound();
  showBrowserNotification('Ignite', message, onClick);
};
