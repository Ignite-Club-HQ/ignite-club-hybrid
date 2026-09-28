export type RoleRequestScope = "club" | "team";

export function roleRequestErrorFeedback(scope: RoleRequestScope, error: Error) {
  const message = error.message?.toLowerCase() || "";
  if (message.includes("not authorized")) {
    return {
      title: "Permission denied",
      description:
        scope === "club"
          ? "You don't have permission to manage join requests. Only club admins can approve or deny requests."
          : "You don't have permission to manage join requests. Only team admins, coaches, and club admins can approve or deny requests.",
      variant: "destructive" as const,
    };
  }
  return {
    title: "Something went wrong",
    description: "Failed to process the request. Please try again.",
    variant: "destructive" as const,
  };
}

export const roleMutationFeedback = {
  removed: { title: "Role removed" },
  requestProcessed: { title: "Request processed" },
} as const;
