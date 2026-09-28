import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, Loader2, AlertCircle, Users, Sparkles, Baby, UserCheck, Crown, Clock, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { AssignTeamAdminSection, TeamAdminAssignment } from "@/components/AssignTeamAdminSection";
import { ClassFieldsSection } from "@/components/ClassFieldsSection";
import { LevelAgeCombobox } from "@/components/LevelAgeCombobox";
import { defaultRsvpAudienceForTeam } from "@/lib/teamAgeDefaults";
import { invalidateTeamLists } from "@/lib/invalidateTeamLists";
// TeamAdminInviteDialog now shown on TeamDetailPage via navigation state
import type { Database } from "@/integrations/supabase/types";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabClubDetail, getLocalLabTeamList } from "@/lab/fixtureDataLayer";

type AppRole = Database["public"]["Enums"]["app_role"];

export default function CreateTeamPage() {
  // Helper to determine entity label based on class mode
  const isClassMode = (clubData: typeof club) => clubData?.class_mode_enabled === true;
  const entityLabel = (clubData: typeof club) => isClassMode(clubData) ? "Class" : "Team";
  const entityLabelLower = (clubData: typeof club) => isClassMode(clubData) ? "class" : "team";
  const { clubId } = useParams<{ clubId: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  const providerKey = useIcpLab ? "icp" : "supabase";

  const [name, setName] = useState("");
  const [levelAge, setLevelAge] = useState("");
  const [description, setDescription] = useState("");
  
  const [folderId, setFolderId] = useState<string | null>(null);
  const [teamType, setTeamType] = useState<"junior" | "senior" | "mixed">("mixed");
  const [saving, setSaving] = useState(false);
  const [adminAssignment, setAdminAssignment] = useState<TeamAdminAssignment | null>(null);

  // Class mode fields
  const [classDay, setClassDay] = useState("");
  const [classTime, setClassTime] = useState("");
  const [classDuration, setClassDuration] = useState<number | null>(null);
  const [classCapacity, setClassCapacity] = useState<number | null>(null);
  
  // Invite dialog state no longer needed - we navigate immediately with state

  const { data: club } = useQuery({
    queryKey: ["club", clubId, "create-team", providerKey],
    queryFn: async () => {
      if (useIcpLab) {
        const fixture = getLocalLabClubDetail(clubId!);
        return fixture ? {
          name: fixture.name,
          logo_url: fixture.logo_url,
          class_mode_enabled: false,
          contact_email: null,
        } : null;
      }
      const { data, error } = await supabase
        .from("clubs")
        .select("name, logo_url, class_mode_enabled, contact_email")
        .eq("id", clubId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!clubId,
  });

  // Check if current user is a club admin or app admin
  const { data: isClubAdmin, isLoading: isCheckingAdmin } = useQuery({
    queryKey: ["is-club-admin", clubId, user?.id, providerKey],
    queryFn: async () => {
      if (useIcpLab) return true;
      // Check for app_admin role
      const { data: appAdminRole } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      if (appAdminRole) return true;
      
      // Check for club_admin role for this club
      const { data: clubAdminRole } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("club_id", clubId!)
        .eq("role", "club_admin")
        .maybeSingle();
      return !!clubAdminRole;
    },
    enabled: !!clubId && !!user,
  });

  // Get team count and club subscription
  const { data: teamCount = 0 } = useQuery({
    queryKey: ["club-team-count", clubId, providerKey],
    queryFn: async () => {
      if (useIcpLab) {
        return getLocalLabTeamList().filter((team) => team.club_id === clubId).length;
      }
      const { count, error } = await supabase
        .from("teams")
        .select("*", { count: "exact", head: true })
        .eq("club_id", clubId!);
      if (error) throw error;
      return count || 0;
    },
    enabled: !!clubId,
  });

  const { data: clubSubscription } = useQuery({
    queryKey: ["club-subscription", clubId, providerKey],
    queryFn: async () => {
      if (useIcpLab) return null;
      const { data } = await supabase
        .from("club_subscriptions")
        .select("*")
        .eq("club_id", clubId!)
        .maybeSingle();
      return data;
    },
    enabled: !!clubId,
  });

  // Fetch team folders for selection
  const { data: folders = [] } = useQuery({
    queryKey: ["team-folders", clubId, providerKey],
    queryFn: async () => {
      if (useIcpLab) return [];
      const { data, error } = await supabase
        .from("team_folders")
        .select("*")
        .eq("club_id", clubId!)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!clubId,
  });

  // Check if team limit is exceeded
  const teamLimitExceeded = clubSubscription?.team_limit !== null && 
    clubSubscription?.team_limit !== undefined &&
    teamCount >= clubSubscription.team_limit;

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLogoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setLogoPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };


  const handleSubmit = async () => {
    const label = entityLabelLower(club);
    if (!name.trim()) {
      toast({
        title: "Missing information",
        description: `Please enter a ${label} name.`,
        variant: "destructive",
      });
      return;
    }

    // Validate class_day is set when in class mode
    if (club?.class_mode_enabled && !classDay) {
      toast({
        title: "Missing information",
        description: "Please select a day of the week for this class.",
        variant: "destructive",
      });
      return;
    }

    if (useIcpLab) {
      toast({
        title: "Team creation is unavailable in ICP lab mode",
        description: "No team, role, invitation, or media data has been persisted.",
      });
      return;
    }

    setSaving(true);

    // Check for duplicate team name in the same club
    const { data: existingTeam } = await supabase
      .from("teams")
      .select("id")
      .eq("club_id", clubId!)
      .is("deleted_at", null)
      .ilike("name", name.trim())
      .maybeSingle();

    if (existingTeam) {
      setSaving(false);
      toast({
        title: `${entityLabel(club)} name already exists`,
        description: `A ${entityLabelLower(club)} called "${name.trim()}" already exists in this club. Please choose a different name.`,
        variant: "destructive",
      });
      return;
    }

    // Non-admin flow: submit as a team creation request
    if (!isClubAdmin) {
      // Upload logo first if provided
      let logoUrl: string | null = null;
      if (logoFile) {
        try {
          const fileExt = logoFile.name.split('.').pop();
          const fileName = `team-requests/${user!.id}/${Date.now()}.${fileExt}`;
          const { error: uploadError } = await supabase.storage
            .from('club-logos')
            .upload(fileName, logoFile, { upsert: true });
          if (!uploadError) {
            const { data: urlData } = supabase.storage
              .from('club-logos')
              .getPublicUrl(fileName);
            logoUrl = urlData.publicUrl;
          }
        } catch (error) {
          console.error('Logo upload error:', error);
        }
      }

      const { error: requestError } = await supabase
        .from("team_creation_requests")
        .insert({
          club_id: clubId!,
          requested_by: user!.id,
          name: name.trim(),
          level_age: levelAge.trim() || null,
          description: description.trim() || null,
          logo_url: logoUrl,
          team_type: teamType,
          folder_id: folderId || null,
          ...(club?.class_mode_enabled ? {
            class_day: classDay || null,
            class_time: classTime || null,
            class_duration_minutes: classDuration,
            class_capacity: classCapacity,
          } : {}),
        } as any);

      setSaving(false);

      if (requestError) {
        toast({
          title: "Error",
          description: `Failed to submit ${entityLabelLower(club)} request. Please try again.`,
          variant: "destructive",
        });
        return;
      }

      navigate(-1);
      return;
    }

    // Create the team (without logo - will update after upload)
    const { data: team, error: teamError } = await supabase
      .from("teams")
      .insert({
        name: name.trim(),
        club_id: clubId!,
        level_age: levelAge.trim() || null,
        description: description.trim() || null,
        logo_url: null, // Will be updated after upload
        folder_id: folderId || null,
        team_type: teamType,
        created_by: user!.id,
        default_rsvp_audience: defaultRsvpAudienceForTeam(name, levelAge),
        ...(club?.class_mode_enabled ? {
          class_day: classDay || null,
          class_time: classTime || null,
          class_duration_minutes: classDuration,
          class_capacity: classCapacity,
        } : {}),
      })
      .select()
      .single();

    if (teamError) {
      setSaving(false);
      // Check if it's a unique constraint violation
      if (teamError.code === '23505') {
        toast({
          title: `${entityLabel(club)} name already exists`,
          description: `A ${entityLabelLower(club)} called "${name.trim()}" already exists in this club. Please choose a different name.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: `Failed to create ${entityLabelLower(club)}. Please try again.`,
          variant: "destructive",
        });
      }
      return;
    }

    // Upload logo to storage if one was selected
    if (logoFile) {
      try {
        const fileExt = logoFile.name.split('.').pop();
        const fileName = `${clubId}/${team.id}/${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('club-logos')
          .upload(fileName, logoFile, { upsert: true });

        if (!uploadError) {
          const { data: urlData } = supabase.storage
            .from('club-logos')
            .getPublicUrl(fileName);

          await supabase
            .from("teams")
            .update({ logo_url: urlData.publicUrl })
            .eq("id", team.id);
        }
      } catch (error) {
        console.error('Team logo upload error:', error);
      }
    }

    // Handle admin assignment
    if (adminAssignment?.type === 'existing_user' && adminAssignment.userId) {
      // Assign the selected user as team admin
      const { error: roleError } = await supabase.from("user_roles").insert({
        user_id: adminAssignment.userId,
        role: "team_admin" as AppRole,
        club_id: clubId!,
        team_id: team.id,
      });

      setSaving(false);
      if (roleError) {
        toast({
          title: `${entityLabel(club)} created but couldn't assign admin role.`,
          description: "Team created but couldn't assign admin role.",
          variant: "destructive",
        });
      }
      await invalidateTeamLists(queryClient, user?.id);
      navigate(`/teams/${team.id}`);
    } else if (adminAssignment?.type === 'email_invite' && adminAssignment.inviteEmail && adminAssignment.inviteName) {
      // Create pending invite with email
      const inviteToken = crypto.randomUUID();
      const link = `${window.location.origin}/join/p/${inviteToken}`;
      
      const { error: inviteError } = await supabase.from("pending_invites").insert({
        team_id: team.id,
        club_id: clubId,
        role: "team_admin" as AppRole,
        invited_user_id: null,
        invited_by_user_id: user!.id,
        invited_label: adminAssignment.inviteName,
        invited_email: adminAssignment.inviteEmail.toLowerCase(),
        invite_token: inviteToken,
      } as any);

      if (inviteError) {
        setSaving(false);
        toast({
          title: "Warning",
          description: `${entityLabel(club)} created but couldn't create invite.`,
          variant: "destructive",
        });
        await invalidateTeamLists(queryClient, user?.id);
      navigate(`/teams/${team.id}`);
        return;
      }
      
      // Send email invite
      try {
        await supabase.functions.invoke("send-email", {
          body: {
            to: adminAssignment.inviteEmail,
            subject: `You're invited to manage ${team.name}`,
            template: "team-invite",
            senderName: club?.name || undefined,
            replyTo: (club as any)?.contact_email || undefined,
            templateData: {
              recipientName: adminAssignment.inviteName,
              invitedEmail: adminAssignment.inviteEmail,
              teamName: team.name,
              clubName: club?.name || "The Club",
              roleName: "Team Admin",
              inviteLink: link,
              clubLogoUrl: club?.logo_url || undefined,
            },
          },
        });
        
        // Update pending invite with email sent status
        await supabase
          .from("pending_invites")
          .update({
            email_sent_at: new Date().toISOString(),
          } as any)
          .eq("invite_token", inviteToken);
          
      } catch (error) {
        console.error("Failed to send email:", error);
      }

      setSaving(false);
      await invalidateTeamLists(queryClient, user?.id);
      navigate(`/teams/${team.id}`, {
        state: { 
          showAdminInvite: true, 
          inviteName: adminAssignment.inviteName,
          inviteEmail: adminAssignment.inviteEmail,
          teamName: team.name 
        } 
      });
    } else {
      // Default: Assign creator as team_admin
      const { error: roleError } = await supabase.from("user_roles").insert({
        user_id: user!.id,
        role: "team_admin" as AppRole,
        club_id: clubId!,
        team_id: team.id,
      });

      setSaving(false);

      if (roleError) {
        toast({
          title: "Warning",
          description: `${entityLabel(club)} created but couldn't assign admin role.`,
          variant: "destructive",
        });
      }

      // If user came here from a competition join link, return them to finish joining
      const pendingCompToken = sessionStorage.getItem("pendingCompetitionJoinToken");
      if (pendingCompToken) {
        sessionStorage.removeItem("pendingCompetitionJoinToken");
        sessionStorage.removeItem("redirectAfterAuth");
        await invalidateTeamLists(queryClient, user?.id);
        navigate(`/competitions/join?token=${pendingCompToken}`);
        return;
      }
      await invalidateTeamLists(queryClient, user?.id);
      navigate(`/teams/${team.id}`);
    }
  };

  // No longer needed - we navigate immediately now

  // Show loading while checking admin status
  if (isCheckingAdmin) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (useIcpLab) {
    return (
      <div className="min-h-[100dvh] bg-background px-4 py-6">
        <div className="mx-auto max-w-lg space-y-4">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
            <h1 className="text-lg font-semibold">Team creation is unavailable in ICP lab mode</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {club
                ? `${club.name} is a synthetic fixture. Team creation, role assignment, invitations, and logo uploads are not persisted.`
                : "This synthetic club is unavailable. No team data can be created."}
            </p>
          </div>
        </div>
      </div>
    );
  }



  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="flex items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold">Create {entityLabel(club)}</h1>
            {club && (
              <p className="text-sm text-muted-foreground truncate">{club.name}</p>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-6 space-y-8 max-w-lg mx-auto">
          {/* Team/Class Limit Warning */}
          {teamLimitExceeded && (
            <Alert variant="destructive" className="border-destructive/50 bg-destructive/10">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="flex flex-col gap-3">
                <span>
                  Your club has reached its {entityLabelLower(club)} limit ({clubSubscription?.team_limit} {entityLabelLower(club)}es). 
                  Please upgrade your club subscription to add more.
                </span>
                <Button asChild size="sm" className="w-fit">
                  <Link to={`/clubs/${clubId}/upgrade`}>
                    <Crown className="h-4 w-4 mr-2" />
                    Upgrade Plan
                  </Link>
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* Hero Section with Logo */}
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-primary/50 to-primary/30 rounded-full blur opacity-40 group-hover:opacity-60 transition-opacity" />
              <Avatar className="relative h-32 w-32 border-4 border-background shadow-xl">
                <AvatarImage src={logoPreview || undefined} className="object-cover" />
                <AvatarFallback className="bg-muted text-muted-foreground text-4xl">
                  {name.charAt(0)?.toUpperCase() || <Users className="h-12 w-12" />}
                </AvatarFallback>
              </Avatar>
              <label className="absolute bottom-1 right-1 p-2.5 rounded-full bg-primary cursor-pointer hover:bg-primary/90 transition-all shadow-lg hover:scale-105 active:scale-95">
                <Camera className="h-4 w-4 text-primary-foreground" />
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoUpload}
                />
              </label>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Add your {entityLabelLower(club)} logo</p>
              <p className="text-xs text-muted-foreground/70">Recommended: Square image, 400x400px</p>
            </div>
          </div>

          {/* Form Fields */}
          <div className="space-y-6">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm font-medium">
                {entityLabel(club)} Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                placeholder={club?.class_mode_enabled ? "e.g., Monday Beginners" : "e.g., U12 Dragons"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                className="h-12 text-base bg-muted/50 border-muted-foreground/20 focus:bg-background transition-colors"
              />
            </div>

            {/* Team Type — must come before Level / Age Group because it
                drives which levels the combobox offers. */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Team Type</Label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setTeamType("junior")}
                  className={`p-3 rounded-xl text-center transition-all border-2 ${
                    teamType === "junior"
                      ? "border-pink-500 bg-pink-500/10"
                      : "border-border hover:border-pink-500/50"
                  }`}
                >
                  <Baby className={`h-5 w-5 mx-auto mb-1 ${teamType === "junior" ? "text-pink-600" : "text-muted-foreground"}`} />
                  <p className={`text-sm font-medium ${teamType === "junior" ? "text-pink-600" : ""}`}>Junior</p>
                  <p className="text-[10px] text-muted-foreground">Kids only</p>
                </button>
                <button
                  type="button"
                  onClick={() => setTeamType("senior")}
                  className={`p-3 rounded-xl text-center transition-all border-2 ${
                    teamType === "senior"
                      ? "border-amber-500 bg-amber-500/10"
                      : "border-border hover:border-amber-500/50"
                  }`}
                >
                  <UserCheck className={`h-5 w-5 mx-auto mb-1 ${teamType === "senior" ? "text-amber-600" : "text-muted-foreground"}`} />
                  <p className={`text-sm font-medium ${teamType === "senior" ? "text-amber-600" : ""}`}>Senior</p>
                  <p className="text-[10px] text-muted-foreground">Adults only</p>
                </button>
                <button
                  type="button"
                  onClick={() => setTeamType("mixed")}
                  className={`p-3 rounded-xl text-center transition-all border-2 ${
                    teamType === "mixed"
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <Users className={`h-5 w-5 mx-auto mb-1 ${teamType === "mixed" ? "text-primary" : "text-muted-foreground"}`} />
                  <p className={`text-sm font-medium ${teamType === "mixed" ? "text-primary" : ""}`}>Mixed</p>
                  <p className="text-[10px] text-muted-foreground">All ages</p>
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {teamType === "junior" && "Only parents with child players can be added"}
                {teamType === "senior" && "Only adult players can be added (no parents/kids)"}
                {teamType === "mixed" && "All member types can be added"}
              </p>
            </div>

            {/* Level / Age Group */}
            <div className="space-y-2">
              <Label htmlFor="levelAge" className="text-sm font-medium">
                Level / Age Group
              </Label>
              <LevelAgeCombobox
                value={levelAge}
                onChange={setLevelAge}
                teamType={teamType}
              />

            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description" className="text-sm font-medium">
                Description
              </Label>
              <Textarea
                id="description"
                placeholder={club?.class_mode_enabled ? "Describe this class, what students will learn..." : "Tell members about this team..."}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                rows={4}
                className="text-base resize-none bg-muted/50 border-muted-foreground/20 focus:bg-background transition-colors"
              />
              <p className="text-xs text-muted-foreground text-right">{description.length}/500</p>
            </div>



            {/* Class Mode Fields */}
            {club?.class_mode_enabled && (
              <ClassFieldsSection
                classDay={classDay}
                setClassDay={setClassDay}
                classTime={classTime}
                setClassTime={setClassTime}
                classDuration={classDuration}
                setClassDuration={setClassDuration}
                classCapacity={classCapacity}
                setClassCapacity={setClassCapacity}
              />
            )}
          </div>

          {/* Assign Team Admin Section - only for club admins */}
          {clubId && isClubAdmin && (
            <AssignTeamAdminSection
              clubId={clubId}
              teamName={name || `this ${entityLabelLower(club)}`}
              onAssignmentChange={setAdminAssignment}
            />
          )}

          {/* Info Card */}
          {!adminAssignment && (
            <div className={`rounded-xl p-4 border ${isClubAdmin ? 'bg-primary/5 border-primary/10' : 'bg-amber-500/5 border-amber-500/20'}`}>
              <div className="flex gap-3">
                <div className="shrink-0 mt-0.5">
                  {isClubAdmin ? (
                    <Sparkles className="h-5 w-5 text-primary" />
                  ) : (
                    <Clock className="h-5 w-5 text-amber-500" />
                  )}
                </div>
                <div className="space-y-1">
                  {isClubAdmin ? (
                    <>
                      <p className="text-sm font-medium text-foreground">You'll be the {entityLabelLower(club)} admin</p>
                      <p className="text-xs text-muted-foreground">
                        As the creator, you'll have full control to manage members, events, and {entityLabelLower(club)} settings.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-foreground">Requires club admin approval</p>
                      <p className="text-xs text-muted-foreground">
                        Your {entityLabelLower(club)} request will be sent to the club admin for review. Once approved, the {entityLabelLower(club)} will be created and you'll be assigned as its admin.
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Fixed Bottom Button */}
      <div className="sticky bottom-0 p-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t">
        <div className="max-w-lg mx-auto">
          <Button
            className="w-full h-12 text-base font-semibold shadow-lg"
            onClick={handleSubmit}
            disabled={saving || !name.trim() || (isClubAdmin && teamLimitExceeded)}
          >
            {saving ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : isClubAdmin && teamLimitExceeded ? (
              "Upgrade Required"
            ) : !isClubAdmin ? (
              <>
                <Send className="h-5 w-5 mr-2" />
                Submit Request
              </>
            ) : (
              `Create ${entityLabel(club)}`
            )}
          </Button>
        </div>
      </div>

    </div>
  );
}
