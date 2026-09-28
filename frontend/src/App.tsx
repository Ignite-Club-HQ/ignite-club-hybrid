import { Suspense, useEffect, Fragment, type ReactNode } from "react";
import NativeOnlyGate from "@/components/NativeOnlyGate";
import { Capacitor } from "@capacitor/core";
// Force publish - Firebase upgraded to v12.7.0 for Capacitor 8 compatibility
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useParams, useSearchParams } from "react-router-dom";
import { ScrollToTop } from "@/components/ScrollToTop";
import { AuthProvider, IcpAuthProvider } from "@/hooks/useAuth";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { AppLayout } from "@/components/layout/AppLayout";
import { ThemeProvider } from "next-themes";
import { ClubThemeProvider } from "@/hooks/useClubTheme";
import { AccessibilityPrefsProvider } from "@/hooks/useAccessibilityPrefs";
const GlobalSubMonitorGate = lazyWithRetry(() => import("@/components/pitch/GlobalSubMonitorGate"));
import PitchBoardResumeRedirect from "@/components/pitch/PitchBoardResumeRedirect";
import { MessagesBootstrapPrefetcher } from "@/components/MessagesBootstrapPrefetcher";

import { CookieConsentBanner } from "@/components/CookieConsentBanner";
import { IOSInstallPrompt } from "@/components/IOSInstallPrompt";
import { PushNotificationManager } from "@/components/PushNotificationManager";
import { PWAPendingInviteHandler } from "@/components/PWAPendingInviteHandler";
import AppNavigatorBridge from "@/components/AppNavigatorBridge";

import { NativeAppUpdatePrompt } from "@/components/NativeAppUpdatePrompt";
// Lazy-loaded: LegalReacceptanceGate is inert (returns null) unless an admin
// has explicitly turned on re-acceptance, so its Radix Checkbox dependency
// should not enter every visitor's initial chunk.
const LegalReacceptanceGate = lazyWithRetry(() =>
  import("@/components/LegalReacceptanceGate").then((m) => ({ default: m.LegalReacceptanceGate })),
);

import { StatusBarManager } from "@/components/StatusBarManager";
import { NotifDebugOverlay } from "@/components/NotifDebugOverlay";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { DevRibbon } from "@/components/DevRibbon";
import { IcsPreviewFallbackDialog } from "@/components/IcsPreviewFallbackDialog";
import { Loader2 } from "lucide-react";

// OAuth callback capture is now handled in main.tsx (runs earlier)

// Eagerly loaded pages (initial load) — keep this list tight; every import
// here lands in the main bundle and lengthens cold-start parse time on
// Android. Auth-adjacent pages are lazy because logged-in users (the vast
// majority of cold opens) never hit them.
const HomePage = lazyWithRetry(() => import("./pages/HomePage"));
const VerifyResetCodePage = lazyWithRetry(() => import("./pages/VerifyResetCodePage"));
const AuthPage = lazyWithRetry(() => import("./pages/AuthPage"));
const CompleteProfilePage = lazyWithRetry(() => import("./pages/CompleteProfilePage"));
const ResetPasswordPage = lazyWithRetry(() => import("./pages/ResetPasswordPage"));
const SignupProPage = lazyWithRetry(() => import("./pages/SignupProPage"));


