import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { eventKeys } from "@/lab/eventQueryKeys";
import { createMemberCheckout, listenForPaymentStatus } from "@/lib/memberCheckout";

export interface UseEventPaymentFlowArgs {
  supabase: any;
  id: string | undefined;
  event: any;
  user: { id?: string; email?: string | null } | null | undefined;
  eventPrice: number | null | undefined;
  useIcpLab: boolean;
}

/**
 * Member checkout payment flow for the event detail page: starts a checkout
 * session, listens for the payment-status callback, confirms server-side and
 * reflects the outcome via toasts, plus the payment success/cancel URL-param
 * handler. Extracted verbatim from `EventDetailPage.tsx` — no control flow
 * or decision logic changed, only file location.
 */
export function useEventPaymentFlow(params: UseEventPaymentFlowArgs) {
  const { supabase, id, event, user, eventPrice, useIcpLab } = params;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Payment checkout state
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  // Active payment-status listener cleanup (CONFIRMED DEFECT 2).
  // Stored in a ref so a new listener disposes the previous one and unmount
  // always tears the active listener down exactly once (cleanup is idempotent).
  const paymentListenerCleanupRef = useRef<(() => void) | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      const dispose = paymentListenerCleanupRef.current;
      paymentListenerCleanupRef.current = null;
      dispose?.();
    };
  }, []);

  const handlePayNow = async () => {
    if (!event || !user || !eventPrice) return;

    if (useIcpLab) {
      toast({
        title: "Payments are disabled in ICP lab mode",
        description: "This synthetic event cannot create a real checkout session.",
        variant: "destructive",
      });
      return;
    }

    
    setIsProcessingPayment(true);
    try {
      const amountCents = Math.round(eventPrice * 100);
      const isNative = Capacitor.isNativePlatform();

      const result = await createMemberCheckout({
        club_id: event.club_id,
        title: event.title,
        amount_cents: amountCents,
        type: "event",
        payer_email: user.email || undefined,
        description: `Event payment: ${event.title}`,
        success_url: isNative
          ? "igniteclubhq://payment-success"
          : `${window.location.origin}/events/${event.id}?payment=success`,
        cancel_url: isNative
          ? "igniteclubhq://payment-cancel"
          : `${window.location.origin}/events/${event.id}?payment=cancelled`,
        metadata: {
          event_id: event.id,
          club_id: event.club_id,
          ...(event.team_id ? { team_id: event.team_id } : {}),
        },
      });

      if (result.error) {
        throw new Error(result.error);
      }

      if (result.url) {
        // Dispose any listener from a previous Pay Now tap before registering.
        const previousDispose = paymentListenerCleanupRef.current;
        paymentListenerCleanupRef.current = null;
        previousDispose?.();

        const clearActiveListener = () => {
          const dispose = paymentListenerCleanupRef.current;
          paymentListenerCleanupRef.current = null;
          dispose?.();
        };

        const dispose = listenForPaymentStatus(result.payment_id, async (status) => {
          // Terminal callback: the listener is done — drop the stored ref.
          clearActiveListener();
          if (!isMountedRef.current) return;

          if (status === "paid") {
            // CONFIRMED DEFECT 1: functions.invoke resolves with { data, error }
            // instead of throwing, so the returned error must be inspected.
            let confirmError: unknown = null;
            try {
              const { error } = await supabase.functions.invoke("confirm-event-payment", {
                body: {
                  event_id: event.id,
                  amount: eventPrice,
                  payment_id: result.payment_id,
                },
              });
              confirmError = error ?? null;
            } catch (err) {
              confirmError = err;
            }

            if (!isMountedRef.current) return;

            if (confirmError) {
              console.error("Failed to confirm event payment server-side:", confirmError);
              toast({
                title: "Payment confirmation incomplete",
                description:
                  "Your payment may have been received, but we could not update the event. Please contact your club before trying again.",
                variant: "destructive",
              });
              return;
            }

            queryClient.invalidateQueries({ queryKey: eventKeys.payments(id) });
            toast({ title: "Payment successful!" });
          } else {
            toast({ title: "Payment failed", variant: "destructive" });
          }
        });

        // A terminal callback can fire synchronously during registration; only
        // store the disposer if the listener is still considered active.
        if (isMountedRef.current) {
          paymentListenerCleanupRef.current = dispose;
        } else {
          dispose();
        }


        if (isNative) {
          import("@/lib/safeOpenUrl").then(({ safeOpenUrl }) => safeOpenUrl(result.url));
        } else {
          window.location.href = result.url;
        }
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (error: any) {
      console.error('Payment error:', error);
      toast({
        title: "Payment Error",
        description: error.message || "Failed to start payment process",
        variant: "destructive",
      });
    } finally {
      setIsProcessingPayment(false);
    }
  };

  // Check for payment success/cancel from URL params
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('payment');
    
    if (paymentStatus === 'success') {
      toast({
        title: "Payment Successful!",
        description: "Your payment has been processed. Thank you!",
      });
      // Remove the query param from URL
      window.history.replaceState({}, '', `/events/${id}`);
      // Refetch payments
      queryClient.invalidateQueries({ queryKey: eventKeys.payments(id) });
    } else if (paymentStatus === 'cancelled') {
      toast({
        title: "Payment Cancelled",
        description: "Your payment was cancelled.",
        variant: "destructive",
      });
      window.history.replaceState({}, '', `/events/${id}`);
    }
  }, [id, toast, queryClient]);

  return { handlePayNow, isProcessingPayment };
}
