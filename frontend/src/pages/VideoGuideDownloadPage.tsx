import { Button } from "@/components/ui/button";
import { Download, FileText, ShieldAlert, Loader2, FileDown, Play } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Promo video paths - these would be uploaded to storage or assets
const promoMainShowcase = "";
const promoCoachFocus = "";
const promoParentConvenience = "";
const promoClubAdmin = "";
const promoSponsorValue = "";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Navigate } from "react-router-dom";
import { jsPDF } from "jspdf";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

const VIDEO_GUIDE_CONTENT = `# Ignite Sports Club App - Complete Video Recording Guide

## Table of Contents
1. Getting Started (3 videos)
2. Clubs (5 videos)
3. Teams (5 videos)
4. Events (8 videos)
5. Communication (6 videos)
6. Media & Photos (4 videos)
7. Pitch Board (6 videos)
8. Admin Features (5 videos)
9. Vault & Storage (9 videos)
10. Sponsorship Features (7 videos)
11. Profile & Settings (5 videos)
12. Promo Videos (5 videos)

**Total: 68 videos**

---

## Demo Accounts Reference

| Account | Email | Password | Best For |
|---------|-------|----------|----------|
| Club Admin | redacted@example.invalid | demo123 | Club management, sponsors, rewards |
| Team Admin | redacted@example.invalid | demo123 | Team management, pitch board |
| Player | redacted@example.invalid | demo123 | Player perspective, RSVPs |
| Parent | redacted@example.invalid | demo123 | Parent features, children |

---

## Category 1: Getting Started

### Video 1.1: Signing Up for the App
**Duration:** 2-3 minutes
**Demo Account:** Create new account (use test email)

**Recording Steps:**
1. Start at the login page (/)
2. Click "Sign Up" tab
3. Show the email input field - type a sample email
4. Show the password field - type a password
5. Click "Sign Up" button
6. Show the confirmation message
7. Highlight the "Complete Profile" prompt
8. Fill in display name
9. Optionally upload an avatar
10. Click "Save Profile"
11. Show the home screen after completion

**Key Points to Highlight:**
- Simple email/password signup
- Profile completion is quick
- Avatar upload is optional

---

### Video 1.2: Installing as PWA (Add to Home Screen)
**Duration:** 2-3 minutes
**Demo Account:** Any logged-in account

**Recording Steps:**
1. Show the app running in mobile browser
2. Look for the PWA install prompt (if shown)
3. **For iOS:** Tap Share button → "Add to Home Screen"
4. **For Android:** Tap three-dot menu → "Install app" or "Add to Home Screen"
5. Show the app icon on home screen
6. Open the app from home screen
7. Demonstrate it opens in full-screen mode
8. Show it works offline (airplane mode demo)

**Key Points to Highlight:**
- Works like a native app
- No app store needed
- Offline capable

---

### Video 1.3: Logging In and Navigation
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Start at login page (/)
2. Enter demo email and password
3. Click "Sign In"
4. Show the home screen with upcoming events
5. Navigate through bottom navigation:
   - **Home** (calendar icon) - Events list
   - **Messages** (chat icon) - Chat groups
   - **Media** (image icon) - Photos/videos
   - **Profile** (user icon) - Your profile
6. Demonstrate the header showing club logo/name
7. Show notifications bell icon
8. Click on club name to see club details

---

## Category 2: Clubs

### Video 2.1: Creating a New Club
**Duration:** 3-4 minutes
**Demo Account:** Create new account or use one without clubs

**Recording Steps:**
1. From home screen, click "Create Club" or go to Clubs page
2. Click "Create New Club" button
3. Fill in club details:
   - Club name (e.g., "Riverside FC")
   - Description
   - Sport type (select from dropdown)
4. Upload club logo (optional)
5. Click "Create Club"
6. Show success message
7. Navigate to the new club's detail page
8. Show you're automatically the club admin

---

### Video 2.2: Joining an Existing Club
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Show receiving an invite link (paste in browser)
2. Or: Navigate to Clubs page
3. Click "Join Club" button
4. Enter invite code or click invite link
5. Select role (Player/Parent/Supporter)
6. Click "Join"
7. Show confirmation
8. Navigate to the club to see you're now a member

---

### Video 2.3: Club Settings and Customization
**Duration:** 4-5 minutes
**Demo Account:** redacted@example.invalid
**Demo Club:** Northern United FC

**Recording Steps:**
1. Navigate to club detail page
2. Click "Edit Club" or settings gear icon
3. Show editable fields:
   - Club name
   - Description
   - Logo upload/change
   - Sport type
4. Scroll to "Theme Customization" section
5. Adjust primary color picker
6. Adjust secondary color picker
7. Toggle "Show logo in header"
8. Toggle "Show club name in header"
9. Click "Save Changes"
10. Show the updated header/theme

---

### Video 2.4: Managing Club Members
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid
**Demo Club:** Northern United FC

**Recording Steps:**
1. Navigate to club detail page
2. Click "Members" tab or section
3. Show list of current members with roles
4. Click on a member to view their profile
5. Click "Manage Roles" button
6. Show adding a role to a member
7. Show removing a role
8. Demonstrate "Award Points" feature
9. Show filtering members by role/team

---

### Video 2.5: Creating Club Invite Links
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid
**Demo Club:** Northern United FC

**Recording Steps:**
1. Navigate to club detail page
2. Click "Invite Members" button
3. Select role for new members
4. Set expiry date (optional)
5. Set max uses (optional)
6. Click "Generate Link"
7. Show the generated link
8. Demonstrate "Copy Link" button
9. Show share options

---

## Category 3: Teams

### Video 3.1: Creating a Team
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid
**Demo Club:** Northern United FC

**Recording Steps:**
1. Navigate to club detail page
2. Click "Teams" tab
3. Click "Create Team" button
4. Fill in team details:
   - Team name (e.g., "Under 12s")
   - Age group/division
   - Team color (optional)
5. Upload team logo (optional)
6. Click "Create Team"
7. Show success message
8. Navigate to the new team page

---

### Video 3.2: Joining a Team
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid
**Demo Team:** Under 14s

**Recording Steps:**
1. Method 1 - Via invite link:
   - Paste team invite link
   - Confirm joining
2. Method 2 - Via club:
   - Navigate to club
   - Go to Teams tab
   - Click "Join Team" on desired team
3. Select role (Player/Manager/Coach)
4. Show confirmation
5. Navigate to team page

---

### Video 3.3: Team Settings
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid
**Demo Team:** Under 14s

**Recording Steps:**
1. Navigate to team detail page
2. Click "Edit Team" button
3. Show editable settings:
   - Team name
   - Age group
   - Season dates
   - Default formation
4. Show pitch board settings:
   - Team size (5/7/9/11)
   - Half duration
5. Save changes
6. Show updated team info

---

### Video 3.4: Managing Team Members
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid
**Demo Team:** Under 14s

**Recording Steps:**
1. Navigate to team detail page
2. Click "Members" or "Squad" tab
3. Show list of team members
4. Click "Add Member" button
5. Select from club members or invite new
6. Set player position (optional)
7. Set jersey number (optional)
8. Show editing member details
9. Demonstrate removing a member

---

### Video 3.5: Promoting to Team Admin
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid
**Demo Team:** Under 14s

**Recording Steps:**
1. Navigate to team detail page
2. Go to Members section
3. Click on a member (not already admin)
4. Click "Promote to Team Admin" or "Make Manager"
5. Confirm the action
6. Show the member now has admin badge
7. Explain what team admins can do

---

## Category 4: Events

### Video 4.1: Creating a Training Session
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid
**Demo Team:** Under 14s

**Recording Steps:**
1. Navigate to team page
2. Click "Create Event" button
3. Select event type: "Training"
4. Fill in details:
   - Title: "Tuesday Training"
   - Date and time
   - Duration
5. Add location:
   - Type address or select saved location
   - Show map preview
6. Add description (optional)
7. Click "Create Event"
8. Show event in calendar

---

### Video 4.2: Creating a Match/Game
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid
**Demo Team:** Under 14s

**Recording Steps:**
1. Navigate to team page
2. Click "Create Event"
3. Select event type: "Match"
4. Fill in match details:
   - Opponent name (type or select from saved)
   - Home/Away toggle
   - Match date and time
5. Add venue:
   - Use address autocomplete
   - Show map embed
6. Set reminder time
7. Add event sponsors (optional)
8. Click "Create Match"
9. Show match card with opponent

---

### Video 4.3: Creating a Social Event
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid
**Demo Club:** Northern United FC

**Recording Steps:**
1. Navigate to club page (not team)
2. Click "Create Event"
3. Select event type: "Social"
4. Fill in details:
   - Title: "End of Season BBQ"
   - Date and time
   - Location
5. Add price (optional) - e.g., "$10 per family"
6. Add description with details
7. Create event
8. Show it appears for all club members

---

### Video 4.4: RSVP and Attendance
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Navigate to home screen (Events)
2. Find an upcoming event
3. Click on event to open detail
4. Show RSVP section
5. Click "Going" button
6. Add guest count (optional)
7. Add notes (optional)
8. Show confirmation
9. Change RSVP to "Maybe"
10. Change to "Can't Go"
11. Show attendance summary for organizers

---

### Video 4.5: Adding Duties to Events
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Navigate to an upcoming event (as organizer)
2. Click "Manage Duties" or "Add Duty"
3. Add a duty: "Bring oranges"
4. Add another: "Line marking"
5. Show duty list
6. Click on a duty
7. Assign to a member
8. Show the member receives notification
9. Mark duty as complete
10. Show points awarded for completed duty

---

### Video 4.6: Event Details and Location
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Navigate to an event with location
2. Open event detail page
3. Show the event information:
   - Date and time
   - Location with address
4. Click on map to expand
5. Show "Get Directions" button
6. Click to open in maps app
7. Show event description section
8. Show attached sponsors

---

### Video 4.7: Recurring Events
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid
**Demo Team:** Under 14s

**Recording Steps:**
1. Navigate to Create Event
2. Select event type: "Training"
3. Fill in basic details
4. Enable "Recurring Event" toggle
5. Select recurrence pattern:
   - Weekly
   - Select days (e.g., Tuesday, Thursday)
6. Set end date or number of occurrences
7. Create event
8. Show multiple events created in calendar
9. Edit single occurrence
10. Edit all future occurrences

---

### Video 4.8: Cancelling Events
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Navigate to an upcoming event (as organizer)
2. Click "Edit Event" or menu
3. Click "Cancel Event"
4. For recurring: Choose "This event only" or "All future"
5. Confirm cancellation
6. Show event marked as cancelled
7. Show notification sent to attendees
8. Show cancelled event in list (greyed out)

---

## Category 5: Communication

### Video 5.1: Team Chat Basics
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid
**Demo Team:** Under 14s

**Recording Steps:**
1. Navigate to Messages (bottom nav)
2. Show list of chat groups
3. Click on team chat (e.g., "Under 14s")
4. Type a message and send
5. Show message appears
6. Show other members' messages
7. Reply to a message (swipe or click reply)
8. Show the reply thread
9. React to a message with emoji

---

### Video 5.2: Club Announcements
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid
**Demo Club:** Northern United FC

**Recording Steps:**
1. Navigate to Messages
2. Click on "Club Chat" or "Announcements"
3. Show this goes to all club members
4. Type an announcement message
5. Add an image (optional)
6. Send the message
7. Show it appears for all members
8. Demonstrate pinning important messages

---

### Video 5.3: Creating Chat Groups
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Navigate to Messages
2. Click "+" or "New Group" button
3. Enter group name (e.g., "Match Day Coordination")
4. Select which roles can access
5. Choose scope (team-only or club-wide)
6. Click "Create Group"
7. Show new group appears
8. Send first message
9. Add members to group

---

### Video 5.4: Image Sharing in Chat
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Open any chat
2. Click the image/attachment icon
3. Select an image from device
4. Preview the image
5. Add a caption (optional)
6. Send the image
7. Show image appears in chat
8. Click to view full-size
9. Long-press for options (download, share)

---

### Video 5.5: Mentions and Notifications
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Open team chat
2. Type "@" to see member list
3. Select a member to mention
4. Complete message and send
5. Show how mentioned person gets notification
6. Demonstrate @everyone or @team
7. Show notification badge on messages icon
8. Open notification to jump to message

---

### Video 5.6: Chat Message Features
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Open any chat with messages
2. Long-press on a message
3. Show reaction options - add thumbs up
4. Show reply option
5. Show link preview when URL is shared
6. Send a YouTube link - show embed
7. Show typing indicator when others type
8. Show read receipts (who's seen message)
9. Demonstrate muting a chat

---

## Category 6: Media & Photos

### Video 6.1: Uploading Photos
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid
**Demo Team:** Under 14s

**Recording Steps:**
1. Navigate to Media (bottom nav)
2. Show media feed
3. Click "+" or "Upload" button
4. Select photos from device (multiple selection)
5. Add title/caption (optional)
6. Select team or club to share with
7. Toggle "Show in Feed"
8. Click "Upload"
9. Show upload progress
10. Show photos appear in feed

---

### Video 6.2: Viewing and Interacting with Photos
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Navigate to Media feed
2. Click on a photo to open lightbox
3. Swipe through photos
4. Double-tap to zoom
5. Click heart/like button
6. Add a comment
7. Reply to a comment
8. Share photo (click share icon)
9. Download photo (if allowed)

---

### Video 6.3: Photo Reactions and Comments
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Open a photo in lightbox
2. Show reaction buttons
3. Click to add reaction (❤️, 😄, etc.)
4. See reaction count update
5. Scroll down to comments section
6. Add a comment
7. React to someone's comment
8. Reply to a comment
9. Show comment thread

---

### Video 6.4: Media Management for Admins
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Navigate to Media as admin
2. Show admin controls on photos
3. Click menu on a photo
4. Show "Delete" option
5. Show "Edit" option
6. Demonstrate filtering by team
7. Demonstrate filtering by date
8. Show storage usage indicator
9. Bulk select and delete (if applicable)

---

## Category 7: Pitch Board

### Video 7.1: Pitch Board Basics
**Duration:** 4-5 minutes
**Demo Account:** redacted@example.invalid
**Demo Team:** Under 14s

**Recording Steps:**
1. Navigate to team page
2. Click "Pitch Board" button
3. Show empty pitch layout
4. Show player tokens on the side
5. Drag a player onto the pitch
6. Position player in their spot
7. Drag more players to form lineup
8. Show substitutes area
9. Save the formation

---

### Video 7.2: Using the Game Timer
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid
**Demo Team:** Under 14s

**Recording Steps:**
1. Open Pitch Board
2. Set up a lineup with subs
3. Click "Start Game" button
4. Show timer starts counting
5. Show half indicator (1st half)
6. Click on a player on pitch
7. Click on a substitute
8. Confirm substitution
9. Show time tracker updates
10. Click to end half / start 2nd half
11. End game and show summary

---

### Video 7.3: Substitution Tracking
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid
**Demo Team:** Under 14s

**Recording Steps:**
1. Open Pitch Board with active game
2. Show players with time played
3. Make a substitution (swap players)
4. Show sub animation/confirmation
5. Note time recorded automatically
6. Show sub count on players
7. Show player time balance indicator
8. Make another sub to demonstrate
9. Show substitution history
10. Highlight "fair play" tracking

---

### Video 7.4: Saving Formations
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid
**Demo Team:** Under 14s

**Recording Steps:**
1. Open Pitch Board
2. Set up desired formation
3. Click "Save Formation" button
4. Enter formation name (e.g., "4-3-3 Attack")
5. Save formation
6. Clear the pitch
7. Click "Load Formation"
8. Select saved formation
9. Show formation loads instantly
10. Edit and save as new formation

---

### Video 7.5: Formation Strategies
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid
**Demo Team:** Under 14s

**Recording Steps:**
1. Open Pitch Board
2. Show formation selector dropdown
3. Select different formations:
   - 4-4-2
   - 4-3-3
   - 3-5-2
4. Show pitch adjusts for each
5. Demonstrate drawing on pitch (if available)
6. Add arrows for movement
7. Add notes for player instructions
8. Save as tactical plan

---

### Video 7.6: Post-Game Statistics
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid
**Demo Team:** Under 14s

**Recording Steps:**
1. After ending a game, show summary dialog
2. View statistics:
   - Minutes played per player
   - Substitution count
   - Position heatmap
3. Navigate to "Stats" or "Reports"
4. Show player stats over multiple games
5. Show fairness metrics
6. Export stats (if available)
7. Share with parents

---

## Category 8: Admin Features

### Video 8.1: Role Management
**Duration:** 4-5 minutes
**Demo Account:** redacted@example.invalid
**Demo Club:** Northern United FC

**Recording Steps:**
1. Navigate to club settings
2. Click "Manage Roles"
3. Show default roles:
   - Admin
   - Manager/Coach
   - Player
   - Parent
   - Supporter
4. Click on a member
5. Add a role (e.g., make someone a coach)
6. Remove a role
7. Show role permissions explained
8. Approve/reject role requests

---

### Video 8.2: Club Subscription & Upgrades
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid
**Demo Club:** Northern United FC

**Recording Steps:**
1. Navigate to club settings
2. Click "Subscription" or "Upgrade"
3. Show current plan
4. Show available plans:
   - Free tier features
   - Pro features
5. Click "Upgrade to Pro"
6. Show upgrade benefits:
   - More storage
   - Advanced features
   - Priority support
7. Promo code entry field
8. Complete upgrade flow

---

### Video 8.3: Points and Rewards System
**Duration:** 4-5 minutes
**Demo Account:** redacted@example.invalid
**Demo Club:** Northern United FC

**Recording Steps:**
1. Navigate to club settings
2. Click "Rewards" section
3. Show existing rewards list
4. Click "Add Reward"
5. Fill in details:
   - Reward name
   - Points required
   - Description
6. Upload reward image (optional)
7. Save reward
8. Navigate to member profile
9. "Award Points" to member
10. Show member redeeming a reward
11. Fulfill the redemption (mark as given)

---

### Video 8.4: Managing Feedback
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Navigate to admin settings
2. Click "Manage Feedback"
3. Show feedback submissions
4. Filter by type (bug, feature, etc.)
5. Click on a feedback item
6. View details
7. Update status (new → reviewed → done)
8. Add admin notes
9. Show how users submit feedback

---

### Video 8.5: User Management
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Navigate to club members
2. Show full member list
3. Search for a member
4. Filter by role or team
5. Click on a member profile
6. View their:
   - Roles across teams
   - Points balance
   - Activity history
7. Remove from club (with confirmation)
8. Transfer ownership (if applicable)

---

## Category 9: Vault & Storage

### Video 9.1: Accessing the Vault from Club
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid
**Demo Club:** Northern United FC

**Recording Steps:**
1. Navigate to club detail page
2. Show the "Vault" tab or icon in navigation
3. Click on "Vault"
4. Show the vault overview page
5. Explain this is club-wide storage
6. Show any existing folders
7. Show storage used indicator

**Key Points to Highlight:**
- Club vault is accessible to authorized roles
- Centralized document storage
- Different from Media (photos/videos)

---

### Video 9.2: Accessing the Vault from Team
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid
**Demo Team:** Under 14s

**Recording Steps:**
1. Navigate to team detail page
2. Look for "Vault" or "Files" section
3. Click on Vault
4. Show team-specific vault folder
5. Explain this is separate from club vault
6. Show team members who can access
7. Navigate back to team and show easy access

---

### Video 9.3: Creating Folders in Vault
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Open the Vault page
2. Click "Create Folder" or "+" button
3. Enter folder name (e.g., "Player Registrations")
4. Add description (optional)
5. Select folder color (optional)
6. Click "Create"
7. Show new folder appears
8. Create another folder (e.g., "Match Reports")
9. Show folders can be organized

---

### Video 9.4: Uploading Files to Vault
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Open a vault folder
2. Click "Upload Files" button
3. Select files from device (multiple)
4. Show supported file types:
   - PDFs, documents
   - Spreadsheets
   - Images
5. Show upload progress
6. Files appear in folder
7. Click on a file to preview/download
8. Show file details (size, date, uploader)

---

### Video 9.5: Uploading Photos to Vault (vs Media)
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Open a vault folder
2. Click "Upload"
3. Select photos
4. Show upload completes
5. **Explain the difference:**
   - Vault: Private storage, not in feed
   - Media: Public/team feed, social features
6. Navigate to Media tab
7. Show photos there have reactions, comments
8. Vault photos are just files
9. Use Vault for: medical forms, waivers, documents with photos

---

### Video 9.6: Managing Files (Rename, Move, Delete)
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Open vault with files
2. Click on a file's menu (three dots)
3. Click "Rename"
4. Enter new name, save
5. Click menu again → "Move"
6. Select destination folder
7. Confirm move
8. Navigate to destination, show file there
9. Click menu → "Delete"
10. Confirm deletion
11. File is removed

---

### Video 9.7: Viewing Storage Usage
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid
**Demo Club:** Northern United FC

**Recording Steps:**
1. Navigate to Club Settings
2. Find "Storage" section
3. Show storage usage meter
4. Show breakdown:
   - Vault files: X GB
   - Media photos: X GB
   - Total: X of Y GB
5. Show what counts toward storage
6. Show warning when near limit

---

### Video 9.8: Purchasing Additional Storage
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid
**Demo Club:** Northern United FC

**Recording Steps:**
1. Navigate to Club Settings → Storage
2. Show current storage limit
3. Click "Purchase More Storage" or "Upgrade Storage"
4. Show available storage packages:
   - 10 GB extra
   - 50 GB extra
   - 100 GB extra
5. Show pricing
6. Select a package
7. Complete purchase flow
8. Show updated storage limit
9. Mention storage is per-club

---

### Video 9.9: Vault Backups
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid
**Demo Club:** Northern United FC

**Recording Steps:**
1. Navigate to Club Settings
2. Find "Backups" section
3. Click "Create Backup"
4. Show backup is being created
5. Show list of previous backups
6. Click on a backup to see contents
7. Click "Download Backup"
8. Show backup as ZIP file
9. Explain restore process (if applicable)
10. Mention scheduled backups (if available)

---

## Category 10: Sponsorship Features

### Video 10.1: Adding Club Sponsors
**Duration:** 4-5 minutes
**Demo Account:** redacted@example.invalid
**Demo Club:** Northern United FC

**Recording Steps:**
1. Navigate to Club Settings
2. Click "Sponsors" section
3. Click "Add Sponsor"
4. Fill in sponsor details:
   - Sponsor name
   - Website URL
   - Description
5. Upload sponsor logo
6. Set display order
7. Toggle "Active" status
8. Click "Save"
9. Show sponsor appears in list
10. Show sponsor logo on club page

---

### Video 10.2: Setting Primary Club Sponsor
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid
**Demo Club:** Northern United FC

**Recording Steps:**
1. Navigate to Club Settings → Sponsors
2. Show list of sponsors
3. Click "Set as Primary" on a sponsor
4. Confirm selection
5. Navigate to club home page
6. Show primary sponsor displayed prominently
7. Show on event pages
8. Show in header (if enabled)
9. Change primary sponsor to demonstrate

---

### Video 10.3: Assigning Sponsors to Teams
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid
**Demo Club:** Northern United FC

**Recording Steps:**
1. Navigate to Club Settings → Sponsors
2. Click on a sponsor to edit
3. Find "Team Assignments" section
4. Toggle which teams this sponsor supports
5. Save changes
6. Navigate to that team's page
7. Show team sponsor displayed
8. Or: Go to Team Settings
9. Click "Sponsors" → Select from club sponsors
10. Save team sponsor settings

---

### Video 10.4: Sponsor Display on Events
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid
**Demo Team:** Under 14s

**Recording Steps:**
1. Navigate to Create Event
2. Fill in event details
3. Scroll to "Sponsors" section
4. Click "Add Event Sponsor"
5. Select from available sponsors
6. Add multiple sponsors (if desired)
7. Drag to reorder display
8. Create the event
9. View event detail page
10. Show sponsor logos displayed
11. Click sponsor to visit website

---

### Video 10.5: Sponsor Analytics Dashboard
**Duration:** 4-5 minutes
**Demo Account:** redacted@example.invalid
**Demo Club:** Northern United FC

**Recording Steps:**
1. Navigate to Club Settings → Sponsors
2. Click "Analytics" or "Reports"
3. Show overview dashboard:
   - Total impressions
   - Click-through rates
   - Event appearances
4. Select date range
5. Filter by sponsor
6. Show individual sponsor stats
7. Show which events had most views
8. Export report (if available)

---

### Video 10.6: Sponsor-Linked Rewards
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid
**Demo Club:** Northern United FC

**Recording Steps:**
1. Navigate to Club Settings → Rewards
2. Click "Add Reward"
3. Fill in reward details
4. Click "Link to Sponsor"
5. Select a sponsor
6. Upload sponsor-provided reward image
7. Add QR code for redemption (if applicable)
8. Save reward
9. Show reward with sponsor branding
10. Member redeems at sponsor location

---

### Video 10.7: Creating a Sponsorship Pitch Video
**Duration:** 2-3 minutes
**Recording Notes:** This is a guide video, not app demo

**Recording Steps:**
1. Show the sponsorship value proposition:
   - "Reach engaged sports families"
   - "Local community visibility"
   - "Digital presence at events"
2. Show example sponsor placements in app:
   - Club page
   - Team pages
   - Event pages
   - Rewards section
3. Show analytics/reporting capabilities
4. Display pricing tiers (if applicable)
5. Contact information for sponsorship inquiries

---

## Category 11: Profile & Settings

### Video 11.1: Managing Your Profile
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Navigate to Profile (bottom nav)
2. Click "Edit Profile"
3. Update display name
4. Change avatar (upload new photo)
5. Update profile visibility settings
6. Save changes
7. View updated profile

---

### Video 11.2: Adding and Managing Children
**Duration:** 3-4 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Navigate to Profile
2. Click "Manage Children"
3. Click "Add Child"
4. Enter child's name
5. Enter year of birth
6. Assign to team
7. Save child
8. Show child appears in list
9. Edit child details
10. Show child's points balance
11. RSVP on behalf of child

---

### Video 11.3: Notification Settings
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Navigate to Profile/Settings
2. Click "Notifications"
3. Show toggle for each type:
   - Event reminders
   - Chat messages
   - Team updates
   - Media uploads
4. Toggle each setting
5. Set quiet hours (if available)
6. Enable push notifications
7. Test notification

---

### Video 11.4: Privacy and Visibility
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Navigate to Profile/Settings
2. Click "Privacy"
3. Show profile visibility options:
   - Everyone
   - Club members only
   - Team members only
4. Toggle each setting
5. Show what others can see
6. Data export option
7. Account deletion option

---

### Video 11.5: Viewing Your Clubs and Teams
**Duration:** 2-3 minutes
**Demo Account:** redacted@example.invalid

**Recording Steps:**
1. Navigate to Profile
2. Click "My Clubs" or "My Teams"
3. Show list of clubs you belong to
4. Show your role in each
5. Show list of teams
6. Click to navigate to any
7. Show "Leave Club" option
8. Show "Leave Team" option

---

## Promo Videos

### Promo 1: Main Feature Showcase (2-3 minutes)
**Description:** High-energy overview of all key features

**Segment Breakdown:**
1. **Opening (10 sec):** App logo animation, tagline "Your Club, Connected"
2. **Onboarding (15 sec):** Quick signup flow, PWA install
3. **Clubs & Teams (20 sec):** Creating club, adding teams, inviting members
4. **Events (25 sec):** Creating match, RSVPs, duties, location maps
5. **Communication (20 sec):** Team chat, reactions, mentions, photo sharing
6. **Media (15 sec):** Photo gallery, reactions, comments
7. **Pitch Board (25 sec):** Setting lineup, game timer, substitutions, stats
8. **Vault & Storage (15 sec):** File upload, folder organization, secure storage
9. **Sponsors (15 sec):** Logo placement, analytics dashboard
10. **Rewards (10 sec):** Points, redemption
11. **Closing (10 sec):** Download CTA, app stores, website

**Shot List:**
- Dynamic transitions between features
- Real gameplay footage mixed with app screens
- Upbeat background music
- Text overlays for key benefits

---

### Promo 2: Coach/Manager Focus (30-45 seconds)
**Tagline:** "Manage Your Team Like a Pro"

**Shot List:**
1. Coach looking at phone on sideline
2. Quick cuts of:
   - Creating training session
   - Pitch board lineup
   - Timer and substitutions
   - Player stats dashboard
3. Team chat coordination
4. Post-game in change room showing stats
5. Closing: "Ignite - Coaching Made Simple"

---

### Promo 3: Parent Convenience (30-45 seconds)
**Tagline:** "Never Miss a Game"

**Shot List:**
1. Parent checking phone while making breakfast
2. Quick cuts of:
   - Event notification
   - Easy RSVP
   - Map and directions
   - Chat with other parents
3. At the field, showing duty reminder
4. Viewing child's photos
5. Closing: "Ignite - Stay Connected"

---

### Promo 4: Club Admin Power (30-45 seconds)
**Tagline:** "Run Your Club Effortlessly"

**Shot List:**
1. Club admin at desk
2. Quick cuts of:
   - Member management
   - Multiple teams overview
   - Sponsor dashboard
   - Storage and vault
   - Rewards setup
3. Analytics dashboard
4. Happy club celebration photo
5. Closing: "Ignite - Club Management Simplified"

---

### Promo 5: Sponsor Value (30-45 seconds)
**Tagline:** "Reach Every Game, Every Family"

**Shot List:**
1. Local business owner
2. Quick cuts of:
   - Logo on club page
   - Logo on event page
   - Logo on team jerseys (real footage)
   - Analytics showing impressions
3. Family at game seeing sponsor
4. Reward redemption at sponsor location
5. Closing: "Partner with Ignite - Local Impact"

---

## Recording Order Recommendation

**Day 1: Core Features (estimated 2-3 hours recording)**
1. 1.1 Signing Up
2. 1.2 PWA Install
3. 1.3 Logging In
4. 2.1 Creating Club
5. 2.2 Joining Club
6. 3.1 Creating Team
7. 3.2 Joining Team

**Day 2: Events & Communication (estimated 2-3 hours)**
1. 4.1-4.8 All Event videos
2. 5.1-5.6 All Communication videos

**Day 3: Media, Pitch Board, Vault (estimated 3-4 hours)**
1. 6.1-6.4 All Media videos
2. 7.1-7.6 All Pitch Board videos
3. 9.1-9.9 All Vault & Storage videos

**Day 4: Admin, Sponsors & Settings (estimated 2-3 hours)**
1. 8.1-8.5 All Admin videos
2. 10.1-10.7 All Sponsorship videos
3. 2.3-2.5 Club management videos
4. 3.3-3.5 Team management videos

**Day 5: Profile, Promo Videos (estimated 2-3 hours)**
1. 11.1-11.5 All Profile videos
2. Promo 1-5 All Promo videos

---

## Recording Tips

### Before Recording
- Ensure demo accounts have realistic data
- Clear browser cache for clean demo
- Test all features work in current build
- Prepare script/bullet points for each video
- Set up screen recording software

### During Recording
- Speak slowly and clearly
- Pause on important UI elements
- Keep mouse movements smooth
- Highlight cursor for visibility
- Record in 1080p or higher

### After Recording
- Add captions/subtitles
- Include progress indicators
- Add chapter markers for long videos
- Compress for web delivery
- Create thumbnails for each video

---

## Video Specifications

- **Resolution:** 1920x1080 (1080p) minimum
- **Frame Rate:** 30fps
- **Format:** MP4 (H.264)
- **Audio:** Clear voiceover, subtle background music
- **Captions:** Auto-generated + reviewed
- **Thumbnail:** Custom for each video
- **Intro/Outro:** Consistent branding
`;