// Lazy loaded pages (code splitting)
const EventsPage = lazyWithRetry(() => import("./pages/EventsPage"));
const EventDetailPage = lazyWithRetry(() => import("./pages/EventDetailPage"));
const CreateEventPage = lazyWithRetry(() => import("./pages/CreateEventPage"));
const EditEventPage = lazyWithRetry(() => import("./pages/EditEventPage"));
const ImportFixturesPage = lazyWithRetry(() => import("./pages/ImportFixturesPage"));
const ClubsPage = lazyWithRetry(() => import("./pages/ClubsPage"));
const ClubDetailPage = lazyWithRetry(() => import("./pages/ClubDetailPage"));
const ClubLinkEmbedPage = lazyWithRetry(() => import("./pages/ClubLinkEmbedPage"));
const CreateClubPage = lazyWithRetry(() => import("./pages/CreateClubPage"));
const ClubSetupWizardPage = lazyWithRetry(() => import("./pages/ClubSetupWizardPage"));
const StartPage = lazyWithRetry(() => import("./pages/StartPage"));
const StartTeamPage = lazyWithRetry(() => import("./pages/StartTeamPage"));
const EditClubPage = lazyWithRetry(() => import("./pages/EditClubPage"));
const CreateTeamPage = lazyWithRetry(() => import("./pages/CreateTeamPage"));
const EditTeamPage = lazyWithRetry(() => import("./pages/EditTeamPage"));
const TeamDetailPage = lazyWithRetry(() => import("./pages/TeamDetailPage"));
const MessagesPage = lazyWithRetry(() => import("./pages/MessagesPage"));
const ScheduledMessagesPage = lazyWithRetry(() => import("./pages/ScheduledMessagesPage"));
// Chat routes: mark `chat_chunk_loaded` when the lazy dynamic import resolves,
// so `chat_open_perf.stages` can split the auth_ready → chat_mount gap into
// "chunk fetch/parse" vs "React render". See src/lib/coldStartMarks.ts.
import { mark as _coldMark } from "@/lib/coldStartMarks";
const markChatChunk = <T,>(mod: T): T => { try { _coldMark("chat_chunk_loaded"); } catch {} return mod; };
const TeamChatPage = lazyWithRetry(() => import("./pages/TeamChatPage").then(markChatChunk));
const BroadcastChatPage = lazyWithRetry(() => import("./pages/BroadcastChatPage").then(markChatChunk));
const ClubChatPage = lazyWithRetry(() => import("./pages/ClubChatPage").then(markChatChunk));
const GroupChatPage = lazyWithRetry(() => import("./pages/GroupChatPage").then(markChatChunk));
const DirectMessagePage = lazyWithRetry(() => import("./pages/DirectMessagePage").then(markChatChunk));
const ClubAdminChatPage = lazyWithRetry(() => import("./pages/ClubAdminChatPage").then(markChatChunk));
const WelcomeMessagePage = lazyWithRetry(() => import("./pages/WelcomeMessagePage"));
const MediaPage = lazyWithRetry(() => import("./pages/MediaPage"));
const VaultPage = lazyWithRetry(() => import("./pages/VaultPage"));
const ProfilePage = lazyWithRetry(() => import("./pages/ProfilePage"));
const SettingsPage = lazyWithRetry(() => import("./pages/SettingsPage"));
const AccessibilitySettingsPage = lazyWithRetry(() => import("./pages/AccessibilitySettingsPage"));
const AccountPage = lazyWithRetry(() => import("./pages/AccountPage"));
const AdminPage = lazyWithRetry(() => import("./pages/AdminPage"));
const AdminTempPasswordPage = lazyWithRetry(() => import("./pages/AdminTempPasswordPage"));
const OnlineUsersPage = lazyWithRetry(() => import("./pages/OnlineUsersPage"));
const RealtimeHealthPage = lazyWithRetry(() => import("./pages/RealtimeHealthPage"));
const AdminActiveGamesPage = lazyWithRetry(() => import("./pages/AdminActiveGamesPage"));
const AdminEngagementPage = lazyWithRetry(() => import("./pages/AdminEngagementPage"));
const EditProfilePage = lazyWithRetry(() => import("./pages/EditProfilePage"));
const MyRolesPage = lazyWithRetry(() => import("./pages/MyRolesPage"));
const NotificationsPage = lazyWithRetry(() => import("./pages/NotificationsPage"));
const ManageRolesPage = lazyWithRetry(() => import("./pages/ManageRolesPage"));
const ManageTeamRolesPage = lazyWithRetry(() => import("./pages/ManageTeamRolesPage"));
const ChildrenPage = lazyWithRetry(() => import("./pages/ChildrenPage"));
const UpgradeProPage = lazyWithRetry(() => import("./pages/UpgradeProPage"));
const ClubUpgradePage = lazyWithRetry(() => import("./pages/ClubUpgradePage"));
const ManagePromoCodesPage = lazyWithRetry(() => import("./pages/ManagePromoCodesPage"));
const StripeSettingsPage = lazyWithRetry(() => import("./pages/StripeSettingsPage"));
const AppStripeSettingsPage = lazyWithRetry(() => import("./pages/AppStripeSettingsPage"));
const ManageFeedbackPage = lazyWithRetry(() => import("./pages/ManageFeedbackPage"));
const ManageUsersPage = lazyWithRetry(() => import("./pages/ManageUsersPage"));
const ManageBackupsPage = lazyWithRetry(() => import("./pages/ManageBackupsPage"));
const JoinTeamPage = lazyWithRetry(() => import("./pages/JoinTeamPage"));
const JoinClubPage = lazyWithRetry(() => import("./pages/JoinClubPage"));
const TermsOfServicePage = lazyWithRetry(() => import("./pages/TermsOfServicePage"));
const PrivacyPolicyPage = lazyWithRetry(() => import("./pages/PrivacyPolicyPage"));
const CancellationPolicyPage = lazyWithRetry(() => import("./pages/CancellationPolicyPage"));
const PlayerStatsReportPage = lazyWithRetry(() => import("./pages/PlayerStatsReportPage"));
const ClubRewardsPage = lazyWithRetry(() => import("./pages/ClubRewardsPage"));
const ClubNewsPage = lazyWithRetry(() => import("./pages/ClubNewsPage"));
const ClubNewsPostPage = lazyWithRetry(() => import("./pages/ClubNewsPostPage"));
const ClubRewardsReportPage = lazyWithRetry(() => import("./pages/ClubRewardsReportPage"));
const SponsorAnalyticsPage = lazyWithRetry(() => import("./pages/SponsorAnalyticsPage"));
const ManageAdsPage = lazyWithRetry(() => import("./pages/ManageAdsPage"));
const VideoGuideDownloadPage = lazyWithRetry(() => import("./pages/VideoGuideDownloadPage"));
const AttendanceStatsPage = lazyWithRetry(() => import("./pages/AttendanceStatsPage"));

