import { useState, useCallback, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';
import { 
  checkNativeBiometricAvailability, 
  authenticateWithNativeBiometric,
  storeCredentialsForBiometric,
  deleteStoredCredentials,
  BiometricAvailability
} from '@/lib/nativeBiometrics';

// WebAuthn utilities
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64UrlToBase64(base64url: string): string {
  // Convert base64url to standard base64
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  while (base64.length % 4) {
    base64 += '=';
  }
  return base64;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // Handle both base64url and standard base64
  const standardBase64 = base64UrlToBase64(base64);
  const binary = atob(standardBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Check if WebAuthn is available
export function isWebAuthnAvailable(): boolean {
  return !!(
    window.PublicKeyCredential &&
    typeof window.PublicKeyCredential === 'function'
  );
}

// Check if platform authenticator (biometrics) is available
// On native platforms, uses native biometrics; on web, uses WebAuthn
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  // On native platforms, check for native biometrics
  if (Capacitor.isNativePlatform()) {
    const availability = await checkNativeBiometricAvailability();
    console.log('[Passkey] Native biometric availability:', availability);
    return availability.isAvailable;
  }
  
  // On web, check for WebAuthn
  if (!isWebAuthnAvailable()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// Export native biometric availability check for detailed info
export async function getNativeBiometricInfo(): Promise<BiometricAvailability | null> {
  if (!Capacitor.isNativePlatform()) return null;
  return await checkNativeBiometricAvailability();
}

// Storage keys
const PASSKEY_ACCOUNTS_KEY = 'ignite_passkey_accounts';
const REMEMBER_ME_KEY = 'ignite_remember_me';
const LAST_USED_ACCOUNT_KEY = 'ignite_last_used_account';

// Account interface for stored passkey accounts
export interface PasskeyAccount {
  email: string;
  displayName?: string;
  addedAt: string;
}

// Get all stored passkey accounts.
// Defensive: reject non-array payloads and malformed entries so callers only
// ever see well-formed PasskeyAccount records. Never throws.
export function getStoredPasskeyAccounts(): PasskeyAccount[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const stored = localStorage.getItem(PASSKEY_ACCOUNTS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    const valid: PasskeyAccount[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const email = rec.email;
      const addedAt = rec.addedAt;
      if (typeof email !== 'string' || email.length === 0) continue;
      if (typeof addedAt !== 'string' || addedAt.length === 0) continue;
      const displayName = rec.displayName;
      if (displayName !== undefined && typeof displayName !== 'string') continue;
      const clean: PasskeyAccount = { email, addedAt };
      if (typeof displayName === 'string') clean.displayName = displayName;
      valid.push(clean);
    }
    return valid;
  } catch {
    return [];
  }
}

// Set all passkey accounts (used for syncing from database)
export function setStoredPasskeyAccounts(accounts: PasskeyAccount[]): void {
  try {
    localStorage.setItem(PASSKEY_ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    // Ignore storage errors
  }
}

// Add a passkey account
export function addStoredPasskeyAccount(email: string, displayName?: string): void {
  try {
    const accounts = getStoredPasskeyAccounts();
    // Check if account already exists
    const existingIndex = accounts.findIndex(a => a.email.toLowerCase() === email.toLowerCase());
    if (existingIndex >= 0) {
      // Update existing account
      accounts[existingIndex] = {
        email,
        displayName: displayName || accounts[existingIndex].displayName,
        addedAt: accounts[existingIndex].addedAt,
      };
    } else {
      // Add new account
      accounts.push({
        email,
        displayName,
        addedAt: new Date().toISOString(),
      });
    }
    localStorage.setItem(PASSKEY_ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    // Ignore storage errors
  }
}

// Remove a passkey account
export function removeStoredPasskeyAccount(email: string): void {
  try {
    const accounts = getStoredPasskeyAccounts();
    const filtered = accounts.filter(a => a.email.toLowerCase() !== email.toLowerCase());
    localStorage.setItem(PASSKEY_ACCOUNTS_KEY, JSON.stringify(filtered));
  } catch {
    // Ignore storage errors
  }
}

// Get last used account email
export function getLastUsedAccount(): string | null {
  try {
    return localStorage.getItem(LAST_USED_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

// Set last used account email
export function setLastUsedAccount(email: string | null): void {
  try {
    if (email) {
      localStorage.setItem(LAST_USED_ACCOUNT_KEY, email);
    } else {
      localStorage.removeItem(LAST_USED_ACCOUNT_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

// Legacy function for backward compatibility - returns first stored email
export function getStoredPasskeyEmail(): string | null {
  const accounts = getStoredPasskeyAccounts();
  if (accounts.length === 0) return null;
  // Return last used or first account
  const lastUsed = getLastUsedAccount();
  if (lastUsed) {
    const found = accounts.find(a => a.email.toLowerCase() === lastUsed.toLowerCase());
    if (found) return found.email;
  }
  return accounts[0].email;
}

export function getRememberMe(): boolean {
  try {
    return localStorage.getItem(REMEMBER_ME_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setRememberMe(value: boolean) {
  try {
    if (value) {
      localStorage.setItem(REMEMBER_ME_KEY, 'true');
    } else {
      localStorage.removeItem(REMEMBER_ME_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export const PASSKEY_IN_PROGRESS_ERROR = 'A passkey operation is already in progress';

export function usePasskey() {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [accounts, setAccounts] = useState<PasskeyAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nativeBiometricInfo, setNativeBiometricInfo] = useState<BiometricAvailability | null>(null);
  // Synchronous re-entry guard — set BEFORE any await so concurrent callers
  // are rejected without invoking Edge Functions, opening WebAuthn or
  // mutating any state on the active operation.
  const operationInFlightRef = useRef(false);

  // Refresh accounts list
  const refreshAccounts = useCallback(async () => {
    const storedAccounts = getStoredPasskeyAccounts();
    setAccounts(storedAccounts);
    
    // For native platforms, check if we have stored credentials
    if (Capacitor.isNativePlatform()) {
      const biometricInfo = await checkNativeBiometricAvailability();
      setNativeBiometricInfo(biometricInfo);
      setIsRegistered(biometricInfo.hasCredentials);
    } else {
      setIsRegistered(storedAccounts.length > 0);
    }
  }, []);

  // Check availability on mount
  useEffect(() => {
    const checkAvailability = async () => {
      const available = await isPlatformAuthenticatorAvailable();
      setIsAvailable(available);
      refreshAccounts();
    };
    checkAvailability();
  }, [refreshAccounts]);

  // Register a new passkey for the current user (WebAuthn - web only)
  // For native, use storeCredentialsForNativeBiometric instead
  const registerPasskey = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    // Synchronous concurrency guard — reject before touching state, Edge
    // Functions, or WebAuthn.
    if (operationInFlightRef.current) {
      return { success: false, error: PASSKEY_IN_PROGRESS_ERROR };
    }
    operationInFlightRef.current = true;
    setLoading(true);
    setError(null);

    try {
      // Native platforms don't support WebAuthn passkeys
      if (Capacitor.isNativePlatform()) {
        throw new Error('Use storeCredentialsForNativeBiometric for native platforms');
      }
      
      // Get current session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('You must be logged in to register a passkey');
      }

      // Request registration options from server
      const { data: optionsData, error: optionsError } = await supabase.functions.invoke(
        'passkey-register',
        {
          body: { action: 'get-options' },
        }
      );

      if (optionsError || !optionsData?.options) {
        throw new Error(optionsData?.error || 'Failed to get registration options');
      }

      const options = optionsData.options;

      // Create credential using WebAuthn API
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: base64ToArrayBuffer(options.challenge),
          rp: {
            name: options.rp.name,
            id: options.rp.id,
          },
          user: {
            id: base64ToArrayBuffer(options.user.id),
            name: options.user.name,
            displayName: options.user.displayName,
          },
          pubKeyCredParams: options.pubKeyCredParams,
          timeout: options.timeout || 60000,
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred',
          },
          attestation: 'none',
        },
      }) as PublicKeyCredential | null;

      if (!credential) {
        throw new Error('Credential creation was cancelled');
      }

      const response = credential.response as AuthenticatorAttestationResponse;

      // Send credential to server for verification
      const { data: verifyData, error: verifyError } = await supabase.functions.invoke(
        'passkey-register',
        {
          body: {
            action: 'verify',
            credential: {
              id: credential.id,
              rawId: arrayBufferToBase64(credential.rawId),
              response: {
                clientDataJSON: arrayBufferToBase64(response.clientDataJSON),
                attestationObject: arrayBufferToBase64(response.attestationObject),
              },
              type: credential.type,
            },
          },
        }
      );

      if (verifyError || !verifyData?.success) {
        throw new Error(verifyData?.error || 'Failed to verify passkey');
      }

      // Add account to stored list
      const email = session.user.email || '';
      const displayName = session.user.user_metadata?.full_name || session.user.user_metadata?.name || email;
      addStoredPasskeyAccount(email, displayName);
      setLastUsedAccount(email);
      refreshAccounts();
      
      return { success: true };
    } catch (err: any) {
      const message = err.name === 'NotAllowedError' 
        ? 'Passkey registration was cancelled or timed out'
        : err.message || 'Failed to register passkey';
      setError(message);
      return { success: false, error: message };
    } finally {
      setLoading(false);
      operationInFlightRef.current = false;
    }
  }, [refreshAccounts]);

  // Authenticate with passkey - supports both email-based and discoverable credentials
  // On native platforms, uses native biometrics with stored credentials
  const authenticateWithPasskey = useCallback(async (email?: string): Promise<{ 
    success: boolean; 
    error?: string;
    userEmail?: string;
  }> => {
    // Synchronous concurrency guard — reject before touching state, Edge
    // Functions, or WebAuthn. Blocked callers must not open biometric
    // prompts or mutate the active operation.
    if (operationInFlightRef.current) {
      return { success: false, error: PASSKEY_IN_PROGRESS_ERROR };
    }
    operationInFlightRef.current = true;
    setLoading(true);
    setError(null);

    try {
      // On native platforms, use native biometric authentication
      if (Capacitor.isNativePlatform()) {
        console.log('[Passkey] Using native biometric authentication');
        
        const result = await authenticateWithNativeBiometric();
        
        if (!result.success) {
          throw new Error(result.error || 'Biometric authentication failed');
        }
        
        // Sign in with the stored credentials
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: result.email!,
          password: result.password!,
        });
        
        if (signInError) {
          // If credentials are invalid, clear them
          if (signInError.message.includes('Invalid login') || signInError.message.includes('Invalid')) {
            await deleteStoredCredentials();
            await refreshAccounts();
            throw new Error('Stored credentials are no longer valid. Please sign in with your password.');
          }
          throw signInError;
        }
        
        return { success: true, userEmail: result.email };
      }
      
      // Web: Use WebAuthn passkeys
      const { data: optionsData, error: optionsError } = await supabase.functions.invoke(
        'passkey-authenticate',
        {
          body: { action: 'get-options', email: email || undefined },
        }
      );

      if (optionsError || !optionsData?.options) {
        throw new Error(optionsData?.error || 'Failed to get authentication options');
      }

      const options = optionsData.options;
      const isDiscoverable = optionsData.discoverable === true;

      console.log('[Passkey] Authenticating with', isDiscoverable ? 'discoverable credentials' : `email: ${email}`);

      // Get credential using WebAuthn API
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: base64ToArrayBuffer(options.challenge),
          rpId: options.rpId,
          allowCredentials: options.allowCredentials?.length > 0 
            ? options.allowCredentials.map((cred: any) => ({
                id: base64ToArrayBuffer(cred.id),
                type: cred.type,
                transports: cred.transports,
              }))
            : undefined,
          timeout: options.timeout || 60000,
          userVerification: 'required',
        },
      }) as PublicKeyCredential | null;

      if (!credential) {
        throw new Error('Authentication was cancelled');
      }

      const response = credential.response as AuthenticatorAssertionResponse;

      const { data: verifyData, error: verifyError } = await supabase.functions.invoke(
        'passkey-authenticate',
        {
          body: {
            action: 'verify',
            email: email,
            credential: {
              id: credential.id,
              rawId: arrayBufferToBase64(credential.rawId),
              response: {
                clientDataJSON: arrayBufferToBase64(response.clientDataJSON),
                authenticatorData: arrayBufferToBase64(response.authenticatorData),
                signature: arrayBufferToBase64(response.signature),
                userHandle: response.userHandle ? arrayBufferToBase64(response.userHandle) : null,
              },
              type: credential.type,
            },
          },
        }
      );

      if (verifyError || !verifyData?.success) {
        throw new Error(verifyData?.error || 'Failed to verify passkey');
      }

      // A verified passkey MUST be accompanied by a full Supabase session.
      // If the backend does not return usable access/refresh tokens, or if
      // setSession rejects them, treat the whole attempt as an authentication
      // failure — do NOT mark success, do NOT update last-used account.
      const sess = verifyData.session;
      const accessToken = sess?.access_token;
      const refreshToken = sess?.refresh_token;
      if (
        !sess ||
        typeof accessToken !== 'string' || accessToken.length === 0 ||
        typeof refreshToken !== 'string' || refreshToken.length === 0
      ) {
        throw new Error('Passkey verification succeeded but no valid session was returned');
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (sessionError) {
        throw new Error('Passkey verification succeeded but no valid session was returned');
      }

      if (email) {
        setLastUsedAccount(email);
      }

      return { success: true, userEmail: verifyData.userEmail };
    } catch (err: any) {
      const message = err.name === 'NotAllowedError'
        ? 'Passkey authentication was cancelled or timed out'
        : err.message || 'Failed to authenticate with passkey';
      setError(message);
      return { success: false, error: message };
    } finally {
      setLoading(false);
      operationInFlightRef.current = false;
    }
  }, [refreshAccounts]);

  // Store credentials for native biometric login (call after successful email/password login)
  const storeCredentialsForNativeBiometric = useCallback(async (
    email: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!Capacitor.isNativePlatform()) {
      return { success: false, error: 'Not on native platform' };
    }
    
    const result = await storeCredentialsForBiometric(email, password);
    if (result.success) {
      await refreshAccounts();
    }
    return result;
  }, [refreshAccounts]);

  // Remove passkey account from local storage
  const removeAccount = useCallback(async (email: string) => {
    // On native, also delete stored credentials
    if (Capacitor.isNativePlatform()) {
      await deleteStoredCredentials();
    }
    removeStoredPasskeyAccount(email);
    await refreshAccounts();
  }, [refreshAccounts]);

  // Clear all passkey registrations (client-side only)
  const clearPasskey = useCallback(async () => {
    try {
      localStorage.removeItem(PASSKEY_ACCOUNTS_KEY);
      localStorage.removeItem(LAST_USED_ACCOUNT_KEY);
      // On native, also delete stored credentials
      if (Capacitor.isNativePlatform()) {
        await deleteStoredCredentials();
      }
    } catch {
      // Ignore
    }
    await refreshAccounts();
  }, [refreshAccounts]);

  return {
    isAvailable,
    isRegistered,
    accounts,
    loading,
    error,
    nativeBiometricInfo,
    registerPasskey,
    authenticateWithPasskey,
    storeCredentialsForNativeBiometric,
    removeAccount,
    clearPasskey,
    refreshAccounts,
    getStoredPasskeyEmail,
  };
}

// Sync passkey accounts from database - call this on login to restore any lost localStorage data
export async function syncPasskeyAccountsFromDatabase(userId: string, userEmail: string, displayName?: string): Promise<void> {
  try {
    const { data: passkeys, error } = await supabase
      .from('user_passkeys')
      .select('id')
      .eq('user_id', userId);
    
    if (error || !passkeys) {
      console.log('[Passkey Sync] No passkeys found or error:', error?.message);
      return;
    }
    
    if (passkeys.length > 0) {
      // User has passkeys in the database, ensure they're in local storage
      const existingAccounts = getStoredPasskeyAccounts();
      const emailLower = userEmail.toLowerCase();
      const hasAccount = existingAccounts.some(a => a.email.toLowerCase() === emailLower);
      
      if (!hasAccount) {
        console.log('[Passkey Sync] Restoring passkey account to localStorage for:', userEmail);
        addStoredPasskeyAccount(userEmail, displayName);
      }
    } else {
      // No passkeys in database - remove from localStorage if present
      const existingAccounts = getStoredPasskeyAccounts();
      const emailLower = userEmail.toLowerCase();
      const hasAccount = existingAccounts.some(a => a.email.toLowerCase() === emailLower);
      
      if (hasAccount) {
        console.log('[Passkey Sync] Removing orphaned passkey account from localStorage:', userEmail);
        removeStoredPasskeyAccount(userEmail);
      }
    }
  } catch (err) {
    console.error('[Passkey Sync] Error syncing passkey accounts:', err);
  }
}
