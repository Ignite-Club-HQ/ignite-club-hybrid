import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Lock, Unlock, Loader2, Plus, X, Shield } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ClubDMSettingsProps {
  clubId: string;
}

// Available roles that can be granted DM permission
const AVAILABLE_ROLES = [
  { value: "app_admin", label: "App Admin", description: "System administrators" },
  { value: "club_admin", label: "Club Admin", description: "Club administrators" },
  { value: "team_admin", label: "Team Admin", description: "Team managers" },
  { value: "coach", label: "Coach", description: "Team coaches" },
  { value: "committee_member", label: "Committee Member", description: "Club committee" },
  { value: "player", label: "Player", description: "Registered players" },
  { value: "parent", label: "Parent/Guardian", description: "Parents and guardians" },
];

// Default roles that always have DM access
const DEFAULT_ROLES = ["app_admin", "club_admin", "team_admin"];

export function ClubDMSettings({ clubId }: ClubDMSettingsProps) {
  const queryClient = useQueryClient();
  const [roleToAdd, setRoleToAdd] = useState<string>("");

  // Fetch current DM settings
  const { data: settings, isLoading } = useQuery({
    queryKey: ["club-dm-settings", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("club_dm_settings")
        .select("*")
        .eq("club_id", clubId)
        .maybeSingle();
      
      if (error) throw error;
      
      // Return defaults if no settings exist
      return data || {
        id: null,
        club_id: clubId,
        dm_enabled: true,
        allowed_roles: DEFAULT_ROLES,
      };
    },
  });

  // Upsert settings mutation
  const updateSettingsMutation = useMutation({
    mutationFn: async (newSettings: { dm_enabled?: boolean; allowed_roles?: string[] }) => {
      const { error } = await supabase
        .from("club_dm_settings")
        .upsert({
          club_id: clubId,
          dm_enabled: newSettings.dm_enabled ?? settings?.dm_enabled ?? true,
          allowed_roles: newSettings.allowed_roles ?? settings?.allowed_roles ?? DEFAULT_ROLES,
        }, {
          onConflict: "club_id",
        });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-dm-settings", clubId] });
      toast.success("DM settings updated");
    },
    onError: (error: Error) => {
      toast.error("Failed to update settings: " + error.message);
    },
  });

  const handleToggleDM = (enabled: boolean) => {
    updateSettingsMutation.mutate({ dm_enabled: enabled });
  };

  const handleAddRole = () => {
    if (!roleToAdd || !settings) return;
    
    const currentRoles = settings.allowed_roles || DEFAULT_ROLES;
    if (currentRoles.includes(roleToAdd)) {
      toast.error("This role already has DM permission");
      return;
    }

    updateSettingsMutation.mutate({
      allowed_roles: [...currentRoles, roleToAdd],
    });
    setRoleToAdd("");
  };

  const handleRemoveRole = (role: string) => {
    if (!settings) return;
    
    // Prevent removing default admin roles
    if (DEFAULT_ROLES.includes(role)) {
      toast.error("Admin roles cannot be removed from DM permissions");
      return;
    }

    const currentRoles = settings.allowed_roles || DEFAULT_ROLES;
    updateSettingsMutation.mutate({
      allowed_roles: currentRoles.filter(r => r !== role),
    });
  };

  const getRoleLabel = (role: string) => {
    return AVAILABLE_ROLES.find(r => r.value === role)?.label || role;
  };

  const isDefaultRole = (role: string) => DEFAULT_ROLES.includes(role);

  // Roles available to add (not already in the list)
  const availableToAdd = AVAILABLE_ROLES.filter(
    r => !(settings?.allowed_roles || DEFAULT_ROLES).includes(r.value)
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const dmEnabled = settings?.dm_enabled ?? true;
  const allowedRoles = settings?.allowed_roles || DEFAULT_ROLES;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5" />
          Direct Messages
        </CardTitle>
        <CardDescription>
          Control who can send direct messages within your club
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="dm-enabled" className="text-base font-medium flex items-center gap-2">
              {dmEnabled ? (
                <Unlock className="h-4 w-4 text-green-500" />
              ) : (
                <Lock className="h-4 w-4 text-destructive" />
              )}
              Enable Direct Messages
            </Label>
            <p className="text-sm text-muted-foreground">
              {dmEnabled 
                ? "Members with allowed roles can send DMs" 
                : "DMs are completely disabled for this club"}
            </p>
          </div>
          <Switch
            id="dm-enabled"
            checked={dmEnabled}
            onCheckedChange={handleToggleDM}
            disabled={updateSettingsMutation.isPending}
          />
        </div>

        {dmEnabled && (
          <>
            <div className="border-t pt-4">
              <Label className="text-base font-medium mb-3 block">
                Roles Allowed to Send DMs
              </Label>
              <p className="text-sm text-muted-foreground mb-4">
                Only members with these roles can initiate direct messages. All members can receive DMs from admins and system messages.
              </p>
              
              {/* Current roles */}
              <div className="flex flex-wrap gap-2 mb-4">
                {allowedRoles.map(role => (
                  <Badge 
                    key={role} 
                    variant={isDefaultRole(role) ? "default" : "secondary"}
                    className="gap-1 pr-1"
                  >
                    {isDefaultRole(role) && <Shield className="h-3 w-3" />}
                    {getRoleLabel(role)}
                    {!isDefaultRole(role) && (
                      <button
                        onClick={() => handleRemoveRole(role)}
                        disabled={updateSettingsMutation.isPending}
                        className="ml-1 rounded-full hover:bg-background/50 p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </Badge>
                ))}
              </div>

              {/* Add role */}
              {availableToAdd.length > 0 && (
                <div className="flex gap-2">
                  <Select value={roleToAdd} onValueChange={setRoleToAdd}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Add a role..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableToAdd.map(role => (
                        <SelectItem key={role.value} value={role.value}>
                          <div className="flex flex-col">
                            <span>{role.label}</span>
                            <span className="text-xs text-muted-foreground">{role.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={handleAddRole}
                    disabled={!roleToAdd || updateSettingsMutation.isPending}
                    size="icon"
                  >
                    {updateSettingsMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              )}
            </div>

            <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">Note:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Admin roles (App Admin, Club Admin, Team Admin) always have DM permission</li>
                <li>All members can receive welcome messages from Ignite Support</li>
                <li>Members cannot reply to system messages</li>
              </ul>
            </div>
          </>
        )}

        {updateSettingsMutation.isPending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Saving...
          </div>
        )}
      </CardContent>
    </Card>
  );
}
