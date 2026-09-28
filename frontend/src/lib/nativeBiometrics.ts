/**
 * Native Biometric Authentication for Capacitor
 * Uses @capgo/capacitor-native-biometric for Face ID/Touch ID on native platforms
 * Stores credentials securely in Keychain (iOS) / Keystore (Android)
 */

import { Capacitor } from '@capacitor/core';
import { NativeBiometric, BiometryType } from '@capgo/capacitor-native-biometric';

const CREDENTIALS_SERVER = 'app.lovable.ignite';

export interface BiometricAvailability {
  isAvailable: boolean;
  biometryType: 'faceId' | 'touchId' | 'fingerprint' | 'iris' | 'none';
  hasCredentials: boolean;
}

/**
 * Check if native biometric authentication is available on this device
 */
export async function checkNativeBiometricAvailability(): Promise<BiometricAvailability> {
  // Only available on native platforms
  if (!Capacitor.isNativePlatform()) {
    return { isAvailable: false, biometryType: 'none', hasCredentials: false };
  }

  try {
    const result = await NativeBiometric.isAvailable();
    
    let biometryType: BiometricAvailability['biometryType'] = 'none';
    if (result.biometryType === BiometryType.FACE_ID) {
      biometryType = 'faceId';
    } else if (result.biometryType === BiometryType.TOUCH_ID) {
      biometryType = 'touchId';
    } else if (result.biometryType === BiometryType.FINGERPRINT) {
      biometryType = 'fingerprint';
    } else if (result.biometryType === BiometryType.IRIS_AUTHENTICATION) {
      biometryType = 'iris';
    }

    // Check if we have stored credentials
    let hasCredentials = false;
    try {
      const creds = await NativeBiometric.getCredentials({ server: CREDENTIALS_SERVER });
      hasCredentials = !!(creds.username && creds.password);
    } catch {
      // No credentials stored
      hasCredentials = false;
    }

    return {
      isAvailable: result.isAvailable,
      biometryType,
      hasCredentials,
    };
  } catch (error) {
    console.log('[NativeBiometric] Error checking availability:', error);
    return { isAvailable: false, biometryType: 'none', hasCredentials: false };
  }
}

/**
 * Get the display name for the biometric type
 */
export function getBiometricDisplayName(biometryType: BiometricAvailability['biometryType']): string {
  switch (biometryType) {
    case 'faceId':
      return 'Face ID';
    case 'touchId':
      return 'Touch ID';
    case 'fingerprint':
      return 'Fingerprint';
    case 'iris':
      return 'Iris';
    default:
      return 'Biometrics';
  }
}

/**
 * Store credentials securely for biometric login
 */
export async function storeCredentialsForBiometric(
  email: string,
  password: string
): Promise<{ success: boolean; error?: string }> {
  if (!Capacitor.isNativePlatform()) {
    return { success: false, error: 'Not on native platform' };
  }

  try {
    // Check if biometrics are available
    const availability = await checkNativeBiometricAvailability();
    if (!availability.isAvailable) {
      return { success: false, error: 'Biometric authentication not available' };
    }

    // Delete any existing credentials first
    try {
      await NativeBiometric.deleteCredentials({ server: CREDENTIALS_SERVER });
    } catch {
      // Ignore - no credentials to delete
    }

    // Store new credentials
    await NativeBiometric.setCredentials({
      username: email,
      password: password,
      server: CREDENTIALS_SERVER,
    });

    console.log('[NativeBiometric] Credentials stored successfully');
    return { success: true };
  } catch (error: any) {
    console.error('[NativeBiometric] Error storing credentials:', error);
    return { success: false, error: error.message || 'Failed to store credentials' };
  }
}

/**
 * Authenticate using biometrics and retrieve stored credentials
 */
export async function authenticateWithNativeBiometric(): Promise<{
  success: boolean;
  email?: string;
  password?: string;
  error?: string;
}> {
  if (!Capacitor.isNativePlatform()) {
    return { success: false, error: 'Not on native platform' };
  }

  try {
    // Check availability first
    const availability = await checkNativeBiometricAvailability();
    if (!availability.isAvailable) {
      return { success: false, error: 'Biometric authentication not available' };
    }
    if (!availability.hasCredentials) {
      return { success: false, error: 'No saved credentials. Please sign in with email first.' };
    }

    // Prompt for biometric authentication
    const biometricName = getBiometricDisplayName(availability.biometryType);
    await NativeBiometric.verifyIdentity({
      reason: `Sign in to Ignite Club HQ`,
      title: `${biometricName} Login`,
      subtitle: 'Verify your identity',
      description: `Use ${biometricName} to access your account`,
      useFallback: true,
      fallbackTitle: 'Use PIN',
    });

    // If we get here, authentication succeeded - retrieve credentials
    const credentials = await NativeBiometric.getCredentials({
      server: CREDENTIALS_SERVER,
    });

    return {
      success: true,
      email: credentials.username,
      password: credentials.password,
    };
  } catch (error: any) {
    console.log('[NativeBiometric] Authentication failed:', error);
    
    // Handle specific error cases
    if (error.code === 'BIOMETRIC_AUTHENTICATION_FAILED' || error.message?.includes('cancel')) {
      return { success: false, error: 'Authentication cancelled' };
    }
    
    return { success: false, error: error.message || 'Biometric authentication failed' };
  }
}

/**
 * Delete stored biometric credentials
 */
export async function deleteStoredCredentials(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    await NativeBiometric.deleteCredentials({ server: CREDENTIALS_SERVER });
    console.log('[NativeBiometric] Credentials deleted');
  } catch {
    // Ignore - no credentials to delete
  }
}

/**
 * Check if there are stored credentials for biometric login
 */
export async function hasStoredCredentials(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;

  try {
    const creds = await NativeBiometric.getCredentials({ server: CREDENTIALS_SERVER });
    return !!(creds.username && creds.password);
  } catch {
    return false;
  }
}
