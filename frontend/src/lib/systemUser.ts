// System user constant for "Ignite Support" - used for welcome DMs
// This is a special UUID that represents the system account
// We handle this ID specially in the UI to show branding and disable replies

export const IGNITE_SUPPORT_USER_ID = "00000000-0000-0000-0000-000000000001";

// Check if a user ID is the Ignite Support system user
export function isIgniteSupportUser(userId: string | null | undefined): boolean {
  return userId === IGNITE_SUPPORT_USER_ID;
}

// Welcome message sent to new users
export const WELCOME_MESSAGE_TEXT = 
  "Welcome to Ignite Club HQ! 🔥\n\nManage your club, teams, schedules, messaging, media and more — all in one place.\n\nTo learn more and see tips on using Ignite, visit:\nhttps://reference.invalid the latest updates, follow us on our [Facebook page](https://reference.invalid).";
