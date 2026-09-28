import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO } from "date-fns";
import { AlertTriangle, Heart, Megaphone, MessageSquare, type LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export type MessageVolumePoint = {
  day: string;
  Club: number;
  "Team / group": number;
};

type CommunicationEngagementSectionProps = {
  clubMessages: number;
  teamMessages: number;
  reactions: number;
  broadcasts: number;
  isLoading: boolean;
  hasError: boolean;
  volume: MessageVolumePoint[];
};

const tooltipStyle = {
  background: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
};

function EmptyState({ label }: { label: string }) {
  return <div className="text-center text-sm text-muted-foreground py-8">{label}</div>;
}

function Metric({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-muted-foreground text-[11px]">
          <Icon className="h-3.5 w-3.5" />
          <span className="truncate">{label}</span>
        </div>
        {loading ? (
          <Skeleton className="h-7 w-16 mt-1" />
        ) : (
          <div className="mt-1 text-xl font-bold">{value.toLocaleString()}</div>
        )}
      </CardContent>
    </Card>
  );
}

export function CommunicationEngagementSection({
  clubMessages,
  teamMessages,
  reactions,
  broadcasts,
  isLoading,
  hasError,
  volume,
}: CommunicationEngagementSectionProps) {
  return (
    <>
      <div className="flex items-center gap-2 pt-2">
        <MessageSquare className="h-4 w-4 text-primary" />
        <div>
          <h2 className="text-base font-semibold leading-tight">Communication</h2>
          <p className="text-xs text-muted-foreground">Messaging &amp; broadcast activity</p>
        </div>
      </div>
      {hasError && (
        <Card className="border-destructive/50">
          <CardContent className="p-3 flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>Message analytics could not load. Try refreshing; if it persists, the admin analytics query is still failing.</span>
          </CardContent>
        </Card>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Metric icon={MessageSquare} label="Club messages" value={clubMessages} loading={isLoading} />
        <Metric icon={MessageSquare} label="Team / group messages" value={teamMessages} loading={isLoading} />
        <Metric icon={Heart} label="Reactions" value={reactions} loading={isLoading} />
        <Metric icon={Megaphone} label="Broadcasts" value={broadcasts} loading={isLoading} />
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Message volume</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : clubMessages + teamMessages === 0 ? (
            <EmptyState label="No messages sent in this period." />
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={volume}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="day" tickFormatter={(d) => format(parseISO(d), "M/d")} fontSize={11} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Club" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Team / group" fill="hsl(142 70% 45%)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