const ClubEngagementAnalyticsPage = lazyWithRetry(() => import("./pages/ClubEngagementAnalyticsPage"));
const PushAnalyticsPage = lazyWithRetry(() => import("./pages/PushAnalyticsPage"));
const NotificationPreferencesPage = lazyWithRetry(() => import("./pages/NotificationPreferencesPage"));
const MiniLeaguesPage = lazyWithRetry(() => import("./pages/MiniLeaguesPage"));
const CompetitionsPage = lazyWithRetry(() => import("./pages/CompetitionsPage"));
const CreateCompetitionPage = lazyWithRetry(() => import("./pages/CreateCompetitionPage"));
const CompetitionDetailPage = lazyWithRetry(() => import("./pages/CompetitionDetailPage"));
const CompetitionSettingsPage = lazyWithRetry(() => import("./pages/CompetitionSettingsPage"));
const AssociationsPage = lazyWithRetry(() => import("./pages/AssociationsPage"));
const CreateAssociationPage = lazyWithRetry(() => import("./pages/CreateAssociationPage"));
const AssociationDetailPage = lazyWithRetry(() => import("./pages/AssociationDetailPage"));
const PublicCompetitionPage = lazyWithRetry(() => import("./pages/PublicCompetitionPage"));
const MiniLeagueDetailPage = lazyWithRetry(() => import("./pages/MiniLeagueDetailPage"));
const EventGroupPitchPage = lazyWithRetry(() => import("./pages/EventGroupPitchPage"));
const AppSettingsPage = lazyWithRetry(() => import("./pages/AppSettingsPage"));
const AdminAICatchUpPage = lazyWithRetry(() => import("./pages/AdminAICatchUpPage"));
const AdminIcpLlmTestPage = lazyWithRetry(() => import("./pages/AdminIcpLlmTestPage"));
const PlacementAdminSettingsPage = lazyWithRetry(() => import("./pages/PlacementAdminSettingsPage"));
const AdMobSettingsPage = lazyWithRetry(() => import("./pages/AdMobSettingsPage"));
const ClassEnrolmentPage = lazyWithRetry(() => import("./pages/ClassEnrolmentPage"));
const PayFeesPage = lazyWithRetry(() => import("./pages/PayFeesPage"));
const SendUpdateReminderPage = lazyWithRetry(() => import("./pages/SendUpdateReminderPage"));
const AdminDmAttachmentsPage = lazyWithRetry(() => import("./pages/AdminDmAttachmentsPage"));
const AdminChatPhotoRemindersPage = lazyWithRetry(() => import("./pages/AdminChatPhotoRemindersPage"));
const AdminChatVirtDebugPage = lazyWithRetry(() => import("./pages/AdminChatVirtDebugPage"));
const AdminDeletedChatsPage = lazyWithRetry(() => import("./pages/AdminDeletedChatsPage"));
const PublishChatPhotosPage = lazyWithRetry(() => import("./pages/PublishChatPhotosPage"));
const SeasonsPage = lazyWithRetry(() => import("./pages/SeasonsPage"));
const SeasonDetailPage = lazyWithRetry(() => import("./pages/SeasonDetailPage"));
const SeasonComparePage = lazyWithRetry(() => import("./pages/SeasonComparePage"));
const ShortInviteRedirect = lazyWithRetry(() => import("./pages/ShortInviteRedirect"));
const EoiAdminPage = lazyWithRetry(() => import("./pages/EoiAdminPage"));
const PublicEoiFormPage = lazyWithRetry(() => import("./pages/PublicEoiFormPage"));
const EoiCompletePage = lazyWithRetry(() => import("./pages/EoiCompletePage"));
const ClaimTeamPage = lazyWithRetry(() => import("./pages/ClaimTeamPage"));
const CompetitionJoinPage = lazyWithRetry(() => import("./pages/CompetitionJoinPage"));
const EmbeddedEoiFormPage = lazyWithRetry(() => import("./pages/EmbeddedEoiFormPage"));
// WatchLiveTeamPage archived: only served basketball/netball spectator view (archive/sports/pages/)
const LeaderboardPage = lazyWithRetry(() => import("./pages/LeaderboardPage"));
const NotFound = lazyWithRetry(() => import("./pages/NotFound"));

