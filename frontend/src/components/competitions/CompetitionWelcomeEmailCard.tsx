import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, Loader2, FileText, Upload, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const MAX = 1500;
const BUCKET = "competition-documents";

interface Row {
  player_welcome_message: string | null;
  code_of_conduct_path: string | null;
  code_of_conduct_name: string | null;
}

/**
 * Player welcome email for a competition. Sent in place of the standard
 * invite wording when a player is invited to a team entered in this
 * competition. `{team}` is replaced with the player's team name; app store
 * and "join your team" buttons are always added below the message, and the
 * Code of Conduct (if uploaded) is included as a secure link.
 */
export function CompetitionWelcomeEmailCard({ competitionId }: { competitionId: string }) {
  const qc = useQueryClient();
  const queryKey = ["competition-welcome-email", competitionId];
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitions")
        .select("player_welcome_message, code_of_conduct_path, code_of_conduct_name" as "id")
        .eq("id", competitionId)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as Row) ?? null;
    },
  });

  const [value, setValue] = useState("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (data !== undefined && !dirty) setValue(data?.player_welcome_message ?? "");
  }, [data, dirty]);

  const update = async (patch: Partial<Row>) => {
    const { error } = await supabase
      .from("competitions")
      .update(patch as never)
      .eq("id", competitionId);
    if (error) throw error;
  };

  const saveMsg = useMutation({
    mutationFn: async (msg: string) => {
      const t = msg.trim();
      await update({ player_welcome_message: t.length ? t : null });
    },
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey });
      toast.success("Welcome email saved");
    },
    onError: (e: Error) => toast.error("Couldn't save: " + e.message),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 10 * 1024 * 1024) throw new Error("File must be under 10 MB");
      const ext = (file.name.split(".").pop() || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${competitionId}/code-of-conduct-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || "application/pdf",
        upsert: false,
      });
      if (error) throw error;
      const old = data?.code_of_conduct_path;
      await update({ code_of_conduct_path: path, code_of_conduct_name: file.name });
      if (old) await supabase.storage.from(BUCKET).remove([old]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success("Code of Conduct uploaded");
    },
    onError: (e: Error) => toast.error("Upload failed: " + e.message),
  });

  const removeFile = useMutation({
    mutationFn: async () => {
      const old = data?.code_of_conduct_path;
      await update({ code_of_conduct_path: null, code_of_conduct_name: null });
      if (old) await supabase.storage.from(BUCKET).remove([old]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success("Code of Conduct removed");
    },
    onError: (e: Error) => toast.error("Couldn't remove: " + e.message),
  });

  const viewFile = async () => {
    if (!data?.code_of_conduct_path) return;
    const { data: s, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(data.code_of_conduct_path, 300);
    if (error || !s?.signedUrl) return toast.error("Couldn't open file");
    window.open(s.signedUrl, "_blank", "noopener");
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Player welcome email
        </CardTitle>
        <CardDescription>
          Sent to each player invited to a team in this competition. Write <strong>{"{team}"}</strong> where
          their team name should go. Buttons to download the app on iPhone and Android and to join their
          team are added automatically below your message.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Textarea
            value={value}
            onChange={(e) => {
              setValue(e.target.value.slice(0, MAX));
              setDirty(true);
            }}
            rows={10}
            placeholder={"Welcome to the season!\n\nYou're on Team {team}.\n\nPlease download the app using the buttons below and join your team."}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {value.length}/{MAX}
            </span>
            <div className="flex gap-2">
              {dirty && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setValue(data?.player_welcome_message ?? "");
                    setDirty(false);
                  }}
                >
                  Cancel
                </Button>
              )}
              <Button size="sm" disabled={!dirty || saveMsg.isPending} onClick={() => saveMsg.mutate(value)}>
                {saveMsg.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border p-3 space-y-2">
          <p className="text-sm font-medium">Code of Conduct</p>
          <p className="text-xs text-muted-foreground">
            Added as a "Read the Code of Conduct" button under your message. PDF, up to 10 MB.
          </p>
          {data?.code_of_conduct_path ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={viewFile}
                className="flex items-center gap-2 min-w-0 flex-1 text-left text-sm text-primary"
              >
                <FileText className="h-4 w-4 shrink-0" />
                <span className="truncate">{data.code_of_conduct_name || "Code of Conduct"}</span>
              </button>
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
                Replace
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove Code of Conduct"
                onClick={() => removeFile.mutate()}
                disabled={removeFile.isPending}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
              Upload Code of Conduct
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf,.doc,.docx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) upload.mutate(f);
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export default CompetitionWelcomeEmailCard;
