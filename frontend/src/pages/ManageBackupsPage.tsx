import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, RefreshCw, FileArchive, Calendar, HardDrive, Loader2, AlertCircle, CheckCircle2, RotateCcw, FolderOpen, File, ChevronRight, ChevronDown, Building2, Users, MessageSquare, CalendarDays, Gift, Image, Shield, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { format } from "date-fns";

interface BackupFile {
  name: string;
  id: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

interface BackupEntry {
  path: string;
  name: string;
  size: number;
  isFolder: boolean;
}

interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  size: number;
  children: Map<string, TreeNode>;
  expanded?: boolean;
}

import { IcpUnavailablePage } from "@/components/IcpUnavailablePage";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

export default function ManageBackupsPage() {
  if (resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true)) {
    return <IcpUnavailablePage title="Backup administration is unavailable in ICP lab mode" description="Backup creation, download, and restore require an approved encrypted export and recovery design." />;
  }
  return <SupabaseManageBackupsPage />;
}

function SupabaseManageBackupsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [backupToDelete, setBackupToDelete] = useState<string | null>(null);
  const [selectedBackup, setSelectedBackup] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [restoreMode, setRestoreMode] = useState<"files_only" | "full">("files_only");

  // Check if user is app admin
  const { data: isAppAdmin, isLoading: isLoadingAdmin } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });

  // Fetch backups list
  const { data: backups, isLoading: isLoadingBackups, refetch } = useQuery({
    queryKey: ["vault-backups"],
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("backups")
        .list(undefined, {
          sortBy: { column: "created_at", order: "desc" },
        });
      
      if (error) throw error;
      return (data || []).filter(f => f.name.startsWith("vault-backup-")) as BackupFile[];
    },
    enabled: isAppAdmin === true,
  });

  // Fetch backup contents when restore dialog is open
  const { data: backupContents, isLoading: isLoadingContents } = useQuery({
    queryKey: ["backup-contents", selectedBackup],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("vault-backup-list", {
        body: { backupName: selectedBackup },
      });
      if (error) throw error;
      return data as { entries: BackupEntry[]; manifest: unknown; totalFiles: number; totalFolders: number };
    },
    enabled: !!selectedBackup && restoreDialogOpen,
  });

  // Manual backup trigger
  const triggerBackupMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("vault-backup");
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`Backup completed: ${data.files_backed_up} files backed up`);
        queryClient.invalidateQueries({ queryKey: ["vault-backups"] });
      } else {
        toast.error(`Backup failed: ${data.error}`);
      }
    },
    onError: (error: Error) => {
      toast.error(`Backup failed: ${error.message}`);
    },
  });

  // Restore mutation
  const restoreMutation = useMutation({
    mutationFn: async ({ paths, mode }: { paths: string[]; mode: "files_only" | "full" }) => {
      const { data, error } = await supabase.functions.invoke("vault-backup-restore", {
        body: { backupName: selectedBackup, paths, restoreMode: mode },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`Restored ${data.totalRestored} items${data.totalErrors > 0 ? ` (${data.totalErrors} errors)` : ""}`);
        setRestoreDialogOpen(false);
        setSelectedBackup(null);
        setSelectedPaths(new Set());
        setRestoreMode("files_only");
      } else {
        toast.error(`Restore failed: ${data.error}`);
      }
    },
    onError: (error: Error) => {
      toast.error(`Restore failed: ${error.message}`);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (filename: string) => {
      const { error } = await supabase.storage
        .from("backups")
        .remove([filename]);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Backup deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["vault-backups"] });
      setDeleteDialogOpen(false);
      setBackupToDelete(null);
    },
    onError: (error: Error) => {
      toast.error(`Delete failed: ${error.message}`);
    },
  });

  const openDeleteDialog = (backupName: string) => {
    setBackupToDelete(backupName);
    setDeleteDialogOpen(true);
  };

  const handleDelete = () => {
    if (backupToDelete) {
      deleteMutation.mutate(backupToDelete);
    }
  };

  // Build tree structure from flat entries
  const buildTree = (entries: BackupEntry[]): TreeNode => {
    const root: TreeNode = { name: "", path: "", isFolder: true, size: 0, children: new Map() };
    
    for (const entry of entries) {
      const parts = entry.path.split("/");
      let current = root;
      
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = i === parts.length - 1;
        const currentPath = parts.slice(0, i + 1).join("/");
        
        if (!current.children.has(part)) {
          current.children.set(part, {
            name: part,
            path: currentPath,
            isFolder: !isLast || entry.isFolder,
            size: isLast ? entry.size : 0,
            children: new Map(),
          });
        }
        current = current.children.get(part)!;
      }
    }
    
    return root;
  };

  // Get all file paths under a folder
  const getFilesUnderPath = (node: TreeNode): string[] => {
    const files: string[] = [];
    
    const traverse = (n: TreeNode) => {
      if (!n.isFolder) {
        files.push(n.path);
      }
      n.children.forEach(child => traverse(child));
    };
    
    traverse(node);
    return files;
  };

  // Handle folder/file selection
  const toggleSelection = (node: TreeNode) => {
    const newSelected = new Set(selectedPaths);
    
    if (node.isFolder) {
      const files = getFilesUnderPath(node);
      const allSelected = files.every(f => selectedPaths.has(f));
      
      if (allSelected) {
        files.forEach(f => newSelected.delete(f));
      } else {
        files.forEach(f => newSelected.add(f));
      }
    } else {
      if (newSelected.has(node.path)) {
        newSelected.delete(node.path);
      } else {
        newSelected.add(node.path);
      }
    }
    
    setSelectedPaths(newSelected);
  };

  // Check if folder is fully/partially selected
  const getFolderSelectionState = (node: TreeNode): "none" | "partial" | "all" => {
    const files = getFilesUnderPath(node);
    if (files.length === 0) return "none";
    const selectedCount = files.filter(f => selectedPaths.has(f)).length;
    if (selectedCount === 0) return "none";
    if (selectedCount === files.length) return "all";
    return "partial";
  };

  // Download backup
  const handleDownload = async (filename: string) => {
    setDownloadingId(filename);
    try {
      const { data, error } = await supabase.storage
        .from("backups")
        .download(filename);
      
      if (error) throw error;
      
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success("Backup downloaded");
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Download failed";
      toast.error(errorMessage);
    } finally {
      setDownloadingId(null);
    }
  };

  const openRestoreDialog = (backupName: string) => {
    setSelectedBackup(backupName);
    setSelectedPaths(new Set());
    setExpandedFolders(new Set());
    setRestoreDialogOpen(true);
  };

  const handleRestore = () => {
    if (selectedPaths.size === 0) {
      toast.error("Please select files to restore");
      return;
    }
    restoreMutation.mutate({ paths: Array.from(selectedPaths), mode: restoreMode });
  };

  const formatFileSize = (bytes: number): string => {
    if (!bytes || bytes === 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const extractDateFromFilename = (filename: string): Date | null => {
    const match = filename.match(/vault-backup-(\d{4}-\d{2}-\d{2})\.zip/);
    if (match) return new Date(match[1]);
    return null;
  };

  // Get icon for node based on path/name
  const getNodeIcon = (node: TreeNode) => {
    const pathLower = node.path.toLowerCase();
    const nameLower = node.name.toLowerCase();
    
    if (node.isFolder) {
      if (pathLower.startsWith("clubs/") && pathLower.split("/").length === 2) {
        return <Building2 className="h-4 w-4 text-primary flex-shrink-0" />;
      }
      if (nameLower === "teams" || pathLower.includes("/teams/")) {
        return <Users className="h-4 w-4 text-blue-500 flex-shrink-0" />;
      }
      if (nameLower === "events") {
        return <CalendarDays className="h-4 w-4 text-orange-500 flex-shrink-0" />;
      }
      if (nameLower === "messages" || nameLower === "chat_groups") {
        return <MessageSquare className="h-4 w-4 text-green-500 flex-shrink-0" />;
      }
      if (nameLower === "photos") {
        return <Image className="h-4 w-4 text-purple-500 flex-shrink-0" />;
      }
      if (nameLower === "rewards") {
        return <Gift className="h-4 w-4 text-pink-500 flex-shrink-0" />;
      }
      if (nameLower === "sponsors") {
        return <Shield className="h-4 w-4 text-yellow-500 flex-shrink-0" />;
      }
      if (nameLower === "roles" || nameLower === "invites") {
        return <Users className="h-4 w-4 text-cyan-500 flex-shrink-0" />;
      }
      return <FolderOpen className="h-4 w-4 text-primary flex-shrink-0" />;
    }
    
    // Files
    if (nameLower.endsWith(".json")) {
      return <File className="h-4 w-4 text-yellow-600 flex-shrink-0" />;
    }
    if (nameLower.match(/\.(jpg|jpeg|png|gif|webp)$/)) {
      return <Image className="h-4 w-4 text-purple-500 flex-shrink-0" />;
    }
    return <File className="h-4 w-4 text-muted-foreground flex-shrink-0" />;
  };

  // Render tree node
  const renderTreeNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    if (!node.name) {
      // Root node - render children
      return Array.from(node.children.values()).map(child => renderTreeNode(child, 0));
    }

    const isExpanded = expandedFolders.has(node.path);
    const selectionState = node.isFolder ? getFolderSelectionState(node) : (selectedPaths.has(node.path) ? "all" : "none");

    return (
      <div key={node.path}>
        <div 
          className="flex items-center gap-2 py-1.5 px-2 hover:bg-muted/50 rounded cursor-pointer"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => {
            if (node.isFolder) {
              const newExpanded = new Set(expandedFolders);
              if (isExpanded) {
                newExpanded.delete(node.path);
              } else {
                newExpanded.add(node.path);
              }
              setExpandedFolders(newExpanded);
            }
          }}
        >
          {node.isFolder ? (
            isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          ) : (
            <span className="w-4" />
          )}
          
          <Checkbox
            checked={selectionState === "all"}
            ref={(el) => {
              if (el && selectionState === "partial") {
                (el as unknown as HTMLInputElement).indeterminate = true;
              }
            }}
            onCheckedChange={() => toggleSelection(node)}
            onClick={(e) => e.stopPropagation()}
          />
          
          {getNodeIcon(node)}
          
          <span className="text-sm truncate flex-1">{node.name}</span>
          
          {!node.isFolder && node.size > 0 && (
            <span className="text-xs text-muted-foreground">{formatFileSize(node.size)}</span>
          )}
        </div>
        
        {node.isFolder && isExpanded && (
          <div>
            {Array.from(node.children.values()).map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (isLoadingAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAppAdmin) {
    return (
      <div className="container max-w-4xl mx-auto py-8 px-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Access Denied</AlertTitle>
          <AlertDescription>
            You don't have permission to access this page. Only app administrators can manage backups.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const tree = backupContents?.entries ? buildTree(backupContents.entries.filter(e => !e.isFolder)) : null;

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Club Backups</h1>
          <p className="text-muted-foreground">Manage comprehensive club backup archives</p>
        </div>
      </div>

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileArchive className="h-5 w-5" />
            Comprehensive Club Backups
          </CardTitle>
          <CardDescription>
            Full club backups are created daily at 2:00 AM UTC and retained for 30 days.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* What's included */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Building2 className="h-4 w-4 text-primary" />
              <span>Clubs & Teams</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <CalendarDays className="h-4 w-4 text-primary" />
              <span>Events & RSVPs</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <MessageSquare className="h-4 w-4 text-primary" />
              <span>Chat Messages</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Image className="h-4 w-4 text-primary" />
              <span>Photos & Files</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Users className="h-4 w-4 text-primary" />
              <span>Members & Roles</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Gift className="h-4 w-4 text-primary" />
              <span>Rewards & Sponsors</span>
            </div>
          </div>
          
          <Button
            onClick={() => triggerBackupMutation.mutate()}
            disabled={triggerBackupMutation.isPending}
          >
            {triggerBackupMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating Backup...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Create Backup Now
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Backups List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Available Backups</CardTitle>
            <CardDescription>
              {backups?.length || 0} backup{(backups?.length || 0) !== 1 ? "s" : ""} available
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {isLoadingBackups ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="h-9 w-24" />
                </div>
              ))}
            </div>
          ) : backups && backups.length > 0 ? (
            <div className="space-y-3">
              {backups.map((backup, index) => {
                const backupDate = extractDateFromFilename(backup.name);
                const isLatest = index === 0;
                
                return (
                  <div
                    key={backup.id || backup.name}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <FileArchive className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">{backup.name}</span>
                          {isLatest && (
                            <Badge variant="secondary" className="text-xs">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Latest
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          {backupDate && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {format(backupDate, "MMMM d, yyyy")}
                            </span>
                          )}
                          {backup.metadata && typeof backup.metadata.size === 'number' && (
                            <span className="flex items-center gap-1">
                              <HardDrive className="h-3 w-3" />
                              {formatFileSize(backup.metadata.size as number)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openRestoreDialog(backup.name)}
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Restore
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDownload(backup.name)}
                        disabled={downloadingId === backup.name}
                      >
                        {downloadingId === backup.name ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Download className="h-4 w-4 mr-2" />
                            Download
                          </>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openDeleteDialog(backup.name)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <FileArchive className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No backups available yet</p>
              <p className="text-sm">Create a backup or wait for the daily automated backup</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Restore Dialog */}
      <Dialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5" />
              Restore from Backup
            </DialogTitle>
            <DialogDescription>
              Select files and folders to restore. Files will be restored to their original clubs/teams.
            </DialogDescription>
          </DialogHeader>

          {isLoadingContents ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : tree ? (
            <>
              {/* Restore Mode Selection */}
              <div className="border rounded-lg p-4 space-y-3">
                <Label className="text-sm font-medium">Restore Mode</Label>
                <RadioGroup value={restoreMode} onValueChange={(v) => setRestoreMode(v as "files_only" | "full")}>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="files_only" id="files_only" />
                    <Label htmlFor="files_only" className="text-sm font-normal">
                      <span className="font-medium">Files Only</span> - Restore photos and documents only
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="full" id="full" />
                    <Label htmlFor="full" className="text-sm font-normal">
                      <span className="font-medium">Full Restore</span> - Restore files, events, sponsors, rewards, and other data
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="flex items-center justify-between py-2 border-b">
                <span className="text-sm text-muted-foreground">
                  {backupContents?.totalFiles || 0} files, {backupContents?.totalFolders || 0} folders
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const allFiles = backupContents?.entries.filter(e => !e.isFolder).map(e => e.path) || [];
                      setSelectedPaths(new Set(allFiles));
                    }}
                  >
                    Select All
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedPaths(new Set())}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              
              <ScrollArea className="flex-1 min-h-0 border rounded-md">
                <div className="p-2">
                  {renderTreeNode(tree)}
                </div>
              </ScrollArea>
              
              {selectedPaths.size > 0 && (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>
                    {selectedPaths.size} file{selectedPaths.size !== 1 ? "s" : ""} selected for restore
                  </AlertDescription>
                </Alert>
              )}
            </>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <AlertCircle className="h-8 w-8 mx-auto mb-2" />
              <p>Failed to load backup contents</p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleRestore}
              disabled={selectedPaths.size === 0 || restoreMutation.isPending}
            >
              {restoreMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Restoring...
                </>
              ) : (
                <>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Restore {selectedPaths.size} File{selectedPaths.size !== 1 ? "s" : ""}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Backup
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this backup? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          
          {backupToDelete && (
            <div className="p-4 border rounded-lg bg-muted/50">
              <div className="flex items-center gap-3">
                <FileArchive className="h-8 w-8 text-muted-foreground" />
                <div>
                  <p className="font-medium">{backupToDelete}</p>
                  {extractDateFromFilename(backupToDelete) && (
                    <p className="text-sm text-muted-foreground">
                      {format(extractDateFromFilename(backupToDelete)!, "MMMM d, yyyy")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Backup
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
