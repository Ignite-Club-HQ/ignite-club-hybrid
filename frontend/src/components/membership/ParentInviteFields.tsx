import { Mail, Search, X } from "lucide-react";
import type { FocusEvent } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ParentInviteSuggestion {
  id: string;
  name: string;
  avatarUrl?: string | null;
  secondaryText?: string;
}

export interface ParentInviteFieldsProps {
  idPrefix: string;
  name: string;
  email: string;
  searchValue: string;
  nameLabel: string;
  emailLabel: string;
  namePlaceholder: string;
  emailPlaceholder: string;
  suggestions: readonly ParentInviteSuggestion[];
  selectedSuggestion?: ParentInviteSuggestion;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onSelectSuggestion: (suggestion: ParentInviteSuggestion) => void;
  onClearSelection: () => void;
  onFocus?: (event: FocusEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
  requiredMessage?: string;
  emptyMessage?: string;
}

export function ParentInviteFields({
  idPrefix,
  name,
  email,
  searchValue,
  nameLabel,
  emailLabel,
  namePlaceholder,
  emailPlaceholder,
  suggestions,
  selectedSuggestion,
  onNameChange,
  onEmailChange,
  onSearchChange,
  onSelectSuggestion,
  onClearSelection,
  onFocus,
  onBlur,
  requiredMessage,
  emptyMessage,
}: ParentInviteFieldsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="space-y-2 relative">
        <Label htmlFor={`${idPrefix}-name`}>{nameLabel}</Label>
        {selectedSuggestion ? (
          <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-2">
            <Avatar className="h-7 w-7">
              <AvatarImage src={selectedSuggestion.avatarUrl || undefined} />
              <AvatarFallback className="bg-primary/20 text-primary text-xs">
                {selectedSuggestion.name[0]?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{selectedSuggestion.name}</p>
              <p className="text-[10px] text-muted-foreground">Existing parent</p>
            </div>
            <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={onClearSelection}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              id={`${idPrefix}-name`}
              placeholder={namePlaceholder}
              value={searchValue || name}
              onFocus={onFocus}
              onBlur={onBlur}
              onChange={(event) => {
                onNameChange(event.target.value);
                onSearchChange(event.target.value);
              }}
              className="pl-9"
            />
            {suggestions.length > 0 && (
              <div className="absolute z-20 top-full left-0 right-0 mt-1 space-y-1 max-h-48 overflow-y-auto rounded-lg border bg-muted/30 p-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    className="w-full text-left p-2 rounded-lg hover:bg-background transition-colors text-sm"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      onSelectSuggestion(suggestion);
                    }}
                  >
                    <p className="font-medium">{suggestion.name}</p>
                    {suggestion.secondaryText && (
                      <p className="text-xs text-muted-foreground">{suggestion.secondaryText}</p>
                    )}
                  </button>
                ))}
              </div>
            )}
            {emptyMessage && searchValue.trim().length >= 2 && suggestions.length === 0 && (
              <p className="absolute z-20 top-full left-0 right-0 mt-1 rounded-lg border bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
                {emptyMessage}
              </p>
            )}
          </>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-email`}>{emailLabel}</Label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            id={`${idPrefix}-email`}
            type="email"
            placeholder={emailPlaceholder}
            value={email}
            disabled={Boolean(selectedSuggestion)}
            onChange={(event) => onEmailChange(event.target.value)}
            className="pl-9"
          />
        </div>
        {requiredMessage && !selectedSuggestion && name.trim() && !email.trim() && (
          <p className="text-xs text-destructive">{requiredMessage}</p>
        )}
      </div>
    </div>
  );
}
