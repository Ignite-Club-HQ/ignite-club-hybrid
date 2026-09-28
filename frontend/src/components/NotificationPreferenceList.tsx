import type { LucideIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export type NotificationPreferenceDescriptor<TKey extends string> = {
  key: TKey;
  icon: LucideIcon;
  label: string;
  description: string;
  disabled?: (values: Readonly<Partial<Record<TKey, boolean>>>) => boolean;
};

type NotificationPreferenceListProps<TKey extends string> = {
  descriptors: readonly NotificationPreferenceDescriptor<TKey>[];
  values: Readonly<Partial<Record<TKey, boolean>>>;
  onChange: (key: TKey, value: boolean) => void;
  disabled?: boolean;
  className?: string;
};

export function NotificationPreferenceList<TKey extends string>({
  descriptors,
  values,
  onChange,
  disabled,
  className,
}: NotificationPreferenceListProps<TKey>) {
  return (
    <div className={className}>
      {descriptors.map(({ key, icon: Icon, label, description, disabled: descriptorDisabled }) => (
        <div className="flex items-center justify-between" key={key}>
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <div>
              <Label>{label}</Label>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
          </div>
          <Switch
            checked={values[key] ?? false}
            onCheckedChange={(value) => onChange(key, value)}
            disabled={disabled || descriptorDisabled?.(values)}
          />
        </div>
      ))}
    </div>
  );
}