/**
 * SECURITY (cross-thread bleed): React Router reuses the same element instance
 * when only a route param changes, so navigating chat A -> chat B keeps every
 * `useState`/ref of the chat page alive (rendered message list, optimistic
 * merges, caches) until async effects catch up. That is how a message posted in
 * one group could momentarily render — and be persisted — inside another.
 * Keying on the param forces a clean remount per conversation.
 */
const RemountOnParamChange = ({
  param,
  children,
}: {
  param: string;
  children: ReactNode;
}) => {
  const params = useParams();
  return <Fragment key={params[param] ?? "none"}>{children}</Fragment>;
};



import { setupReactQueryNativeAdapter } from "@/lib/reactQueryNativeAdapter";
import { installWebReconnectInvalidator } from "@/lib/webReconnectInvalidator";
import { setupAndroidWebViewWake } from "@/lib/androidWebViewWake";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

// `offlineFirst` lets queryFn run even when the device is offline, so our
// cache-fallback branches (chat messages, schedule events, etc.) can return
// cached data instead of React Query pausing the query indefinitely (which
// would leave Schedule stuck on "loading" and chat threads blank).
//
// `retry: 1` + exponential backoff catches transient mobile-network blips
// (paired with the 15s PostgREST GET abort in supabaseAuthRetry.ts). One
// silent retry, then surface the error so cached data / retry UI can show.
// `refetchOnReconnect: "always"` (not `true`) so the moment Capacitor Network
// reports the device back online we re-pull EVERY active query — including
// ones whose data is still within its staleTime window. With plain `true`,
// queries that succeeded just before a brief network drop are considered
// fresh at reconnect and skip the refetch, which left Messages/Schedule/Media
// blank on Android until the app was killed (see audit 2026-06).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: "offlineFirst",
      retry: 1,
      retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 8000),
      refetchOnReconnect: "always",
      // Tighter defaults to reduce redundant refetches; per-query overrides
      // (e.g. staleTime: 0, refetchOnWindowFocus: true) still win where declared.
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
    },
    mutations: { networkMode: "offlineFirst" },
  },
});


