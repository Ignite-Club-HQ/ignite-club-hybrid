import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Loader2, Ticket, Copy, Check, Calendar, Crown, Zap, Building2, Users, Lock, HardDrive } from "lucide-react";
import { format, isPast, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { getCachedRoles } from "@/lib/rolesCache";

type ScopeType = "club" | "team";
type PromoType = "subscription" | "storage";

import { IcpUnavailablePage } from "@/components/IcpUnavailablePage";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { membershipKeys } from "@/lab/membershipQueryKeys";

export default function ManagePromoCodesPage() {
  if (resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true)) {
    return <IcpUnavailablePage title="Promo-code administration is unavailable in ICP lab mode" description="Promo codes remain part of the disabled external billing boundary." />;
  }
  return <SupabaseManagePromoCodesPage />;
}

function SupabaseManagePromoCodesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newCode, setNewCode] = useState("");
  const [expiryDate, setExpiryDate] = useState<Date | undefined>();
  const [accessLevel, setAccessLevel] = useState<"pro" | "pro_football">("pro");
  const [scopeType, setScopeType] = useState<ScopeType>("club");
  const [promoType, setPromoType] = useState<PromoType>("subscription");
  const [storageGb, setStorageGb] = useState<string>("");
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expiryDrawerOpen, setExpiryDrawerOpen] = useState(false);
  const isMobile = useIsMobile();

  // Fetch user roles
  const { data: userRoles } = useQuery({
    queryKey: membershipKeys.userRolesFor(user?.id),
    queryFn: async () => {
      const cached = getCachedRoles();
      if (cached) return cached;
      
      const { data } = await supabase
        .from("user_roles")
        .select("*")
        .eq("user_id", user!.id);
      return data || [];
    },
    enabled: !!user,
  });

  const isAppAdmin = useMemo(() => {
    return userRoles?.some(r => r.role === "app_admin") || false;
  }, [userRoles]);

  const isClubAdmin = useMemo(() => {
    return userRoles?.some(r => r.role === "club_admin") || false;
  }, [userRoles]);

  const hasAccess = isAppAdmin || isClubAdmin;

  // Fetch all clubs for the dropdown
  const { data: clubs } = useQuery({
    queryKey: ["all-clubs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: hasAccess,
  });

  const { data: promoCodes, isLoading } = useQuery({
    queryKey: ["promo-codes"],
    queryFn: async () => {
      // Fetch promo codes with club relationship only (created_by references auth.users, not profiles)
      const { data, error } = await supabase
        .from("promo_codes")
        .select("*, clubs:club_id(id, name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      
      // Fetch creator profiles separately if needed
      if (data && data.length > 0) {
        const creatorIds = Array.from(
          new Set<string>(
            data.flatMap((promo) =>
              typeof promo.created_by === "string" ? [promo.created_by] : [],
            ),
          ),
        );
        if (creatorIds.length > 0) {
          const { data: profiles } = await selectCachedProfilesByIds(creatorIds);
          
          const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
          return data.map(promo => ({
            ...promo,
            creator_profile: profileMap.get(promo.created_by) || null
          }));
        }
      }
      return data?.map(promo => ({ ...promo, creator_profile: null })) || [];
    },
    enabled: hasAccess,
  });

  const createPromoMutation = useMutation({
    mutationFn: async ({ code, expiresAt, accessLevel, scopeType, clubId, promoType, storageGb }: { 
      code: string; 
      expiresAt?: Date; 
      accessLevel: string; 
      scopeType: string; 
      clubId: string | null;
      promoType: string;
      storageGb: number | null;
    }) => {
      const { error } = await supabase.from("promo_codes").insert({
        code: code.toUpperCase().trim(),
        created_by: user!.id,
        expires_at: expiresAt?.toISOString() || null,
        access_level: promoType === "storage" ? "storage" : accessLevel,
        scope_type: scopeType,
        club_id: clubId,
        storage_gb: promoType === "storage" ? storageGb : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["promo-codes"] });
      setNewCode("");
      setExpiryDate(undefined);
      setSelectedClubId(null);
      setStorageGb("");
      toast({ title: "Promo code created" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to create", 
        description: error.message.includes("duplicate") ? "Code already exists" : error.message,
        variant: "destructive" 
      });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from("promo_codes")
        .update({ is_active: isActive })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["promo-codes"] });
    },
  });

  const deletePromoMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("promo_codes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["promo-codes"] });
      toast({ title: "Promo code deleted" });
    },
  });

  const copyToClipboard = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!hasAccess) {
    return (
      <div className="py-6 text-center">
        <p className="text-muted-foreground">Access denied. Club admin only.</p>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Promo Codes</h1>
          <p className="text-sm text-muted-foreground">Manage promotional codes for Pro access</p>
        </div>
        <Ticket className="h-6 w-6 text-primary" />
      </div>

      {/* Create New Code */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Create New Code</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-code">Code & Expiry</Label>
            <div className="flex gap-2">
              <Input
                id="new-code"
                placeholder="IGNITE2024"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                className="uppercase flex-1"
              />
              {isMobile ? (
                <>
                  <Button 
                    variant="outline" 
                    className="w-[130px] justify-start text-left font-normal shrink-0"
                    onClick={() => setExpiryDrawerOpen(true)}
                  >
                    <Calendar className="mr-2 h-4 w-4 shrink-0" />
                    <span className="truncate">{expiryDate ? format(expiryDate, "MMM d") : "No expiry"}</span>
                  </Button>
                  <Drawer open={expiryDrawerOpen} onOpenChange={setExpiryDrawerOpen}>
                    <DrawerContent>
                      <DrawerHeader>
                        <DrawerTitle>Select Expiry Date</DrawerTitle>
                      </DrawerHeader>
                      <div className="p-4 flex justify-center">
                        <CalendarComponent
                          mode="single"
                          selected={expiryDate}
                          onSelect={(date) => {
                            setExpiryDate(date);
                            setExpiryDrawerOpen(false);
                          }}
                          disabled={(date) => date < new Date()}
                          className="pointer-events-auto w-full [&_.rdp-month]:w-full [&_.rdp-table]:w-full [&_.rdp-head_th]:text-base [&_.rdp-head_th]:py-2 [&_.rdp-cell]:h-12 [&_.rdp-day]:h-12 [&_.rdp-day]:w-full [&_.rdp-day]:text-lg [&_.rdp-caption_label]:text-lg [&_.rdp-nav_button]:h-10 [&_.rdp-nav_button]:w-10"
                        />
                      </div>
                      {expiryDate && (
                        <div className="p-4 border-t">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="w-full"
                            onClick={() => {
                              setExpiryDate(undefined);
                              setExpiryDrawerOpen(false);
                            }}
                          >
                            Clear expiry
                          </Button>
                        </div>
                      )}
                    </DrawerContent>
                  </Drawer>
                </>
              ) : (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-[140px] justify-start text-left font-normal shrink-0">
                      <Calendar className="mr-2 h-4 w-4 shrink-0" />
                      <span className="truncate">{expiryDate ? format(expiryDate, "MMM d, yyyy") : "No expiry"}</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <CalendarComponent
                      mode="single"
                      selected={expiryDate}
                      onSelect={setExpiryDate}
                      disabled={(date) => date < new Date()}
                      initialFocus
                      className="pointer-events-auto"
                    />
                    {expiryDate && (
                      <div className="p-2 border-t">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="w-full"
                          onClick={() => setExpiryDate(undefined)}
                        >
                          Clear expiry
                        </Button>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>

          {/* Promo Type Toggle */}
          <div className="space-y-2">
            <Label>Code Type</Label>
            <ToggleGroup 
              type="single" 
              value={promoType} 
              onValueChange={(v) => v && setPromoType(v as PromoType)}
              className="justify-start"
            >
              <ToggleGroupItem value="subscription" className="gap-2">
                <Crown className="h-4 w-4" />
                Subscription
              </ToggleGroupItem>
              <ToggleGroupItem value="storage" className="gap-2">
                <HardDrive className="h-4 w-4" />
                Storage
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="text-xs text-muted-foreground">
              {promoType === "subscription" 
                ? "Code grants Pro/Pro Football subscription access" 
                : "Code grants additional vault storage"}
            </p>
          </div>

          {promoType === "subscription" && (
            <>
              {/* Scope Type Toggle */}
              <div className="space-y-2">
                <Label>Applies To</Label>
                <ToggleGroup 
                  type="single" 
                  value={scopeType} 
                  onValueChange={(v) => v && setScopeType(v as ScopeType)}
                  className="justify-start"
                >
                  <ToggleGroupItem value="club" className="gap-2">
                    <Building2 className="h-4 w-4" />
                    Club Level
                  </ToggleGroupItem>
                  <ToggleGroupItem value="team" className="gap-2">
                    <Users className="h-4 w-4" />
                    Team Level
                  </ToggleGroupItem>
                </ToggleGroup>
                <p className="text-xs text-muted-foreground">
                  {scopeType === "club" 
                    ? "Code grants Pro access at the club level (all teams in club)" 
                    : "Code grants Pro access at the team level (individual team)"}
                </p>
              </div>

              {/* Access Level Toggle */}
              <div className="space-y-2">
                <Label>Access Level</Label>
                <ToggleGroup 
                  type="single" 
                  value={accessLevel} 
                  onValueChange={(v) => v && setAccessLevel(v as "pro" | "pro_football")}
                  className="justify-start"
                >
                  <ToggleGroupItem value="pro" className="gap-2">
                    <Crown className="h-4 w-4" />
                    Pro
                  </ToggleGroupItem>
                  <ToggleGroupItem value="pro_football" className="gap-2">
                    <Zap className="h-4 w-4" />
                    Pro Football
                  </ToggleGroupItem>
                </ToggleGroup>
                <p className="text-xs text-muted-foreground">
                  {accessLevel === "pro" 
                    ? "Standard Pro features (unlimited teams, storage, etc.)" 
                    : "Pro Football features (includes pitch board, player stats, etc.)"}
                </p>
              </div>
            </>
          )}

          {promoType === "storage" && (
            <div className="space-y-2">
              <Label>Storage Amount</Label>
              <Select 
                value={storageGb} 
                onValueChange={setStorageGb}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select storage size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10 GB</SelectItem>
                  <SelectItem value="50">50 GB</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Amount of additional storage this code grants
              </p>
            </div>
          )}

          {/* Optional Club Restriction */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Lock className="h-4 w-4" />
              Restrict to Club (Optional)
            </Label>
            <Select 
              value={selectedClubId || "none"} 
              onValueChange={(v) => setSelectedClubId(v === "none" ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Any club can use this code" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Any club can use this code</SelectItem>
                {clubs?.map((club) => (
                  <SelectItem key={club.id} value={club.id}>
                    {club.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {selectedClubId 
                ? "Only the selected club can use this code" 
                : "Leave blank to allow any club to use this code"}
            </p>
          </div>

          <Button 
            onClick={() => createPromoMutation.mutate({ 
              code: newCode, 
              expiresAt: expiryDate, 
              accessLevel, 
              scopeType: promoType === "storage" ? "club" : scopeType,
              clubId: selectedClubId,
              promoType,
              storageGb: promoType === "storage" ? parseInt(storageGb) : null
            })}
            disabled={!newCode.trim() || createPromoMutation.isPending || (promoType === "storage" && !storageGb)}
            className="w-full"
          >
            {createPromoMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Add Promo Code
          </Button>
        </CardContent>
      </Card>

      {/* Existing Codes */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Existing Codes ({promoCodes?.length || 0})</h2>
        
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : promoCodes?.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              No promo codes yet. Create one above.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {promoCodes?.map((promo) => {
              const isExpired = promo.expires_at && isPast(parseISO(promo.expires_at));
              const promoScopeType = (promo as any).scope_type || "club";
              const promoStorageGb = (promo as any).storage_gb;
              const isStoragePromo = promo.access_level === "storage" || promoStorageGb;
              
              return (
                <Card key={promo.id} className={isExpired ? "opacity-60" : ""}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="font-mono font-bold text-lg">{promo.code}</code>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => copyToClipboard(promo.code, promo.id)}
                          >
                            {copiedId === promo.id ? (
                              <Check className="h-3 w-3 text-green-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                          {isExpired ? (
                            <Badge variant="destructive">Expired</Badge>
                          ) : (
                            <Badge variant={promo.is_active ? "default" : "secondary"}>
                              {promo.is_active ? "Active" : "Inactive"}
                            </Badge>
                          )}
                          {isStoragePromo ? (
                            <Badge variant="outline" className="gap-1">
                              <HardDrive className="h-3 w-3" />
                              {promoStorageGb}GB Storage
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1">
                              {promo.access_level === "pro_football" ? (
                                <>
                                  <Zap className="h-3 w-3" />
                                  Pro Football
                                </>
                              ) : (
                                <>
                                  <Crown className="h-3 w-3" />
                                  Pro
                                </>
                              )}
                            </Badge>
                          )}
                          <Badge variant="secondary" className="gap-1">
                            {promoScopeType === "team" ? (
                              <>
                                <Users className="h-3 w-3" />
                                Team
                              </>
                            ) : (
                              <>
                                <Building2 className="h-3 w-3" />
                                Club
                              </>
                            )}
                          </Badge>
                          {(promo as any).clubs && (
                            <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-900/20">
                              <Lock className="h-3 w-3" />
                              {(promo.clubs as any).name}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Used {promo.uses_count} times
                          {promo.creator_profile && ` • Created by ${promo.creator_profile.display_name}`}
                          {promo.expires_at && (
                            <span className={isExpired ? "text-destructive" : ""}>
                              {" "}• {isExpired ? "Expired" : "Expires"} {format(parseISO(promo.expires_at), "MMM d, yyyy")}
                            </span>
                          )}
                        </p>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={promo.is_active}
                          onCheckedChange={(checked) => 
                            toggleActiveMutation.mutate({ id: promo.id, isActive: checked })
                          }
                          disabled={isExpired}
                        />
                      
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete promo code?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete the code "{promo.code}".
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deletePromoMutation.mutate(promo.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
