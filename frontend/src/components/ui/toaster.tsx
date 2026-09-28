import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";

export function Toaster() {
  const { toasts, dismiss } = useToast();

  // Dismiss all toasts when clicking anywhere on the document
  // Use a small delay to prevent immediate dismissal from the same click that triggered the toast
  // Create a stable ID to track when toasts change (so we clean up old listeners)
  const toastIds = toasts.map(t => t.id).join(',');
  
  useEffect(() => {
    if (toasts.length === 0) return;

    // Define handler outside setTimeout so we can remove it in cleanup
    const handleClick = () => {
      dismiss();
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener("click", handleClick, { once: true });
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      // Always try to remove - it's a no-op if not added or already fired
      document.removeEventListener("click", handleClick);
    };
  }, [toastIds, dismiss]);

  return (
    <ToastProvider duration={5000}>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast 
            key={id} 
            {...props}
            onClick={() => dismiss(id)}
            className="cursor-pointer"
          >
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