// Configure React Query to refetch on reconnect/resume in native apps
setupReactQueryNativeAdapter(queryClient);
// Wire the Realtime channel registry to the QueryClient so revoked channels
// can evict their react-query caches (pass b of Realtime membership audit).
import("@/lib/realtimeChannelRegistry").then((m) => m.bindRealtimeRegistryQueryClient(queryClient));
// Web equivalent (native adapter early-returns off-native): scoped invalidator
// for photos / Pro-access on reconnect + tab-focus so Media doesn't stall.
installWebReconnectInvalidator(queryClient);
// Force Android WebView to repaint on resume (compositor pauses in background)
setupAndroidWebViewWake();

// Loading fallback component - uses CSS variables to respect current theme
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const MediaPhotoRedirect = () => {
  const { photoId } = useParams();
  return <Navigate to={`/media?photo=${photoId}`} replace />;
};

const ShareLinkRedirect = () => {
  const [searchParams] = useSearchParams();
  const type = searchParams.get("type");
  const id = searchParams.get("id");

  if (!type || !id) return <Navigate to="/" replace />;

  switch (type) {
    case "photo":
      return <Navigate to={`/media?photo=${id}`} replace />;
    case "event":
      return <Navigate to={`/events/${id}`} replace />;
    case "folder":
      return <Navigate to={`/vault/folder/${id}`} replace />;
    default:
      return <Navigate to="/" replace />;
  }
};

const DeepLinkGate = lazyWithRetry(() => import("@/components/DeepLinkGate"));

/**
 * Wrapper that shows a deep-link interstitial for in-app browsers (Messenger,
 * WhatsApp, etc.) and otherwise renders the normal child component.
 */
const WithDeepLinkGate = ({ children }: { children: React.ReactNode }) => {
  // Quick sync check — avoid lazy-loading DeepLinkGate when not needed
  const isNative = Capacitor.isNativePlatform();
  const ua = navigator.userAgent || "";
  const inApp = !isNative && /FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|WhatsApp|LinkedInApp|Messenger/i.test(ua);
  if (!inApp) return <>{children}</>;
  return (
    <Suspense fallback={<PageLoader />}>
      <DeepLinkGate />
    </Suspense>
  );
};


// Read stored theme synchronously to match index.html bootstrap
const getInitialTheme = (): 'light' | 'dark' => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('app-theme');
    if (stored === 'dark') return 'dark';
    if (stored === 'light') return 'light';
    // Check DOM class set by index.html script
    if (document.documentElement.classList.contains('dark')) return 'dark';
  }
  return 'light'; // Default to light to match index.html
};

const INITIAL_THEME = getInitialTheme();