const VideoGuideDownloadPage = () => {
  const handleDownload = () => {
    const blob = new Blob([VIDEO_GUIDE_CONTENT], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'VIDEO_RECORDING_GUIDE.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadTxt = () => {
    const blob = new Blob([VIDEO_GUIDE_CONTENT], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'VIDEO_RECORDING_GUIDE.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadPdf = () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const maxWidth = pageWidth - margin * 2;
    let y = margin;

    const lines = VIDEO_GUIDE_CONTENT.split('\n');

    lines.forEach((line) => {
      // Check if we need a new page
      if (y > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }

      // Handle headers
      if (line.startsWith('# ')) {
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        const text = line.replace('# ', '');
        doc.text(text, margin, y);
        y += 10;
      } else if (line.startsWith('## ')) {
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        const text = line.replace('## ', '');
        y += 4;
        doc.text(text, margin, y);
        y += 8;
      } else if (line.startsWith('### ')) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        const text = line.replace('### ', '');
        y += 2;
        doc.text(text, margin, y);
        y += 6;
      } else if (line.startsWith('**') && line.endsWith('**')) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        const text = line.replace(/\*\*/g, '');
        doc.text(text, margin, y);
        y += 5;
      } else if (line.startsWith('---')) {
        y += 3;
        doc.setDrawColor(200);
        doc.line(margin, y, pageWidth - margin, y);
        y += 5;
      } else if (line.trim() === '') {
        y += 3;
      } else {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        // Handle bold within lines
        const cleanLine = line.replace(/\*\*/g, '').replace(/- /g, '• ');
        const splitLines = doc.splitTextToSize(cleanLine, maxWidth);
        splitLines.forEach((splitLine: string) => {
          if (y > pageHeight - margin) {
            doc.addPage();
            y = margin;
          }
          doc.text(splitLine, margin, y);
          y += 5;
        });
      }
    });

    doc.save('VIDEO_RECORDING_GUIDE.pdf');
  };

  const promoVideos = [
    { title: "Main Feature Showcase", tagline: "Your Club, Connected", src: promoMainShowcase },
    { title: "Coach/Manager Focus", tagline: "Manage Your Team Like a Pro", src: promoCoachFocus },
    { title: "Parent Convenience", tagline: "Never Miss a Game", src: promoParentConvenience },
    { title: "Club Admin Power", tagline: "Run Your Club Effortlessly", src: promoClubAdmin },
    { title: "Sponsor Value", tagline: "Reach Every Game, Every Family", src: promoSponsorValue },
  ];

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center space-y-4">
          <FileText className="h-16 w-16 mx-auto text-primary" />
          <h1 className="text-2xl font-bold">Video Recording Guide</h1>
          <p className="text-muted-foreground">
            Complete guide with 68 videos covering all app features, including detailed recording instructions.
          </p>
        </div>

        {/* Promo Videos Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="h-5 w-5 text-primary" />
              Promo Videos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              5 AI-generated promotional videos ready for marketing use.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              {promoVideos.map((video, index) => (
                <div key={index} className="space-y-2">
                  <video
                    src={video.src}
                    controls
                    className="w-full rounded-lg aspect-video bg-muted"
                    preload="metadata"
                  />
                  <div className="text-center">
                    <p className="font-medium text-sm">{video.title}</p>
                    <p className="text-xs text-muted-foreground italic">"{video.tagline}"</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Download Guide Section */}
        <Card>
          <CardHeader>
            <CardTitle>Download Recording Guide</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={handleDownload} size="lg" className="w-full">
              <Download className="mr-2 h-5 w-5" />
              Download as Markdown (.md)
            </Button>
            <Button onClick={handleDownloadTxt} variant="outline" size="lg" className="w-full">
              <Download className="mr-2 h-5 w-5" />
              Download as Text (.txt)
            </Button>
            <Button onClick={handleDownloadPdf} variant="secondary" size="lg" className="w-full">
              <FileDown className="mr-2 h-5 w-5" />
              Download as PDF (.pdf)
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Tip: PDF format is best for printing. Markdown is best for editing.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

// Wrapper component with admin protection
const VideoGuideDownloadPageProtected = () => {
  const { user, loading: authLoading } = useAuth();

  const { data: isAppAdmin, isLoading: roleLoading } = useQuery({
    queryKey: ["is-app-admin-video-guide", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user?.id,
  });

  if (authLoading || roleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (!isAppAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-4">
        <ShieldAlert className="h-16 w-16 text-destructive" />
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="text-muted-foreground text-center">
          You don't have permission to access this page.
        </p>
      </div>
    );
  }

  return <VideoGuideDownloadPage />;
};

export default function VideoGuideDownloadPageRoute() {
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return (
      <div className="container max-w-2xl mx-auto px-4 py-10">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-6 space-y-3 text-center">
            <FileText className="h-10 w-10 mx-auto text-muted-foreground" />
            <h1 className="text-lg font-semibold">Administrative video guides are unavailable in ICP lab mode</h1>
            <p className="text-sm text-muted-foreground">
              Supabase administrator authorization and guide export are not enabled for local ICP identities.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <VideoGuideDownloadPageProtected />;
}
