import { File, FileImage } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

interface VaultStorageBreakdownProps {
  photos: number;
  documents: number;
  formatStorageSize: (bytes: number) => string;
}

export function VaultStorageBreakdown({
  photos,
  documents,
  formatStorageSize,
}: VaultStorageBreakdownProps) {
  const items = [
    { name: "Photos", value: photos, color: "hsl(var(--primary))" },
    { name: "Documents", value: documents, color: "hsl(var(--muted-foreground))" },
  ].filter((item) => item.value > 0);

  return (
    <div className="flex items-center gap-4">
      <div className="w-16 h-16">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={items}
              cx="50%"
              cy="50%"
              innerRadius={16}
              outerRadius={28}
              paddingAngle={2}
              dataKey="value"
            >
              {items.map((item, index) => (
                <Cell key={`cell-${index}`} fill={item.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2 text-xs">
          <div className="w-2 h-2 rounded-sm bg-primary shrink-0" />
          <FileImage className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Photos</span>
          <span className="ml-auto font-medium">{formatStorageSize(photos)}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <div className="w-2 h-2 rounded-sm bg-muted-foreground shrink-0" />
          <File className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Documents</span>
          <span className="ml-auto font-medium">{formatStorageSize(documents)}</span>
        </div>
      </div>
    </div>
  );
}
