import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Search, UserPlus, Mail } from "lucide-react";

interface AssignTeamAdminSectionProps {
  clubId: string;
  teamId?: string; // Will be set after team is created
  teamName: string;
  onAssignmentChange: (assignment: TeamAdminAssignment | null) => void;
}

export interface TeamAdminAssignment {
  type: 'existing_user' | 'email_invite';
  userId?: string;
  userDisplayName?: string;
  inviteEmail?: string;
  inviteName?: string;
}

export function AssignTeamAdminSection({ 
  clubId, 
  teamId,
  teamName,
  onAssignmentChange 
}: AssignTeamAdminSectionProps) {
  const [assignOther, setAssignOther] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<{ id: string; display_name: string; avatar_url: string | null } | null>(null);
  const [wantsEmailInvite, setWantsEmailInvite] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");

  // Fetch club members who could become team admins
  const { data: clubMembers = [] } = useQuery({
    queryKey: ['club-members-for-admin', clubId, searchQuery],
    queryFn: async () => {
      if (!searchQuery.trim()) return [];
      
      // Get all users who have any role in this club (directly or via teams)
      const { data: directMembers } = await supabase
        .from('user_roles')
        .select('user_id, profiles!inner(id, display_name, avatar_url)')
        .eq('club_id', clubId);

      const { data: teamMembers } = await supabase
        .from('user_roles')
        .select(`
          user_id,
          teams!inner(club_id),
          profiles!inner(id, display_name, avatar_url)
        `)
        .eq('teams.club_id', clubId);

      const memberMap = new Map<string, { id: string; display_name: string; avatar_url: string | null }>();
      
      directMembers?.forEach(m => {
        const profile = m.profiles as any;
        if (profile?.display_name?.toLowerCase().includes(searchQuery.toLowerCase())) {
          memberMap.set(profile.id, {
            id: profile.id,
            display_name: profile.display_name,
            avatar_url: profile.avatar_url
          });
        }
      });

      teamMembers?.forEach(m => {
        const profile = m.profiles as any;
        if (profile?.display_name?.toLowerCase().includes(searchQuery.toLowerCase())) {
          memberMap.set(profile.id, {
            id: profile.id,
            display_name: profile.display_name,
            avatar_url: profile.avatar_url
          });
        }
      });

      return Array.from(memberMap.values());
    },
    enabled: assignOther && searchQuery.length >= 2,
  });

  const handleToggleAssignOther = (checked: boolean) => {
    setAssignOther(checked);
    if (!checked) {
      setSelectedUser(null);
      setWantsEmailInvite(false);
      setInviteName("");
      setInviteEmail("");
      onAssignmentChange(null);
    }
  };

  const handleSelectUser = (user: { id: string; display_name: string; avatar_url: string | null }) => {
    setSelectedUser(user);
    setWantsEmailInvite(false);
    onAssignmentChange({
      type: 'existing_user',
      userId: user.id,
      userDisplayName: user.display_name
    });
  };

  const handleSelectEmailInvite = () => {
    setWantsEmailInvite(true);
    setSelectedUser(null);
    // Don't call onAssignmentChange yet - wait for email input
  };

  const handleEmailInputChange = (name: string, email: string) => {
    setInviteName(name);
    setInviteEmail(email);
    
    // Only set assignment if both name and email are valid
    if (name.trim() && email.trim() && email.includes('@')) {
      onAssignmentChange({
        type: 'email_invite',
        inviteEmail: email.trim(),
        inviteName: name.trim()
      });
    } else {
      onAssignmentChange(null);
    }
  };

  if (!assignOther) {
    return (
      <div className="flex items-center justify-between py-3 px-4 bg-muted/30 rounded-lg">
        <div className="flex items-center gap-3">
          <UserPlus className="h-5 w-5 text-muted-foreground" />
          <div>
            <Label htmlFor="assign-other" className="text-sm font-medium">
              Assign someone else as Team Admin
            </Label>
            <p className="text-xs text-muted-foreground">
              You won't be added as admin
            </p>
          </div>
        </div>
        <Switch
          id="assign-other"
          checked={assignOther}
          onCheckedChange={handleToggleAssignOther}
        />
      </div>
    );
  }

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <UserPlus className="h-5 w-5 text-primary" />
          <Label className="text-sm font-medium">Assign Team Admin</Label>
        </div>
        <Switch
          checked={assignOther}
          onCheckedChange={handleToggleAssignOther}
        />
      </div>

      {/* Selected user display */}
      {selectedUser && (
        <div className="flex items-center gap-3 p-3 bg-primary/10 rounded-lg border border-primary/20">
          <Avatar className="h-10 w-10">
            <AvatarImage src={selectedUser.avatar_url || undefined} />
            <AvatarFallback>{selectedUser.display_name?.charAt(0) || 'U'}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <p className="font-medium">{selectedUser.display_name}</p>
            <p className="text-xs text-muted-foreground">Will be assigned as Team Admin</p>
          </div>
          <Badge variant="secondary">Selected</Badge>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => {
              setSelectedUser(null);
              onAssignmentChange(null);
            }}
          >
            Change
          </Button>
        </div>
      )}

      {/* Email invite form */}
      {wantsEmailInvite && !selectedUser && (
        <div className="space-y-3 p-4 bg-primary/10 rounded-lg border border-primary/20">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Send Email Invite</span>
          </div>
          
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Name *</Label>
              <Input
                placeholder="e.g., John Smith"
                value={inviteName}
                onChange={(e) => handleEmailInputChange(e.target.value, inviteEmail)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email *</Label>
              <Input
                type="email"
                placeholder="e.g., redacted@example.invalid"
                value={inviteEmail}
                onChange={(e) => handleEmailInputChange(inviteName, e.target.value)}
              />
            </div>
          </div>
          
          <p className="text-xs text-muted-foreground">
            An invite email will be sent after the team is created.
          </p>
          
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => {
              setWantsEmailInvite(false);
              setInviteName("");
              setInviteEmail("");
              onAssignmentChange(null);
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Search or invite options */}
      {!selectedUser && !wantsEmailInvite && (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search existing members by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Search results */}
          {searchQuery.length >= 2 && clubMembers.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {clubMembers.map((member) => (
                <button
                  key={member.id}
                  onClick={() => handleSelectUser(member)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors text-left"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={member.avatar_url || undefined} />
                    <AvatarFallback>{member.display_name?.charAt(0) || 'U'}</AvatarFallback>
                  </Avatar>
                  <span className="font-medium text-sm">{member.display_name}</span>
                </button>
              ))}
            </div>
          )}

          {searchQuery.length >= 2 && clubMembers.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-2">
              No members found matching "{searchQuery}"
            </p>
          )}

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">or</span>
            </div>
          </div>

          <Button 
            variant="outline" 
            className="w-full"
            onClick={handleSelectEmailInvite}
          >
            <Mail className="h-4 w-4 mr-2" />
            Invite New Person via Email
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            If they're not yet on Ignite, send an email invite so they can sign up and become Team Admin.
          </p>
        </>
      )}
    </Card>
  );
}
