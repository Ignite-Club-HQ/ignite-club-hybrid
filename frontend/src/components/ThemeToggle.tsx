import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

// Get theme from DOM (the authoritative source after useAuth applies it)
const getThemeFromDOM = (): 'light' | 'dark' => {
  if (typeof window !== 'undefined') {
    if (document.documentElement.classList.contains('dark')) return 'dark';
    if (document.documentElement.classList.contains('light')) return 'light';
    // Fallback to localStorage only if DOM doesn't have explicit class
    const stored = localStorage.getItem('app-theme');
    if (stored === 'dark' || stored === 'light') return stored;
  }
  return 'light';
};

export function ThemeToggle() {
  const { user } = useAuth();
  const [theme, setThemeState] = useState<'light' | 'dark'>(getThemeFromDOM);
  const [isSaving, setIsSaving] = useState(false);
  
  // Use ref to always have current user value (avoids stale closure)
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // CRITICAL: Sync state with DOM when it changes (e.g., after Google OAuth applies theme)
  useEffect(() => {
    const syncThemeFromDOM = () => {
      const domTheme = getThemeFromDOM();
      setThemeState(domTheme);
    };

    syncThemeFromDOM();

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          syncThemeFromDOM();
          break;
        }
      }
    });

    observer.observe(document.documentElement, { 
      attributes: true, 
      attributeFilter: ['class'] 
    });

    return () => observer.disconnect();
  }, []);

  const toggleTheme = async () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    console.log('[ThemeToggle] Toggle clicked, changing from', theme, 'to', newTheme);
    
    // Apply to DOM immediately
    setThemeState(newTheme);
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(newTheme);
    root.style.colorScheme = newTheme;
    localStorage.setItem('app-theme', newTheme);
    
    // Save to profile (use ref to get current user)
    const currentUser = userRef.current;
    if (!currentUser) {
      console.warn('[ThemeToggle] Cannot save theme - no user logged in, user ref:', currentUser);
      return;
    }
    
    if (isSaving) {
      console.log('[ThemeToggle] Save already in progress, skipping');
      return;
    }
    
    console.log('[ThemeToggle] Saving theme to profile:', newTheme, 'for user:', currentUser.id);
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ theme_preference: newTheme })
        .eq('id', currentUser.id);
      
      if (error) {
        console.error('[ThemeToggle] Failed to save theme preference:', error);
      } else {
        console.log('[ThemeToggle] Theme preference saved successfully:', newTheme);
      }
    } catch (err) {
      console.error('[ThemeToggle] Exception saving theme preference:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const isDark = theme === 'dark';

  return (
    <Button 
      variant="ghost" 
      size="icon" 
      onClick={toggleTheme} 
      disabled={isSaving}
      className="relative"
    >
      <Sun 
        className="h-5 w-5 transition-all" 
        style={{ 
          transform: isDark ? 'rotate(-90deg) scale(0)' : 'rotate(0deg) scale(1)',
          position: isDark ? 'absolute' : 'relative'
        }}
      />
      <Moon 
        className="h-5 w-5 transition-all" 
        style={{ 
          transform: isDark ? 'rotate(0deg) scale(1)' : 'rotate(90deg) scale(0)',
          position: isDark ? 'relative' : 'absolute'
        }}
      />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
