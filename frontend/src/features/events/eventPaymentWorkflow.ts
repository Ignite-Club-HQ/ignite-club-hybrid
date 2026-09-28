export async function setEventPaymentStatus(
  client: any,
  input: {
    eventId: string;
    userId: string;
    isPaid: boolean;
    amount: number;
    paidAt: string;
  },
): Promise<void> {
  if (input.isPaid) {
    const { error } = await client.from("event_payments").delete()
      .eq("event_id", input.eventId).eq("user_id", input.userId);
    if (error) throw error;
    return;
  }

  const { error } = await client.from("event_payments").insert({
    event_id: input.eventId,
    user_id: input.userId,
    amount: input.amount,
    payment_status: "paid",
    paid_at: input.paidAt,
  });
  if (error) throw error;
}