const App = () => {
  // Global safety net: catch any unhandled promise rejections
  // This prevents iOS WebView crashes from uncaught async errors
  useEffect(() => {
    const handler = (event: PromiseRejectionEvent) => {
      console.error("[App] Unhandled promise rejection:", event.reason);
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, []);

  // Handle Android hardware back button
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let listener: { remove: () => void } | undefined;

    import('@capacitor/app').then(({ App: CapApp }) => {
      CapApp.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) {
          window.history.back();
        } else {
          CapApp.minimizeApp();
        }
      }).then(l => { listener = l; });
    });

    return () => { listener?.remove(); };
  }, []);

  // Android WebView "lost surface" recovery: after long sleep the GPU compositor
  // may not repaint until something invalidates it, leaving a blank dark screen
  // on resume. Force a multi-frame repaint cascade so the screen is never blank.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (Capacitor.getPlatform() !== 'android') return;

    let listener: { remove: () => void } | undefined;

    const kickCompositor = () => {
      try {
        const root = document.getElementById('root');
        if (!root) return;
        // 1. Force a reflow + compositing-layer toggle on the React root.
        root.style.transform = 'translateZ(0)';
        // Touching offsetHeight forces synchronous layout.
        void root.offsetHeight;
        // 2. Briefly hide/show via opacity to invalidate the surface tile.
        const prevOpacity = root.style.opacity;
        root.style.opacity = '0.999';
        requestAnimationFrame(() => {
          root.style.opacity = prevOpacity || '';
          root.style.transform = '';
          // 3. Nudge scroll by 1px and back — most reliable WebView repaint trigger.
          const y = window.scrollY;
          window.scrollTo(0, y + 1);
          requestAnimationFrame(() => {
            window.scrollTo(0, y);
          });
        });
      } catch {
        /* ignore */
      }
    };

    import('@capacitor/app').then(({ App: CapApp }) => {
      CapApp.addListener('resume', () => {
        kickCompositor();
        // Retry across the post-resume hydration window in case the first
        // kick lands before the WebView has fully restored its surface.
        setTimeout(kickCompositor, 120);
        setTimeout(kickCompositor, 400);
      }).then(l => { listener = l; });
    });

    return () => { listener?.remove(); };
  }, []);


  const useIcpAuth = resolveLocalAuthMode(window.location.search, true);
  const AuthBoundary = useIcpAuth ? IcpAuthProvider : AuthProvider;

  return (
  <ThemeProvider attribute="class" defaultTheme={INITIAL_THEME} enableSystem={false} storageKey="app-theme">
    <QueryClientProvider client={queryClient}>
      <AuthBoundary>
        <AccessibilityPrefsProvider>
        <ClubThemeProvider>
          <TooltipProvider>
          <DevRibbon />
          <Toaster />
          <Sonner />
          <IcsPreviewFallbackDialog />
          <NotifDebugOverlay />
          <BrowserRouter>
            <AppNavigatorBridge />
            <ScrollToTop />
            <PWAPendingInviteHandler />

            <Suspense fallback={null}><GlobalSubMonitorGate /></Suspense>
            <PitchBoardResumeRedirect />
            <MessagesBootstrapPrefetcher />

            <Suspense fallback={<PageLoader />}>
              <RouteErrorBoundary>
              <Routes>
                {/* Public routes */}
                <Route path="/auth" element={<AuthPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/verify-reset-code" element={<VerifyResetCodePage />} />
                <Route path="/complete-profile" element={<CompleteProfilePage />} />
                <Route path="/join/:token" element={<NativeOnlyGate><WithDeepLinkGate><JoinTeamPage /></WithDeepLinkGate></NativeOnlyGate>} />
                <Route path="/join/p/:token" element={<NativeOnlyGate><WithDeepLinkGate><JoinTeamPage /></WithDeepLinkGate></NativeOnlyGate>} />
                <Route path="/j/:code" element={<NativeOnlyGate><WithDeepLinkGate><ShortInviteRedirect /></WithDeepLinkGate></NativeOnlyGate>} />
                <Route path="/join-club/:token" element={<NativeOnlyGate><WithDeepLinkGate><JoinClubPage /></WithDeepLinkGate></NativeOnlyGate>} />
                <Route path="/signup-pro" element={<SignupProPage />} />
                <Route path="/terms" element={<TermsOfServicePage />} />
                <Route path="/privacy" element={<PrivacyPolicyPage />} />
                <Route path="/cancellation" element={<CancellationPolicyPage />} />
                <Route path="/video-guide" element={<VideoGuideDownloadPage />} />
                <Route path="/share" element={<ShareLinkRedirect />} />
<Route path="/eoi/:clubSlug/:seasonSlug" element={<PublicEoiFormPage />} />
<Route path="/eoi-embed/:clubSlug/:seasonSlug" element={<EmbeddedEoiFormPage />} />
<Route path="/eoi-complete/:token" element={<EoiCompletePage />} />
<Route path="/claim-team" element={<ClaimTeamPage />} />
<Route path="/competitions/join" element={<CompetitionJoinPage />} />


                {/* Protected routes */}
                <Route element={<AppLayout />}>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/events" element={<EventsPage />} />
                  <Route path="/events/new" element={<CreateEventPage />} />
                  <Route path="/events/:id" element={<EventDetailPage />} />
                  <Route path="/events/import" element={<ImportFixturesPage />} />
                  <Route path="/events/:id/edit" element={<EditEventPage />} />
                  <Route path="/events/:id/groups/:groupId/pitch" element={<EventGroupPitchPage />} />
                  <Route path="/events/:id/groups/:groupId/duties" element={<EventGroupPitchPage />} />
                  <Route path="/clubs" element={<ClubsPage />} />
                  <Route path="/clubs/new" element={<CreateClubPage />} />
                  <Route path="/start" element={<StartPage />} />
                  <Route path="/teams/new" element={<StartTeamPage />} />
                  <Route path="/clubs/:id" element={<ClubDetailPage />} />
                  <Route path="/club-link/:linkId" element={<ClubLinkEmbedPage />} />
                  <Route path="/news" element={<ClubNewsPage />} />
                  <Route path="/news/:newsId" element={<ClubNewsPostPage />} />
                  <Route path="/clubs/:clubId/setup" element={<ClubSetupWizardPage />} />
                  <Route path="/clubs/:id/edit" element={<EditClubPage />} />
                  <Route path="/clubs/:clubId/teams/new" element={<CreateTeamPage />} />
                  <Route path="/clubs/:clubId/roles" element={<ManageRolesPage />} />
                  <Route path="/clubs/:clubId/rewards" element={<ClubRewardsPage />} />
                  <Route path="/clubs/:clubId/rewards/report" element={<ClubRewardsReportPage />} />
                  <Route path="/clubs/:clubId/upgrade" element={<ClubUpgradePage />} />
                  <Route path="/clubs/:clubId/stripe" element={<StripeSettingsPage />} />
                  <Route path="/clubs/:clubId/enrol" element={<ClassEnrolmentPage />} />
                  <Route path="/teams/:id" element={<TeamDetailPage />} />
                  {/* /watch/team/:teamId route archived with WatchLiveTeamPage (court-sports only) */}
                  <Route path="/teams/:id/edit" element={<EditTeamPage />} />
                  <Route path="/teams/:teamId/roles" element={<ManageTeamRolesPage />} />
                  <Route path="/teams/:teamId/upgrade" element={<UpgradeProPage />} />
                  <Route path="/teams/:teamId/attendance" element={<AttendanceStatsPage />} />
                  <Route path="/clubs/:clubId/attendance" element={<Navigate to="engagement" replace />} />
                  <Route path="/clubs/:clubId/engagement" element={<ClubEngagementAnalyticsPage />} />
                  <Route path="/teams/:teamId/publish-chat-photos" element={<PublishChatPhotosPage />} />
                  <Route path="/messages" element={<MessagesPage />} />
                  <Route path="/scheduled-messages" element={<ScheduledMessagesPage />} />
                  <Route path="/messages/broadcast" element={<BroadcastChatPage />} />
                  <Route path="/messages/club/:clubId" element={<RemountOnParamChange param="clubId"><ClubChatPage /></RemountOnParamChange>} />
                   <Route path="/messages/dm/:conversationId" element={<RemountOnParamChange param="conversationId"><DirectMessagePage /></RemountOnParamChange>} />
                   <Route path="/messages/club-admin/:conversationId" element={<RemountOnParamChange param="conversationId"><ClubAdminChatPage /></RemountOnParamChange>} />
                  <Route path="/messages/welcome" element={<WelcomeMessagePage />} />
                  <Route path="/messages/:teamId" element={<RemountOnParamChange param="teamId"><TeamChatPage /></RemountOnParamChange>} />
                  <Route path="/groups/:groupId" element={<RemountOnParamChange param="groupId"><GroupChatPage /></RemountOnParamChange>} />

                  <Route path="/media" element={<MediaPage />} />
                  <Route path="/media/:photoId" element={<MediaPhotoRedirect />} />
                  <Route path="/vault" element={<VaultPage />} />
                  <Route path="/vault/folder/:folderId" element={<VaultPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/settings/accessibility" element={<AccessibilitySettingsPage />} />
                  <Route path="/account" element={<AccountPage />} />
                  <Route path="/admin" element={<AdminPage />} />
                  <Route path="/admin/online-users" element={<OnlineUsersPage />} />
                  <Route path="/admin/realtime-health" element={<RealtimeHealthPage />} />
                  <Route path="/admin/active-games" element={<AdminActiveGamesPage />} />
                  <Route path="/admin/engagement" element={<AdminEngagementPage />} />
                  <Route path="/edit-profile" element={<EditProfilePage />} />
                  <Route path="/leaderboard" element={<LeaderboardPage />} />
                  <Route path="/roles" element={<MyRolesPage />} />
                  <Route path="/children" element={<ChildrenPage />} />
                  <Route path="/children" element={<ChildrenPage />} />
                  <Route path="/notifications" element={<NotificationsPage />} />
                  <Route path="/pay-fees/:clubId" element={<PayFeesPage />} />
                  <Route path="/reports/player-stats" element={<PlayerStatsReportPage />} />
                  <Route path="/admin/promo-codes" element={<ManagePromoCodesPage />} />
                  <Route path="/admin/stripe" element={<AppStripeSettingsPage />} />
                  <Route path="/admin/feedback" element={<ManageFeedbackPage />} />
                  <Route path="/admin/users" element={<ManageUsersPage />} />
                  <Route path="/admin/temp-password" element={<AdminTempPasswordPage />} />
                  <Route path="/admin/backups" element={<ManageBackupsPage />} />
                  <Route path="/admin/sponsor-analytics" element={<SponsorAnalyticsPage />} />
                  <Route path="/admin/ads" element={<ManageAdsPage />} />
                  <Route path="/admin/push-analytics" element={<PushAnalyticsPage />} />
                  <Route path="/admin/notification-preferences" element={<NotificationPreferencesPage />} />
                  <Route path="/admin/settings" element={<AppSettingsPage />} />
                  <Route path="/admin/placement-settings" element={<PlacementAdminSettingsPage />} />
                  <Route path="/admin/ai-catch-up" element={<AdminAICatchUpPage />} />
                  <Route path="/admin/icp-llm-test" element={<AdminIcpLlmTestPage />} />
                  <Route path="/admin/admob" element={<AdMobSettingsPage />} />
                 <Route path="/admin/send-update-reminder" element={<SendUpdateReminderPage />} />
                <Route path="/admin/dm-attachments" element={<AdminDmAttachmentsPage />} />
                <Route path="/admin/chat-photo-reminders" element={<AdminChatPhotoRemindersPage />} />
                <Route path="/admin/chat-virt-debug" element={<AdminChatVirtDebugPage />} />
                <Route path="/admin/deleted-chats" element={<AdminDeletedChatsPage />} />
                  <Route path="/clubs/:clubId/seasons" element={<SeasonsPage />} />
                  <Route path="/clubs/:clubId/seasons/compare" element={<SeasonComparePage />} />
                  <Route path="/clubs/:clubId/seasons/:seasonId" element={<SeasonDetailPage />} />
                  <Route path="/clubs/:clubId/eois" element={<EoiAdminPage />} />
                  <Route path="/mini-leagues" element={<MiniLeaguesPage />} />
                  <Route path="/mini-leagues/:id" element={<MiniLeagueDetailPage />} />
                  <Route path="/competitions" element={<CompetitionsPage />} />
                  <Route path="/competitions/new" element={<CreateCompetitionPage />} />
                  <Route path="/competitions/:id" element={<CompetitionDetailPage />} />
                  <Route path="/competitions/:id/settings" element={<CompetitionSettingsPage />} />
                  <Route path="/associations" element={<AssociationsPage />} />
                  <Route path="/associations/new" element={<CreateAssociationPage />} />
                  <Route path="/associations/:id" element={<AssociationDetailPage />} />
                </Route>

                <Route path="/c/:id" element={<PublicCompetitionPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
              </RouteErrorBoundary>
            </Suspense>
            <CookieConsentBanner />
            <IOSInstallPrompt />
            <PushNotificationManager />
            <StatusBarManager />
            <NativeAppUpdatePrompt />
            <Suspense fallback={null}>
              <LegalReacceptanceGate />
            </Suspense>
            
          </BrowserRouter>
          </TooltipProvider>
        </ClubThemeProvider>
        </AccessibilityPrefsProvider>
      </AuthBoundary>
    </QueryClientProvider>
  </ThemeProvider>
  );
};

export default App;
